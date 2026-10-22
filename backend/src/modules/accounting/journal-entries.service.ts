import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JournalStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { accountName } from '../../common/localization/account-name';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanySettingsService } from '../../common/settings/company-settings.module';
import { CostCentersService } from './cost-centers.service';
import { DocumentNumberService } from './document-number.service';
import { CreateJournalEntryDto, JournalLineDto } from './dto/create-journal-entry.dto';
import { FiscalPeriodsService } from './fiscal-periods.service';

const MONEY_SCALE = 4;

/// Every read of journal lines brings the account's names along, so a line can
/// be shown in either language without a second query — and without the client
/// joining the chart of accounts by hand.
const LINES_WITH_ACCOUNT = {
  orderBy: { lineNumber: 'asc' },
  include: {
    account: { select: { id: true, code: true, nameEn: true, nameAr: true } },
    costCenter: { select: { id: true, code: true, nameEn: true, nameAr: true } },
    allocations: {
      include: {
        costCenter: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      },
    },
  },
} as const;

/** A line reduced to a single signed amount for netting. */
interface NormalisedLine {
  accountId: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  description?: string;
  costCenterId?: string;
  allocations: Array<{ costCenterId: string; amount: Prisma.Decimal }>;
}

@Injectable()
export class JournalEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: DocumentNumberService,
    private readonly audit: AuditService,
    private readonly periods: FiscalPeriodsService,
    private readonly settings: CompanySettingsService,
    private readonly costCenters: CostCentersService,
  ) {}

  async findAll(companyId: string, page = 1, pageSize = 50) {
    const safeSize = Math.min(Math.max(pageSize, 1), 200);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.journalEntry.findMany({
        where: { companyId },
        orderBy: [{ entryDate: 'desc' }, { entryNumber: 'desc' }],
        skip: (page - 1) * safeSize,
        take: safeSize,
        include: {
          lines: LINES_WITH_ACCOUNT,
          branch: { select: { code: true, nameEn: true, nameAr: true } },
        },
      }),
      this.prisma.journalEntry.count({ where: { companyId } }),
    ]);

    return {
      items: items.map((e) => this.toResponse(e)),
      total,
      page,
      pageSize: safeSize,
    };
  }

  async findOne(companyId: string, id: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, companyId },
      include: {
        lines: LINES_WITH_ACCOUNT,
        branch: { select: { code: true, nameEn: true, nameAr: true } },
      },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    return this.toResponse(entry);
  }

  /**
   * Creates a DRAFT entry.
   *
   * The double-entry invariant is enforced here, on the server, using exact
   * decimal arithmetic. A client that sends an unbalanced entry is rejected —
   * the check is not a UI convenience.
   */
  async create(
    companyId: string,
    branchId: string | null,
    userId: string,
    dto: CreateJournalEntryDto,
  ) {
    if (!branchId) {
      throw new BadRequestException(
        'The signed-in user is not assigned to a branch',
      );
    }

    const lines = dto.lines.map((l) => this.normaliseLine(l));

    const totalDebit = lines.reduce(
      (sum, l) => sum.plus(l.debit),
      new Prisma.Decimal(0),
    );
    const totalCredit = lines.reduce(
      (sum, l) => sum.plus(l.credit),
      new Prisma.Decimal(0),
    );

    if (!totalDebit.equals(totalCredit)) {
      throw new BadRequestException({
        message: 'Journal entry is not balanced',
        errors: {
          totalDebit: totalDebit.toFixed(MONEY_SCALE),
          totalCredit: totalCredit.toFixed(MONEY_SCALE),
          difference: totalDebit.minus(totalCredit).toFixed(MONEY_SCALE),
        },
      });
    }

    // Only postable, active accounts of this company may be used.
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: accountIds }, companyId, deletedAt: null },
      select: { id: true, isPostable: true, isActive: true, code: true },
    });

    if (accounts.length !== accountIds.length) {
      throw new BadRequestException('One or more accounts do not exist');
    }
    const notPostable = accounts.filter((a) => !a.isPostable);
    if (notPostable.length > 0) {
      throw new BadRequestException(
        `Accounts cannot receive postings (grouping accounts): ${notPostable
          .map((a) => a.code)
          .join(', ')}`,
      );
    }
    const inactive = accounts.filter((a) => !a.isActive);
    if (inactive.length > 0) {
      throw new BadRequestException(
        `Accounts are inactive: ${inactive.map((a) => a.code).join(', ')}`,
      );
    }

    // The analytical dimension is validated against this company and the entry
    // date before anything is written: an inactive centre, another company's
    // centre or a centre outside its validity window is refused, not stored.
    await this.costCenters.assertPostable(
      this.prisma,
      companyId,
      lines.flatMap((l) => [
        ...(l.costCenterId ? [l.costCenterId] : []),
        ...l.allocations.map((a) => a.costCenterId),
      ]),
      new Date(dto.entryDate),
    );

    // Number allocation and the insert share one transaction: if the insert
    // fails, the reserved number is rolled back with it.
    const created = await this.prisma.$transaction(async (tx) => {
      const entryNumber = await this.numbers.next(
        tx,
        companyId,
        'JOURNAL',
        'JV',
      );

      return tx.journalEntry.create({
        data: {
          companyId,
          branchId,
          entryNumber,
          entryDate: new Date(dto.entryDate),
          description: dto.description ?? null,
          status: JournalStatus.DRAFT,
          totalDebit,
          totalCredit,
          createdBy: userId,
          lines: {
            create: lines.map((l, index) => ({
              lineNumber: index + 1,
              accountId: l.accountId,
              debit: l.debit,
              credit: l.credit,
              description: l.description ?? null,
              costCenterId: l.costCenterId ?? null,
              allocations: {
                create: l.allocations.map((allocation) => ({
                  costCenterId: allocation.costCenterId,
                  amount: allocation.amount,
                })),
              },
            })),
          },
        },
        include: { lines: LINES_WITH_ACCOUNT },
      });
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'journal_entries',
      entityId: created.id,
      after: {
        entryNumber: created.entryNumber,
        totalDebit: created.totalDebit.toFixed(MONEY_SCALE),
        totalCredit: created.totalCredit.toFixed(MONEY_SCALE),
      },
    });

    return this.toResponse(created);
  }

  /**
   * Posts a draft entry. Re-validates the balance so a row edited directly in
   * the database cannot be posted unbalanced.
   */
  async post(companyId: string, userId: string, id: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, companyId },
      include: { lines: true },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    if (entry.status !== JournalStatus.DRAFT && entry.status !== JournalStatus.APPROVED) {
      throw new BadRequestException(
        `Only a draft or an approved entry can be posted (current status: ${entry.status})`,
      );
    }

    const policy = await this.settings.get(companyId);

    // A company that wants its manual entries reviewed says so once, in its
    // settings, and the rule is enforced here - not by the screen hiding a
    // button. A draft can only reach the ledger through an approval.
    if (entry.status === JournalStatus.DRAFT && policy.approvalRequiredForJournal) {
      throw new BadRequestException(
        'This company requires manual journal entries to be approved before posting. Submit the entry for approval first.',
      );
    }

    // Separation of duties: whoever wrote an entry does not also approve or
    // post it. Skipped for a super administrator, who is the escape hatch a
    // small company needs when the accountant is on holiday.
    if (policy.segregationOfDuties && !entry.reversalOfId && !(await this.isSuperAdmin(userId))) {
      if (entry.status === JournalStatus.APPROVED && entry.approvedBy === entry.createdBy) {
        throw new BadRequestException(
          'Separation of duties is on: the person who approved this entry may not post it, and the person who wrote it may not approve it.',
        );
      }
      if (entry.createdBy === userId && entry.approvedBy !== userId) {
        throw new BadRequestException(
          'Separation of duties is on: the person who created this entry may not post it.',
        );
      }
    }

    if (!entry.totalDebit.equals(entry.totalCredit)) {
      throw new BadRequestException('Journal entry is not balanced');
    }

    // A manual entry goes straight to the ledger, so it has to respect the
    // same closed-period rule the documents do. Without this check a closed
    // year could still be written to by hand.
    const period = await this.periods.periodFor(
      this.prisma,
      companyId,
      entry.entryDate,
    );
    if (period && period.status === 'CLOSED') {
      throw new BadRequestException(
        `Period ${period.code} is closed, so nothing can be posted on ${entry.entryDate
          .toISOString()
          .slice(0, 10)}`,
      );
    }

    const updated = await this.prisma.journalEntry.update({
      where: { id },
      data: {
        status: JournalStatus.POSTED,
        postedAt: new Date(),
        postedBy: userId,
      },
      include: { lines: LINES_WITH_ACCOUNT },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'POST',
      entity: 'journal_entries',
      entityId: id,
      before: { status: entry.status },
      after: { status: updated.status },
    });

    return this.toResponse(updated);
  }

  /// Moves a draft to "waiting for approval".
  ///
  /// Asking for a review is not the same as posting: nothing reaches the
  /// ledger, and the entry can still be cancelled or corrected by its author.
  async submitForApproval(companyId: string, userId: string, id: string) {
    const entry = await this.requireStatus(companyId, id, [JournalStatus.DRAFT]);
    const updated = await this.prisma.journalEntry.update({
      where: { id: entry.id },
      data: {
        status: JournalStatus.PENDING_APPROVAL,
        submittedAt: new Date(),
        submittedBy: userId,
      },
      include: { lines: LINES_WITH_ACCOUNT },
    });
    await this.audit.record({
      companyId,
      userId,
      action: 'SUBMIT',
      entity: 'journal_entries',
      entityId: id,
      before: { status: entry.status },
      after: { status: updated.status },
    });
    return this.toResponse(updated);
  }

  /// Approves an entry that is waiting. The approver's identity is recorded on
  /// the entry itself, so the report that asks "who approved this?" does not
  /// have to search the audit trail.
  async approve(companyId: string, userId: string, id: string) {
    const entry = await this.requireStatus(companyId, id, [JournalStatus.PENDING_APPROVAL]);
    const policy = await this.settings.get(companyId);

    if (
      policy.segregationOfDuties &&
      entry.createdBy === userId &&
      !(await this.isSuperAdmin(userId))
    ) {
      throw new BadRequestException(
        'Separation of duties is on: an entry cannot be approved by the person who created it.',
      );
    }

    const updated = await this.prisma.journalEntry.update({
      where: { id: entry.id },
      data: { status: JournalStatus.APPROVED, approvedAt: new Date(), approvedBy: userId },
      include: { lines: LINES_WITH_ACCOUNT },
    });
    await this.audit.record({
      companyId,
      userId,
      action: 'APPROVE',
      entity: 'journal_entries',
      entityId: id,
      before: { status: entry.status },
      after: { status: updated.status },
    });
    return this.toResponse(updated);
  }

  /// Cancels a draft, a submitted entry or an approved one.
  ///
  /// A posted entry is never cancelled: it is reversed, because the books must
  /// show that something was posted and then taken back. A cancelled entry
  /// keeps its number and its reason, and is excluded from every report.
  async cancel(companyId: string, userId: string, id: string, reason?: string) {
    const entry = await this.requireStatus(companyId, id, [
      JournalStatus.DRAFT,
      JournalStatus.PENDING_APPROVAL,
      JournalStatus.APPROVED,
    ]);

    const updated = await this.prisma.journalEntry.update({
      where: { id: entry.id },
      data: {
        status: JournalStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: userId,
        cancelReason: reason?.trim() || null,
      },
      include: { lines: LINES_WITH_ACCOUNT },
    });
    await this.audit.record({
      companyId,
      userId,
      action: 'CANCEL',
      entity: 'journal_entries',
      entityId: id,
      before: { status: entry.status },
      after: { status: updated.status, reason: reason ?? null },
    });
    return this.toResponse(updated);
  }

  private async requireStatus(
    companyId: string,
    id: string,
    allowed: JournalStatus[],
  ): Promise<{ id: string; status: JournalStatus; createdBy: string | null; approvedBy: string | null }> {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, companyId },
      select: { id: true, status: true, createdBy: true, approvedBy: true },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    if (!allowed.includes(entry.status)) {
      throw new BadRequestException(
        `This action is not allowed while the entry is ${entry.status}. Allowed from: ${allowed.join(', ')}.`,
      );
    }
    return entry;
  }

  private async isSuperAdmin(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });
    return user?.isSuperAdmin ?? false;
  }

  /**
   * Reverses a posted entry by creating a mirror-image entry.
   *
   * Posted entries are never edited or deleted: the reversal preserves the
   * audit trail, which is the whole point of double-entry bookkeeping.
   */
  async reverse(companyId: string, userId: string, id: string) {
    const original = await this.prisma.journalEntry.findFirst({
      where: { id, companyId },
      include: { lines: { include: { allocations: true } } },
    });
    if (!original) throw new NotFoundException('Journal entry not found');
    if (original.status !== JournalStatus.POSTED) {
      throw new BadRequestException('Only posted entries can be reversed');
    }

    const alreadyReversed = await this.prisma.journalEntry.findFirst({
      where: { reversalOfId: original.id },
      select: { id: true },
    });
    if (alreadyReversed) {
      throw new BadRequestException('This entry has already been reversed');
    }

    // The mirror entry is dated today; if today falls inside a closed
    // period it is refused like any other posting into one. (Posting into
    // a date no period covers stays allowed, as everywhere else.)
    const reversalDate = new Date();
    const period = await this.periods.periodFor(
      this.prisma,
      companyId,
      reversalDate,
    );
    if (period && period.status === 'CLOSED') {
      throw new BadRequestException(
        `Period ${period.code} is closed, so the reversal cannot be dated ${reversalDate
          .toISOString()
          .slice(0, 10)}`,
      );
    }

    const reversal = await this.prisma.$transaction(async (tx) => {
      const entryNumber = await this.numbers.next(
        tx,
        companyId,
        'JOURNAL',
        'JV',
      );

      const created = await tx.journalEntry.create({
        data: {
          companyId,
          branchId: original.branchId,
          entryNumber,
          entryDate: reversalDate,
          description: `Reversal of ${original.entryNumber}`,
          status: JournalStatus.POSTED,
          currency: original.currency,
          totalDebit: original.totalCredit,
          totalCredit: original.totalDebit,
          reversalOfId: original.id,
          postedAt: new Date(),
          postedBy: userId,
          createdBy: userId,
          lines: {
            create: original.lines.map((l) => ({
              lineNumber: l.lineNumber,
              accountId: l.accountId,
              // Sides are swapped.
              debit: l.credit,
              credit: l.debit,
              description: l.description,
              costCenterId: l.costCenterId,
              // The split is given back exactly as it was taken, so a
              // cost-center report nets a reversed entry to zero.
              allocations: {
                create: (l.allocations ?? []).map((allocation) => ({
                  costCenterId: allocation.costCenterId,
                  amount: allocation.amount,
                })),
              },
            })),
          },
        },
      });

      await tx.journalEntry.update({
        where: { id: original.id },
        data: { status: JournalStatus.REVERSED },
      });

      return created;
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'REVERSE',
      entity: 'journal_entries',
      entityId: original.id,
      after: { reversalId: reversal.id, reversalNumber: reversal.entryNumber },
    });

    return this.toResponse(reversal);
  }

  private normaliseLine(line: JournalLineDto): NormalisedLine {
    const rawDebit = line.debit ?? '0';
    const rawCredit = line.credit ?? '0';

    let debit: Prisma.Decimal;
    let credit: Prisma.Decimal;
    try {
      debit = new Prisma.Decimal(rawDebit).toDecimalPlaces(MONEY_SCALE);
      credit = new Prisma.Decimal(rawCredit).toDecimalPlaces(MONEY_SCALE);
    } catch {
      throw new BadRequestException(
        `Invalid amount on account ${line.accountId}`,
      );
    }

    if (debit.isNegative() || credit.isNegative()) {
      throw new BadRequestException('Amounts cannot be negative');
    }
    if (debit.isZero() && credit.isZero()) {
      throw new BadRequestException(
        'Every line needs either a debit or a credit',
      );
    }
    if (!debit.isZero() && !credit.isZero()) {
      throw new BadRequestException(
        'A line cannot be both a debit and a credit',
      );
    }

    const amount = debit.plus(credit);
    const requested = line.allocations ?? [];
    if (requested.length > 0 && line.costCenterId) {
      throw new BadRequestException(
        'A journal line cannot name one cost center and also be split between several',
      );
    }
    const allocations =
      requested.length > 0
        ? CostCentersService.validateAllocations(amount, requested)
        : [];
    // One allocation covering the whole line is the ordinary single-centre
    // case; storing it on the line keeps every existing report unchanged.
    if (allocations.length === 1) {
      return {
        accountId: line.accountId,
        debit,
        credit,
        description: line.description,
        costCenterId: allocations[0].costCenterId,
        allocations: [],
      };
    }

    return {
      accountId: line.accountId,
      debit,
      credit,
      description: line.description,
      costCenterId: line.costCenterId,
      allocations,
    };
  }

  private toResponse(entry: {
    id: string;
    companyId: string;
    branchId: string;
    entryNumber: string;
    entryDate: Date;
    description: string | null;
    status: JournalStatus;
    currency: string;
    totalDebit: Prisma.Decimal;
    totalCredit: Prisma.Decimal;
    reversalOfId: string | null;
    postedAt: Date | null;
    createdAt: Date;
    lines?: Array<{
      id: string;
      lineNumber: number;
      accountId: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      description: string | null;
      costCenterId: string | null;
      account?: {
        id: string;
        code: string;
        nameEn: string | null;
        nameAr: string | null;
      } | null;
      costCenter?: {
        id: string;
        code: string;
        nameEn: string;
        nameAr: string;
      } | null;
      allocations?: Array<{
        costCenterId: string;
        amount: Prisma.Decimal;
        costCenter?: { id: string; code: string; nameEn: string; nameAr: string } | null;
      }>;
    }>;
  }) {
    return {
      id: entry.id,
      companyId: entry.companyId,
      branchId: entry.branchId,
      entryNumber: entry.entryNumber,
      entryDate: entry.entryDate.toISOString().slice(0, 10),
      description: entry.description,
      status: entry.status.toLowerCase(),
      currency: entry.currency,
      // Amounts are strings on the wire so no precision is lost in JSON.
      totalDebit: entry.totalDebit.toFixed(MONEY_SCALE),
      totalCredit: entry.totalCredit.toFixed(MONEY_SCALE),
      reversalOfId: entry.reversalOfId,
      postedAt: entry.postedAt?.toISOString() ?? null,
      createdAt: entry.createdAt.toISOString(),
      lines:
        entry.lines?.map((l) => ({
          id: l.id,
          lineNumber: l.lineNumber,
          accountId: l.accountId,
          // Both names travel with the line, and `accountName` is the
          // server-side default (English with the documented fallbacks).
          // The client re-picks with the same rule for the language on screen.
          accountCode: l.account?.code ?? null,
          accountNameEn: l.account?.nameEn ?? null,
          accountNameAr: l.account?.nameAr ?? null,
          accountName: l.account
            ? accountName(l.account, 'en')
            : null,
          debit: l.debit.toFixed(MONEY_SCALE),
          credit: l.credit.toFixed(MONEY_SCALE),
          description: l.description,
          costCenterId: l.costCenterId,
          costCenterCode: l.costCenter?.code ?? null,
          costCenterNameEn: l.costCenter?.nameEn ?? null,
          costCenterNameAr: l.costCenter?.nameAr ?? null,
          // A split line reports its allocations; a single-centre line reports
          // an empty list and carries `costCenterId` instead. Clients must not
          // add the two together.
          allocations:
            l.allocations?.map((allocation) => ({
              costCenterId: allocation.costCenterId,
              costCenterCode: allocation.costCenter?.code ?? null,
              costCenterNameEn: allocation.costCenter?.nameEn ?? null,
              costCenterNameAr: allocation.costCenter?.nameAr ?? null,
              amount: allocation.amount.toFixed(MONEY_SCALE),
            })) ?? [],
        })) ?? [],
    };
  }
}
