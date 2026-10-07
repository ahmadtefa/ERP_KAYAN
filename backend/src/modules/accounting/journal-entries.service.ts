import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JournalStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DocumentNumberService } from './document-number.service';
import { CreateJournalEntryDto, JournalLineDto } from './dto/create-journal-entry.dto';
import { FiscalPeriodsService } from './fiscal-periods.service';

const MONEY_SCALE = 4;

/** A line reduced to a single signed amount for netting. */
interface NormalisedLine {
  accountId: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  description?: string;
  costCenterId?: string;
}

@Injectable()
export class JournalEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: DocumentNumberService,
    private readonly audit: AuditService,
    private readonly periods: FiscalPeriodsService,
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
          lines: { orderBy: { lineNumber: 'asc' } },
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
        lines: { orderBy: { lineNumber: 'asc' } },
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
            })),
          },
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
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
    if (entry.status !== JournalStatus.DRAFT) {
      throw new BadRequestException(
        `Only draft entries can be posted (current status: ${entry.status})`,
      );
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
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
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

  /**
   * Reverses a posted entry by creating a mirror-image entry.
   *
   * Posted entries are never edited or deleted: the reversal preserves the
   * audit trail, which is the whole point of double-entry bookkeeping.
   */
  async reverse(companyId: string, userId: string, id: string) {
    const original = await this.prisma.journalEntry.findFirst({
      where: { id, companyId },
      include: { lines: true },
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
          entryDate: new Date(),
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

    return {
      accountId: line.accountId,
      debit,
      credit,
      description: line.description,
      costCenterId: line.costCenterId,
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
          debit: l.debit.toFixed(MONEY_SCALE),
          credit: l.credit.toFixed(MONEY_SCALE),
          description: l.description,
          costCenterId: l.costCenterId,
        })) ?? [],
    };
  }
}
