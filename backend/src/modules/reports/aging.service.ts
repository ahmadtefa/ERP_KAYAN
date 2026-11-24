import { Injectable } from '@nestjs/common';
import { InvoiceDocumentType, InvoiceStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

const MONEY_SCALE = 4;

/// The buckets an accountant reads receivables in. 0-30 days is current
/// business, 90+ is a collections problem.
const BUCKETS = [
  { key: 'current', labelEn: 'Not due', labelAr: 'غير مستحق', min: -9999, max: 0 },
  { key: 'd1_30', labelEn: '1-30 days', labelAr: '١-٣٠ يوم', min: 1, max: 30 },
  { key: 'd31_60', labelEn: '31-60 days', labelAr: '٣١-٦٠ يوم', min: 31, max: 60 },
  { key: 'd61_90', labelEn: '61-90 days', labelAr: '٦١-٩٠ يوم', min: 61, max: 90 },
  { key: 'd90_plus', labelEn: 'More than 90 days', labelAr: 'أكثر من ٩٠ يوم', min: 91, max: 100000 },
] as const;

/**
 * Who owes what, and for how long.
 *
 * Read from posted invoices, not from the ledger: the question is "which
 * invoice is late?", and only the invoice can answer it. The ledger answers
 * the different question "what is the total receivable?" - and the two are
 * reconciled here, out loud, because a difference between them is exactly the
 * thing a credit controller needs to know about.
 */
export interface AgingInvoice {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  documentType: string;
  total: string;
  paid: string;
  balance: string;
  daysOverdue: number;
  bucket: string;
  journalEntryId: string | null;
}
export interface AgingParty {
  partyId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  buckets: Record<string, Prisma.Decimal>;
  total: Prisma.Decimal;
  overdue: Prisma.Decimal;
  invoices: AgingInvoice[];
}

export interface AgingPaging {
  pageSize?: number;
  page?: number;
  detailPartyId?: string;
  invoicePage?: number;
  invoicePageSize?: number;
}

@Injectable()
export class AgingService {
  constructor(private readonly prisma: PrismaService) {}

  async receivables(
    companyId: string,
    query: { asOf?: string; customerId?: string; branchId?: string } & AgingPaging = {},
  ) {
    if (query.pageSize) return this.buildPaged(companyId, 'customer', query);
    return this.build(companyId, 'customer', query);
  }

  async payables(
    companyId: string,
    query: { asOf?: string; supplierId?: string; branchId?: string } & AgingPaging = {},
  ) {
    if (query.pageSize) return this.buildPaged(companyId, 'supplier', query);
    return this.build(companyId, 'supplier', query);
  }

  /// Paged form of the report, computed in the database over every matching
  /// invoice: the same filters, the same signed credit-note arithmetic and the
  /// same day buckets as build(), without loading invoices into memory.
  /// Days overdue is the whole-day difference between the as-of date and the
  /// due date (invoice date when there is none), which is what build() computes
  /// from its end-of-day as-of timestamp.
  private async buildPaged(
    companyId: string,
    side: 'customer' | 'supplier',
    query: { asOf?: string; customerId?: string; supplierId?: string; branchId?: string } & AgingPaging,
  ) {
    return this.prisma.$transaction(async (tx) => this.buildPagedSnapshot(tx, companyId, side, query), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }

  private async buildPagedSnapshot(
    tx: Prisma.TransactionClient,
    companyId: string,
    side: 'customer' | 'supplier',
    query: { asOf?: string; customerId?: string; supplierId?: string; branchId?: string } & AgingPaging,
  ) {
    const asOfDate = (query.asOf ? new Date(`${query.asOf.slice(0, 10)}T23:59:59.999Z`) : new Date())
      .toISOString().slice(0, 10);
    const invoiceTable = Prisma.raw(side === 'customer' ? 'sales_invoices' : 'purchase_invoices');
    const partyColumn = Prisma.raw(side === 'customer' ? '"customerId"' : '"supplierId"');
    const partyTable = Prisma.raw(side === 'customer' ? 'customers' : 'suppliers');
    const partyFilter = side === 'customer' ? query.customerId : query.supplierId;
    const pageSize = query.pageSize ?? 50;
    const page = Math.max(query.page ?? 1, 1);

    const docs = Prisma.sql`
      SELECT i.id, i.${partyColumn} AS pid, i."invoiceNumber", i."invoiceDate", i."dueDate",
             i."documentType"::text AS dtype, i."totalAmount" AS total, i."paidAmount" AS paid,
             i."journalEntryId" AS jid,
             CASE WHEN i."documentType" = 'INVOICE' THEN i."totalAmount" - i."paidAmount"
                  ELSE i."paidAmount" - i."totalAmount" END AS bal,
             CASE WHEN i."documentType" = 'INVOICE'
                  THEN (${asOfDate}::date - COALESCE(i."dueDate", i."invoiceDate"))
                  ELSE 0 END AS days
        FROM ${invoiceTable} i
       WHERE i."companyId" = ${companyId}::uuid
         AND i."deletedAt" IS NULL
         AND i.status = 'POSTED'
         AND i."invoiceDate" <= ${asOfDate}::date
         ${partyFilter ? Prisma.sql`AND i.${partyColumn} = ${partyFilter}::uuid` : Prisma.sql``}
         ${query.branchId ? Prisma.sql`AND i."branchId" = ${query.branchId}::uuid` : Prisma.sql``}`;
    const bucketed = Prisma.sql`
      SELECT d.*, CASE WHEN d.days <= 0 THEN 'current' WHEN d.days <= 30 THEN 'd1_30'
                       WHEN d.days <= 60 THEN 'd31_60' WHEN d.days <= 90 THEN 'd61_90'
                       ELSE 'd90_plus' END AS bucket
        FROM (${docs}) d WHERE d.bal <> 0`;
    const sumBucket = (key: string) =>
      Prisma.sql`ROUND(COALESCE(SUM(b.bal) FILTER (WHERE b.bucket = ${key}), 0), 4)::text`;

    type PartyRow = {
      pid: string; code: string; nameEn: string; nameAr: string; total: string; overdue: string;
      current: string; d1_30: string; d31_60: string; d61_90: string; d90_plus: string; n: number;
    };
    const rowsRaw = await tx.$queryRaw<PartyRow[]>(Prisma.sql`
      SELECT b.pid, p.code, p."nameEn", p."nameAr",
             ROUND(SUM(b.bal), 4)::text AS total,
             ROUND(COALESCE(SUM(b.bal) FILTER (WHERE b.days > 0), 0), 4)::text AS overdue,
             ${sumBucket('current')} AS "current", ${sumBucket('d1_30')} AS d1_30,
             ${sumBucket('d31_60')} AS d31_60, ${sumBucket('d61_90')} AS d61_90,
             ${sumBucket('d90_plus')} AS d90_plus, COUNT(*)::int AS n
        FROM (${bucketed}) b JOIN ${partyTable} p ON p.id = b.pid
       GROUP BY b.pid, p.code, p."nameEn", p."nameAr"
       ORDER BY SUM(b.bal) DESC, b.pid
       LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);

    type TotalRow = {
      parties: number; total: string; overdue: string;
      current: string; d1_30: string; d31_60: string; d61_90: string; d90_plus: string;
    };
    const [t] = await tx.$queryRaw<TotalRow[]>(Prisma.sql`
      SELECT COUNT(DISTINCT b.pid)::int AS parties,
             ROUND(COALESCE(SUM(b.bal), 0), 4)::text AS total,
             ROUND(COALESCE(SUM(b.bal) FILTER (WHERE b.days > 0), 0), 4)::text AS overdue,
             ${sumBucket('current')} AS "current", ${sumBucket('d1_30')} AS d1_30,
             ${sumBucket('d31_60')} AS d31_60, ${sumBucket('d61_90')} AS d61_90,
             ${sumBucket('d90_plus')} AS d90_plus
        FROM (${bucketed}) b`);

    const controlCode = side === 'customer' ? '1103' : '2101';
    const ledgerRows = await tx.$queryRaw<Array<{ net: Prisma.Decimal }>>(Prisma.sql`
      SELECT COALESCE(SUM(l.debit - l.credit), 0) AS net
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l."journalEntryId"
        JOIN accounts a ON a.id = l."accountId"
       WHERE e."companyId" = ${companyId}::uuid
         AND e.status IN ('POSTED', 'REVERSED')
         AND e."entryDate" <= ${asOfDate}::date
         AND a.code = ${controlCode}
         ${query.branchId ? Prisma.sql`AND e."branchId" = ${query.branchId}::uuid` : Prisma.sql``}
    `);
    const ledgerBalance = new Prisma.Decimal(ledgerRows[0]?.net ?? 0);
    const documentBalance = new Prisma.Decimal(t?.total ?? 0);
    const ledgerComparable = side === 'customer' ? ledgerBalance : ledgerBalance.negated();
    const bucketKeys = BUCKETS.map((bucket) => bucket.key);
    const pick = (r: Record<string, string>) =>
      Object.fromEntries(bucketKeys.map((key) => [key, r[key] ?? '0.0000']));

    let invoices: unknown;
    if (query.detailPartyId) {
      const invoicePageSize = query.invoicePageSize ?? 100;
      const invoicePage = Math.max(query.invoicePage ?? 1, 1);
      type InvRow = {
        invoiceNumber: string; invoiceDate: Date; dueDate: Date | null; dtype: string;
        total: Prisma.Decimal; paid: Prisma.Decimal; bal: Prisma.Decimal; days: number;
        bucket: string; jid: string | null; count: number;
      };
      const inv = await tx.$queryRaw<InvRow[]>(Prisma.sql`
        SELECT b."invoiceNumber", b."invoiceDate", b."dueDate", b.dtype, b.total, b.paid, b.bal,
               b.days, b.bucket, b.jid, COUNT(*) OVER ()::int AS count
          FROM (${bucketed}) b
         WHERE b.pid = ${query.detailPartyId}::uuid
         ORDER BY GREATEST(b.days, 0) DESC, b."invoiceNumber", b.id
         LIMIT ${invoicePageSize} OFFSET ${(invoicePage - 1) * invoicePageSize}`);
      const [invoiceCount] = await tx.$queryRaw<Array<{n:number}>>(Prisma.sql`
        SELECT COUNT(*)::int AS n FROM (${bucketed}) b WHERE b.pid = ${query.detailPartyId}::uuid`);
      invoices = {
        partyId: query.detailPartyId,
        page: invoicePage,
        pageSize: invoicePageSize,
        total: invoiceCount?.n ?? 0,
        rows: inv.map((r) => ({
          invoiceNumber: r.invoiceNumber,
          invoiceDate: r.invoiceDate.toISOString().slice(0, 10),
          dueDate: r.dueDate?.toISOString().slice(0, 10) ?? null,
          documentType: r.dtype.toLowerCase(),
          total: new Prisma.Decimal(r.total).toFixed(MONEY_SCALE),
          paid: new Prisma.Decimal(r.paid).toFixed(MONEY_SCALE),
          balance: new Prisma.Decimal(r.bal).toFixed(MONEY_SCALE),
          daysOverdue: Math.max(Number(r.days), 0),
          bucket: r.bucket,
          journalEntryId: r.jid,
        })),
      };
    }

    return {
      side,
      asOf: asOfDate,
      buckets: BUCKETS.map((bucket) => ({
        key: bucket.key, labelEn: bucket.labelEn, labelAr: bucket.labelAr,
      })),
      rows: rowsRaw.map((r) => ({
        partyId: r.pid, code: r.code, nameEn: r.nameEn, nameAr: r.nameAr,
        buckets: pick(r as unknown as Record<string, string>),
        total: r.total, overdue: r.overdue, invoiceCount: r.n,
      })),
      totals: {
        total: t?.total ?? '0.0000',
        overdue: t?.overdue ?? '0.0000',
        buckets: pick((t ?? {}) as unknown as Record<string, string>),
        ledgerBalance: ledgerBalance.toFixed(MONEY_SCALE),
        differenceFromLedger: documentBalance.minus(ledgerComparable).toFixed(MONEY_SCALE),
      },
      paging: {
        page, pageSize, totalParties: t?.parties ?? 0,
        totalPages: Math.ceil((t?.parties ?? 0) / pageSize),
      },
      ...(invoices ? { invoices } : {}),
    };
  }

  private async build(
    companyId: string,
    side: 'customer' | 'supplier',
    query: { asOf?: string; customerId?: string; supplierId?: string; branchId?: string },
  ) {
    const asOf = query.asOf ? new Date(`${query.asOf.slice(0, 10)}T23:59:59.999Z`) : new Date();

    const invoices =
      side === 'customer'
        ? await this.prisma.salesInvoice.findMany({
            where: {
              companyId,
              deletedAt: null,
              status: InvoiceStatus.POSTED,
              invoiceDate: { lte: asOf },
              ...(query.customerId ? { customerId: query.customerId } : {}),
              ...(query.branchId ? { branchId: query.branchId } : {}),
            },
            include: { customer: { select: { id: true, code: true, nameEn: true, nameAr: true } } },
            orderBy: [{ invoiceDate: 'asc' }],
          })
        : await this.prisma.purchaseInvoice.findMany({
            where: {
              companyId,
              deletedAt: null,
              status: InvoiceStatus.POSTED,
              invoiceDate: { lte: asOf },
              ...(query.supplierId ? { supplierId: query.supplierId } : {}),
              ...(query.branchId ? { branchId: query.branchId } : {}),
            },
            include: { supplier: { select: { id: true, code: true, nameEn: true, nameAr: true } } },
            orderBy: [{ invoiceDate: 'asc' }],
          });

    const byParty = new Map<string, AgingParty>();

    for (const invoice of invoices) {
      const party = side === 'customer' ? (invoice as any).customer : (invoice as any).supplier;
      if (!party) continue;

      // Reversed invoices/returns have offsetting journals and no live debt.
      // They must not be counted as unpaid documents a second time.
      // A credit note against a sale, or a debit note against a purchase,
      // reduces what the party owes instead of adding to it. Reading the
      // document type here is what keeps this report and the control account
      // in the ledger telling the same story.
      const isInvoice = invoice.documentType === InvoiceDocumentType.INVOICE;
      const signed = invoice.totalAmount.minus(invoice.paidAmount);
      const balance = isInvoice ? signed : signed.negated();
      if (balance.isZero()) continue;

      const dueDate = invoice.dueDate ?? invoice.invoiceDate;
      // A credit note has no due date: it is a reduction, and it is never late.
      const daysOverdue = isInvoice
        ? Math.floor((asOf.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000))
        : 0;
      const bucket = BUCKETS.find(
        (entry) => daysOverdue >= entry.min && daysOverdue <= entry.max,
      );

      const current: AgingParty = byParty.get(party.id) ?? {
        partyId: party.id,
        code: party.code,
        nameEn: party.nameEn,
        nameAr: party.nameAr,
        buckets: Object.fromEntries(
          BUCKETS.map((entry) => [entry.key, new Prisma.Decimal(0)]),
        ),
        total: new Prisma.Decimal(0),
        overdue: new Prisma.Decimal(0),
        invoices: [] as AgingInvoice[],
      };

      current.total = current.total.plus(balance);
      if (daysOverdue > 0) current.overdue = current.overdue.plus(balance);
      current.buckets[bucket?.key ?? 'd90_plus'] = current.buckets[bucket?.key ?? 'd90_plus'].plus(
        balance,
      );
      current.invoices.push({
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
        dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
        documentType: invoice.documentType.toLowerCase(),
        total: invoice.totalAmount.toFixed(MONEY_SCALE),
        paid: invoice.paidAmount.toFixed(MONEY_SCALE),
        balance: balance.toFixed(MONEY_SCALE),
        daysOverdue: Math.max(daysOverdue, 0),
        bucket: bucket?.key ?? 'd90_plus',
        journalEntryId: invoice.journalEntryId,
      });
      byParty.set(party.id, current);
    }

    const rows = [...byParty.values()]
      .map((party) => ({
        partyId: party.partyId,
        code: party.code,
        nameEn: party.nameEn,
        nameAr: party.nameAr,
        buckets: Object.fromEntries(
          Object.entries(party.buckets).map(([key, value]) => [key, value.toFixed(MONEY_SCALE)]),
        ),
        total: party.total.toFixed(MONEY_SCALE),
        overdue: party.overdue.toFixed(MONEY_SCALE),
        invoiceCount: party.invoices.length,
        invoices: party.invoices.sort((a, b) => b.daysOverdue - a.daysOverdue),
      }))
      .sort((a, b) => new Prisma.Decimal(b.total).minus(a.total).toNumber());

    const totals = {
      total: rows.reduce((sum, row) => sum.plus(row.total), new Prisma.Decimal(0)).toFixed(MONEY_SCALE),
      overdue: rows
        .reduce((sum, row) => sum.plus(row.overdue), new Prisma.Decimal(0))
        .toFixed(MONEY_SCALE),
      buckets: Object.fromEntries(
        BUCKETS.map((bucket) => [
          bucket.key,
          rows
            .reduce((sum, row) => sum.plus(row.buckets[bucket.key]), new Prisma.Decimal(0))
            .toFixed(MONEY_SCALE),
        ]),
      ),
    };

    // The control account, read from the ledger, so the document view and the
    // accounting view can be compared instead of assumed equal.
    const controlCode = side === 'customer' ? '1103' : '2101';
    const ledgerRows = await this.prisma.$queryRaw<Array<{ net: Prisma.Decimal }>>(Prisma.sql`
      SELECT COALESCE(SUM(l.debit - l.credit), 0) AS net
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l."journalEntryId"
        JOIN accounts a ON a.id = l."accountId"
       WHERE e."companyId" = ${companyId}::uuid
         AND e.status IN ('POSTED', 'REVERSED')
         AND e."entryDate" <= ${asOf}::date
         AND a.code = ${controlCode}
         ${query.branchId ? Prisma.sql`AND e."branchId" = ${query.branchId}::uuid` : Prisma.sql``}
    `);
    const ledgerBalance = new Prisma.Decimal(ledgerRows[0]?.net ?? 0);
    const documentBalance = new Prisma.Decimal(totals.total);
    // Customer balances are debit balances; supplier balances are credits, so
    // the ledger side is flipped before comparing.
    const ledgerComparable =
      side === 'customer' ? ledgerBalance : ledgerBalance.negated();

    return {
      side,
      asOf: asOf.toISOString().slice(0, 10),
      buckets: BUCKETS.map((bucket) => ({
        key: bucket.key,
        labelEn: bucket.labelEn,
        labelAr: bucket.labelAr,
      })),
      rows,
      totals: {
        ...totals,
        ledgerBalance: ledgerBalance.toFixed(MONEY_SCALE),
        // Non-zero means the invoice list and the ledger disagree - usually an
        // opening balance or a manual entry. Reported, never hidden.
        differenceFromLedger: documentBalance.minus(ledgerComparable).toFixed(MONEY_SCALE),
      },
    };
  }
}
