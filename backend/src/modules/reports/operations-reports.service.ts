import { BadRequestException, Injectable } from '@nestjs/common';
import { CashVoucherKind, InvoiceStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

const MONEY_SCALE = 4;

export interface OperationsPeriodQuery {
  from?: string;
  to?: string;
  branchId?: string;
}

export interface PartyOperationsQuery extends OperationsPeriodQuery {
  customerId?: string;
  supplierId?: string;
  status?: string;
}

/**
 * The operational reports: what was sold, bought, spent, received and is
 * still owed - read from the documents themselves rather than the ledger, so
 * the numbers match the paperwork a manager is looking at.
 *
 * Ledger reports (trial balance, profit and loss, ...) stay in
 * ReportsService; this file answers "show me the invoices".
 */
@Injectable()
export class OperationsReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private period(query: OperationsPeriodQuery) {
    const to = query.to
      ? new Date(`${query.to.slice(0, 10)}T23:59:59.999Z`)
      : new Date();
    const from = query.from
      ? new Date(`${query.from.slice(0, 10)}T00:00:00.000Z`)
      : new Date(Date.UTC(to.getUTCFullYear(), 0, 1));
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('"from" must not be after "to"');
    }
    return { from, to };
  }

  private statusFilter(status?: string) {
    if (!status) return { status: InvoiceStatus.POSTED };
    const upper = status.toUpperCase();
    if (!['DRAFT', 'POSTED', 'REVERSED', 'ALL'].includes(upper)) {
      throw new BadRequestException('status must be DRAFT, POSTED, REVERSED or ALL');
    }
    return upper === 'ALL' ? {} : { status: upper as InvoiceStatus };
  }

  /// Sales invoices (and returns) in the period, one row per document.
  async sales(companyId: string, query: PartyOperationsQuery) {
    const { from, to } = this.period(query);
    const rows = await this.prisma.salesInvoice.findMany({
      where: {
        companyId,
        deletedAt: null,
        invoiceDate: { gte: from, lte: to },
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...this.statusFilter(query.status),
      },
      orderBy: [{ invoiceDate: 'asc' }, { invoiceNumber: 'asc' }],
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        documentType: true,
        status: true,
        subTotal: true,
        discountAmount: true,
        taxAmount: true,
        totalAmount: true,
        paidAmount: true,
        costOfGoods: true,
        customer: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      },
    });

    const totals = rows.reduce(
      (acc, row) => ({
        subTotal: acc.subTotal.plus(row.subTotal),
        discount: acc.discount.plus(row.discountAmount),
        tax: acc.tax.plus(row.taxAmount),
        total: acc.total.plus(row.totalAmount),
        paid: acc.paid.plus(row.paidAmount),
        costOfGoods: acc.costOfGoods.plus(row.costOfGoods),
      }),
      {
        subTotal: new Prisma.Decimal(0),
        discount: new Prisma.Decimal(0),
        tax: new Prisma.Decimal(0),
        total: new Prisma.Decimal(0),
        paid: new Prisma.Decimal(0),
        costOfGoods: new Prisma.Decimal(0),
      },
    );

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      rows: rows.map((row) => ({
        ...row,
        invoiceDate: row.invoiceDate.toISOString().slice(0, 10),
        dueDate: row.dueDate?.toISOString().slice(0, 10) ?? null,
        subTotal: row.subTotal.toFixed(MONEY_SCALE),
        discountAmount: row.discountAmount.toFixed(MONEY_SCALE),
        taxAmount: row.taxAmount.toFixed(MONEY_SCALE),
        totalAmount: row.totalAmount.toFixed(MONEY_SCALE),
        paidAmount: row.paidAmount.toFixed(MONEY_SCALE),
        outstanding: row.totalAmount.minus(row.paidAmount).toFixed(MONEY_SCALE),
        costOfGoods: row.costOfGoods.toFixed(MONEY_SCALE),
        grossProfit: row.totalAmount.minus(row.costOfGoods).toFixed(MONEY_SCALE),
      })),
      totals: {
        documents: rows.length,
        subTotal: totals.subTotal.toFixed(MONEY_SCALE),
        discount: totals.discount.toFixed(MONEY_SCALE),
        tax: totals.tax.toFixed(MONEY_SCALE),
        total: totals.total.toFixed(MONEY_SCALE),
        paid: totals.paid.toFixed(MONEY_SCALE),
        outstanding: totals.total.minus(totals.paid).toFixed(MONEY_SCALE),
        costOfGoods: totals.costOfGoods.toFixed(MONEY_SCALE),
        grossProfit: totals.total.minus(totals.costOfGoods).toFixed(MONEY_SCALE),
      },
    };
  }

  /// Purchase invoices (and returns) in the period, one row per document.
  async purchases(companyId: string, query: PartyOperationsQuery) {
    const { from, to } = this.period(query);
    const rows = await this.prisma.purchaseInvoice.findMany({
      where: {
        companyId,
        deletedAt: null,
        invoiceDate: { gte: from, lte: to },
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        ...this.statusFilter(query.status),
      },
      orderBy: [{ invoiceDate: 'asc' }, { invoiceNumber: 'asc' }],
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        supplierReference: true,
        documentType: true,
        status: true,
        subTotal: true,
        discountAmount: true,
        taxAmount: true,
        totalAmount: true,
        paidAmount: true,
        supplier: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      },
    });

    const totals = rows.reduce(
      (acc, row) => ({
        subTotal: acc.subTotal.plus(row.subTotal),
        discount: acc.discount.plus(row.discountAmount),
        tax: acc.tax.plus(row.taxAmount),
        total: acc.total.plus(row.totalAmount),
        paid: acc.paid.plus(row.paidAmount),
      }),
      {
        subTotal: new Prisma.Decimal(0),
        discount: new Prisma.Decimal(0),
        tax: new Prisma.Decimal(0),
        total: new Prisma.Decimal(0),
        paid: new Prisma.Decimal(0),
      },
    );

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      rows: rows.map((row) => ({
        ...row,
        invoiceDate: row.invoiceDate.toISOString().slice(0, 10),
        subTotal: row.subTotal.toFixed(MONEY_SCALE),
        discountAmount: row.discountAmount.toFixed(MONEY_SCALE),
        taxAmount: row.taxAmount.toFixed(MONEY_SCALE),
        totalAmount: row.totalAmount.toFixed(MONEY_SCALE),
        paidAmount: row.paidAmount.toFixed(MONEY_SCALE),
        outstanding: row.totalAmount.minus(row.paidAmount).toFixed(MONEY_SCALE),
      })),
      totals: {
        documents: rows.length,
        subTotal: totals.subTotal.toFixed(MONEY_SCALE),
        discount: totals.discount.toFixed(MONEY_SCALE),
        tax: totals.tax.toFixed(MONEY_SCALE),
        total: totals.total.toFixed(MONEY_SCALE),
        paid: totals.paid.toFixed(MONEY_SCALE),
        outstanding: totals.total.minus(totals.paid).toFixed(MONEY_SCALE),
      },
    };
  }

  /**
   * Expenses or income in the period from the ledger, grouped by account -
   * the same figures the profit and loss statement shows, one level deeper.
   */
  async accountMovement(
    companyId: string,
    type: 'EXPENSE' | 'REVENUE',
    query: OperationsPeriodQuery & { accountId?: string },
  ) {
    const { from, to } = this.period(query);
    const branchFilter = query.branchId
      ? Prisma.sql`AND e."branchId" = ${query.branchId}::uuid`
      : Prisma.sql``;
    const accountFilter = query.accountId
      ? Prisma.sql`AND a.id = ${query.accountId}::uuid`
      : Prisma.sql``;

    const rows = await this.prisma.$queryRaw<
      Array<{
        accountId: string;
        code: string;
        nameEn: string;
        nameAr: string;
        debit: Prisma.Decimal;
        credit: Prisma.Decimal;
        entries: bigint;
      }>
    >(Prisma.sql`
      SELECT a.id::text AS "accountId", a.code, a."nameEn", a."nameAr",
             COALESCE(SUM(l.debit), 0) AS debit,
             COALESCE(SUM(l.credit), 0) AS credit,
             COUNT(DISTINCT e.id) AS entries
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l."journalEntryId"
        JOIN accounts a ON a.id = l."accountId"
       WHERE e."companyId" = ${companyId}::uuid
         AND e.status IN ('POSTED', 'REVERSED')
         AND e."entryDate" >= ${from}::date
         AND e."entryDate" <= ${to}::date
         AND a.type = ${type}::"AccountType"
         ${accountFilter}
         ${branchFilter}
       GROUP BY a.id, a.code, a."nameEn", a."nameAr"
       ORDER BY a.code
    `);

    const total = rows.reduce(
      (sum, row) =>
        sum.plus(
          type === 'REVENUE'
            ? new Prisma.Decimal(row.credit).minus(row.debit)
            : new Prisma.Decimal(row.debit).minus(row.credit),
        ),
      new Prisma.Decimal(0),
    );

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      type,
      rows: rows.map((row) => ({
        accountId: row.accountId,
        code: row.code,
        nameEn: row.nameEn,
        nameAr: row.nameAr,
        debit: row.debit.toFixed(MONEY_SCALE),
        credit: row.credit.toFixed(MONEY_SCALE),
        net: (type === 'REVENUE'
          ? new Prisma.Decimal(row.credit).minus(row.debit)
          : new Prisma.Decimal(row.debit).minus(row.credit)
        ).toFixed(MONEY_SCALE),
        entries: Number(row.entries),
      })),
      total: total.toFixed(MONEY_SCALE),
    };
  }

  /// Receipt and payment vouchers in the period.
  async payments(
    companyId: string,
    query: OperationsPeriodQuery & {
      kind?: string;
      customerId?: string;
      supplierId?: string;
    },
  ) {
    const { from, to } = this.period(query);
    const kindFilter: { kind?: CashVoucherKind } = {};
    if (query.kind) {
      const upper = query.kind.toUpperCase();
      if (!['RECEIPT', 'PAYMENT', 'ALL'].includes(upper)) {
        throw new BadRequestException('kind must be RECEIPT, PAYMENT or ALL');
      }
      if (upper !== 'ALL') kindFilter.kind = upper as CashVoucherKind;
    }

    const rows = await this.prisma.cashVoucher.findMany({
      where: {
        companyId,
        deletedAt: null,
        voucherDate: { gte: from, lte: to },
        status: InvoiceStatus.POSTED,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        ...kindFilter,
      },
      orderBy: [{ voucherDate: 'asc' }, { voucherNumber: 'asc' }],
      select: {
        id: true,
        voucherNumber: true,
        voucherDate: true,
        kind: true,
        amount: true,
        description: true,
        reference: true,
        status: true,
        cashAccount: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        customer: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        supplier: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        counterAccount: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      },
    });

    const receipts = rows
      .filter((row) => row.kind === CashVoucherKind.RECEIPT)
      .reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0));
    const payments = rows
      .filter((row) => row.kind === CashVoucherKind.PAYMENT)
      .reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0));

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      rows: rows.map((row) => ({
        ...row,
        voucherDate: row.voucherDate.toISOString().slice(0, 10),
        amount: row.amount.toFixed(MONEY_SCALE),
      })),
      totals: {
        documents: rows.length,
        receipts: receipts.toFixed(MONEY_SCALE),
        payments: payments.toFixed(MONEY_SCALE),
        net: receipts.minus(payments).toFixed(MONEY_SCALE),
      },
    };
  }

  /**
   * Cash report: each cash box and bank account with its opening balance,
   * what moved in the period, and what is left.
   */
  async cash(companyId: string, query: OperationsPeriodQuery & { cashAccountId?: string }) {
    const { from, to } = this.period(query);
    const accountFilter = query.cashAccountId
      ? Prisma.sql`AND ca.id = ${query.cashAccountId}::uuid`
      : Prisma.sql``;

    const rows = await this.prisma.$queryRaw<
      Array<{
        accountId: string;
        code: string;
        nameEn: string;
        nameAr: string;
        kind: string;
        opening: Prisma.Decimal;
        debit: Prisma.Decimal;
        credit: Prisma.Decimal;
      }>
    >(Prisma.sql`
      SELECT ca.id::text AS "accountId", ca.code, ca."nameEn", ca."nameAr", ca.kind::text AS kind,
             COALESCE(SUM(CASE WHEN e."entryDate" < ${from}::date THEN l.debit - l.credit ELSE 0 END), 0) AS opening,
             COALESCE(SUM(CASE WHEN e."entryDate" >= ${from}::date THEN l.debit ELSE 0 END), 0) AS debit,
             COALESCE(SUM(CASE WHEN e."entryDate" >= ${from}::date THEN l.credit ELSE 0 END), 0) AS credit
        FROM cash_accounts ca
        JOIN journal_lines l ON l."accountId" = ca."accountId"
        JOIN journal_entries e ON e.id = l."journalEntryId"
       WHERE ca."companyId" = ${companyId}::uuid
         AND ca."deletedAt" IS NULL
         AND e.status IN ('POSTED', 'REVERSED')
         AND e."entryDate" <= ${to}::date
         ${accountFilter}
       GROUP BY ca.id, ca.code, ca."nameEn", ca."nameAr", ca.kind
       ORDER BY ca.code
    `);

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      rows: rows.map((row) => ({
        cashAccountId: row.accountId,
        code: row.code,
        nameEn: row.nameEn,
        nameAr: row.nameAr,
        kind: row.kind,
        opening: row.opening.toFixed(MONEY_SCALE),
        inflow: row.debit.toFixed(MONEY_SCALE),
        outflow: row.credit.toFixed(MONEY_SCALE),
        closing: new Prisma.Decimal(row.opening)
          .plus(row.debit)
          .minus(row.credit)
          .toFixed(MONEY_SCALE),
      })),
      totals: {
        opening: rows
          .reduce((sum, row) => sum.plus(row.opening), new Prisma.Decimal(0))
          .toFixed(MONEY_SCALE),
        inflow: rows
          .reduce((sum, row) => sum.plus(row.debit), new Prisma.Decimal(0))
          .toFixed(MONEY_SCALE),
        outflow: rows
          .reduce((sum, row) => sum.plus(row.credit), new Prisma.Decimal(0))
          .toFixed(MONEY_SCALE),
        closing: rows
          .reduce(
            (sum, row) => sum.plus(row.opening).plus(row.debit).minus(row.credit),
            new Prisma.Decimal(0),
          )
          .toFixed(MONEY_SCALE),
      },
    };
  }

  /// Invoices that are still not fully paid, split into due and overdue.
  async outstandingInvoices(
    companyId: string,
    query: {
      asOf?: string;
      kind?: string;
      customerId?: string;
      supplierId?: string;
      branchId?: string;
    },
  ) {
    const asOf = query.asOf
      ? new Date(`${query.asOf.slice(0, 10)}T23:59:59.999Z`)
      : new Date();
    const side = (query.kind ?? 'sales').toLowerCase();
    if (!['sales', 'purchases'].includes(side)) {
      throw new BadRequestException('kind must be sales or purchases');
    }

    const sales = side === 'sales';
    const rows = sales
      ? await this.prisma.salesInvoice.findMany({
          where: {
            companyId,
            deletedAt: null,
            status: InvoiceStatus.POSTED,
            invoiceDate: { lte: asOf },
            ...(query.branchId ? { branchId: query.branchId } : {}),
            ...(query.customerId ? { customerId: query.customerId } : {}),
          },
          select: {
            id: true,
            invoiceNumber: true,
            invoiceDate: true,
            dueDate: true,
            totalAmount: true,
            paidAmount: true,
            customer: { select: { id: true, code: true, nameEn: true, nameAr: true } },
          },
          orderBy: [{ dueDate: 'asc' }, { invoiceDate: 'asc' }],
        })
      : await this.prisma.purchaseInvoice.findMany({
          where: {
            companyId,
            deletedAt: null,
            status: InvoiceStatus.POSTED,
            invoiceDate: { lte: asOf },
            ...(query.branchId ? { branchId: query.branchId } : {}),
            ...(query.supplierId ? { supplierId: query.supplierId } : {}),
          },
          select: {
            id: true,
            invoiceNumber: true,
            invoiceDate: true,
            dueDate: true,
            totalAmount: true,
            paidAmount: true,
            supplier: { select: { id: true, code: true, nameEn: true, nameAr: true } },
          },
          orderBy: [{ dueDate: 'asc' }, { invoiceDate: 'asc' }],
        });

    const open = rows
      .map((row) => {
        const outstanding = row.totalAmount.minus(row.paidAmount);
        const overdue =
          row.dueDate != null && row.dueDate.getTime() < asOf.getTime();
        return {
          id: row.id,
          invoiceNumber: row.invoiceNumber,
          invoiceDate: row.invoiceDate.toISOString().slice(0, 10),
          dueDate: row.dueDate?.toISOString().slice(0, 10) ?? null,
          party: 'customer' in row ? row.customer : (row as { supplier: unknown }).supplier,
          totalAmount: row.totalAmount.toFixed(MONEY_SCALE),
          paidAmount: row.paidAmount.toFixed(MONEY_SCALE),
          outstanding: outstanding.toFixed(MONEY_SCALE),
          daysOverdue:
            overdue && row.dueDate
              ? Math.floor((asOf.getTime() - row.dueDate.getTime()) / 86400000)
              : 0,
          state: outstanding.isZero() ? 'PAID' : overdue ? 'OVERDUE' : 'DUE',
        };
      })
      .filter((row) => new Prisma.Decimal(row.outstanding).isPositive());

    const total = open.reduce(
      (sum, row) => sum.plus(row.outstanding),
      new Prisma.Decimal(0),
    );
    const overdueTotal = open
      .filter((row) => row.state === 'OVERDUE')
      .reduce((sum, row) => sum.plus(row.outstanding), new Prisma.Decimal(0));

    return {
      asOf: asOf.toISOString().slice(0, 10),
      kind: side,
      rows: open,
      totals: {
        invoices: open.length,
        outstanding: total.toFixed(MONEY_SCALE),
        overdue: overdueTotal.toFixed(MONEY_SCALE),
        due: total.minus(overdueTotal).toFixed(MONEY_SCALE),
      },
    };
  }
}
