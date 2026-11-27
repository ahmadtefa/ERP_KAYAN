import { BadRequestException, Injectable } from '@nestjs/common';
import { JournalStatus, Prisma } from '@prisma/client';
import { CostCentersService } from './cost-centers.service';
import { DocumentNumberService } from './document-number.service';
import { FiscalPeriodsService } from './fiscal-periods.service';

const MONEY_SCALE = 4;

export interface PostingLine {
  accountId: string;
  debit?: Prisma.Decimal | string;
  credit?: Prisma.Decimal | string;
  description?: string;
  /// The analytical dimension, when the document knows one. An invoice line
  /// that names a cost center carries it through to the ledger.
  costCenterId?: string | null;
  /// A controlled split of this line across several centres. Mutually
  /// exclusive with `costCenterId`: a line is either attributed to one centre
  /// or divided between several, never both, or a report would count it twice.
  allocations?: Array<{ costCenterId: string; amount: string | Prisma.Decimal }>;
}

export interface PostingRequest {
  companyId: string;
  branchId: string;
  userId: string;
  entryDate: Date;
  description: string;
  lines: PostingLine[];
  /** Where the entry came from, kept for tracing an entry back to its document. */
  sourceType:
    | 'SALES_INVOICE'
    | 'PURCHASE_INVOICE'
    | 'SALES_RETURN'
    | 'PURCHASE_RETURN'
    | 'CASH_VOUCHER'
    | 'CASH_TRANSFER'
    | 'STOCK_DOCUMENT'
    | 'OPENING_BALANCE'
    | 'YEAR_END_CLOSE'
    | 'FIXED_ASSET'
    | 'ASSET_DEPRECIATION'
    | 'ASSET_DISPOSAL'
    | 'COMMISSION_PAYOUT'
    /// A lot written off or destroyed: the value leaves stock for the
    /// inventory-difference account, with the reason on the entry.
    | 'INVENTORY_WRITE_OFF'
    /// A lot moved between two warehouses. Value does not change overall;
    /// the entry exists so both shelves' cards reconcile.
    | 'BATCH_TRANSFER'
    | 'MANUAL';
  sourceId: string;
  sourceNumber: string;
  /// Overrides the description written on the entry. Defaults to the
  /// document's own description plus its number in brackets, which is what
  /// makes a ledger line traceable back to the document that caused it.
  entryDescription?: string;
  /// Overrides the period code used when a message has to name the period.
  currency?: string;
  /// When true, a cash-balance refusal may carry the actual figures (the
  /// caller has checked the user may read cash balances). Default false:
  /// the refusal names the account but no amounts.
  discloseBalance?: boolean;
}

/**
 * Writes a POSTED journal entry from a business document.
 *
 * Sales and purchase invoices both need exactly this, and both must do it in
 * the same transaction as their own rows and their stock movements: a posted
 * invoice without its accounting, or accounting without the invoice, would be
 * a ledger that cannot be reconciled.
 */
@Injectable()
export class PostingService {
  constructor(
    private readonly numbers: DocumentNumberService,
    private readonly periods: FiscalPeriodsService,
    private readonly costCenters: CostCentersService,
  ) {}

  async post(
    tx: Prisma.TransactionClient,
    request: PostingRequest,
  ): Promise<{ id: string; entryNumber: string }> {
    const lines = request.lines
      .map((l) => {
        const debit = this.amount(l.debit);
        const credit = this.amount(l.credit);
        const amount = debit.plus(credit);
        const hasAllocations = (l.allocations?.length ?? 0) > 0;
        if (hasAllocations && l.costCenterId) {
          throw new BadRequestException({ code: 'JOURNAL_COST_CENTER_SPLIT', message: 'A journal line cannot name one cost center and also be split between several' });
        }
        const allocations = hasAllocations
          ? CostCentersService.validateAllocations(amount, l.allocations!)
          : [];
        // A single allocation that covers the whole line is the ordinary
        // one-centre case: store it on the line so every existing report and
        // every historical row keeps the same shape.
        if (allocations.length === 1) {
          return {
            accountId: l.accountId,
            debit,
            credit,
            description: l.description ?? null,
            costCenterId: allocations[0].costCenterId,
            allocations: [] as Array<{ costCenterId: string; amount: Prisma.Decimal }>,
          };
        }
        return {
          accountId: l.accountId,
          debit,
          credit,
          description: l.description ?? null,
          costCenterId: l.costCenterId ?? null,
          allocations,
        };
      })
      // A zero line carries no information and would only clutter the ledger.
      .filter((l) => !l.debit.isZero() || !l.credit.isZero());

    if (lines.length < 2) {
      throw new BadRequestException({ code: 'POSTING_NEEDS_BOTH_SIDES', message: 'A posting needs at least one debit and one credit' });
    }

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
        message: 'The document does not balance, so it was not posted',
        errors: {
          totalDebit: totalDebit.toFixed(MONEY_SCALE),
          totalCredit: totalCredit.toFixed(MONEY_SCALE),
          difference: totalDebit.minus(totalCredit).toFixed(MONEY_SCALE),
        },
      });
    }

    // One document, one entry. Every caller already claims its document by
    // flipping its status inside its own transaction, which is what stops
    // two people posting the same invoice. This is the second lock on the
    // same door, at the one place every document passes through: if a
    // non-reversal entry for this document is already in the ledger, a
    // retry (or a future caller that forgets to claim) is refused here
    // instead of writing the same revenue twice and leaving the duplicate
    // to be found months later in a reconciliation.
    const alreadyPosted = await tx.journalEntry.findFirst({
      where: {
        companyId: request.companyId,
        sourceType: request.sourceType,
        sourceId: request.sourceId,
        reversalOfId: null,
        status: { in: [JournalStatus.POSTED, JournalStatus.REVERSED] },
      },
      select: { entryNumber: true },
    });
    if (alreadyPosted) {
      throw new BadRequestException({ code: 'POSTING_ALREADY_POSTED', message: `Document ${request.sourceNumber} has already been posted as journal entry ${alreadyPosted.entryNumber}` });
    }

    // Accounts must exist, be postable and belong to this company. A document
    // is rejected rather than posted to a grouping account.
    const accountIds = [...new Set(lines.map((l) => l.accountId))].sort();
    // Keep account validity stable until the journal has committed. Chart
    // updates and soft deletion acquire conflicting row locks; a plain MVCC
    // validation could otherwise post to an account after it was retired.
    // A deterministic order reduces deadlocks between multi-account postings.
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM accounts
      WHERE "companyId" = ${request.companyId}::uuid
        AND id IN (${Prisma.join(accountIds.map(id => Prisma.sql`${id}::uuid`))})
      ORDER BY id FOR SHARE
    `);
    const accounts = await tx.account.findMany({
      where: { id: { in: accountIds }, companyId: request.companyId, deletedAt: null },
      select: { id: true, code: true, isPostable: true, isActive: true },
    });
    if (accounts.length !== accountIds.length) {
      throw new BadRequestException({ code: 'ACCOUNT_MISSING', message: 'One or more accounts do not exist' });
    }
    const invalid = accounts.filter((a) => !a.isPostable || !a.isActive);
    if (invalid.length > 0) {
      throw new BadRequestException({ code: 'JOURNAL_ACCOUNT_GROUPING', message: `Accounts cannot receive postings: ${invalid.map((a) => a.code).join(', ')}` });
    }
    // Every cost centre named here must be this company's, active, and valid
    // on the entry date. The foreign key alone would let another company's
    // centre (or a retired one) onto the ledger.
    await this.costCenters.assertPostable(
      tx,
      request.companyId,
      lines.flatMap((l) => [
        ...(l.costCenterId ? [l.costCenterId] : []),
        ...l.allocations.map((a) => a.costCenterId),
      ]),
      request.entryDate,
    );

    // A closed period is a finished year. Nothing may be added to it.
    const entryDate = request.entryDate;
    const period = await this.periods.periodFor(tx, request.companyId, entryDate);
    if (period && period.status === 'CLOSED') {
      throw new BadRequestException(
        `Period ${period.code} is closed, so nothing can be posted on ${entryDate
          .toISOString()
          .slice(0, 10)}`,
      );
    }

    // The number comes first: it decides where this entry lands in the cash
    // statement's date/number order, and the guard checks that exact
    // position. The allocation shares this transaction, so a refused posting
    // returns the number to the sequence with everything else.
    const entryNumber = await this.numbers.next(
      tx,
      request.companyId,
      'JOURNAL',
      'JV',
    );

    // A payment voucher, a transfer out, or any other document that takes
    // money out of a box or a bank may not take out more than it holds.
    await this.assertCashBalancesCover(tx, request.companyId, lines, request.entryDate, {
      discloseBalance: request.discloseBalance,
      candidateNumber: entryNumber,
    });

    const entry = await tx.journalEntry.create({
      data: {
        companyId: request.companyId,
        branchId: request.branchId,
        entryNumber,
        entryDate: request.entryDate,
        description:
          request.entryDescription ?? `${request.description} [${request.sourceNumber}]`,
        status: JournalStatus.POSTED,
        totalDebit,
        totalCredit,
        currency: request.currency ?? 'EGP',
        postedAt: new Date(),
        postedBy: request.userId,
        createdBy: request.userId,
        // The document this entry came from, so a report can drill down into
        // it instead of leaving the reader with a number and no explanation.
        sourceType: request.sourceType,
        sourceId: request.sourceId,
        sourceNumber: request.sourceNumber,
        lines: {
          create: lines.map((l, index) => ({
            lineNumber: index + 1,
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            description: l.description,
            costCenterId: l.costCenterId,
            allocations: {
              create: l.allocations.map((allocation) => ({
                costCenterId: allocation.costCenterId,
                amount: allocation.amount,
              })),
            },
          })),
        },
      },
      select: { id: true, entryNumber: true },
    });

    return entry;
  }

  /**
   * Writes the mirror entry that cancels a posted one.
   *
   * Nothing is ever edited or deleted: the original stays in the books and a
   * second entry, with its own number, takes it back. That is the only way a
   * reader of the ledger can see both what happened and that it was undone.
   *
   * Runs inside the caller's transaction so a document that reverses its
   * accounting and its stock together cannot half-succeed.
   */
  async reverse(
    tx: Prisma.TransactionClient,
    companyId: string,
    userId: string,
    journalEntryId: string,
    description: string,
    entryDate: Date = new Date(),
    discloseBalance = false,
  ): Promise<{ id: string; entryNumber: string }> {
    const original = await tx.journalEntry.findFirst({
      where: { id: journalEntryId, companyId },
      include: {
        lines: { orderBy: { lineNumber: 'asc' }, include: { allocations: true } },
      },
    });
    if (!original) {
      throw new BadRequestException({ code: 'POSTING_ENTRY_MISSING', message: 'The journal entry to reverse was not found' });
    }
    if (original.status === JournalStatus.REVERSED) {
      throw new BadRequestException({ code: 'ALREADY_REVERSED', message: 'This journal entry has already been reversed' });
    }
    if (original.status !== JournalStatus.POSTED) {
      throw new BadRequestException({ code: 'POSTING_NOT_POSTED_REVERSE', message: 'Only a posted journal entry can be reversed' });
    }

    // The mirror's number decides where it lands in the cash statement's
    // date/number order, and the guard checks that exact position. The
    // allocation shares this transaction, so a refused reversal returns the
    // number to the sequence with everything else.
    const entryNumber = await this.numbers.next(tx, companyId, 'JOURNAL', 'JV');

    // Reversing a receipt takes its money back out of the box, so a reversal
    // can overdraw a cash account exactly like a payment can. The guard runs
    // before the original is claimed: once the original reads REVERSED without
    // its mirror committed, a concurrent balance check would miss those lines.
    // Holding the box's row lock from here to commit closes that window.
    await this.assertCashBalancesCover(
      tx,
      companyId,
      original.lines.map((line) => ({
        accountId: line.accountId,
        debit: line.credit,
        credit: line.debit,
      })),
      entryDate,
      { discloseBalance, candidateNumber: entryNumber },
    );

    const claimed = await tx.journalEntry.updateMany({
      where: { id: original.id, companyId, status: JournalStatus.POSTED },
      data: { status: JournalStatus.REVERSED },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException({ code: 'ALREADY_REVERSED', message: 'This journal entry has already been reversed' });
    }

    // A reversal is a posting like any other: it may not land in a closed
    // period either. Without this check the closed year could still be
    // written to — backwards, but written to all the same — by reversing
    // one of its entries with a date inside it.
    const reversalPeriod = await this.periods.periodFor(tx, companyId, entryDate);
    if (reversalPeriod && reversalPeriod.status === 'CLOSED') {
      throw new BadRequestException(
        `Period ${reversalPeriod.code} is closed, so the reversal cannot be dated ${entryDate
          .toISOString()
          .slice(0, 10)}`,
      );
    }

    const reversal = await tx.journalEntry.create({
      data: {
        companyId,
        branchId: original.branchId,
        entryNumber,
        entryDate,
        description,
        status: JournalStatus.POSTED,
        currency: original.currency,
        totalDebit: original.totalCredit,
        totalCredit: original.totalDebit,
        reversalOfId: original.id,
        // A reversal points at the same document as what it reverses: the
        // reader who drills down wants the invoice, not the mirror entry.
        sourceType: original.sourceType,
        sourceId: original.sourceId,
        sourceNumber: original.sourceNumber,
        postedAt: new Date(),
        postedBy: userId,
        createdBy: userId,
        lines: {
          create: original.lines.map((line) => ({
            lineNumber: line.lineNumber,
            accountId: line.accountId,
            debit: line.credit,
            credit: line.debit,
            description: line.description,
            costCenterId: line.costCenterId,
            // The reversal must give back exactly the analytical split the
            // original took, or a cost-center report would show a project's
            // cost still standing after the document that caused it was undone.
            allocations: {
              create: (line.allocations ?? []).map((allocation) => ({
                costCenterId: allocation.costCenterId,
                amount: allocation.amount,
              })),
            },
          })),
        },
      },
      select: { id: true, entryNumber: true },
    });

    return reversal;
  }

  /**
   * What a ledger account holds right now, read the same way the cash reports
   * read it: every posted line, including reversed entries and their mirrors,
   * which cancel each other. Drafts and cancelled entries move nothing.
   */
  async postedBalanceFor(
    db: Prisma.TransactionClient,
    companyId: string,
    accountId: string,
    excludeEntryId?: string,
  ): Promise<Prisma.Decimal> {
    // Two plain statements rather than a conditional fragment: the balance
    // definition must stay exactly the one the cash reports use.
    const rows = excludeEntryId
      ? await db.$queryRaw<Array<{ net: Prisma.Decimal | string }>>(Prisma.sql`
          SELECT COALESCE(SUM(l.debit - l.credit), 0) AS net
            FROM journal_lines l
            JOIN journal_entries e ON e.id = l."journalEntryId"
           WHERE e."companyId" = ${companyId}::uuid
             AND e.status IN ('POSTED', 'REVERSED')
             AND l."accountId" = ${accountId}::uuid
             AND e.id <> ${excludeEntryId}::uuid
        `)
      : await db.$queryRaw<Array<{ net: Prisma.Decimal | string }>>(Prisma.sql`
          SELECT COALESCE(SUM(l.debit - l.credit), 0) AS net
            FROM journal_lines l
            JOIN journal_entries e ON e.id = l."journalEntryId"
           WHERE e."companyId" = ${companyId}::uuid
             AND e.status IN ('POSTED', 'REVERSED')
             AND l."accountId" = ${accountId}::uuid
        `);
    return new Prisma.Decimal(rows[0]?.net ?? 0);
  }

  /**
   * The lowest running balance an account reaches from the position a new
   * entry would occupy, in exactly the order the box statement prints:
   * entryDate, then entryNumber (cash-accounts.service.ts statement()).
   *
   * `candidateNumber` matters twice. A manual journal keeps the number it
   * was given as a draft, so when it posts days later its true position can
   * be BEFORE same-day entries that were posted (and numbered) after the
   * draft was created. And the six-digit series grows a seventh digit at one
   * million, where lexical order flips against numeric order. The query
   * compares numbers as strings exactly like the statement's ORDER BY, so
   * the guard and the statement can never disagree about either case.
   *
   * A caller that does not know the number yet (the save-time advisory for
   * a voucher, whose journal number is only allocated at posting) passes
   * none and the candidate is placed after every same-day entry: the exact
   * position a fresh number takes anywhere below the million boundary, and
   * re-checked with the real number at posting.
   *
   * One indexed single-pass statement; the window aggregate is the same
   * work the statement endpoint itself performs to print the box's history.
   */
  async lowestCashBalanceFrom(
    db: Prisma.TransactionClient,
    companyId: string,
    accountId: string,
    fromDate: Date,
    candidateNumber?: string,
    excludeEntryId?: string,
  ): Promise<Prisma.Decimal> {
    // Callers without a number (a draft that has not been numbered yet) sit
    // after every entry of their own date. That is stated as a flag, never as
    // a sentinel string: how a string such as '~~~' sorts depends on the
    // database collation, and under a locale that ignores punctuation it
    // sorts BEFORE real numbers, which would make same-day receipts unable
    // to fund a same-day payment.
    const hasNumber = candidateNumber !== undefined;
    const number = candidateNumber ?? '';
    // Two plain templates rather than a conditional fragment: the position
    // rule must stay exactly the one the statement prints.
    const rows = excludeEntryId
      ? await db.$queryRaw<
          Array<{ before_sum: Prisma.Decimal | string; min_after: Prisma.Decimal | string | null }>
        >(Prisma.sql`
          SELECT COALESCE(SUM(t.net) FILTER (WHERE t.is_before), 0) AS before_sum,
                 MIN(t.running) FILTER (WHERE NOT t.is_before) AS min_after
            FROM (
              SELECT (l.debit - l.credit) AS net,
                     (e."entryDate" < ${fromDate}::date
                      OR (e."entryDate" = ${fromDate}::date
                          AND (NOT ${hasNumber}::boolean OR e."entryNumber" < ${number}))) AS is_before,
                     SUM(l.debit - l.credit) OVER (
                       ORDER BY e."entryDate", e."entryNumber", l."lineNumber"
                     ) AS running
                FROM journal_lines l
                JOIN journal_entries e ON e.id = l."journalEntryId"
               WHERE e."companyId" = ${companyId}::uuid
                 AND e.status IN ('POSTED', 'REVERSED')
                 AND l."accountId" = ${accountId}::uuid
                 AND e.id <> ${excludeEntryId}::uuid
            ) t
        `)
      : await db.$queryRaw<
          Array<{ before_sum: Prisma.Decimal | string; min_after: Prisma.Decimal | string | null }>
        >(Prisma.sql`
          SELECT COALESCE(SUM(t.net) FILTER (WHERE t.is_before), 0) AS before_sum,
                 MIN(t.running) FILTER (WHERE NOT t.is_before) AS min_after
            FROM (
              SELECT (l.debit - l.credit) AS net,
                     (e."entryDate" < ${fromDate}::date
                      OR (e."entryDate" = ${fromDate}::date
                          AND (NOT ${hasNumber}::boolean OR e."entryNumber" < ${number}))) AS is_before,
                     SUM(l.debit - l.credit) OVER (
                       ORDER BY e."entryDate", e."entryNumber", l."lineNumber"
                     ) AS running
                FROM journal_lines l
                JOIN journal_entries e ON e.id = l."journalEntryId"
               WHERE e."companyId" = ${companyId}::uuid
                 AND e.status IN ('POSTED', 'REVERSED')
                 AND l."accountId" = ${accountId}::uuid
            ) t
        `);
    const before = new Prisma.Decimal(rows[0]?.before_sum ?? 0);
    const after = rows[0]?.min_after;
    if (after === null || after === undefined) return before;
    return Prisma.Decimal.min(before, new Prisma.Decimal(after));
  }

  /**
   * A cash box or a bank account can never go negative: its balance is the
   * money physically in it, and a safe cannot hold less than nothing. Never
   * means at no point of the statement: a receipt dated next week cannot
   * fund a payment dated today, and a receipt numbered after a manual
   * entry cannot fund that entry's own earlier position either. The running
   * balance is checked from the candidate's exact statement position
   * onward, never as an end-of-history total. Backdating inside an open
   * period stays allowed whenever the box was actually covered at every
   * position from the candidate's own on.
   *
   * Every ledger write funnels through PostingService (vouchers, transfers,
   * invoices, opening balances, year-end) except manual journal transitions,
   * which call this guard themselves, so the rule lives in this one place for
   * all of them. Only the net movement per account matters: an entry that
   * moves money between two boxes is checked on the box it leaves.
   *
   * History written before this guard existed can already dip below zero.
   * Such a dip never blocks a receipt (money coming in always helps), and it
   * never blocks an outflow dated after it whose own dates forward stay
   * covered; an outflow that would land on or before the dip and deepen it is
   * refused. That is the explicit rule: the guard polices the timeline from
   * the candidate's date forward, and leaves yesterday's books to correction.
   *
   * Concurrency: the cash account's row is locked FOR UPDATE before its
   * timeline is read, and every writer takes the same lock in id order, so
   * two payments posted at the same moment queue behind it and the second
   * one reads a timeline that already includes the first. Accounts are
   * locked in a deterministic order so two opposite transfers cannot
   * deadlock.
   *
   * `excludeEntryId` is for the manual-journal transition, which claims its
   * entry (flips it to POSTED) before validating: the entry's own lines would
   * otherwise be counted into the balance it is checked against. The same
   * path passes `candidateNumber`, because a manual entry keeps the number
   * it took as a draft: its statement position can sit before same-day
   * entries that posted days earlier, and only the real number finds it.
   *
   * `discloseBalance` carries the caller's permission check: only a user who
   * may read cash balances (cash.accounts.read) gets the figures in a
   * refusal. Everyone else gets the account code and the rule, no amounts.
   */
  async assertCashBalancesCover(
    tx: Prisma.TransactionClient,
    companyId: string,
    lines: Array<{ accountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal }>,
    entryDate: Date,
    options: {
      excludeEntryId?: string;
      candidateNumber?: string;
      discloseBalance?: boolean;
      lock?: boolean;
    } = {},
  ): Promise<void> {
    const netByAccount = new Map<string, Prisma.Decimal>();
    for (const line of lines) {
      const net = (netByAccount.get(line.accountId) ?? new Prisma.Decimal(0))
        .plus(line.debit)
        .minus(line.credit);
      netByAccount.set(line.accountId, net);
    }
    // Only money going out can break the rule.
    const outgoing = [...netByAccount.entries()]
      .filter(([, net]) => net.isNegative())
      .map(([accountId]) => accountId)
      .sort();
    if (outgoing.length === 0) return;

    const cashAccounts = await tx.cashAccount.findMany({
      where: { companyId, deletedAt: null, accountId: { in: outgoing } },
      select: { id: true, code: true, nameAr: true, nameEn: true, accountId: true },
      orderBy: { id: 'asc' },
    });

    for (const cashAccount of cashAccounts) {
      if (options.lock !== false) {
        await tx.$queryRaw(Prisma.sql`
          SELECT id FROM cash_accounts WHERE id = ${cashAccount.id}::uuid FOR UPDATE
        `);
      }
      const floor = await this.lowestCashBalanceFrom(
        tx,
        companyId,
        cashAccount.accountId,
        entryDate,
        options.candidateNumber,
        options.excludeEntryId,
      );
      const movement = netByAccount.get(cashAccount.accountId)!;
      const requested = movement.abs();
      if (floor.minus(requested).isNegative()) {
        // The account code is safe for anyone holding the voucher or entry:
        // they picked the account themselves. The figures are not.
        if (options.discloseBalance) {
          throw new BadRequestException({
            code: 'CASH_BALANCE_NEGATIVE',
            message:
              `رصيد الخزنة أو البنك لا يمكن أن يصبح بالسالب في أي موضع: أدنى رصيد تصل إليه «${cashAccount.nameAr}» (${cashAccount.code}) من موضع هذا القيد في كشف الحساب فصاعدًا هو ${floor.toFixed(MONEY_SCALE)} والمطلوب صرفه ${requested.toFixed(MONEY_SCALE)}. ` +
              `قلّل المبلغ إلى الرصيد المتاح أو سجّل سند قبض بتاريخ لا يتأخر عن هذا القيد. لم يُرحَّل أي قيد. / ` +
              `A cash or bank balance can never go negative at any position: "${cashAccount.nameEn}" (${cashAccount.code}) runs as low as ${floor.toFixed(MONEY_SCALE)} from this entry's position in the statement onward and this pays out ${requested.toFixed(MONEY_SCALE)}. ` +
              `Lower the amount to the available balance or record a receipt dated no later than this entry. Nothing was posted.`,
            errors: {
              cashAccountCode: cashAccount.code,
              requested: requested.toFixed(MONEY_SCALE),
              available: floor.toFixed(MONEY_SCALE),
            },
          });
        }
        throw new BadRequestException({
          code: 'CASH_BALANCE_NEGATIVE',
          message:
            `رصيد الخزنة أو البنك (${cashAccount.code}) لا يكفي لهذا الصرف: الرصيد لا يمكن أن يصبح بالسالب في أي تاريخ. ` +
            `قلّل المبلغ أو سجّل سند قبض بتاريخ لا يتأخر عن هذا القيد. لم يُرحَّل أي قيد. / ` +
            `The cash or bank account (${cashAccount.code}) cannot cover this payment: a balance can never go negative at any date. ` +
            `Lower the amount or record a receipt dated no later than this entry. Nothing was posted.`,
          errors: { cashAccountCode: cashAccount.code },
        });
      }
    }
  }

  private amount(value: Prisma.Decimal | string | undefined): Prisma.Decimal {
    if (value === undefined) return new Prisma.Decimal(0);
    try {
      const d = new Prisma.Decimal(value).toDecimalPlaces(MONEY_SCALE);
      if (d.isNegative()) {
        throw new BadRequestException({ code: 'POSTING_AMOUNT_INVALID', message: 'Posting amounts cannot be negative' });
      }
      return d;
    } catch {
      throw new BadRequestException({ code: 'POSTING_AMOUNT_INVALID', message: `Invalid posting amount: ${String(value)}` });
    }
  }
}
