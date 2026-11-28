import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Money is kept to 4 places, rates to 8, like the rest of the ledger. */
export const AMOUNT_SCALE = 4;
export const RATE_SCALE = 8;

export class CurrencyError extends Error {
  constructor(public readonly code: string, message: string, public readonly params?: Record<string, string>) {
    super(message);
  }
}

export function normalizeCode(value: unknown): string {
  const code = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new CurrencyError('CURRENCY_CODE_BAD', 'Currency code must be three letters, for example USD');
  }
  return code;
}

/** Units of the company currency for ONE unit of the foreign currency. Never guessed, never zero. */
export function parseRate(value: unknown): Prisma.Decimal {
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new CurrencyError('CURRENCY_RATE_BAD', 'Exchange rate must be a positive number');
  const rate = new Prisma.Decimal(text);
  if (rate.lte(0)) throw new CurrencyError('CURRENCY_RATE_BAD', 'Exchange rate must be greater than zero');
  if (rate.gte(new Prisma.Decimal('1000000000'))) throw new CurrencyError('CURRENCY_RATE_BAD', 'Exchange rate is too large');
  return rate.toDecimalPlaces(RATE_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

/** Foreign amount times rate, half-up to 4 places. */
export function toBase(amount: Prisma.Decimal.Value, rate: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(amount).mul(new Prisma.Decimal(rate)).toDecimalPlaces(AMOUNT_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Gain (+) or loss (-) in the company currency when a foreign balance booked at one rate
 * is settled at another. `settled` is the foreign amount settled. For a receivable, a
 * higher rate at collection is a gain; for a payable it is a loss, so the sign flips.
 */
export function realizedDifference(
  settled: Prisma.Decimal.Value,
  bookedRate: Prisma.Decimal.Value,
  settleRate: Prisma.Decimal.Value,
  kind: 'RECEIVABLE' | 'PAYABLE',
): Prisma.Decimal {
  const diff = toBase(settled, settleRate).sub(toBase(settled, bookedRate));
  return kind === 'RECEIVABLE' ? diff : diff.neg();
}

export function assertForeign(code: string, base: string): void {
  if (code === base) throw new CurrencyError('CURRENCY_IS_BASE', 'The company currency does not need an exchange rate', { code });
}

export function asHttp(error: unknown): never {
  if (error instanceof CurrencyError) {
    throw new BadRequestException({ code: error.code, message: error.message, ...(error.params ? { params: error.params } : {}) });
  }
  throw error;
}
