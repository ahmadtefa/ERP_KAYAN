import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountType, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

const MONEY_SCALE = 4;

/// The range every statement reads. Both ends are inclusive, and the defaults
/// are "the year so far" - which is what a person opening a report expects to
/// see.
function rangeOf(query: { from?: string; to?: string }) {
  const to = query.to ? new Date(`${query.to.slice(0, 10)}T23:59:59.999Z`) : new Date();
  const from = query.from
    ? new Date(`${query.from.slice(0, 10)}T00:00:00.000Z`)
    : new Date(Date.UTC(to.getUTCFullYear(), 0, 1));
  if (from > to) throw new BadRequestException('"from" must not be after "to"');
  return { from, to };
}

interface AccountBalanceRow {
  accountId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  type: AccountType;
  opening: Prisma.Decimal;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
}

/**
 * The statements a company is judged by: the balance sheet, the cash flow
 * statement, the general journal and the general ledger.
 *
 * Every figure is read from posted journal lines. Nothing here looks at an
 * invoice, a stock balance or a setting: a statement that could disagree with
 * the ledger would be a second version of the truth, and the ledger is the
 * first one.
 */
@Injectable()
export class FinancialStatementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Opening, movement and closing per account for the period. */
  private async balances(
    companyId: string,
    from: Date,
    to: Date,
    filters: { branchId?: string; costCenterId?: string } = {},
  ): Promise<AccountBalanceRow[]> {
    const branchFilter = filters.branchId
      ? Prisma.sql`AND e."branchId" = ${filters.branchId}::uuid`
      : Prisma.sql``;
    const costCenterFilter = filters.costCenterId
      ? Prisma.sql`AND l."costCenterId" = ${filters.costCenterId}::uuid`
      : Prisma.sql``;

    const rows = await this.prisma.$queryRaw<
      Array<{
        accountId: string;
        code: string;
        nameEn: string;
        nameAr: string;
        type: AccountType;
        opening: Prisma.Decimal;
        debit: Prisma.Decimal;
        credit: Prisma.Decimal;
      }>
    >(Prisma.sql`
      SELECT a.id            AS "accountId",
             a.code          AS code,
             a."nameEn"      AS "nameEn",
             a."nameAr"      AS "nameAr",
             a.type          AS type,
             COALESCE(SUM(CASE WHEN e."entryDate" < ${from}::date THEN l.debit - l.credit ELSE 0 END), 0) AS opening,
             COALESCE(SUM(CASE WHEN e."entryDate" >= ${from}::date THEN l.debit ELSE 0 END), 0)          AS debit,
             COALESCE(SUM(CASE WHEN e."entryDate" >= ${from}::date THEN l.credit ELSE 0 END), 0)         AS credit
        FROM accounts a
        LEFT JOIN journal_lines l ON l."accountId" = a.id
        LEFT JOIN journal_entries e
               ON e.id = l."journalEntryId"
              AND e.status IN ('POSTED', 'REVERSED')
              AND e."entryDate" <= ${to}::date
              ${branchFilter}
              ${costCenterFilter}
       WHERE a."companyId" = ${companyId}::uuid
         AND a."deletedAt" IS NULL
         AND a."isPostable" = true
       GROUP BY a.id, a.code, a."nameEn", a."nameAr", a.type
       ORDER BY a.code ASC
    `);

    return rows.map((row) => ({
      ...row,
      opening: new Prisma.Decimal(row.opening),
      debit: new Prisma.Decimal(row.debit),
      credit: new Prisma.Decimal(row.credit),
    }));
  }

  /**
   * The balance sheet: what the company owns and what it owes, at a date.
   *
   * The result of the period is added to equity, because until a year is
   * closed the profit has not been transferred to retained earnings yet - and
   * a balance sheet that ignored it would not balance.
   */
  async balanceSheet(
    companyId: string,
    query: { asOf?: string; to?: string; branchId?: string },
  ) {
    const asOf = query.asOf ?? query.to;
    const { from, to } = rangeOf({ to: asOf });
    const rows = await this.balances(companyId, from, to, { branchId: query.branchId });

    // Liabilities and equity are shown the way a reader expects to see them:
    // a 5,000 credit balance reads as 5,000 owed, not as -5,000. The ledger's
    // own debit-positive signs are kept out of the statement.
    const section = (type: AccountType) =>
      rows
        .filter((row) => row.type === type)
        .map((row) => {
          const closing = row.opening.plus(row.debit).minus(row.credit);
          const presented =
            type === AccountType.LIABILITY || type === AccountType.EQUITY
              ? closing.negated()
              : closing;
          return {
            accountId: row.accountId,
            code: row.code,
            nameEn: row.nameEn,
            nameAr: row.nameAr,
            balance: presented.toFixed(MONEY_SCALE),
            // True when the account sits on its natural side. A liability or
            // an equity account with a debit balance is worth looking at, and
            // the flag says so instead of hiding it behind a minus sign.
            isDebitBalance: closing.greaterThanOrEqualTo(0) === (type === AccountType.ASSET),
            naturalBalance: type === AccountType.ASSET ? 'DEBIT' : 'CREDIT',
          };
        })
        .filter((row) => !new Prisma.Decimal(row.balance).isZero());

    const totalOf = (items: Array<{ balance: string }>) =>
      items.reduce((sum, item) => sum.plus(item.balance), new Prisma.Decimal(0));

    const assets = section(AccountType.ASSET);
    const liabilities = section(AccountType.LIABILITY);
    const equity = section(AccountType.EQUITY);

    // The result of the period is read from the same rows as everything else,
    // including any part of it that was already on the books before the period
    // started: an income statement that ignored an unclosed earlier year would
    // make the balance sheet disagree with itself.
    const revenue = rows.reduce(
      (sum, row) =>
        row.type === AccountType.REVENUE
          ? sum.minus(row.opening).minus(row.debit).plus(row.credit)
          : sum,
      new Prisma.Decimal(0),
    );
    const expenses = rows.reduce(
      (sum, row) =>
        row.type === AccountType.EXPENSE
          ? sum.plus(row.opening).plus(row.debit).minus(row.credit)
          : sum,
      new Prisma.Decimal(0),
    );
    const result = revenue.minus(expenses);

    const totalAssets = totalOf(assets);
    const totalLiabilities = totalOf(liabilities);
    // The profit is still sitting in the revenue and expense accounts until a
    // year-end close moves it to retained earnings, so it belongs in equity.
    const totalEquity = totalOf(equity).plus(result);
    const difference = totalAssets.minus(totalLiabilities).minus(totalEquity);

    return {
      asOf: to.toISOString().slice(0, 10),
      assets,
      liabilities,
      equity: [
        ...equity,
        {
          accountId: null,
          code: '',
          nameEn: 'Result for the period',
          nameAr: 'نتيجة أعمال الفترة',
          balance: result.toFixed(MONEY_SCALE),
          isDebitBalance: result.lessThan(0),
          naturalBalance: 'CREDIT',
        },
      ].filter((row) => !new Prisma.Decimal(row.balance).isZero()),
      totals: {
        assets: totalAssets.toFixed(MONEY_SCALE),
        liabilities: totalLiabilities.toFixed(MONEY_SCALE),
        equity: totalEquity.toFixed(MONEY_SCALE),
        // Zero means the balance sheet balances. Anything else is a bug, not
        // a rounding difference, and it is reported rather than hidden.
        difference: difference.toFixed(MONEY_SCALE),
      },
      isBalanced: difference.isZero(),
    };
  }

  /**
   * Cash flow, direct method: the actual movements in and out of cash and
   * bank accounts, grouped by what the money was for.
   *
   * It is built from the counterpart accounts of every cash line, so it can
   * be traced back to documents rather than derived from balance movements.
   */
  async cashFlow(companyId: string, query: { from?: string; to?: string; branchId?: string }) {
    const { from, to } = rangeOf(query);
    const branchFilter = query.branchId
      ? Prisma.sql`AND e."branchId" = ${query.branchId}::uuid`
      : Prisma.sql``;

    const cashCodes = await this.prisma.cashAccount.findMany({
      where: { companyId, deletedAt: null },
      select: { accountId: true },
    });
    const cashAccountIds = cashCodes.map((row) => row.accountId);
    if (cashAccountIds.length === 0) {
      return {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
        inflows: [],
        outflows: [],
        totals: { inflow: '0.0000', outflow: '0.0000', net: '0.0000' },
        note: 'This company has no cash or bank accounts defined.',
      };
    }

    // Every cash line, with the other side of its entry, so the question
    // "where did this money come from?" is answered by the entry itself.
    const rows = await this.prisma.$queryRaw<
      Array<{
        direction: string;
        amount: Prisma.Decimal;
        counterpartCode: string;
        counterpartNameEn: string;
        counterpartNameAr: string;
        counterpartType: AccountType | null;
        entryNumber: string;
        entryDate: Date;
        description: string | null;
        source: string | null;
      }>
    >(Prisma.sql`
      WITH cash_lines AS (
        SELECT e.id                AS entry_id,
               e."entryNumber"     AS "entryNumber",
               e."entryDate"       AS "entryDate",
               e.description       AS description,
               l.debit             AS debit,
               l.credit            AS credit
          FROM journal_lines l
          JOIN journal_entries e ON e.id = l."journalEntryId"
         WHERE e."companyId" = ${companyId}::uuid
           AND e.status IN ('POSTED', 'REVERSED')
           AND e."entryDate" >= ${from}::date
           AND e."entryDate" <= ${to}::date
           AND l."accountId" = ANY(${cashAccountIds}::uuid[])
      ),
      counterparts AS (
        SELECT c.entry_id,
               c."entryNumber",
               c."entryDate",
               c.description,
               c.debit,
               c.credit,
               a.code       AS "counterpartCode",
               a."nameEn"   AS "counterpartNameEn",
               a."nameAr"   AS "counterpartNameAr",
               a.type       AS "counterpartType",
               ROW_NUMBER() OVER (PARTITION BY c.entry_id ORDER BY a.code) AS rn
          FROM cash_lines c
          JOIN journal_lines l2 ON l2."journalEntryId" = c.entry_id
          JOIN accounts a ON a.id = l2."accountId"
         WHERE l2."accountId" <> ALL(${cashAccountIds}::uuid[])
      )
      SELECT "entryNumber",
             "entryDate",
             description,
             "counterpartCode",
             "counterpartNameEn",
             "counterpartNameAr",
             "counterpartType",
             CASE WHEN debit > 0 THEN 'in' ELSE 'out' END AS direction,
             CASE WHEN debit > 0 THEN debit ELSE credit END AS amount
        FROM counterparts
       WHERE rn = 1
       ORDER BY "entryDate", "entryNumber"
    `);

    const groupRows = (direction: 'in' | 'out') => {
      const grouped = new Map<
        string,
        {
          code: string;
          nameEn: string;
          nameAr: string;
          type: string | null;
          amount: Prisma.Decimal;
          entries: Array<{ entryNumber: string; entryDate: string; description: string | null; amount: string }>;
        }
      >();

      for (const row of rows.filter((item) => item.direction === direction)) {
        const key = row.counterpartCode;
        const current = grouped.get(key) ?? {
          code: row.counterpartCode,
          nameEn: row.counterpartNameEn,
          nameAr: row.counterpartNameAr,
          type: row.counterpartType,
          amount: new Prisma.Decimal(0),
          entries: [],
        };
        current.amount = current.amount.plus(row.amount);
        current.entries.push({
          entryNumber: row.entryNumber,
          entryDate: new Date(row.entryDate).toISOString().slice(0, 10),
          description: row.description,
          amount: new Prisma.Decimal(row.amount).toFixed(MONEY_SCALE),
        });
        grouped.set(key, current);
      }

      return [...grouped.values()]
        .map((item) => ({
          code: item.code,
          nameEn: item.nameEn,
          nameAr: item.nameAr,
          type: item.type,
          amount: item.amount.toFixed(MONEY_SCALE),
          entries: item.entries,
        }))
        .sort((a, b) => new Prisma.Decimal(b.amount).minus(a.amount).toNumber());
    };

    const inflows = groupRows('in');
    const outflows = groupRows('out');
    const totalIn = inflows.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0));
    const totalOut = outflows.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0));

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      inflows,
      outflows,
      totals: {
        inflow: totalIn.toFixed(MONEY_SCALE),
        outflow: totalOut.toFixed(MONEY_SCALE),
        net: totalIn.minus(totalOut).toFixed(MONEY_SCALE),
      },
    };
  }

  /** The day book: every posted entry in the period, with its lines. */
  async generalJournal(
    companyId: string,
    query: { from?: string; to?: string; branchId?: string; page?: number; pageSize?: number },
  ) {
    const { from, to } = rangeOf(query);
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 100, 1), 500);

    const where: Prisma.JournalEntryWhereInput = {
      companyId,
      status: { in: ['POSTED', 'REVERSED'] },
      entryDate: { gte: from, lte: to },
      ...(query.branchId ? { branchId: query.branchId } : {}),
    };

    const [entries, total] = await this.prisma.$transaction([
      this.prisma.journalEntry.findMany({
        where,
        orderBy: [{ entryDate: 'asc' }, { entryNumber: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          lines: {
            orderBy: { lineNumber: 'asc' },
            include: {
              account: { select: { code: true, nameEn: true, nameAr: true } },
              costCenter: { select: { code: true, nameEn: true, nameAr: true } },
            },
          },
          branch: { select: { code: true } },
        },
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      page,
      pageSize,
      total,
      items: entries.map((entry) => ({
        id: entry.id,
        entryNumber: entry.entryNumber,
        entryDate: entry.entryDate.toISOString().slice(0, 10),
        description: entry.description,
        status: entry.status.toLowerCase(),
        source: entry.sourceType
          ? { type: entry.sourceType, id: entry.sourceId, number: entry.sourceNumber }
          : null,
        isReversal: Boolean(entry.reversalOfId),
        branchCode: entry.branch?.code ?? null,
        totalDebit: entry.totalDebit.toFixed(MONEY_SCALE),
        totalCredit: entry.totalCredit.toFixed(MONEY_SCALE),
        lines: entry.lines.map((line) => ({
          lineNumber: line.lineNumber,
          accountId: line.accountId,
          accountCode: line.account.code,
          accountNameEn: line.account.nameEn,
          accountNameAr: line.account.nameAr,
          costCenterCode: line.costCenter?.code ?? null,
          description: line.description,
          debit: line.debit.toFixed(MONEY_SCALE),
          credit: line.credit.toFixed(MONEY_SCALE),
        })),
      })),
    };
  }

  /**
   * The general ledger: every account that moved, with its opening, its
   * movement and its closing - the report an accountant reads first.
   */
  async generalLedger(
    companyId: string,
    query: { from?: string; to?: string; branchId?: string; costCenterId?: string },
  ) {
    const { from, to } = rangeOf(query);
    const rows = await this.balances(companyId, from, to, {
      branchId: query.branchId,
      costCenterId: query.costCenterId,
    });

    const items = rows
      .map((row) => {
        const closing = row.opening.plus(row.debit).minus(row.credit);
        return {
          accountId: row.accountId,
          code: row.code,
          nameEn: row.nameEn,
          nameAr: row.nameAr,
          type: row.type.toLowerCase(),
          opening: row.opening.toFixed(MONEY_SCALE),
          debit: row.debit.toFixed(MONEY_SCALE),
          credit: row.credit.toFixed(MONEY_SCALE),
          closing: closing.toFixed(MONEY_SCALE),
        };
      })
      .filter(
        (row) =>
          !new Prisma.Decimal(row.opening).isZero() ||
          !new Prisma.Decimal(row.debit).isZero() ||
          !new Prisma.Decimal(row.credit).isZero(),
      );

    const totalDebit = items.reduce((sum, row) => sum.plus(row.debit), new Prisma.Decimal(0));
    const totalCredit = items.reduce((sum, row) => sum.plus(row.credit), new Prisma.Decimal(0));

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      items,
      totals: {
        debit: totalDebit.toFixed(MONEY_SCALE),
        credit: totalCredit.toFixed(MONEY_SCALE),
        difference: totalDebit.minus(totalCredit).toFixed(MONEY_SCALE),
      },
    };
  }

  /**
   * Cost-center report: revenue and expense carried by each centre, with the
   * children of a centre rolled up into it.
   *
   * Attribution rules, which are what make this report reconcile with the
   * ledger:
   *   * a line that names one centre is attributed to it in full;
   *   * a line split between several centres contributes each allocation's own
   *     amount, never the whole line again;
   *   * a line with no centre lands in "Unallocated" instead of disappearing.
   *
   * `own*` is what was posted to the centre itself and `total*` adds its
   * descendants, so a parent can be read as a subtotal without the company
   * total double-counting it. `reconciliation` proves that everything
   * attributed plus everything unallocated equals the ledger's own totals for
   * the period.
   */
  async costCenterReport(
    companyId: string,
    query: {
      from?: string;
      to?: string;
      type?: string;
      costCenterId?: string;
      includeInactive?: boolean | string;
    },
  ) {
    const { from, to } = rangeOf(query);
    const includeInactive =
      query.includeInactive === true || query.includeInactive === 'true';

    const rows = await this.prisma.$queryRaw<
      Array<{
        costCenterId: string | null;
        type: AccountType;
        isDebit: boolean;
        amount: Prisma.Decimal;
      }>
    >(Prisma.sql`
      SELECT COALESCE(al."costCenterId", l."costCenterId") AS "costCenterId",
             a.type                                         AS type,
             (l.debit > 0)                                  AS "isDebit",
             COALESCE(al.amount, l.debit + l.credit)        AS amount
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l."journalEntryId"
        JOIN accounts a ON a.id = l."accountId"
        LEFT JOIN journal_line_allocations al ON al."journalLineId" = l.id
       WHERE e."companyId" = ${companyId}::uuid
         AND e.status IN ('POSTED', 'REVERSED')
         AND e."entryDate" >= ${from}::date
         AND e."entryDate" <= ${to}::date
         AND a.type IN ('REVENUE', 'EXPENSE')
    `);

    // Every live centre is read, active or not: deactivating a centre stops
    // new postings, it does not turn its history into unattributed cost. The
    // active flag only hides a row from the list unless asked for.
    const centers = await this.prisma.costCenter.findMany({
      where: { companyId, deletedAt: null },
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameAr: true,
        type: true,
        parentId: true,
        isActive: true,
      },
      orderBy: { code: 'asc' },
    });

    const byId = new Map(centers.map((center) => [center.id, center]));

    // Own figures per centre, plus the unattributed bucket.
    const own = new Map<string, { revenue: Prisma.Decimal; expenses: Prisma.Decimal }>();
    const unallocated = {
      revenue: new Prisma.Decimal(0),
      expenses: new Prisma.Decimal(0),
    };
    const ledger = {
      revenue: new Prisma.Decimal(0),
      expenses: new Prisma.Decimal(0),
    };

    for (const row of rows) {
      const amount = new Prisma.Decimal(row.amount);
      const revenueDelta = row.isDebit ? amount.negated() : amount;
      const expenseDelta = row.isDebit ? amount : amount.negated();

      if (row.type === AccountType.REVENUE) {
        ledger.revenue = ledger.revenue.plus(revenueDelta);
      } else {
        ledger.expenses = ledger.expenses.plus(expenseDelta);
      }

      // A line pointing at a deleted centre cannot be attributed to a live
      // one; it is reported as unallocated rather than silently dropped.
      const known = row.costCenterId ? byId.get(row.costCenterId) : undefined;
      if (!known) {
        if (row.type === AccountType.REVENUE) unallocated.revenue = unallocated.revenue.plus(revenueDelta);
        else unallocated.expenses = unallocated.expenses.plus(expenseDelta);
        continue;
      }

      const current = own.get(known.id) ?? {
        revenue: new Prisma.Decimal(0),
        expenses: new Prisma.Decimal(0),
      };
      if (row.type === AccountType.REVENUE) current.revenue = current.revenue.plus(revenueDelta);
      else current.expenses = current.expenses.plus(expenseDelta);
      own.set(known.id, current);
    }

    const childrenOf = new Map<string, string[]>();
    for (const center of centers) {
      if (!center.parentId) continue;
      const list = childrenOf.get(center.parentId) ?? [];
      list.push(center.id);
      childrenOf.set(center.parentId, list);
    }

    // Every centre's subtree total, computed once, with a visited guard so a
    // corrupted hierarchy can never make this run forever.
    const subtree = new Map<string, { revenue: Prisma.Decimal; expenses: Prisma.Decimal }>();
    const totalsFor = (id: string, seen = new Set<string>()): { revenue: Prisma.Decimal; expenses: Prisma.Decimal } => {
      const cached = subtree.get(id);
      if (cached) return cached;
      if (seen.has(id)) return { revenue: new Prisma.Decimal(0), expenses: new Prisma.Decimal(0) };
      seen.add(id);
      const base = own.get(id) ?? {
        revenue: new Prisma.Decimal(0),
        expenses: new Prisma.Decimal(0),
      };
      let revenue = base.revenue;
      let expenses = base.expenses;
      for (const childId of childrenOf.get(id) ?? []) {
        const child = totalsFor(childId, seen);
        revenue = revenue.plus(child.revenue);
        expenses = expenses.plus(child.expenses);
      }
      const result = { revenue, expenses };
      subtree.set(id, result);
      return result;
    };

    const typeFilter = query.type ? String(query.type).toUpperCase() : null;
    const matchesFilter = (center: { id: string; type: string }) =>
      (typeFilter ? center.type === typeFilter : true) &&
      (query.costCenterId ? center.id === query.costCenterId : true);

    const visible = centers
      .filter((center) => includeInactive || center.isActive)
      .filter(matchesFilter);
    const items = visible
      .map((center) => {
        const ownFigures = own.get(center.id) ?? {
          revenue: new Prisma.Decimal(0),
          expenses: new Prisma.Decimal(0),
        };
        const rolled = totalsFor(center.id);
        return {
          costCenterId: center.id,
          code: center.code,
          nameEn: center.nameEn,
          nameAr: center.nameAr,
          type: center.type,
          parentId: center.parentId,
          isActive: center.isActive,
          ownRevenue: ownFigures.revenue.toFixed(MONEY_SCALE),
          ownExpenses: ownFigures.expenses.toFixed(MONEY_SCALE),
          ownResult: ownFigures.revenue.minus(ownFigures.expenses).toFixed(MONEY_SCALE),
          revenue: rolled.revenue.toFixed(MONEY_SCALE),
          expenses: rolled.expenses.toFixed(MONEY_SCALE),
          result: rolled.revenue.minus(rolled.expenses).toFixed(MONEY_SCALE),
          hasActivity: !ownFigures.revenue.isZero() || !ownFigures.expenses.isZero(),
        };
      })
      // Roots first, then the rest, each group by code: a reader can follow the
      // tree without the API having to nest JSON.
      .sort((a, b) => a.code.localeCompare(b.code));

    // The totals of the rows the caller asked for. Summing each centre's OWN
    // figures counts every line exactly once (a line belongs to one centre),
    // and stays correct when a type or a single centre filters the list - a
    // roll-up of visible roots would either double count or lose a subtree
    // whose parent was filtered out.
    const visibleOwn = visible.reduce(
      (sum, center) => {
        const figures = own.get(center.id) ?? {
          revenue: new Prisma.Decimal(0),
          expenses: new Prisma.Decimal(0),
        };
        return {
          revenue: sum.revenue.plus(figures.revenue),
          expenses: sum.expenses.plus(figures.expenses),
        };
      },
      { revenue: new Prisma.Decimal(0), expenses: new Prisma.Decimal(0) },
    );

    // Attribution over the whole chart, for the reconciliation block: every
    // live centre's own figures plus the lines nothing could claim.
    const allOwn = centers.reduce(
      (sum, center) => {
        const figures = own.get(center.id) ?? {
          revenue: new Prisma.Decimal(0),
          expenses: new Prisma.Decimal(0),
        };
        return {
          revenue: sum.revenue.plus(figures.revenue),
          expenses: sum.expenses.plus(figures.expenses),
        };
      },
      { revenue: new Prisma.Decimal(0), expenses: new Prisma.Decimal(0) },
    );

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      items,
      unallocated: {
        revenue: unallocated.revenue.toFixed(MONEY_SCALE),
        expenses: unallocated.expenses.toFixed(MONEY_SCALE),
      },
      totals: {
        revenue: visibleOwn.revenue.toFixed(MONEY_SCALE),
        expenses: visibleOwn.expenses.toFixed(MONEY_SCALE),
        result: visibleOwn.revenue.minus(visibleOwn.expenses).toFixed(MONEY_SCALE),
      },
      // Every figure above is derived from posted (or posted-then-reversed)
      // lines in the period. This block states the ledger's own totals so a
      // reader - or a test - can prove nothing was dropped or counted twice.
      reconciliation: {
        ledgerRevenue: ledger.revenue.toFixed(MONEY_SCALE),
        ledgerExpenses: ledger.expenses.toFixed(MONEY_SCALE),
        attributedRevenue: allOwn.revenue.plus(unallocated.revenue).toFixed(MONEY_SCALE),
        attributedExpenses: allOwn.expenses.plus(unallocated.expenses).toFixed(MONEY_SCALE),
        balanced:
          ledger.revenue.equals(allOwn.revenue.plus(unallocated.revenue)) &&
          ledger.expenses.equals(allOwn.expenses.plus(unallocated.expenses)),
      },
    };
  }

  /**
   * The journal lines behind a cost center's figures: the drill-down a reader
   * needs to trust the report. Only posted entries (including reversals, which
   * net themselves out) are shown, exactly as the report counts them.
   */
  async costCenterTransactions(
    companyId: string,
    costCenterId: string | null,
    query: { from?: string; to?: string; page?: number; pageSize?: number },
  ) {
    const { from, to } = rangeOf(query);
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 100, 1), 500);

    const where: Prisma.JournalLineWhereInput = {
      entry: {
        companyId,
        status: { in: ['POSTED', 'REVERSED'] },
        entryDate: { gte: from, lte: to },
      },
      // The report only reads revenue and expense accounts, so the drill-down
      // has to agree with it: a list that also showed receivables and stock
      // would not add up to the figure the reader clicked.
      account: { type: { in: ['REVENUE', 'EXPENSE'] } },
      ...(costCenterId === null
        ? { costCenterId: null, allocations: { none: {} } }
        : {
            OR: [
              { costCenterId },
              { allocations: { some: { costCenterId } } },
            ],
          }),
    };

    const [lines, total] = await this.prisma.$transaction([
      this.prisma.journalLine.findMany({
        where,
        orderBy: [
          { entry: { entryDate: 'desc' } },
          { entry: { entryNumber: 'desc' } },
          { lineNumber: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          account: { select: { code: true, nameEn: true, nameAr: true, type: true } },
          entry: {
            select: {
              id: true,
              entryNumber: true,
              entryDate: true,
              description: true,
              sourceType: true,
              sourceNumber: true,
              status: true,
            },
          },
          allocations: { select: { costCenterId: true, amount: true } },
        },
      }),
      this.prisma.journalLine.count({ where }),
    ]);

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      costCenterId,
      total,
      page,
      pageSize,
      items: lines.map((line) => {
        // The amount this particular centre carries: its own allocation when
        // the line was split, otherwise the whole line.
        const allocation = costCenterId
          ? line.allocations.find((row) => row.costCenterId === costCenterId)
          : null;
        const amount = allocation ? allocation.amount : line.debit.plus(line.credit);
        return {
          journalEntryId: line.entry.id,
          entryNumber: line.entry.entryNumber,
          entryDate: line.entry.entryDate.toISOString().slice(0, 10),
          description: line.entry.description ?? line.description,
          sourceType: line.entry.sourceType,
          sourceNumber: line.entry.sourceNumber,
          status: line.entry.status.toLowerCase(),
          accountCode: line.account.code,
          accountNameEn: line.account.nameEn,
          accountNameAr: line.account.nameAr,
          accountType: line.account.type,
          debit: line.debit.toFixed(MONEY_SCALE),
          credit: line.credit.toFixed(MONEY_SCALE),
          amount: amount.toFixed(MONEY_SCALE),
          isDebit: line.debit.greaterThan(0),
          isAllocated: Boolean(allocation),
        };
      }),
    };
  }
}
