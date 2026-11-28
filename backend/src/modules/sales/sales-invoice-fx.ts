import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CurrencyError, normalizeCode, parseRate, toBase } from '../currency/currency-rules';

export type InvoiceFx = { currency: string; rate: Prisma.Decimal; source: 'TYPED' | 'TABLE' };

type Queryable = { $queryRaw: <T>(q: Prisma.Sql) => Promise<T> };
type Writable = { $executeRaw: (q: Prisma.Sql) => Promise<number> };

function refuse(error: unknown): never {
  if (error instanceof CurrencyError) {
    throw new BadRequestException({ code: error.code, message: error.message, ...(error.params ? { params: error.params } : {}) });
  }
  throw error;
}

/**
 * Works out whether an invoice is in a foreign currency and at what rate.
 * Returns null for an ordinary company-currency invoice. The rate is the one typed on the
 * invoice or, when none is typed, the latest saved rate on or before the invoice date;
 * it is never guessed.
 */
export async function resolveInvoiceFx(
  q: Queryable,
  companyId: string,
  input: { currency?: string | null; exchangeRate?: string | number | null; invoiceDate: string },
): Promise<InvoiceFx | null> {
  const typed = input.exchangeRate !== undefined && input.exchangeRate !== null && String(input.exchangeRate).trim() !== '';
  const raw = String(input.currency ?? '').trim();
  // An ordinary invoice never touches the database here.
  if (!typed && raw === '') return null;
  const [company] = await q.$queryRaw<{ currency: string }[]>(Prisma.sql`SELECT currency FROM companies WHERE id = ${companyId}::uuid`);
  const base = company?.currency ?? 'EGP';
  try {
    if (raw === '') {
      if (typed) throw new CurrencyError('INVOICE_FX_RATE_WITHOUT_CURRENCY', 'A rate was given but no currency was chosen');
      return null;
    }
    const code = normalizeCode(raw);
    if (code === base) {
      if (typed) throw new CurrencyError('INVOICE_FX_RATE_WITHOUT_CURRENCY', 'A rate was given but the invoice is in the company currency');
      return null;
    }
    const [known] = await q.$queryRaw<{ isActive: boolean }[]>(Prisma.sql`
      SELECT "isActive" FROM currencies WHERE "companyId" = ${companyId}::uuid AND code = ${code}`);
    if (!known || !known.isActive) throw new CurrencyError('INVOICE_FX_CURRENCY_UNKNOWN', 'This currency is not an active currency of the company', { code });
    if (typed) return { currency: code, rate: parseRate(input.exchangeRate), source: 'TYPED' };
    const on = input.invoiceDate.slice(0, 10);
    const [row] = await q.$queryRaw<{ rate: Prisma.Decimal }[]>(Prisma.sql`
      SELECT rate FROM exchange_rates WHERE "companyId" = ${companyId}::uuid AND "currencyCode" = ${code} AND "rateDate" <= ${on}::date
       ORDER BY "rateDate" DESC LIMIT 1`);
    if (!row) throw new CurrencyError('FX_RATE_MISSING', 'No exchange rate has been entered for this currency on or before that date', { code, date: on });
    return { currency: code, rate: new Prisma.Decimal(row.rate), source: 'TABLE' };
  } catch (error) {
    return refuse(error);
  }
}

type MoneyLine = { unitPrice?: string; discountAmount?: string };
type MoneyDoc<L extends MoneyLine> = { discountAmount?: string; lines: L[] };

const DASH = /^\s*$/;

/**
 * Turns a foreign-priced document into the same document priced in the company currency.
 * Every price must be typed: the price list holds company-currency prices only.
 * Percent figures and quantities are not touched.
 */
export function documentInBase<L extends MoneyLine, D extends MoneyDoc<L>>(dto: D, rate: Prisma.Decimal.Value): D {
  const convert = (v: string) => toBase(v, rate).toFixed(4);
  const lines = dto.lines.map((line) => {
    if (line.unitPrice === undefined || DASH.test(String(line.unitPrice))) {
      throw new BadRequestException({ code: 'INVOICE_FX_PRICE_REQUIRED', message: 'Every line of a foreign-currency invoice needs a typed price' });
    }
    return {
      ...line,
      unitPrice: convert(line.unitPrice),
      ...(line.discountAmount !== undefined && !DASH.test(String(line.discountAmount)) ? { discountAmount: convert(line.discountAmount) } : {}),
    };
  });
  return {
    ...dto,
    ...(dto.discountAmount !== undefined && !DASH.test(String(dto.discountAmount)) ? { discountAmount: convert(dto.discountAmount) } : {}),
    lines,
  };
}

export async function saveInvoiceFx(
  tx: Writable,
  companyId: string,
  invoiceId: string,
  fx: InvoiceFx | null,
  foreign: { subTotal: Prisma.Decimal; taxAmount: Prisma.Decimal; totalAmount: Prisma.Decimal } | null,
  kind: 'SALES' | 'PURCHASE' = 'SALES',
): Promise<void> {
  // The table name comes from this closed choice, never from input.
  const table = Prisma.raw(kind === 'PURCHASE' ? 'purchase_invoice_fx' : 'sales_invoice_fx');
  await tx.$executeRaw(Prisma.sql`DELETE FROM ${table} WHERE "invoiceId" = ${invoiceId}::uuid AND "companyId" = ${companyId}::uuid`);
  if (!fx || !foreign) return;
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO ${table} ("invoiceId", "companyId", currency, rate, "rateSource", "foreignSubTotal", "foreignTaxAmount", "foreignTotal")
    VALUES (${invoiceId}::uuid, ${companyId}::uuid, ${fx.currency}, ${fx.rate.toFixed(8)}::numeric, ${fx.source},
            ${foreign.subTotal.toFixed(4)}::numeric, ${foreign.taxAmount.toFixed(4)}::numeric, ${foreign.totalAmount.toFixed(4)}::numeric)`);
}
