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

@Injectable()
export class AgingService {
  constructor(private readonly prisma: PrismaService) {}

  async receivables(
    companyId: string,
    query: { asOf?: string; customerId?: string; branchId?: string } = {},
  ) {
    return this.build(companyId, 'customer', query);
  }

  async payables(
    companyId: string,
    query: { asOf?: string; supplierId?: string; branchId?: string } = {},
  ) {
    return this.build(companyId, 'supplier', query);
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
