import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

const SCALE = 4;

export interface VatReturnQuery {
  from?: string;
  to?: string;
  branchId?: string;
}

export interface VatRateRow {
  rate: string;
  taxableBase: string;
  tax: string;
  documents: number;
}

type RawRow = { documentType: string; taxRate: Prisma.Decimal; base: Prisma.Decimal; tax: Prisma.Decimal; docs: bigint | number };

/** Folds raw per-type rows into per-rate rows: credit notes subtract, debit notes add. */
export function foldVatRows(rows: RawRow[]) {
  const byRate = new Map<string, { base: Prisma.Decimal; tax: Prisma.Decimal; docs: number }>();
  for (const r of rows) {
    const sign = r.documentType === 'CREDIT_NOTE' ? -1 : 1;
    const key = new Prisma.Decimal(r.taxRate).toFixed(2);
    const cur = byRate.get(key) ?? { base: new Prisma.Decimal(0), tax: new Prisma.Decimal(0), docs: 0 };
    cur.base = cur.base.plus(new Prisma.Decimal(r.base).mul(sign));
    cur.tax = cur.tax.plus(new Prisma.Decimal(r.tax).mul(sign));
    cur.docs += Number(r.docs);
    byRate.set(key, cur);
  }
  const rates = [...byRate.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([rate, v]): VatRateRow => ({
      rate,
      taxableBase: v.base.toFixed(SCALE),
      tax: v.tax.toFixed(SCALE),
      documents: v.docs,
    }));
  const total = [...byRate.values()].reduce(
    (acc, v) => ({ base: acc.base.plus(v.base), tax: acc.tax.plus(v.tax) }),
    { base: new Prisma.Decimal(0), tax: new Prisma.Decimal(0) },
  );
  return { rates, taxableBase: total.base, tax: total.tax };
}

/**
 * The VAT return for a period, read from posted documents: output VAT on
 * sales less credit notes, input VAT on purchases less credit notes, and the
 * net due to (or refundable from) the tax authority. Draft and reversed
 * documents are not counted; a reversed document has already been cancelled.
 */
@Injectable()
export class VatReturnService {
  constructor(private readonly prisma: PrismaService) {}

  private period(query: VatReturnQuery) {
    const iso = /^\d{4}-\d{2}-\d{2}/;
    const now = new Date();
    const to = query.to ? query.to.slice(0, 10) : now.toISOString().slice(0, 10);
    const from = query.from ? query.from.slice(0, 10) : `${now.getUTCFullYear()}-01-01`;
    if (!iso.test(from) || !iso.test(to)) throw new BadRequestException('Dates must be YYYY-MM-DD');
    if (from > to) throw new BadRequestException({ code: 'DATE_RANGE_REVERSED', message: '"from" must not be after "to"' });
    return { from, to };
  }

  private side(table: 'sales' | 'purchases', companyId: string, from: string, to: string, branchId?: string) {
    const invoices = Prisma.raw(table === 'sales' ? 'sales_invoices' : 'purchase_invoices');
    const lines = Prisma.raw(table === 'sales' ? 'sales_invoice_lines' : 'purchase_invoice_lines');
    const branch = branchId ? Prisma.sql`AND i."branchId" = ${branchId}::uuid` : Prisma.empty;
    return this.prisma.$queryRaw<RawRow[]>(Prisma.sql`
      SELECT i."documentType"::text AS "documentType", l."taxRate" AS "taxRate",
             SUM(l."lineTotal") AS base, SUM(l."taxAmount") AS tax, COUNT(DISTINCT i.id) AS docs
        FROM ${invoices} i JOIN ${lines} l ON l."invoiceId" = i.id
       WHERE i."companyId" = ${companyId}::uuid AND i.status = 'POSTED' AND i."deletedAt" IS NULL
         AND i."invoiceDate" >= ${from}::date AND i."invoiceDate" <= ${to}::date ${branch}
       GROUP BY i."documentType", l."taxRate"`);
  }

  async report(companyId: string, query: VatReturnQuery) {
    const { from, to } = this.period(query);
    const [sales, purchases] = await Promise.all([
      this.side('sales', companyId, from, to, query.branchId),
      this.side('purchases', companyId, from, to, query.branchId),
    ]);
    const output = foldVatRows(sales);
    const input = foldVatRows(purchases);
    const net = output.tax.minus(input.tax);
    // Flat rows and totals so the report table can show it like the others.
    const rows = [
      ...output.rates.map((r) => ({ side: 'OUTPUT', ...r })),
      ...input.rates.map((r) => ({ side: 'INPUT', ...r })),
    ];
    return {
      from,
      to,
      rows,
      totals: {
        outputTax: output.tax.toFixed(SCALE),
        inputTax: input.tax.toFixed(SCALE),
        net: net.toFixed(SCALE),
      },
      output: { rates: output.rates, taxableBase: output.taxableBase.toFixed(SCALE), tax: output.tax.toFixed(SCALE) },
      input: { rates: input.rates, taxableBase: input.taxableBase.toFixed(SCALE), tax: input.tax.toFixed(SCALE) },
      net: net.toFixed(SCALE),
      // Positive: owed to the tax authority. Negative: a refundable credit.
      position: net.greaterThan(0) ? 'PAYABLE' : net.lessThan(0) ? 'REFUNDABLE' : 'NIL',
    };
  }
}
