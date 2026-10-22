import { Prisma } from '@prisma/client';

/**
 * Straight-line depreciation, monthly — the pure arithmetic, kept apart
 * from the service so it can be tested to the last decimal.
 *
 * The month convention: an asset is charged for the month it enters
 * service and every month after, a full month each time, until the
 * depreciable base (cost − salvage) is used up. The final charge takes
 * whatever is left of the base, so the schedule always sums exactly to
 * the base and the book value never falls below salvage.
 *
 * Example (the figures the lifecycle scenario asserts):
 * cost 120,000, salvage 12,000, life 60 months → base 108,000,
 * monthly 1,800 exactly.
 */
export function depreciableBase(
  cost: Prisma.Decimal,
  salvageValue: Prisma.Decimal,
): Prisma.Decimal {
  return cost.minus(salvageValue);
}

export function monthlyCharge(
  cost: Prisma.Decimal,
  salvageValue: Prisma.Decimal,
  usefulLifeMonths: number,
): Prisma.Decimal {
  return depreciableBase(cost, salvageValue)
    .div(usefulLifeMonths)
    .toDecimalPlaces(4);
}

/** What one more month costs, given what has already been charged. */
export function nextCharge(
  cost: Prisma.Decimal,
  salvageValue: Prisma.Decimal,
  usefulLifeMonths: number,
  accumulated: Prisma.Decimal,
): Prisma.Decimal {
  const remaining = depreciableBase(cost, salvageValue).minus(accumulated);
  if (remaining.lessThanOrEqualTo(0)) return new Prisma.Decimal(0);
  const monthly = monthlyCharge(cost, salvageValue, usefulLifeMonths);
  return Prisma.Decimal.min(monthly, remaining);
}

/** Book value can reach salvage; it can never pass it. */
export function bookValue(
  cost: Prisma.Decimal,
  accumulated: Prisma.Decimal,
): Prisma.Decimal {
  return cost.minus(accumulated);
}

/** Gain (positive) or loss (negative) when an asset leaves the books. */
export function disposalResult(
  cost: Prisma.Decimal,
  accumulated: Prisma.Decimal,
  proceeds: Prisma.Decimal,
): Prisma.Decimal {
  return proceeds.minus(bookValue(cost, accumulated));
}

/** "2024-03" → the journal date a run for that month carries. */
export function monthEndOf(periodKey: string): Date {
  const [year, month] = periodKey.split('-').map(Number);
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0));
}

/** The period key a date falls in: "YYYY-MM". */
export function periodKeyOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export const PERIOD_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
