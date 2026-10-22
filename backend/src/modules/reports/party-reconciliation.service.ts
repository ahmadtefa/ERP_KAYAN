import { Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceDocumentType, InvoiceStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { ACCOUNT_CODES } from '../accounting/account-map.service';

const MONEY_SCALE = 4;
const money = (value: Prisma.Decimal) => value.toFixed(MONEY_SCALE);

/**
 * The party subledger against its control account, with every pound of
 * any difference accounted for by name.
 *
 * Three different things can make the two balances differ, and this
 * report separates them instead of printing one opaque gap:
 *
 *   advances — money received from a customer (or paid to a supplier)
 *     that no invoice has absorbed yet. The voucher credited the
 *     control account; no invoice's paid amount moved. Real, visible,
 *     and normally temporary.
 *   other postings — journal lines on the control account that no
 *     party document wrote: opening balances entered as bare accounts,
 *     old manual entries. Each is listed with its entry number so it
 *     can be traced and either justified or reversed.
 *   unexplained — whatever is left. On consistent books it is zero;
 *     anything else is a defect to investigate, reported, not absorbed.
 *
 * difference = otherPostings − advances + unexplained, identically.
 *
 * One honest limitation, shared with the party-balance reports: an
 * invoice's paid amount is its position today, so an `asOf` in the past
 * compares the ledger then against settlements known now. Run it as of
 * today for an exact reconciliation.
 */
@Injectable()
export class PartyReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  receivables(companyId: string, query: { asOf?: string }) {
    return this.build(companyId, 'receivables', query.asOf);
  }

  payables(companyId: string, query: { asOf?: string }) {
    return this.build(companyId, 'payables', query.asOf);
  }

  private async build(
    companyId: string,
    side: 'receivables' | 'payables',
    asOfInput?: string,
  ) {
    const isReceivable = side === 'receivables';
    const asOf = asOfInput
      ? new Date(`${asOfInput.slice(0, 10)}T00:00:00.000Z`)
      : new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

    const controlCode = isReceivable
      ? ACCOUNT_CODES.accountsReceivable
      : ACCOUNT_CODES.accountsPayable;
    const control = await this.prisma.account.findFirst({
      where: { companyId, code: controlCode, deletedAt: null },
      select: { id: true, code: true, nameEn: true, nameAr: true },
    });
    if (!control) {
      throw new NotFoundException(
        `Control account ${controlCode} does not exist in this company's chart`,
      );
    }

    // The ledger side, signed the way the balance reads: a receivable
    // is debit-positive, a payable credit-positive.
    const sign = isReceivable ? 1 : -1;
    const lines = await this.prisma.$queryRaw<
      Array<{
        entryId: string;
        entryNumber: string;
        entryDate: Date;
        sourceType: string | null;
        sourceNumber: string | null;
        net: Prisma.Decimal;
      }>
    >(Prisma.sql`
      SELECT e.id AS "entryId", e."entryNumber", e."entryDate",
             e."sourceType", e."sourceNumber",
             COALESCE(SUM(l.debit - l.credit), 0) AS net
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l."journalEntryId"
       WHERE e."companyId" = ${companyId}::uuid
         AND l."accountId" = ${control.id}::uuid
         AND e.status IN ('POSTED', 'REVERSED')
         AND e."entryDate" <= ${asOf}::date
       GROUP BY e.id, e."entryNumber", e."entryDate", e."sourceType", e."sourceNumber"
       ORDER BY e."entryDate", e."entryNumber"
    `);
    const signed = (net: Prisma.Decimal) =>
      sign === 1 ? new Prisma.Decimal(net) : new Prisma.Decimal(net).negated();
    const controlBalance = lines.reduce(
      (sum, row) => sum.plus(signed(row.net)),
      new Prisma.Decimal(0),
    );

    // The document side: invoices and notes, with the settlement each
    // carries, signed exactly as the party-balance reports sign them.
    const documents = isReceivable
      ? await this.prisma.salesInvoice.findMany({
          where: {
            companyId,
            deletedAt: null,
            status: InvoiceStatus.POSTED,
            invoiceDate: { lte: asOf },
          },
          select: { documentType: true, totalAmount: true, paidAmount: true },
        })
      : await this.prisma.purchaseInvoice.findMany({
          where: {
            companyId,
            deletedAt: null,
            status: InvoiceStatus.POSTED,
            invoiceDate: { lte: asOf },
          },
          select: { documentType: true, totalAmount: true, paidAmount: true },
        });
    let invoiced = new Prisma.Decimal(0);
    let notes = new Prisma.Decimal(0);
    let paidApplied = new Prisma.Decimal(0);
    for (const doc of documents) {
      if (doc.documentType === InvoiceDocumentType.INVOICE) {
        invoiced = invoiced.plus(doc.totalAmount);
        paidApplied = paidApplied.plus(doc.paidAmount);
      } else {
        notes = notes.plus(doc.totalAmount);
        paidApplied = paidApplied.minus(doc.paidAmount);
      }
    }
    const subledgerTotal = invoiced.minus(notes).minus(paidApplied);

    // Split the ledger lines: what party documents wrote, what vouchers
    // wrote, and everything else.
    const documentSources = isReceivable
      ? ['SALES_INVOICE', 'SALES_RETURN']
      : ['PURCHASE_INVOICE', 'PURCHASE_RETURN'];
    let voucherNet = new Prisma.Decimal(0);
    const otherPostings: Array<{
      entryId: string;
      entryNumber: string;
      entryDate: string;
      sourceType: string | null;
      sourceNumber: string | null;
      amount: string;
    }> = [];
    let otherTotal = new Prisma.Decimal(0);
    for (const row of lines) {
      const amount = signed(row.net);
      if (row.sourceType === 'CASH_VOUCHER') {
        voucherNet = voucherNet.plus(amount);
      } else if (!documentSources.includes(row.sourceType ?? '')) {
        otherTotal = otherTotal.plus(amount);
        if (!amount.isZero()) {
          otherPostings.push({
            entryId: row.entryId,
            entryNumber: row.entryNumber,
            entryDate: new Date(row.entryDate).toISOString().slice(0, 10),
            sourceType: row.sourceType,
            sourceNumber: row.sourceNumber,
            amount: money(amount),
          });
        }
      }
    }
    // Vouchers move the control by their full amount; only the applied
    // part moves an invoice. A receipt of 500 with 300 applied reads
    // voucherNet −500 (it credited the control), paidApplied 300, and
    // the 200 still held against no invoice is the advance:
    // advances = −voucherNet − paidApplied.
    const advancesHeld = voucherNet.negated().minus(paidApplied);

    const difference = controlBalance.minus(subledgerTotal);
    const unexplained = difference.minus(otherTotal).plus(advancesHeld);

    return {
      asOf: asOf.toISOString().slice(0, 10),
      side,
      controlAccount: {
        accountId: control.id,
        code: control.code,
        nameEn: control.nameEn,
        nameAr: control.nameAr,
      },
      controlBalance: money(controlBalance),
      subledger: {
        invoiced: money(invoiced),
        notes: money(notes),
        paidApplied: money(paidApplied),
        total: money(subledgerTotal),
      },
      advances: money(advancesHeld),
      otherPostings,
      otherPostingsTotal: money(otherTotal),
      difference: money(difference),
      unexplained: money(unexplained),
      isReconciled: unexplained.isZero(),
    };
  }
}
