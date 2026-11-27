import { branchWhere } from '../../common/auth/branch-read-scope';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { JournalStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { accountName } from '../../common/localization/account-name';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JOURNAL_PENDING_APPROVAL, dedupeKey } from '../notifications/notification-kinds';
import { CompanySettingsService } from '../../common/settings/company-settings.module';
import { CONTROL_ACCOUNT_CODES } from './account-map.service';
import { CostCentersService } from './cost-centers.service';
import { DocumentNumberService } from './document-number.service';
import { CreateJournalEntryDto, JournalLineDto } from './dto/create-journal-entry.dto';
import { FiscalPeriodsService } from './fiscal-periods.service';
import { PostingService } from './posting.service';

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
    private readonly posting: PostingService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async findAll(companyId: string, page = 1, pageSize = 50, branchScope: string[] | null = null) {
    const safeSize = Math.min(Math.max(pageSize, 1), 200);
    const where = { companyId, ...branchWhere(branchScope) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.journalEntry.findMany({
        where,
        orderBy: [{ entryDate: 'desc' }, { entryNumber: 'desc' }],
        skip: (page - 1) * safeSize,
        take: safeSize,
        include: {
          lines: LINES_WITH_ACCOUNT,
          branch: { select: { code: true, nameEn: true, nameAr: true } },
        },
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    return {
      items: items.map((e) => this.toResponse(e)),
      total,
      page,
      pageSize: safeSize,
    };
  }

  async findOne(companyId: string, id: string, branchScope: string[] | null = null) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, companyId, ...branchWhere(branchScope) },
      include: {
        lines: LINES_WITH_ACCOUNT,
        branch: { select: { code: true, nameEn: true, nameAr: true } },
      },
    });
    if (!entry) throw new NotFoundException({ code: 'JOURNAL_ENTRY_NOT_FOUND', message: 'Journal entry not found' });
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
      throw new BadRequestException({ code: 'JOURNAL_USER_NO_BRANCH', message: 'The signed-in user is not assigned to a branch' });
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
        code: 'JOURNAL_CREATE_UNBALANCED',
        message: 'Journal entry is not balanced',
        errors: {
          totalDebit: totalDebit.toFixed(MONEY_SCALE),
          totalCredit: totalCredit.toFixed(MONEY_SCALE),
          difference: totalDebit.minus(totalCredit).toFixed(MONEY_SCALE),
        },
        params: { totalDebit: totalDebit.toFixed(MONEY_SCALE), totalCredit: totalCredit.toFixed(MONEY_SCALE), difference: totalDebit.minus(totalCredit).toFixed(MONEY_SCALE) },
      });
    }

    // Only postable, active accounts of this company may be used.
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: accountIds }, companyId, deletedAt: null },
      select: { id: true, isPostable: true, isActive: true, code: true },
    });

    if (accounts.length !== accountIds.length) {
      throw new BadRequestException({ code: 'ACCOUNT_MISSING', message: 'One or more accounts do not exist' });
    }
    const notPostable = accounts.filter((a) => !a.isPostable);
    if (notPostable.length > 0) {
      throw new BadRequestException({ code: 'JOURNAL_ACCOUNT_GROUPING', message: `Accounts cannot receive postings (grouping accounts): ${notPostable
          .map((a) => a.code)
          .join(', ')}` });
    }
    const inactive = accounts.filter((a) => !a.isActive);
    if (inactive.length > 0) {
      throw new BadRequestException({ code: 'JOURNAL_ACCOUNT_INACTIVE', message: `Accounts are inactive: ${inactive.map((a) => a.code).join(', ')}` });
    }

    // The receivable/payable control accounts belong to the subledgers.
    // A manual line written straight onto one of them moves the ledger
    // without moving any customer or supplier, and the two then disagree
    // by exactly that line — the classic unreconciled control account.
    // It is refused here, at the door; the party documents (invoices,
    // notes, vouchers, opening balances) are how these accounts move.
    const control = accounts.filter((a) =>
      CONTROL_ACCOUNT_CODES.includes(a.code),
    );
    if (control.length > 0) {
      throw new BadRequestException({ code: 'JOURNAL_CONTROL_ACCOUNT', message: `Manual entries cannot post directly to a control account (${control
          .map((a) => a.code)
          .join(', ')}). Use the customer/supplier documents so the subledger and the ledger move together.` });
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

      const row = await tx.journalEntry.create({
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
      await this.audit.recordRequired({
        companyId, userId, action: 'CREATE', entity: 'journal_entries', entityId: row.id,
        after: { entryNumber: row.entryNumber, totalDebit: row.totalDebit.toFixed(MONEY_SCALE),
          totalCredit: row.totalCredit.toFixed(MONEY_SCALE) },
      }, tx);
      return row;
    });
    return this.toResponse(created);
  }

  /**
   * Posts a draft entry. Re-validates the balance so a row edited directly in
   * the database cannot be posted unbalanced.
   */
  async post(
    companyId: string,
    userId: string,
    id: string,
    options: { discloseBalance?: boolean } = {},
  ) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, companyId },
      include: { lines: true },
    });
    if (!entry) throw new NotFoundException({ code: 'JOURNAL_ENTRY_NOT_FOUND', message: 'Journal entry not found' });
    if (entry.status !== JournalStatus.DRAFT && entry.status !== JournalStatus.APPROVED) {
      throw new BadRequestException({ code: 'JOURNAL_NOT_POSTABLE_STATE', message: `Only a draft or an approved entry can be posted (current status: ${entry.status})` });
    }

    if (!entry.reversalOfId) {
      const lineAccounts = await this.prisma.account.findMany({
        where: {
          companyId,
          code: { in: CONTROL_ACCOUNT_CODES },
          id: { in: entry.lines.map((l) => l.accountId) },
        },
        select: { code: true },
      });
      if (lineAccounts.length > 0) {
        throw new BadRequestException({ code: 'JOURNAL_CONTROL_ACCOUNT', message: `Manual entries cannot post directly to a control account (${lineAccounts
            .map((a) => a.code)
            .join(', ')}). Cancel this draft and use the customer/supplier documents instead.` });
      }
    }

    const policy = await this.settings.get(companyId);

    // A company that wants its manual entries reviewed says so once, in its
    // settings, and the rule is enforced here - not by the screen hiding a
    // button. A draft can only reach the ledger through an approval.
    if (entry.status === JournalStatus.DRAFT && policy.approvalRequiredForJournal) {
      throw new BadRequestException({ code: 'JOURNAL_NEEDS_APPROVAL', message: 'This company requires manual journal entries to be approved before posting. Submit the entry for approval first.' });
    }

    // Separation of duties: whoever wrote an entry does not also approve or
    // post it. Skipped for a super administrator, who is the escape hatch a
    // small company needs when the accountant is on holiday.
    if (policy.segregationOfDuties && !entry.reversalOfId && !(await this.isSuperAdmin(userId))) {
      if (entry.status === JournalStatus.APPROVED && entry.approvedBy === entry.createdBy) {
        throw new BadRequestException({ code: 'JOURNAL_SEPARATION', message: 'Separation of duties is on: the person who approved this entry may not post it, and the person who wrote it may not approve it.' });
      }
      if (entry.createdBy === userId && entry.approvedBy !== userId) {
        throw new BadRequestException({ code: 'JOURNAL_SEPARATION', message: 'Separation of duties is on: the person who created this entry may not post it.' });
      }
    }

    if (!entry.totalDebit.equals(entry.totalCredit)) {
      throw new BadRequestException({ code: 'JOURNAL_UNBALANCED', message: 'Journal entry is not balanced' });
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

    return this.transition(companyId, userId, entry, {
      status: JournalStatus.POSTED,
      postedAt: new Date(),
      postedBy: userId,
    }, 'POST', undefined, options);
  }

  /// Moves a draft to "waiting for approval".
  ///
  /// Asking for a review is not the same as posting: nothing reaches the
  /// ledger, and the entry can still be cancelled or corrected by its author.
  async submitForApproval(companyId: string, userId: string, id: string) {
    const entry = await this.requireStatus(companyId, id, [JournalStatus.DRAFT]);
    const result = await this.transition(companyId, userId, entry, {
      status: JournalStatus.PENDING_APPROVAL,
      submittedAt: new Date(),
      submittedBy: userId,
    }, 'SUBMIT');
    await this.announce(companyId, id, 'SUBMIT', userId, entry.createdBy);
    return result;
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
      throw new BadRequestException({ code: 'JOURNAL_SEPARATION', message: 'Separation of duties is on: an entry cannot be approved by the person who created it.' });
    }

    const result = await this.transition(companyId, userId, entry, {
      status: JournalStatus.APPROVED,
      approvedAt: new Date(),
      approvedBy: userId,
    }, 'APPROVE');
    await this.announce(companyId, id, 'APPROVE', userId, entry.createdBy);
    return result;
  }

  /// Keeps the notification centre in step with the workflow at once: the
  /// approver is told when an entry is submitted, the task disappears when it
  /// is decided, and the author hears the outcome. A notification failure
  /// never undoes the accounting action; the 30-minute scan is the backstop.
  private async announce(
    companyId: string,
    id: string,
    action: 'SUBMIT' | 'APPROVE' | 'CANCEL',
    userId: string,
    createdBy: string | null,
    reason?: string | null,
  ) {
    if (!this.notifications) return;
    try {
      const entry = await this.prisma.journalEntry.findFirst({
        where: { id, companyId },
        select: { branchId: true, entryNumber: true, description: true, totalDebit: true },
      });
      if (!entry) return;
      if (action === 'SUBMIT') {
        await this.notifications.raiseSafely({
          companyId,
          type: JOURNAL_PENDING_APPROVAL,
          branchId: entry.branchId,
          entityType: 'JournalEntry',
          entityId: id,
          entityRef: entry.entryNumber,
          actionPath: `/accounting/journal-entries?entry=${id}`,
          titleEn: `Journal entry ${entry.entryNumber} is waiting for approval`,
          titleAr: `القيد ${entry.entryNumber} في انتظار الاعتماد`,
          bodyEn: entry.description ?? `${entry.totalDebit} waiting to be approved.`,
          bodyAr: entry.description ?? `${entry.totalDebit} في انتظار الاعتماد.`,
          dedupe: dedupeKey({ type: JOURNAL_PENDING_APPROVAL, entityId: id }),
        });
        return;
      }
      await this.notifications.clearPending(companyId, 'JournalEntry', id);
      await this.notifications.tellRequester({
        companyId,
        branchId: entry.branchId,
        requesterId: createdBy,
        decidedBy: userId,
        outcome: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        entityType: 'JournalEntry',
        entityId: id,
        entityRef: entry.entryNumber,
        nameAr: 'القيد',
        nameEn: 'Journal entry',
        actionPath: `/accounting/journal-entries?entry=${id}`,
        reason,
      });
    } catch {
      // The scan reconciles the centre on its next pass.
    }
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

    const result = await this.transition(companyId, userId, entry, {
      status: JournalStatus.CANCELLED,
      cancelledAt: new Date(),
      cancelledBy: userId,
      cancelReason: reason?.trim() || null,
    }, 'CANCEL', reason ?? null);
    await this.announce(companyId, id, 'CANCEL', userId, entry.createdBy, reason ?? null);
    return result;
  }

  /** Compare the observed state inside the write transaction. A competing
   * action must not overwrite a transition already committed by another user.
   * The required audit row commits or rolls back with the transition. This
   * does not protect direct SQL, mutable lines, or concurrent policy edits. */
  private async transition(
    companyId: string,
    userId: string,
    entry: { id: string; status: JournalStatus },
    data: Prisma.JournalEntryUpdateManyMutationInput,
    action: 'POST' | 'SUBMIT' | 'APPROVE' | 'CANCEL',
    reason?: string | null,
    options: { discloseBalance?: boolean } = {},
  ) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.journalEntry.updateMany({
        where: { id: entry.id, companyId, status: entry.status },
        data,
      });
      if (claimed.count !== 1) {
        throw new ConflictException({ code: 'JOURNAL_STATUS_CHANGED', message: 'تغيرت حالة القيد بواسطة عملية أخرى. حدّث البيانات قبل المحاولة مجددًا. / Journal status changed; refresh before retrying.' });
      }
      const updated = await tx.journalEntry.findUniqueOrThrow({
        where: { id: entry.id },
        include: { lines: LINES_WITH_ACCOUNT },
      });
      if (action === 'POST') await this.assertPostingLines(tx, companyId, updated, options);
      await this.audit.recordRequired({
        companyId, userId, action, entity: 'journal_entries', entityId: entry.id,
        before: { status: entry.status },
        after: { status: updated.status, ...(action === 'CANCEL' ? { reason } : {}) },
      }, tx);
      return this.toResponse(updated);
    });
  }

  /** Validate the actual lines and account state after claiming the entry.
   * Account row locks serialize against chart updates through commit. A direct
   * SQL client that mutates lines after this transaction remains out of scope. */
  private async assertPostingLines(
    tx: Prisma.TransactionClient,
    companyId: string,
    entry: {
      id: string;
      entryDate: Date;
      entryNumber: string;
      totalDebit: Prisma.Decimal; totalCredit: Prisma.Decimal; reversalOfId: string | null;
      lines: Array<{accountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal}>;
    },
    options: { discloseBalance?: boolean } = {},
  ): Promise<void> {
    if (entry.lines.length < 2) throw new BadRequestException({ code: 'JOURNAL_TWO_LINES', message: 'A journal needs at least two lines' });
    let debit = new Prisma.Decimal(0);
    let credit = new Prisma.Decimal(0);
    for (const line of entry.lines) {
      if (!line.debit.isFinite() || !line.credit.isFinite() ||
          line.debit.isNegative() || line.credit.isNegative() ||
          (line.debit.isZero() === line.credit.isZero())) {
        throw new BadRequestException({ code: 'JOURNAL_LINE_AMOUNT', message: 'Every journal line needs one positive debit or credit' });
      }
      debit = debit.plus(line.debit);
      credit = credit.plus(line.credit);
    }
    if (!debit.equals(credit) || !debit.equals(entry.totalDebit) || !credit.equals(entry.totalCredit)) {
      throw new BadRequestException({ code: 'JOURNAL_UNBALANCED', message: 'Journal lines do not balance or do not match the entry totals' });
    }
    // Historical reversals may use accounts since deactivated. Ordinary
    // entries must still use active, postable, non-control accounts now.
    if (entry.reversalOfId) return;
    const ids = [...new Set(entry.lines.map(line => line.accountId))].sort();
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM accounts
      WHERE "companyId" = ${companyId}::uuid AND id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})
      ORDER BY id FOR SHARE
    `);
    const accounts = await tx.account.findMany({
      where: { companyId, id: { in: ids }, deletedAt: null },
      select: { id:true, code:true, isActive:true, isPostable:true },
    });
    if (accounts.length !== ids.length || accounts.some(account => !account.isActive || !account.isPostable)) {
      throw new BadRequestException({ code: 'JOURNAL_ACCOUNT_UNAVAILABLE', message: 'One or more journal accounts are unavailable or cannot receive postings' });
    }
    if (accounts.some(account => CONTROL_ACCOUNT_CODES.includes(account.code))) {
      throw new BadRequestException({ code: 'JOURNAL_CONTROL_ACCOUNT', message: 'Manual entries cannot post directly to a control account' });
    }
    // A manual entry can name a box or a bank directly, and taking more out
    // than it holds is refused here exactly as it is for a payment voucher.
    // The entry was already claimed above, so its own lines are excluded from
    // the balance it is checked against.
    // The entry keeps the number it took as a draft, which can place it
    // before same-day entries posted since: its true statement position,
    // not the end of the day, is what the guard must check.
    await this.posting.assertCashBalancesCover(tx, companyId, entry.lines, entry.entryDate, {
      excludeEntryId: entry.id,
      candidateNumber: entry.entryNumber,
      discloseBalance: options.discloseBalance,
    });
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
    if (!entry) throw new NotFoundException({ code: 'JOURNAL_ENTRY_NOT_FOUND', message: 'Journal entry not found' });
    if (!allowed.includes(entry.status)) {
      throw new BadRequestException({ code: 'JOURNAL_STATE_NOT_ALLOWED', message: `This action is not allowed while the entry is ${entry.status}. Allowed from: ${allowed.join(', ')}.` });
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
  async reverse(
    companyId: string,
    userId: string,
    id: string,
    options: { discloseBalance?: boolean } = {},
  ) {
    const original = await this.prisma.journalEntry.findFirst({
      where: { id, companyId },
      include: { lines: { include: { allocations: true } } },
    });
    if (!original) throw new NotFoundException({ code: 'JOURNAL_ENTRY_NOT_FOUND', message: 'Journal entry not found' });
    if (original.status !== JournalStatus.POSTED) {
      throw new BadRequestException({ code: 'ONLY_POSTED_REVERSE', message: 'Only posted entries can be reversed' });
    }

    const alreadyReversed = await this.prisma.journalEntry.findFirst({
      where: { reversalOfId: original.id },
      select: { id: true },
    });
    if (alreadyReversed) {
      throw new BadRequestException({ code: 'ALREADY_REVERSED', message: 'This entry has already been reversed' });
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
      // The mirror's number first: it fixes the mirror's position in the
      // statement order the guard checks. A refused reversal rolls the
      // number back with everything else, so nothing is burned.
      const entryNumber = await this.numbers.next(
        tx,
        companyId,
        'JOURNAL',
        'JV',
      );

      // The mirror hands back whatever the original took: reversing an entry
      // that put money into a box takes it out again, and that may not
      // overdraw the box. Guarded before the claim for the same reason as in
      // PostingService.reverse: a REVERSED original without its committed
      // mirror would be invisible to a concurrent balance check.
      await this.posting.assertCashBalancesCover(
        tx,
        companyId,
        original.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit })),
        reversalDate,
        { discloseBalance: options.discloseBalance, candidateNumber: entryNumber },
      );

      // Claim the original first. The pre-checks above run outside the
      // transaction, so two people reversing at the same moment could both
      // pass them; this conditional update lets exactly one of them write
      // the mirror entry (the same guard PostingService.reverse applies).
      const claimed = await tx.journalEntry.updateMany({
        where: { id: original.id, companyId, status: JournalStatus.POSTED },
        data: { status: JournalStatus.REVERSED },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException({ code: 'ALREADY_REVERSED', message: 'This entry has already been reversed' });
      }


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

      await this.audit.recordRequired({
        companyId, userId, action: 'REVERSE', entity: 'journal_entries', entityId: original.id,
        after: { reversalId: created.id, reversalNumber: created.entryNumber },
      }, tx);
      return created;
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
      throw new BadRequestException({ code: 'JOURNAL_LINE_AMOUNT', message: `Invalid amount on account ${line.accountId}` });
    }

    if (debit.isNegative() || credit.isNegative()) {
      throw new BadRequestException({ code: 'FIELD_NOT_NEGATIVE', message: 'Amounts cannot be negative', field: 'Amounts' });
    }
    if (debit.isZero() && credit.isZero()) {
      throw new BadRequestException({ code: 'JOURNAL_LINE_AMOUNT', message: 'Every line needs either a debit or a credit' });
    }
    if (!debit.isZero() && !credit.isZero()) {
      throw new BadRequestException({ code: 'JOURNAL_LINE_AMOUNT', message: 'A line cannot be both a debit and a credit' });
    }

    const amount = debit.plus(credit);
    const requested = line.allocations ?? [];
    if (requested.length > 0 && line.costCenterId) {
      throw new BadRequestException({ code: 'JOURNAL_COST_CENTER_SPLIT', message: 'A journal line cannot name one cost center and also be split between several' });
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
