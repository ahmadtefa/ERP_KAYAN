import { Injectable } from '@nestjs/common';
import { CashVoucherKind, InvoiceStatus, Prisma } from '@prisma/client';

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

    // Receipts and payments in the period come from the vouchers themselves:
    // "how much money moved" is a cash question, not a ledger question.
    const [receipts, payments] = await Promise.all([
      this.prisma.cashVoucher.aggregate({
        where: {
          companyId,
          deletedAt: null,
          status: InvoiceStatus.POSTED,
          kind: CashVoucherKind.RECEIPT,
          voucherDate: { gte: from, lte: to },
          ...branchFilterDoc,
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.cashVoucher.aggregate({
        where: {
          companyId,
          deletedAt: null,
          status: InvoiceStatus.POSTED,
          kind: CashVoucherKind.PAYMENT,
          voucherDate: { gte: from, lte: to },
          ...branchFilterDoc,
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    // Every cash box and bank account with what is in it, so the manager can
    // see where the money is, not only how much there is.
    const cashAccounts = await this.prisma.cashAccount.findMany({
      where: { companyId, deletedAt: null, isActive: true },
      orderBy: [{ kind: 'asc' }, { code: 'asc' }],
      select: { id: true, code: true, nameEn: true, nameAr: true, kind: true, accountId: true },
    });
    const cashBalances = await this.prisma.$queryRaw<
      Array<{ accountId: string; net: Prisma.Decimal }>
    >(Prisma.sql`
      SELECT l."accountId"::text AS "accountId",
             COALESCE(SUM(l.debit - l.credit), 0) AS net
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l."journalEntryId"
        JOIN cash_accounts ca ON ca."accountId" = l."accountId"
       WHERE e."companyId" = ${companyId}::uuid
         AND e.status IN ('POSTED', 'REVERSED')
         AND e."entryDate" <= ${to}::date
         AND ca."deletedAt" IS NULL
       GROUP BY l."accountId"
    `);
    const balanceByAccount = new Map(
      cashBalances.map((row) => [row.accountId, new Prisma.Decimal(row.net)]),
    );

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

    // Due but not yet late: what is still open without a crisis attached.
    const outstandingRows = await this.prisma.$queryRaw<
      Array<{ outstanding: Prisma.Decimal; count: bigint }>
    >(Prisma.sql`
      SELECT COALESCE(SUM("totalAmount" - "paidAmount"), 0) AS outstanding,
             COUNT(*) AS count
        FROM sales_invoices
       WHERE "companyId" = ${companyId}::uuid
         AND "deletedAt" IS NULL
         AND status = 'POSTED'
         AND ("totalAmount" - "paidAmount") > 0
         ${query.branchId ? Prisma.sql`AND "branchId" = ${query.branchId}::uuid` : Prisma.sql``}
    `);

    // ---------------------------------------------------------- parties
    const [customerCounts, supplierCounts] = await Promise.all([
      this.prisma.customer.groupBy({
        by: ['isActive'],
        where: { companyId, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.supplier.groupBy({
        by: ['isActive'],
        where: { companyId, deletedAt: null },
        _count: { _all: true },
      }),
    ]);
    const countsOf = (rows: Array<{ isActive: boolean; _count: { _all: number } }>) => ({
      count: rows.reduce((sum, row) => sum + row._count._all, 0),
      active: rows.find((row) => row.isActive)?._count._all ?? 0,
    });

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

    // ------------------------------------------------- who and what sells
    const topCustomers = await this.prisma.$queryRaw<
      Array<{
        id: string;
        nameEn: string;
        nameAr: string;
        total: Prisma.Decimal;
        invoices: bigint;
      }>
    >(Prisma.sql`
      SELECT c.id::text AS id, c."nameEn", c."nameAr",
             COALESCE(SUM(si."totalAmount"), 0) AS total,
             COUNT(si.id) AS invoices
        FROM customers c
        JOIN sales_invoices si ON si."customerId" = c.id
       WHERE si."companyId" = ${companyId}::uuid
         AND si."deletedAt" IS NULL
         AND si.status = 'POSTED'
         AND si."documentType" = 'INVOICE'
         AND si."invoiceDate" >= ${from}::date
         AND si."invoiceDate" <= ${to}::date
         ${query.branchId ? Prisma.sql`AND si."branchId" = ${query.branchId}::uuid` : Prisma.sql``}
       GROUP BY c.id, c."nameEn", c."nameAr"
       ORDER BY total DESC
       LIMIT 5
    `);

    const topItems = await this.prisma.$queryRaw<
      Array<{
        id: string;
        nameEn: string;
        nameAr: string;
        quantity: Prisma.Decimal;
        total: Prisma.Decimal;
      }>
    >(Prisma.sql`
      SELECT i.id::text AS id, i."nameEn", i."nameAr",
             COALESCE(SUM(sl.quantity), 0) AS quantity,
             COALESCE(SUM(sl."lineTotal"), 0) AS total
        FROM items i
        JOIN sales_invoice_lines sl ON sl."itemId" = i.id
        JOIN sales_invoices si ON si.id = sl."invoiceId"
       WHERE si."companyId" = ${companyId}::uuid
         AND si."deletedAt" IS NULL
         AND si.status = 'POSTED'
         AND si."documentType" = 'INVOICE'
         AND si."invoiceDate" >= ${from}::date
         AND si."invoiceDate" <= ${to}::date
         ${query.branchId ? Prisma.sql`AND si."branchId" = ${query.branchId}::uuid` : Prisma.sql``}
       GROUP BY i.id, i."nameEn", i."nameAr"
       ORDER BY total DESC
       LIMIT 5
    `);

    // ------------------------------------------------- latest activity
    const recentSales = await this.prisma.salesInvoice.findMany({
      where: { companyId, deletedAt: null, ...branchFilterDoc },
      orderBy: { invoiceDate: 'desc' },
      take: 5,
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        totalAmount: true,
        status: true,
        documentType: true,
        customer: { select: { nameEn: true, nameAr: true } },
      },
    });
    const recentPurchases = await this.prisma.purchaseInvoice.findMany({
      where: { companyId, deletedAt: null, ...branchFilterDoc },
      orderBy: { invoiceDate: 'desc' },
      take: 5,
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        totalAmount: true,
        status: true,
        documentType: true,
        supplier: { select: { nameEn: true, nameAr: true } },
      },
    });
    const recentVouchers = await this.prisma.cashVoucher.findMany({
      where: { companyId, deletedAt: null, ...branchFilterDoc },
      orderBy: { voucherDate: 'desc' },
      take: 5,
      select: {
        id: true,
        voucherNumber: true,
        voucherDate: true,
        amount: true,
        status: true,
        kind: true,
        customer: { select: { nameEn: true, nameAr: true } },
        supplier: { select: { nameEn: true, nameAr: true } },
      },
    });

    const recentDocuments = [
      ...recentSales.map((row) => ({
        kind: 'SALES_INVOICE' as const,
        id: row.id,
        number: row.invoiceNumber,
        date: row.invoiceDate.toISOString().slice(0, 10),
        partyNameEn: row.customer.nameEn,
        partyNameAr: row.customer.nameAr,
        amount: row.totalAmount.toFixed(MONEY_SCALE),
        status: row.status,
        documentType: row.documentType,
      })),
      ...recentPurchases.map((row) => ({
        kind: 'PURCHASE_INVOICE' as const,
        id: row.id,
        number: row.invoiceNumber,
        date: row.invoiceDate.toISOString().slice(0, 10),
        partyNameEn: row.supplier.nameEn,
        partyNameAr: row.supplier.nameAr,
        amount: row.totalAmount.toFixed(MONEY_SCALE),
        status: row.status,
        documentType: row.documentType,
      })),
      ...recentVouchers.map((row) => ({
        kind: row.kind === CashVoucherKind.RECEIPT ? ('CASH_RECEIPT' as const) : ('CASH_PAYMENT' as const),
        id: row.id,
        number: row.voucherNumber,
        date: row.voucherDate.toISOString().slice(0, 10),
        partyNameEn: row.customer?.nameEn ?? row.supplier?.nameEn ?? '',
        partyNameAr: row.customer?.nameAr ?? row.supplier?.nameAr ?? '',
        amount: row.amount.toFixed(MONEY_SCALE),
        status: row.status,
        documentType: row.kind,
      })),
    ]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 8);

    // Work waiting for someone: drafts to post, debts to chase, stock to reorder.
    const [draftSales, draftPurchases, draftVouchers, draftJournals] = await Promise.all([
      this.prisma.salesInvoice.count({
        where: { companyId, deletedAt: null, status: InvoiceStatus.DRAFT, ...branchFilterDoc },
      }),
      this.prisma.purchaseInvoice.count({
        where: { companyId, deletedAt: null, status: InvoiceStatus.DRAFT, ...branchFilterDoc },
      }),
      this.prisma.cashVoucher.count({
        where: { companyId, deletedAt: null, status: InvoiceStatus.DRAFT, ...branchFilterDoc },
      }),
      this.prisma.journalEntry.count({
        where: { companyId, status: 'DRAFT', ...branchFilterDoc },
      }),
    ]);

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
      receipts: {
        total: (receipts._sum.amount ?? new Prisma.Decimal(0)).toFixed(MONEY_SCALE),
        vouchers: receipts._count?._all ?? 0,
      },
      payments: {
        total: (payments._sum.amount ?? new Prisma.Decimal(0)).toFixed(MONEY_SCALE),
        vouchers: payments._count?._all ?? 0,
      },
      cashPosition: cashPosition.toFixed(MONEY_SCALE),
      cashAccounts: cashAccounts.map((account) => ({
        id: account.id,
        code: account.code,
        nameEn: account.nameEn,
        nameAr: account.nameAr,
        kind: account.kind,
        balance: (balanceByAccount.get(account.accountId) ?? new Prisma.Decimal(0)).toFixed(
          MONEY_SCALE,
        ),
      })),
      receivables: receivables.total,
      payables: payables.total,
      overdue: {
        total: new Prisma.Decimal(overdueRows[0]?.overdue ?? 0).toFixed(MONEY_SCALE),
        invoices: Number(overdueRows[0]?.count ?? 0),
      },
      outstanding: {
        total: new Prisma.Decimal(outstandingRows[0]?.outstanding ?? 0).toFixed(MONEY_SCALE),
        invoices: Number(outstandingRows[0]?.count ?? 0),
      },
      parties: {
        customers: countsOf(customerCounts),
        suppliers: countsOf(supplierCounts),
      },
      stock: {
        value: new Prisma.Decimal(stockRows[0]?.value ?? 0).toFixed(MONEY_SCALE),
        itemsInStock: Number(stockRows[0]?.items ?? 0),
        negativeBalances: Number(stockRows[0]?.negative ?? 0),
        needsReorder: Number(reorderCount[0]?.count ?? 0),
      },
      topCustomers: topCustomers.map((row) => ({
        id: row.id,
        nameEn: row.nameEn,
        nameAr: row.nameAr,
        total: row.total.toFixed(MONEY_SCALE),
        invoices: Number(row.invoices),
      })),
      topItems: topItems.map((row) => ({
        id: row.id,
        nameEn: row.nameEn,
        nameAr: row.nameAr,
        quantity: row.quantity.toFixed(MONEY_SCALE),
        total: row.total.toFixed(MONEY_SCALE),
      })),
      recentDocuments,
      quickActions: {
        draftDocuments: draftSales + draftPurchases + draftVouchers + draftJournals,
        draftSales,
        draftPurchases,
        draftVouchers,
        draftJournals,
        overdueInvoices: Number(overdueRows[0]?.count ?? 0),
        itemsToReorder: Number(reorderCount[0]?.count ?? 0),
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

  /**
   * Month-by-month comparison for the dashboard charts: the last `months`
   * calendar months of sales, purchases, money in, money out, and the ledger
   * result. A month with no documents is a zero, not a gap.
   */
  async monthly(companyId: string, query: { months?: number; branchId?: string }) {
    const months = Math.min(Math.max(query.months ?? 12, 3), 24);
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const branchFilter = query.branchId
      ? Prisma.sql`AND e."branchId" = ${query.branchId}::uuid`
      : Prisma.sql``;
    const branchFilterDoc = query.branchId
      ? Prisma.sql`AND si."branchId" = ${query.branchId}::uuid`
      : Prisma.sql``;
    const branchFilterPurchase = query.branchId
      ? Prisma.sql`AND pi."branchId" = ${query.branchId}::uuid`
      : Prisma.sql``;
    const branchFilterVoucher = query.branchId
      ? Prisma.sql`AND cv."branchId" = ${query.branchId}::uuid`
      : Prisma.sql``;

    const [salesRows, purchaseRows, voucherRows, ledgerRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ month: string; total: Prisma.Decimal; count: bigint }>>(
        Prisma.sql`
          SELECT to_char(si."invoiceDate", 'YYYY-MM') AS month,
                 COALESCE(SUM(si."totalAmount"), 0) AS total,
                 COUNT(*) AS count
            FROM sales_invoices si
           WHERE si."companyId" = ${companyId}::uuid
             AND si."deletedAt" IS NULL
             AND si.status = 'POSTED'
             AND si."documentType" = 'INVOICE'
             AND si."invoiceDate" >= ${start}::date
             AND si."invoiceDate" < ${end}::date
             ${branchFilterDoc}
           GROUP BY 1
        `,
      ),
      this.prisma.$queryRaw<Array<{ month: string; total: Prisma.Decimal; count: bigint }>>(
        Prisma.sql`
          SELECT to_char(pi."invoiceDate", 'YYYY-MM') AS month,
                 COALESCE(SUM(pi."totalAmount"), 0) AS total,
                 COUNT(*) AS count
            FROM purchase_invoices pi
           WHERE pi."companyId" = ${companyId}::uuid
             AND pi."deletedAt" IS NULL
             AND pi.status = 'POSTED'
             AND pi."documentType" = 'INVOICE'
             AND pi."invoiceDate" >= ${start}::date
             AND pi."invoiceDate" < ${end}::date
             ${branchFilterPurchase}
           GROUP BY 1
        `,
      ),
      this.prisma.$queryRaw<
        Array<{ month: string; receipts: Prisma.Decimal; payments: Prisma.Decimal }>
      >(Prisma.sql`
          SELECT to_char(cv."voucherDate", 'YYYY-MM') AS month,
                 COALESCE(SUM(cv.amount) FILTER (WHERE cv.kind = 'RECEIPT'), 0) AS receipts,
                 COALESCE(SUM(cv.amount) FILTER (WHERE cv.kind = 'PAYMENT'), 0) AS payments
            FROM cash_vouchers cv
           WHERE cv."companyId" = ${companyId}::uuid
             AND cv."deletedAt" IS NULL
             AND cv.status = 'POSTED'
             AND cv."voucherDate" >= ${start}::date
             AND cv."voucherDate" < ${end}::date
             ${branchFilterVoucher}
           GROUP BY 1
        `,
      ),
      this.prisma.$queryRaw<
        Array<{ month: string; revenue: Prisma.Decimal; expenses: Prisma.Decimal }>
      >(Prisma.sql`
          SELECT to_char(e."entryDate", 'YYYY-MM') AS month,
                 COALESCE(SUM(CASE WHEN a.type = 'REVENUE' THEN l.credit - l.debit ELSE 0 END), 0) AS revenue,
                 COALESCE(SUM(CASE WHEN a.type = 'EXPENSE' THEN l.debit - l.credit ELSE 0 END), 0) AS expenses
            FROM journal_lines l
            JOIN journal_entries e ON e.id = l."journalEntryId"
            JOIN accounts a ON a.id = l."accountId"
           WHERE e."companyId" = ${companyId}::uuid
             AND e.status IN ('POSTED', 'REVERSED')
             AND e."entryDate" >= ${start}::date
             AND e."entryDate" < ${end}::date
             ${branchFilter}
           GROUP BY 1
        `,
      ),
    ]);

    const key = (year: number, month: number) =>
      `${year}-${String(month + 1).padStart(2, '0')}`;
    const byMonth = new Map<
      string,
      {
        sales: Prisma.Decimal;
        salesCount: number;
        purchases: Prisma.Decimal;
        purchasesCount: number;
        receipts: Prisma.Decimal;
        payments: Prisma.Decimal;
        revenue: Prisma.Decimal;
        expenses: Prisma.Decimal;
      }
    >();
    for (let index = 0; index < months; index += 1) {
      const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
      byMonth.set(key(date.getUTCFullYear(), date.getUTCMonth()), {
        sales: new Prisma.Decimal(0),
        salesCount: 0,
        purchases: new Prisma.Decimal(0),
        purchasesCount: 0,
        receipts: new Prisma.Decimal(0),
        payments: new Prisma.Decimal(0),
        revenue: new Prisma.Decimal(0),
        expenses: new Prisma.Decimal(0),
      });
    }
    for (const row of salesRows) {
      const slot = byMonth.get(row.month);
      if (slot) {
        slot.sales = new Prisma.Decimal(row.total);
        slot.salesCount = Number(row.count);
      }
    }
    for (const row of purchaseRows) {
      const slot = byMonth.get(row.month);
      if (slot) {
        slot.purchases = new Prisma.Decimal(row.total);
        slot.purchasesCount = Number(row.count);
      }
    }
    for (const row of voucherRows) {
      const slot = byMonth.get(row.month);
      if (slot) {
        slot.receipts = new Prisma.Decimal(row.receipts);
        slot.payments = new Prisma.Decimal(row.payments);
      }
    }
    for (const row of ledgerRows) {
      const slot = byMonth.get(row.month);
      if (slot) {
        slot.revenue = new Prisma.Decimal(row.revenue);
        slot.expenses = new Prisma.Decimal(row.expenses);
      }
    }

    return {
      from: start.toISOString().slice(0, 10),
      months: [...byMonth.entries()].map(([month, slot]) => ({
        month,
        sales: slot.sales.toFixed(MONEY_SCALE),
        salesCount: slot.salesCount,
        purchases: slot.purchases.toFixed(MONEY_SCALE),
        purchasesCount: slot.purchasesCount,
        receipts: slot.receipts.toFixed(MONEY_SCALE),
        payments: slot.payments.toFixed(MONEY_SCALE),
        revenue: slot.revenue.toFixed(MONEY_SCALE),
        expenses: slot.expenses.toFixed(MONEY_SCALE),
        result: slot.revenue.minus(slot.expenses).toFixed(MONEY_SCALE),
      })),
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
