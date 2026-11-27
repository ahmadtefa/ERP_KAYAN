/**
 * Sales-rep commissions.
 *
 * A rep earns a percentage of the invoice amount before VAT. A credit note
 * takes the same rep and the same rate back (a negative entry). Amounts are
 * worked in whole piasters with integer arithmetic so no float error creeps in.
 */
export class CommissionError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

/** A percentage from 0 to 100 with at most 4 decimals, as an integer of 1/10000 percent. */
export function parseRate(input: unknown): number {
  const text = String(input ?? '').trim();
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(text)) throw new CommissionError('Enter a percentage from 0 to 100 (up to 4 decimals)');
  const scaled = Math.round(Number(text) * 10000);
  if (scaled > 1_000_000) throw new CommissionError('Enter a percentage from 0 to 100 (up to 4 decimals)');
  return scaled;
}

export const rateToPercent = (scaled: number) => scaled / 10000;

/** Whole piasters from a money value; refuses more than two decimals. */
export function toPiasters(value: unknown): number {
  const text = String(value ?? '').trim();
  if (!/^-?\d+(\.\d{1,4})?$/.test(text)) throw new CommissionError('Not a valid amount');
  const n = Number(text);
  return Math.round(n * 100);
}

/** Commission in piasters: basis x rate, half rounded away from zero. */
export function commissionPiasters(basisPiasters: number, rateScaled: number): number {
  const num = BigInt(basisPiasters) * BigInt(rateScaled);
  const den = 1_000_000n;
  const neg = num < 0n;
  const abs = neg ? -num : num;
  const q = (abs * 2n + den) / (den * 2n);
  return Number(neg ? -q : q);
}

/** The amount an invoice earns commission on: the total without VAT. */
export function invoiceBasis(totalAmount: unknown, taxAmount: unknown): number {
  return toPiasters(totalAmount) - toPiasters(taxAmount);
}

export const money = (piasters: number) => (piasters / 100).toFixed(2);

export interface PayoutEntry { id: string; amountPiasters: number }

/** A payout nets sales against returns. It must be above zero to be paid. */
export function payoutTotal(entries: PayoutEntry[]): number {
  if (entries.length === 0) throw new CommissionError('There is nothing to pay for that period', 'COMMISSION_NOTHING_TO_PAY');
  const total = entries.reduce((s, e) => s + e.amountPiasters, 0);
  if (total <= 0) throw new CommissionError('Returns cancel the commission for that period, so there is nothing to pay', 'COMMISSION_RETURNS_CANCEL');
  return total;
}
