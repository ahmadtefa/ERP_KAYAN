import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export class HrError extends Error {
  constructor(public readonly code: string, message: string, public readonly params?: Record<string, string>) {
    super(message);
  }
}

export function asHttp(error: unknown): never {
  if (error instanceof HrError) {
    throw new BadRequestException({ code: error.code, message: error.message, ...(error.params ? { params: error.params } : {}) });
  }
  throw error;
}

export function money(value: unknown, field: string, opts: { allowZero?: boolean } = {}): Prisma.Decimal {
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,4})?$/.test(text)) throw new HrError('HR_AMOUNT_BAD', `${field} must be a number with up to 4 decimals`, { field });
  const d = new Prisma.Decimal(text);
  if (d.lt(0) || (!opts.allowZero && d.isZero()) || d.gte(new Prisma.Decimal('1e13'))) {
    throw new HrError('HR_AMOUNT_BAD', `${field} is out of range`, { field });
  }
  return d;
}

export function isoDate(value: unknown, field: string): string {
  const v = String(value ?? '').trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw new HrError('HR_DATE_BAD', `${field} must be a real date like 2026-03-31`, { field });
  }
  return v;
}

export function monthKey(value: unknown): string {
  const v = String(value ?? '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new HrError('HR_MONTH_BAD', 'Month must look like 2026-03');
  return v;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function percent(value: unknown, field: string): Prisma.Decimal {
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,4})?$/.test(text)) throw new HrError('HR_RATE_BAD', `${field} must be a percentage between 0 and 100`, { field });
  const d = new Prisma.Decimal(text);
  if (d.gt(100)) throw new HrError('HR_RATE_BAD', `${field} must be a percentage between 0 and 100`, { field });
  return d;
}

export type TaxBracket = { from: string; to: string | null; ratePercent: string };

/**
 * Brackets are typed by the company: they must start at zero, follow each other with no gap
 * or overlap, and only the last one may be open-ended. Nothing is assumed about the law.
 */
export function checkBrackets(input: unknown): TaxBracket[] {
  if (!Array.isArray(input)) throw new HrError('HR_BRACKETS_BAD', 'Tax brackets must be a list');
  const out: TaxBracket[] = [];
  let expectedFrom = new Prisma.Decimal(0);
  input.forEach((raw, i) => {
    const b = raw as { from?: unknown; to?: unknown; ratePercent?: unknown };
    const from = money(b.from, 'from', { allowZero: true });
    const rate = percent(b.ratePercent, 'ratePercent');
    const last = i === input.length - 1;
    const open = b.to === null || b.to === undefined || String(b.to).trim() === '';
    if (!from.eq(expectedFrom)) throw new HrError('HR_BRACKETS_BAD', 'Each tax bracket must start where the previous one ends, and the first at zero', { row: String(i + 1) });
    if (open && !last) throw new HrError('HR_BRACKETS_BAD', 'Only the last tax bracket may have no upper limit', { row: String(i + 1) });
    let to: Prisma.Decimal | null = null;
    if (!open) {
      to = money(b.to, 'to');
      if (to.lte(from)) throw new HrError('HR_BRACKETS_BAD', 'The upper limit of a tax bracket must be above its start', { row: String(i + 1) });
      expectedFrom = to;
    }
    out.push({ from: from.toFixed(4), to: to ? to.toFixed(4) : null, ratePercent: rate.toFixed(4) });
  });
  return out;
}

export function nationalId(value: unknown): string | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (!/^\d{14}$/.test(v)) throw new HrError('HR_NATIONAL_ID_BAD', 'National ID must be exactly 14 digits');
  return v;
}

/** Shown to people who may not see personal data. */
export function maskTail(value: string | null): string | null {
  if (!value) return value;
  return value.length <= 4 ? '****' : `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;
}
