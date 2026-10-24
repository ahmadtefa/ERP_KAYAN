import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccountType,
  InvoiceDocumentType,
  InvoiceStatus,
  JournalStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { buildTrialBalanceGroups } from './trial-balance-groups';

const MONEY_SCALE = 4;

/**
 * Reporting reads every journal entry that has reached the ledger, i.e. POSTED
 * and REVERSED. Reversal in this system is additive: the original entry stays in
 * the books and a mirror entry cancels it, exactly as a paper ledger works. An
 * entry whose status is DRAFT is only a proposal and is never read.
 *
 * (Historical note: reading POSTED only made a reversed invoice look doubled.)
 * must never influence a figure anyone makes a decision on.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private parseDate(value: string, field: string): Date {
    // Validate the calendar date before Date parses it (JS normalizes Feb 31).
    const datePrefix = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
    if (!datePrefix) {
      throw new BadRequestException(`"${field}" must be an ISO date or timestamp`);
    }

    const [, year, month, day] = datePrefix;
    const normalized = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (
      normalized.getUTCFullYear() !== Number(year) ||
      normalized.getUTCMonth() !== Number(month) - 1 ||
      normalized.getUTCDate() !== Number(day)
    ) {
      throw new BadRequestException(`"${field}" must be a valid calendar date`);
    }

    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
      throw new BadRequestException(`"${field}" must be a valid date`);
    }
    return parsed;
  }

  private period(query: { from?: string; to?: string }) {
    const to = query.to ? this.parseDate(query.to, 'to') : new Date();
    const from = query.from
      ? this.parseDate(query.from, 'from')
      : new Date(Date.UTC(to.getUTCFullYear(), 0, 1));
    if (from > to) {
      throw new BadRequestException('"from" must not be after "to"');
    }
    return { from, to };
  }

  /**
   * Trial balance: every account's opening balance, the movement inside the
   * period, and the closing balance.
   *
   * The result must balance - total closing debits equal total closing credits.
   * The totals are returned so the caller can see that for themselves rather
   * than taking it on trust.
   */
  async trialBalance(
    companyId: string,
    query: { from?: string; to?: string; branchId?: string },
  ) {
    const { from, to } = this.period(query);
    const branchFilter = query.branchId ? Prisma.sql`AND e."branchId" = ${query.branchId}::uuid` : Prisma.sql``;

    const accounts = await this.prisma.account.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameAr: true,
        type: true,
        parentId: true,
        isPostable: true,
      },
    });
    const postable = accounts.filter((a) => a.isPostable);

    const opening = await this.prisma.$queryRaw<
      Array<{ accountId: string; net: Prisma.Decimal }>
    >(Prisma.sql`
      SELECT l."accountId" AS "accountId",
             COALESCE(SUM(l.debit - l.credit), 0) AS net
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l."journalEntryId"
       WHERE e."companyId" = ${companyId}::uuid
         AND e.status IN ('POSTED', 'REVERSED')
         AND e."entryDate" < ${from}::date
         ${branchFilter}
       GROUP BY l."accountId"
    `);

    const movement = await this.prisma.$queryRaw<
      Array<{ accountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal }>
    >(Prisma.sql`
      SELECT l."accountId" AS "accountId",
             COALESCE(SUM(l.debit), 0)  AS debit,
             COALESCE(SUM(l.credit), 0) AS credit
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l."journalEntryId"
       WHERE e."companyId" = ${companyId}::uuid
         AND e.status IN ('POSTED', 'REVERSED')
         AND e."entryDate" >= ${from}::date
         AND e."entryDate" <= ${to}::date
         ${branchFilter}
       GROUP BY l."accountId"
    `);

    const openingById = new Map(opening.map((r) => [r.accountId, new Prisma.Decimal(r.net)]));
    const movementById = new Map(
      movement.map((r) => [
        r.accountId,
        { debit: new Prisma.Decimal(r.debit), credit: new Prisma.Decimal(r.credit) },
      ]),
    );

    const valuesById = new Map(
      postable.map((a) => {
        const open = openingById.get(a.id) ?? new Prisma.Decimal(0);
        const mv = movementById.get(a.id) ?? {
          debit: new Prisma.Decimal(0),
          credit: new Prisma.Decimal(0),
        };
        return [
          a.id,
          {
            opening: open,
            debit: mv.debit,
            credit: mv.credit,
            closing: open.plus(mv.debit).minus(mv.credit),
          },
        ] as const;
      }),
    );

    const rows = postable
      .map((a) => {
        const v = valuesById.get(a.id)!;
        return {
          accountId: a.id,
          code: a.code,
          nameEn: a.nameEn,
          nameAr: a.nameAr,
          type: a.type.toLowerCase(),
          opening: v.opening.toFixed(MONEY_SCALE),
          debit: v.debit.toFixed(MONEY_SCALE),
          credit: v.credit.toFixed(MONEY_SCALE),
          closing: v.closing.toFixed(MONEY_SCALE),
        };
      })
      // An account with nothing in it and nothing carried forward is noise.
      .filter(
        (r) =>
          !new Prisma.Decimal(r.opening).isZero() ||
          !new Prisma.Decimal(r.debit).isZero() ||
          !new Prisma.Decimal(r.credit).isZero(),
      );

    const totalDebit = rows.reduce(
      (s, r) => s.plus(r.debit),
      new Prisma.Decimal(0),
    );
    const totalCredit = rows.reduce(
      (s, r) => s.plus(r.credit),
      new Prisma.Decimal(0),
    );
    const totalClosingDebit = rows.reduce(
      (s, r) => s.plus(new Prisma.Decimal(r.closing).greaterThan(0) ? r.closing : 0),
      new Prisma.Decimal(0),
    );
    const totalClosingCredit = rows.reduce(
      (s, r) => s.plus(new Prisma.Decimal(r.closing).lessThan(0) ? new Prisma.Decimal(r.closing).negated() : 0),
      new Prisma.Decimal(0),
    );

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      rows,
      // Heading subtotals for readability. The totals below are computed
      // from the postable rows alone, so these never double-count.
      groups: buildTrialBalanceGroups(accounts, valuesById),
      totals: {
        debit: totalDebit.toFixed(MONEY_SCALE),
        credit: totalCredit.toFixed(MONEY_SCALE),
        closingDebit: totalClosingDebit.toFixed(MONEY_SCALE),
        closingCredit: totalClosingCredit.toFixed(MONEY_SCALE),
        // Zero here means the ledger balances. Anything else is a bug worth
        // investigating, not a rounding artefact.
        difference: totalClosingDebit.minus(totalClosingCredit).toFixed(MONEY_SCALE),
      },
    };
  }

  /** Profit and loss for the period. Revenue less expenses. */
  async profitAndLoss(
    companyId: string,
    query: { from?: string; to?: string; branchId?: string },
  ) {
    const tb = await this.trialBalance(companyId, query);
    const rows = tb.rows.filter(
      (r) => r.type === AccountType.REVENUE.toLowerCase() || r.type === AccountType.EXPENSE.toLowerCase(),
    );

    const revenue = rows
      .filter((r) => r.type === AccountType.REVENUE.toLowerCase())
      .map((r) => ({
        ...r,
        amount: new Prisma.Decimal(r.credit).minus(r.debit).toFixed(MONEY_SCALE),
      }));
    const expenses = rows
      .filter((r) => r.type === AccountType.EXPENSE.toLowerCase())
      .map((r) => ({
        ...r,
        amount: new Prisma.Decimal(r.debit).minus(r.credit).toFixed(MONEY_SCALE),
      }));

    const totalRevenue = revenue.reduce((s, r) => s.plus(r.amount), new Prisma.Decimal(0));
    const totalExpenses = expenses.reduce((s, r) => s.plus(r.amount), new Prisma.Decimal(0));

    return {
      from: tb.from,
      to: tb.to,
      revenue,
      expenses,
      totals: {
        revenue: totalRevenue.toFixed(MONEY_SCALE),
        expenses: totalExpenses.toFixed(MONEY_SCALE),
        netProfit: totalRevenue.minus(totalExpenses).toFixed(MONEY_SCALE),
      },
    };
  }

  /**
   * What each customer still owes, from posted invoices.
   *
   * This is the document view, not the ledger view: it answers "which invoices
   * are unpaid", which is what a collections call needs.
   */
  async customerBalances(companyId: string, query: { asOf?: string | null }) {
    const asOf = query.asOf ? this.parseDate(query.asOf, 'asOf') : new Date();

    const customers = await this.prisma.customer.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, nameEn: true, nameAr: true, phone: true },
    });

    // A return is a row in this same table (a credit note naming the
    // invoice it returns). Summing every row's total as "invoiced" — as
    // this report used to — adds a return to what the customer owes
    // instead of subtracting it, so the subledger and the receivable
    // control account disagreed by twice every return. The ageing
    // report already reads the document type; both now tell one story:
    // an invoice adds (total − paid), a note subtracts it. Reversed
    // documents are excluded for the same reason ageing excludes them:
    // their journals cancel out, so they carry no live balance.
    const invoices = await this.prisma.salesInvoice.findMany({
      where: {
        companyId,
        deletedAt: null,
        // POSTED only: a reversed invoice keeps its number but no longer
        // carries a debt, and its journal has already been cancelled.
        status: InvoiceStatus.POSTED,
        invoiceDate: { lte: asOf },
      },
      select: {
        customerId: true,
        invoiceNumber: true,
        invoiceDate: true,
        documentType: true,
        totalAmount: true,
        paidAmount: true,
      },
      orderBy: { invoiceDate: 'asc' },
    });

    const byCustomer = new Map<
      string,
      { invoiced: Prisma.Decimal; notes: Prisma.Decimal; paid: Prisma.Decimal }
    >();
    for (const inv of invoices) {
      const current = byCustomer.get(inv.customerId) ?? {
        invoiced: new Prisma.Decimal(0),
        notes: new Prisma.Decimal(0),
        paid: new Prisma.Decimal(0),
      };
      if (inv.documentType === InvoiceDocumentType.INVOICE) {
        current.invoiced = current.invoiced.plus(inv.totalAmount);
        current.paid = current.paid.plus(inv.paidAmount);
      } else {
        current.notes = current.notes.plus(inv.totalAmount);
        current.paid = current.paid.minus(inv.paidAmount);
      }
      byCustomer.set(inv.customerId, current);
    }

    return {
      asOf: asOf.toISOString().slice(0, 10),
      rows: customers
        .map((c) => {
          const agg = byCustomer.get(c.id) ?? {
            invoiced: new Prisma.Decimal(0),
            notes: new Prisma.Decimal(0),
            paid: new Prisma.Decimal(0),
          };
          return {
            customerId: c.id,
            code: c.code,
            nameEn: c.nameEn,
            nameAr: c.nameAr,
            phone: c.phone,
            invoiced: agg.invoiced.toFixed(MONEY_SCALE),
            notes: agg.notes.toFixed(MONEY_SCALE),
            paid: agg.paid.toFixed(MONEY_SCALE),
            balance: agg.invoiced.minus(agg.notes).minus(agg.paid).toFixed(MONEY_SCALE),
          };
        })
        .filter((r) => !new Prisma.Decimal(r.balance).isZero()),
    };
  }

  /** The mirror image: what the company still owes each supplier. */
  async supplierBalances(companyId: string, query: { asOf?: string | null }) {
    const asOf = query.asOf ? this.parseDate(query.asOf, 'asOf') : new Date();

    const suppliers = await this.prisma.supplier.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, nameEn: true, nameAr: true, phone: true },
    });

    // The debit-note mirror of the customer fix above: a purchase
    // return reduces what is owed instead of adding to it.
    const invoices = await this.prisma.purchaseInvoice.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: InvoiceStatus.POSTED,
        invoiceDate: { lte: asOf },
      },
      select: {
        supplierId: true,
        documentType: true,
        totalAmount: true,
        paidAmount: true,
      },
    });

    const bySupplier = new Map<
      string,
      { invoiced: Prisma.Decimal; notes: Prisma.Decimal; paid: Prisma.Decimal }
    >();
    for (const inv of invoices) {
      const current = bySupplier.get(inv.supplierId) ?? {
        invoiced: new Prisma.Decimal(0),
        notes: new Prisma.Decimal(0),
        paid: new Prisma.Decimal(0),
      };
      if (inv.documentType === InvoiceDocumentType.INVOICE) {
        current.invoiced = current.invoiced.plus(inv.totalAmount);
        current.paid = current.paid.plus(inv.paidAmount);
      } else {
        current.notes = current.notes.plus(inv.totalAmount);
        current.paid = current.paid.minus(inv.paidAmount);
      }
      bySupplier.set(inv.supplierId, current);
    }

    return {
      asOf: asOf.toISOString().slice(0, 10),
      rows: suppliers
        .map((s) => {
          const agg = bySupplier.get(s.id) ?? {
            invoiced: new Prisma.Decimal(0),
            notes: new Prisma.Decimal(0),
            paid: new Prisma.Decimal(0),
          };
          return {
            supplierId: s.id,
            code: s.code,
            nameEn: s.nameEn,
            nameAr: s.nameAr,
            phone: s.phone,
            invoiced: agg.invoiced.toFixed(MONEY_SCALE),
            notes: agg.notes.toFixed(MONEY_SCALE),
            paid: agg.paid.toFixed(MONEY_SCALE),
            balance: agg.invoiced.minus(agg.notes).minus(agg.paid).toFixed(MONEY_SCALE),
          };
        })
        .filter((r) => !new Prisma.Decimal(r.balance).isZero()),
    };
  }

  /** Every line of one account, so a figure can be traced to its documents. */
  async accountLedger(
    companyId: string,
    accountId: string,
    query: { from?: string; to?: string; branchId?: string },
  ) {
    const { from, to } = this.period(query);

    const account = await this.prisma.account.findFirst({
      where: { id: accountId, companyId, deletedAt: null },
      select: { id: true, code: true, nameEn: true, nameAr: true, type: true },
    });
    if (!account) {
      throw new NotFoundException('The account does not exist in this company');
    }

    const branchFilter = query.branchId
      ? Prisma.sql`AND e."branchId" = ${query.branchId}::uuid`
      : Prisma.sql``;

    const openingRows = await this.prisma.$queryRaw<Array<{ net: Prisma.Decimal }>>(Prisma.sql`
      SELECT COALESCE(SUM(l.debit - l.credit), 0) AS net
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l."journalEntryId"
       WHERE e."companyId" = ${companyId}::uuid
         AND e.status IN ('POSTED', 'REVERSED')
         AND l."accountId" = ${accountId}::uuid
         AND e."entryDate" < ${from}::date
         ${branchFilter}
    `);
    const opening = new Prisma.Decimal(openingRows[0]?.net ?? 0);

    const lines = await this.prisma.journalLine.findMany({
      where: {
        accountId,
        entry: {
          companyId,
          status: { in: [JournalStatus.POSTED, JournalStatus.REVERSED] },
          entryDate: { gte: from, lte: to },
          ...(query.branchId ? { branchId: query.branchId } : {}),
        },
      },
      include: {
        entry: {
          select: {
            entryNumber: true,
            entryDate: true,
            description: true,
            status: true,
            sourceType: true,
            sourceId: true,
            sourceNumber: true,
            reversalOfId: true,
          },
        },
      },
      orderBy: [{ entry: { entryDate: 'asc' } }, { entry: { entryNumber: 'asc' } }],
    });

    let running = opening;
    const movements = lines.map((l) => {
      running = running.plus(l.debit).minus(l.credit);
      return {
        entryId: l.journalEntryId,
        entryNumber: l.entry.entryNumber,
        entryDate: l.entry.entryDate.toISOString().slice(0, 10),
        description: l.description ?? l.entry.description,
        debit: l.debit.toFixed(MONEY_SCALE),
        credit: l.credit.toFixed(MONEY_SCALE),
        runningBalance: running.toFixed(MONEY_SCALE),
        /// Which document this line came from, so the reader can open it.
        source: l.entry.sourceType
          ? {
              type: l.entry.sourceType,
              id: l.entry.sourceId,
              number: l.entry.sourceNumber,
            }
          : {
              type: 'JOURNAL_ENTRY',
              id: l.journalEntryId,
              number: l.entry.entryNumber,
            },
        isReversal: Boolean(l.entry.reversalOfId),
      };
    });

    return {
      account,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      opening: opening.toFixed(MONEY_SCALE),
      movements,
      closing: running.toFixed(MONEY_SCALE),
    };
  }
}
