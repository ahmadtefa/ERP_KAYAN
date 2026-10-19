import { Prisma } from '@prisma/client';

import { allocateMoneyByWeight } from './money-allocation';

/// Discounts on invoices and quotations.
///
/// A discount is either a percentage of the base or a fixed amount of money.
/// The distinction is stored, because "10%" and "10.00" are not the same
/// thing a month later when somebody asks why the document came to what it
/// did. The resolved amount is stored too, so a historical document never has
/// to be recomputed to be understood.
///
/// The order used everywhere in the system is:
///
///   quantity x unit price          -> gross line value (tax exclusive)
///   less the line discount         -> net line value
///   less the invoice discount,     -> eligible net line value
///     allocated pro rata
///   tax on the final net value     -> tax
///
/// Tax comes last because the company's existing documents define the
/// document discount as "applied before tax"; VAT is charged on what the
/// customer actually pays for the goods.
export const DISCOUNT_TYPES = ['PERCENT', 'AMOUNT'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const DISCOUNT_SCALE = 4;
const HUNDRED = new Prisma.Decimal(100);

export class DiscountError extends Error {}

export interface DiscountInput {
  type?: string | null;
  percent?: string | number | Prisma.Decimal | null;
  amount?: string | number | Prisma.Decimal | null;
}

export interface ResolvedDiscount {
  /// Null when no discount was asked for at all.
  type: DiscountType | null;
  percent: Prisma.Decimal;
  amount: Prisma.Decimal;
  base: Prisma.Decimal;
  net: Prisma.Decimal;
}

export function isDiscountType(value: unknown): value is DiscountType {
  return value === 'PERCENT' || value === 'AMOUNT';
}

export function hasDiscount(input: DiscountInput | null | undefined): boolean {
  if (!input) return false;
  if (input.type === 'PERCENT' || input.type === 'AMOUNT') return true;
  return toDecimalOrNull(input.percent)?.greaterThan(0) === true
    || toDecimalOrNull(input.amount)?.greaterThan(0) === true;
}

function toDecimalOrNull(value: string | number | Prisma.Decimal | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Prisma.Decimal(value);
  if (!parsed.isFinite()) throw new DiscountError('A discount must be a finite number');
  return parsed;
}

/**
 * Turns what the caller asked for into an exact amount of money.
 *
 * `base` is the value the discount applies to, in the company's currency,
 * already rounded to four places. The returned net is never negative: an
 * amount larger than the base is refused rather than quietly clamped, because
 * a negative line would corrupt every total downstream.
 */
export function resolveDiscount(
  base: Prisma.Decimal,
  input: DiscountInput | null | undefined,
): ResolvedDiscount {
  if (base.isNegative()) throw new DiscountError('A discount base cannot be negative');

  const percentInput = toDecimalOrNull(input?.percent);
  const amountInput = toDecimalOrNull(input?.amount);
  const explicitType = input?.type ?? null;
  if (explicitType !== null && !isDiscountType(explicitType)) {
    throw new DiscountError(`Unknown discount type "${explicitType}"`);
  }

  // No type but a value is the shape older clients send: percent wins when it
  // is present, which is how the field was documented.
  let type: DiscountType | null = explicitType;
  if (!type) {
    if (percentInput?.greaterThan(0)) type = 'PERCENT';
    else if (amountInput?.greaterThan(0)) type = 'AMOUNT';
    else return { type: null, percent: new Prisma.Decimal(0), amount: new Prisma.Decimal(0), base, net: base };
  }

  if (type === 'PERCENT') {
    const percent = percentInput ?? new Prisma.Decimal(0);
    if (percent.isNegative()) throw new DiscountError('A discount percent cannot be negative');
    if (percent.greaterThan(HUNDRED)) throw new DiscountError('A discount percent cannot exceed 100');
    const amount = base.mul(percent).div(HUNDRED).toDecimalPlaces(DISCOUNT_SCALE);
    if (amount.greaterThan(base)) {
      throw new DiscountError('The discount is larger than the value it applies to');
    }
    return { type, percent: percent.toDecimalPlaces(DISCOUNT_SCALE), amount, base, net: base.minus(amount) };
  }

  // A fixed discount. The client may also send a percent it derived for
  // display; that number is not trusted, the amount is the document's word.
  const amount = (amountInput ?? new Prisma.Decimal(0)).toDecimalPlaces(DISCOUNT_SCALE);
  if (amount.isNegative()) throw new DiscountError('A discount amount cannot be negative');
  if (amount.greaterThan(base)) {
    throw new DiscountError(
      `A discount of ${amount.toFixed(DISCOUNT_SCALE)} cannot be taken from a value of ${base.toFixed(DISCOUNT_SCALE)}`,
    );
  }
  const percent = base.isZero()
    ? new Prisma.Decimal(0)
    : amount.div(base).mul(HUNDRED).toDecimalPlaces(DISCOUNT_SCALE);
  return { type, percent, amount, base, net: base.minus(amount) };
}

/** The total discount as a percentage of the gross value, for limit checks. */
export function effectiveDiscountPercent(
  gross: Prisma.Decimal,
  discount: Prisma.Decimal,
): Prisma.Decimal {
  if (gross.lessThanOrEqualTo(0)) return new Prisma.Decimal(0);
  return discount.div(gross).mul(HUNDRED).toDecimalPlaces(DISCOUNT_SCALE);
}

/**
 * Spreads a document-level discount over the lines that carry value.
 *
 * Returns one share per line, in the same order, adding up to the resolved
 * discount exactly. A line worth nothing gets nothing: the discount belongs to
 * the goods that were actually sold.
 */
export function allocateDocumentDiscount(
  netLineValues: readonly Prisma.Decimal[],
  input: DiscountInput | null | undefined,
): { discount: ResolvedDiscount; shares: Prisma.Decimal[] } {
  const totalBase = netLineValues.reduce(
    (sum, value) => sum.plus(value),
    new Prisma.Decimal(0),
  );
  const discount = resolveDiscount(totalBase, input);
  if (discount.amount.isZero()) {
    return { discount, shares: netLineValues.map(() => new Prisma.Decimal(0)) };
  }
  const allocated = allocateMoneyByWeight(
    netLineValues.map((value) => value.toFixed(DISCOUNT_SCALE)),
    discount.amount.toFixed(DISCOUNT_SCALE),
  );
  return { discount, shares: allocated.map((value) => new Prisma.Decimal(value)) };
}

/** Refuses a discount above the company's stated maximum. */
export function assertDiscountLimit(
  percent: Prisma.Decimal,
  maximum: Prisma.Decimal | null | undefined,
  what: string,
): void {
  if (maximum === null || maximum === undefined) return;
  if (percent.greaterThan(maximum)) {
    throw new DiscountError(
      `${what} discount of ${percent.toFixed(DISCOUNT_SCALE)}% exceeds the company maximum of ${maximum.toFixed(DISCOUNT_SCALE)}%`,
    );
  }
}
