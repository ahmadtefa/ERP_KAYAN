import { Injectable } from '@nestjs/common';
import { AccountType, InvoiceStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

const MONEY_SCALE = 4;

/**
 * The dashboard: the numbers a manager looks at first, all of them read from
 * the ledger and the documents.
 *
 * Two rules it follows:
 *
 *  * a period with no data shows a zero and says "no documents in this
 *    period" - it never fills the gap with sample figures;
 *  * every figure carries the filter that produced it, so the number on the
 *    screen can be reproduced in the report that explains it.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(
    companyId: string,
    query: { from?: string; to?: string; branchId?: string },
  ) {
    const to = query.to ? new Date(`${query.to.slice(0, 10)}T23:59:59.999Z`) : new Date();
    const from = query.from
      ? new Date(`${query.from.slice(0, 10)}T00:00:00.000Z`)
      : new Date(Date.UTC(to.getUTCFullYear(), Math.floor(to.getUTCMonth() / 3) * 3, 1));

    const branchFilter = query.branchId
      ? Prisma.sql`AND e."branchId" = ${query.branchId}::uuid`
      : Prisma.sql``;
    const branchFilterDoc = query.branchId ? { branchId: query.branchId } : {};

    // ---------------------------------------------------------- trading
    const trading = await this.prisma.$queryRaw<
      Array<{ revenue: Prisma.Decimal; expenses: Prisma.Decimal }>
    >(Prisma.sql`
      SELECT COALESCE(SUM(CASE WHEN a.type = 'REVENUE' THEN l.credit - l.debit ELSE 0 END), 0) AS revenue,
             COALESCE(SUM(CASE WHEN a.type = 'EXPENSE' THEN l.debit - l.credit ELSE 0 END), 0) AS expenses
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l."journalEntryId"
        JOIN accounts a ON a.id = l."accountId"
       WHERE e."companyId" = ${companyId}::uuid
         AND e.status IN ('POSTED', 'REVERSED')
         AND e."entryDate" >= ${from}::date
         AND e."entryDate" <= ${to}::date
         ${branchFilter}
    `);
    const revenue = new Prisma.Decimal(trading[0]?.revenue ?? 0);
    const expenses = new Prisma.Decimal(trading[0]?.expenses ?? 0);

    // Sales and purchases are counted from the documents, which is what a
    // manager means by "how much did we sell?" - including what has not been
    // paid yet.
    const [sales, purchases] = await Promise.all([
      this.prisma.salesInvoice.aggregate({
        where: {
          companyId,
          deletedAt: null,
          status: InvoiceStatus.POSTED,
          documentType: 'INVOICE',
          invoiceDate: { gte: from, lte: to },
          ...branchFilterDoc,
        },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      this.prisma.purchaseInvoice.aggregate({
        where: {
          companyId,
          deletedAt: null,
          status: InvoiceStatus.POSTED,
          documentType: 'INVOICE',
          invoiceDate: { gte: from, lte: to },
          ...branchFilterDoc,
        },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
    ]);

    const returns = await this.prisma.salesInvoice.aggregate({
      where: {
        companyId,
        deletedAt: null,
        status: InvoiceStatus.POSTED,
        documentType: { in: ['CREDIT_NOTE', 'DEBIT_NOTE'] },
        invoiceDate: { gte: from, lte: to },
        ...branchFilterDoc,
      },
      _sum: { totalAmount: true },
      _count: { _all: true },
    });

    // ---------------------------------------------------------- cash
    const cashRows = await this.prisma.$queryRaw<Array<{ net: Prisma.Decimal }>>(Prisma.sql`
      SELECT COALESCE(SUM(l.debit - l.credit), 0) AS net
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l."journalEntryId"
        JOIN cash_accounts ca ON ca."accountId" = l."accountId"
       WHERE e."companyId" = ${companyId}::uuid
         AND e.status IN ('POSTED', 'REVERSED')
         AND e."entryDate" <= ${to}::date
         AND ca."deletedAt" IS NULL
    `);
    const cashPosition = new Prisma.Decimal(cashRows[0]?.net ?? 0);

    // ------------------------------------------------- receivables/payables
    const [receivables, payables] = await Promise.all([
      this.openBalances(companyId, 'sales', to, query.branchId),
      this.openBalances(companyId, 'purchases', to, query.branchId),
    ]);

    // Unpaid invoices past their due date. This is the number that turns into
    // phone calls, so it counts documents, not ledger totals.
    const overdueRows = await this.prisma.$queryRaw<
      Array<{ overdue: Prisma.Decimal; count: bigint }>
    >(Prisma.sql`
      SELECT COALESCE(SUM("totalAmount" - "paidAmount"), 0) AS overdue,
             COUNT(*) AS count
        FROM sales_invoices
       WHERE "companyId" = ${companyId}::uuid
         AND "deletedAt" IS NULL
         AND status = 'POSTED'
         AND "dueDate" IS NOT NULL
         AND "dueDate" < ${to}::date
         AND ("totalAmount" - "paidAmount") > 0
         ${query.branchId ? Prisma.sql`AND "branchId" = ${query.branchId}::uuid` : Prisma.sql``}
    `);

    // ---------------------------------------------------------- stock
    const stockRows = await this.prisma.$queryRaw<
      Array<{ value: Prisma.Decimal; items: bigint; negative: bigint }>
    >(Prisma.sql`
      SELECT COALESCE(SUM(value), 0) AS value,
             COUNT(*) FILTER (WHERE quantity > 0) AS items,
             COUNT(*) FILTER (WHERE quantity < 0) AS negative
        FROM stock_balances
       WHERE "companyId" = ${companyId}::uuid
         ${query.branchId ? Prisma.sql`AND "branchId" = ${query.branchId}::uuid` : Prisma.sql``}
    `);

    const reorderCount = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS count
        FROM items i
       WHERE i."companyId" = ${companyId}::uuid
         AND i."deletedAt" IS NULL
         AND i."isActive" = true
         AND i."isStockTracked" = true
         AND i."reorderLevel" > 0
         AND COALESCE((
              SELECT SUM(sb.quantity) FROM stock_balances sb WHERE sb."itemId" = i.id
         ), 0) <= i."reorderLevel"
    `);

    // ------------------------------------------------- period comparison
    const lengthMs = to.getTime() - from.getTime();
    const previousTo = new Date(from.getTime() - 1);
    const previousFrom = new Date(from.getTime() - lengthMs - 1);
    const previous = await this.prisma.$queryRaw<
      Array<{ revenue: Prisma.Decimal; expenses: Prisma.Decimal }>
    >(Prisma.sql`
      SELECT COALESCE(SUM(CASE WHEN a.type = 'REVENUE' THEN l.credit - l.debit ELSE 0 END), 0) AS revenue,
             COALESCE(SUM(CASE WHEN a.type = 'EXPENSE' THEN l.debit - l.credit ELSE 0 END), 0) AS expenses
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l."journalEntryId"
        JOIN accounts a ON a.id = l."accountId"
       WHERE e."companyId" = ${companyId}::uuid
         AND e.status IN ('POSTED', 'REVERSED')
         AND e."entryDate" >= ${previousFrom}::date
         AND e."entryDate" <= ${previousTo}::date
         ${branchFilter}
    `);
    const previousRevenue = new Prisma.Decimal(previous[0]?.revenue ?? 0);
    const previousExpenses = new Prisma.Decimal(previous[0]?.expenses ?? 0);

    const documentsInPeriod =
      (sales._count?._all ?? 0) + (purchases._count?._all ?? 0) + (returns._count?._all ?? 0);

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      branchId: query.branchId ?? null,
      // Stated explicitly so the screen can say "there is nothing here yet"
      // instead of showing zeroes that look like a bad month.
      hasData: documentsInPeriod > 0,
      documentsInPeriod,
      sales: {
        total: (sales._sum.totalAmount ?? new Prisma.Decimal(0)).toFixed(MONEY_SCALE),
        invoices: sales._count?._all ?? 0,
      },
      purchases: {
        total: (purchases._sum.totalAmount ?? new Prisma.Decimal(0)).toFixed(MONEY_SCALE),
        invoices: purchases._count?._all ?? 0,
      },
      returns: {
        total: (returns._sum.totalAmount ?? new Prisma.Decimal(0)).toFixed(MONEY_SCALE),
        documents: returns._count?._all ?? 0,
      },
      revenue: revenue.toFixed(MONEY_SCALE),
      expenses: expenses.toFixed(MONEY_SCALE),
      grossResult: revenue.minus(expenses).toFixed(MONEY_SCALE),
      cashPosition: cashPosition.toFixed(MONEY_SCALE),
      receivables: receivables.total,
      payables: payables.total,
      overdue: {
        total: new Prisma.Decimal(overdueRows[0]?.overdue ?? 0).toFixed(MONEY_SCALE),
        invoices: Number(overdueRows[0]?.count ?? 0),
      },
      stock: {
        value: new Prisma.Decimal(stockRows[0]?.value ?? 0).toFixed(MONEY_SCALE),
        itemsInStock: Number(stockRows[0]?.items ?? 0),
        negativeBalances: Number(stockRows[0]?.negative ?? 0),
        needsReorder: Number(reorderCount[0]?.count ?? 0),
      },
      previousPeriod: {
        from: previousFrom.toISOString().slice(0, 10),
        to: previousTo.toISOString().slice(0, 10),
        revenue: previousRevenue.toFixed(MONEY_SCALE),
        expenses: previousExpenses.toFixed(MONEY_SCALE),
        result: previousRevenue.minus(previousExpenses).toFixed(MONEY_SCALE),
        revenueChange: previousRevenue.isZero()
          ? null
          : revenue.minus(previousRevenue).div(previousRevenue).times(100).toFixed(2),
      },
      // Where each headline figure comes from, so it can be traced.
      drillDown: {
        trialBalance: `/reports/trial-balance?from=${from.toISOString().slice(0, 10)}&to=${to
          .toISOString()
          .slice(0, 10)}`,
        profitAndLoss: `/reports/profit-and-loss?from=${from.toISOString().slice(0, 10)}&to=${to
          .toISOString()
          .slice(0, 10)}`,
        balanceSheet: `/reports/balance-sheet?asOf=${to.toISOString().slice(0, 10)}`,
        cashFlow: `/reports/cash-flow?from=${from.toISOString().slice(0, 10)}&to=${to
          .toISOString()
          .slice(0, 10)}`,
        receivablesAging: `/reports/receivables-aging?asOf=${to.toISOString().slice(0, 10)}`,
        payablesAging: `/reports/payables-aging?asOf=${to.toISOString().slice(0, 10)}`,
        cashAccounts: '/cash/accounts/balances',
        stockValuation: '/inventory/reports/valuation',
      },
    };
  }

  /// What is still owed on posted invoices, from the documents.
  private async openBalances(
    companyId: string,
    side: 'sales' | 'purchases',
    asOf: Date,
    branchId?: string,
  ) {
    const rows =
      side === 'sales'
        ? await this.prisma.salesInvoice.findMany({
            where: {
              companyId,
              deletedAt: null,
              status: InvoiceStatus.POSTED,
              invoiceDate: { lte: asOf },
              ...(branchId ? { branchId } : {}),
            },
            select: { totalAmount: true, paidAmount: true },
          })
        : await this.prisma.purchaseInvoice.findMany({
            where: {
              companyId,
              deletedAt: null,
              status: InvoiceStatus.POSTED,
              invoiceDate: { lte: asOf },
              ...(branchId ? { branchId } : {}),
            },
            select: { totalAmount: true, paidAmount: true },
          });

    const total = rows.reduce(
      (sum, row) => sum.plus(row.totalAmount).minus(row.paidAmount),
      new Prisma.Decimal(0),
    );
    return {
      total: total.toFixed(MONEY_SCALE),
      invoices: rows.filter((row) => !row.totalAmount.minus(row.paidAmount).isZero()).length,
    };
  }
}
