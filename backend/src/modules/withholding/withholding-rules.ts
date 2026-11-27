import { Prisma } from '@prisma/client';

/**
 * Withholding tax on a cash voucher.
 *
 * PAYABLE: we pay a supplier and keep back part of it for the tax authority.
 *   Dr supplier account (gross)   Cr bank/cash (net)   Cr withholding payable (tax)
 * RECEIVABLE: a customer pays us and keeps back part for the tax authority.
 *   Dr bank/cash (net)   Dr withholding receivable (tax)   Cr customer account (gross)
 *
 * The voucher amount is always the gross: the invoices it settles are settled
 * in full, and only the cash side is smaller.
 */
export type WithholdingDirection = 'PAYABLE' | 'RECEIVABLE';

export class WithholdingError extends Error {}

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export function parseRate(value: unknown): Prisma.Decimal {
  const text = String(value ?? '').trim();
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(text)) {
    throw new WithholdingError('The rate must be a number such as 1 or 5 or 0.5');
  }
  const rate = D(text);
  if (rate.lessThanOrEqualTo(0) || rate.greaterThan(100)) {
    throw new WithholdingError('The rate must be above 0 and at most 100');
  }
  return rate;
}

/** Tax withheld on a gross amount, to the piastre, halves rounded up. */
export function withheldAmount(gross: Prisma.Decimal.Value, ratePercent: Prisma.Decimal.Value): Prisma.Decimal {
  const base = D(gross);
  if (base.lessThanOrEqualTo(0)) throw new WithholdingError('The voucher amount must be above zero');
  const tax = base.times(D(ratePercent)).dividedBy(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (tax.lessThanOrEqualTo(0)) throw new WithholdingError('At this rate the tax on this amount rounds to zero');
  if (tax.greaterThanOrEqualTo(base)) throw new WithholdingError('The tax cannot be as large as the voucher');
  return tax;
}

/** Which direction a voucher can carry, from its kind and the party it names. */
export function directionFor(kind: 'RECEIPT' | 'PAYMENT', hasCustomer: boolean, hasSupplier: boolean): WithholdingDirection {
  if (kind === 'PAYMENT' && hasSupplier) return 'PAYABLE';
  if (kind === 'RECEIPT' && hasCustomer) return 'RECEIVABLE';
  throw new WithholdingError(
    'Withholding applies to a payment to a supplier or a receipt from a customer',
  );
}

export type JournalLineDraft = {
  accountId: string;
  debit?: Prisma.Decimal;
  credit?: Prisma.Decimal;
  description: string;
};

/**
 * Adjusts the cash side of a voucher's lines for the tax and adds the tax line.
 * The cash line is the one whose account is [cashLedgerAccountId]. Nothing else
 * moves, so the entry still balances: the tax moves from the cash side to its own account.
 */
export function applyWithholdingToLines(
  lines: JournalLineDraft[],
  cashLedgerAccountId: string,
  direction: WithholdingDirection,
  tax: Prisma.Decimal,
  taxAccountId: string,
): JournalLineDraft[] {
  const cashIndex = lines.findIndex((l) => l.accountId === cashLedgerAccountId && (l.debit || l.credit));
  if (cashIndex < 0) throw new WithholdingError('The voucher has no cash line to adjust');
  const out = lines.map((l) => ({ ...l }));
  const cash = out[cashIndex];
  if (direction === 'PAYABLE') {
    const credit = D(cash.credit ?? 0).minus(tax);
    if (credit.lessThanOrEqualTo(0)) throw new WithholdingError('The tax cannot be as large as the cash paid');
    cash.credit = credit;
    out.push({ accountId: taxAccountId, credit: tax, description: 'Withholding tax' });
  } else {
    const debit = D(cash.debit ?? 0).minus(tax);
    if (debit.lessThanOrEqualTo(0)) throw new WithholdingError('The tax cannot be as large as the cash received');
    cash.debit = debit;
    out.push({ accountId: taxAccountId, debit: tax, description: 'Withholding tax withheld by the customer' });
  }
  return out;
}
