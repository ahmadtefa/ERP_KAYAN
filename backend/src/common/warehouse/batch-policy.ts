import { Prisma } from '@prisma/client';

/// The rules of a lot, as arithmetic.
///
/// FEFO, the expiry alarms and the moving average are the three decisions that
/// cost money when they are wrong, and all three are pure: a list of lots and
/// a date in, an answer out. They live here - not inside a service - so they
/// can be pinned by a test that needs no database, no HTTP and no clock, which
/// is the only way "the nearest expiry was chosen" can be proven rather than
/// demonstrated once on somebody's machine.

const DAY_MS = 24 * 60 * 60 * 1000;

/// Days before expiry the alerting centre announces by default.
///
/// The list is a company setting; these are the values a new installation
/// starts with, and the ones the report screens group by. Zero means "today".
export const DEFAULT_EXPIRY_DAYS: readonly number[] = [90, 60, 30, 7, 0];

/// The bands the reports are written in, widest first.
export type ExpiryBand = 'EXPIRED' | 'TODAY' | 'IN_7' | 'IN_30' | 'IN_60' | 'IN_90' | 'LATER' | 'NO_EXPIRY';

/// A date with no time on it, in UTC.
///
/// Stock dates are days, not instants: a lot that expires on the third expires
/// on the third in Cairo and in Alexandria. Comparing `Date` objects directly
/// would make the answer depend on the hour a report happened to run.
export function dayOnly(value: Date | string): Date {
  const date = typeof value === 'string' ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`) : value;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/// Whole days from [today] to [expiry]. Negative means the day has passed.
export function daysUntil(expiry: Date | string, today: Date | string): number {
  return Math.round((dayOnly(expiry).getTime() - dayOnly(today).getTime()) / DAY_MS);
}

/// Which report band a lot belongs to.
export function expiryBand(expiry: Date | string | null, today: Date | string): ExpiryBand {
  if (!expiry) return 'NO_EXPIRY';
  const days = daysUntil(expiry, today);
  if (days < 0) return 'EXPIRED';
  if (days === 0) return 'TODAY';
  if (days <= 7) return 'IN_7';
  if (days <= 30) return 'IN_30';
  if (days <= 60) return 'IN_60';
  if (days <= 90) return 'IN_90';
  return 'LATER';
}

/// How loud a band is.
///
/// Expired stock is critical because it is money that cannot be sold; the last
/// week is a warning because it still can be.
export function bandSeverity(band: ExpiryBand): 'INFO' | 'WARNING' | 'CRITICAL' {
  switch (band) {
    case 'EXPIRED':
      return 'CRITICAL';
    case 'TODAY':
    case 'IN_7':
      return 'WARNING';
    default:
      return 'INFO';
  }
}

/// The bands a company wants announced, cleaned up.
///
/// Anything that is not a whole number of days between 0 and five years is
/// dropped rather than clamped: a company that typed "ninety" should get the
/// default, not a 90 it never asked for by accident of parsing.
export function normalizeExpiryDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_EXPIRY_DAYS];
  const days = raw
    .map((value) => (typeof value === 'number' ? value : Number(value)))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 1825);
  if (days.length === 0) return [...DEFAULT_EXPIRY_DAYS];
  // Widest first, and 0 last: the list reads like the report screen.
  return [...new Set(days)].sort((left, right) => right - left);
}

/// Whether a lot is inside one of the announcement bands today.
///
/// "Within 30 days" includes the seventh day and the day itself: a lot that
/// expires in three days is inside every band up to 90.
export function withinExpiryWindow(
  expiry: Date | string | null,
  today: Date | string,
  days: readonly number[],
): boolean {
  if (!expiry) return false;
  const left = daysUntil(expiry, today);
  if (left < 0) return false;
  const widest = Math.max(...days, 0);
  return left <= widest;
}

/// A lot as the selector sees it: only what decides the order and the amount.
export interface SelectableLot {
  /** Stable identity, echoed back in the allocation. */
  batchId: string;
  batchNumber: string;
  expiryDate: Date | string | null;
  productionDate?: Date | string | null;
  unitCost: Prisma.Decimal | number | string;
  remainingQuantity: Prisma.Decimal | number | string;
  status?: string | null;
}

export interface LotAllocation {
  batchId: string;
  batchNumber: string;
  quantity: Prisma.Decimal;
  /** True when this allocation was taken from an expired lot. */
  expired: boolean;
  unitCost: Prisma.Decimal;
}

export interface FefoResult {
  allocations: LotAllocation[];
  /** What could not be covered; zero when the request is satisfied. */
  shortfall: Prisma.Decimal;
  /** Quantity taken from lots that had already expired. */
  expiredQuantity: Prisma.Decimal;
  /** Lots that were eligible and still had stock, in the order considered. */
  considered: string[];
}

export interface FefoOptions {
  today: Date | string;
  /** Issue from expired lots when the item and the person allow it. */
  allowExpired: boolean;
  /** False keeps the earliest-expiry pick from happening (item setting). */
  useFefo?: boolean;
  /** Lots in this state are never issued: they are not on the shelf. */
  blockedStatuses?: readonly string[];
}

const toDecimal = (value: Prisma.Decimal | number | string): Prisma.Decimal =>
  value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);

/// Chooses which lots an issue comes out of.
///
/// The order is the point: the soonest expiry first, then (for lots that share
/// a date, or have none) the earliest production and finally the lot number,
/// so two runs over the same shelf answer the same way. A lot with no expiry
/// sorts last among the dated ones - it cannot go off, so it can wait - but it
/// is still usable, which is what keeps an item without dates working.
///
/// The function never invents stock: when the eligible lots cannot cover the
/// request it returns a shortfall, and the caller decides whether that is a
/// refusal or a partial issue. Expired lots are skipped unless the caller says
/// otherwise, and what they contribute is reported separately, so the caller
/// can require an approval for exactly that part.
export function selectLotsFefo(
  lots: readonly SelectableLot[],
  quantity: Prisma.Decimal | number | string,
  options: FefoOptions,
): FefoResult {
  const wanted = toDecimal(quantity);
  const blocked = new Set(options.blockedStatuses ?? ['WRITTEN_OFF', 'CLOSED', 'QUARANTINE']);
  const useFefo = options.useFefo !== false;

  const usable = lots
    .filter((lot) => toDecimal(lot.remainingQuantity).greaterThan(0))
    .filter((lot) => !blocked.has(String(lot.status ?? 'OPEN')));

  const ranked = [...usable].sort((left, right) => {
    if (useFefo) {
      const leftDays = left.expiryDate ? daysUntil(left.expiryDate, options.today) : null;
      const rightDays = right.expiryDate ? daysUntil(right.expiryDate, options.today) : null;
      // Undated lots last: they are the ones that can wait.
      if (leftDays !== rightDays) {
        if (leftDays === null) return 1;
        if (rightDays === null) return -1;
        return leftDays - rightDays;
      }
      if (left.productionDate || right.productionDate) {
        const leftMade = left.productionDate ? dayOnly(left.productionDate).getTime() : 0;
        const rightMade = right.productionDate ? dayOnly(right.productionDate).getTime() : 0;
        if (leftMade !== rightMade) return leftMade - rightMade;
      }
    }
    return String(left.batchNumber).localeCompare(String(right.batchNumber));
  });

  const allocations: LotAllocation[] = [];
  const considered: string[] = [];
  let remaining = wanted;
  let expiredQuantity = new Prisma.Decimal(0);

  for (const lot of ranked) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const available = toDecimal(lot.remainingQuantity);
    const expired =
      lot.expiryDate !== null &&
      lot.expiryDate !== undefined &&
      daysUntil(lot.expiryDate, options.today) < 0;

    if (expired && !options.allowExpired) continue;

    considered.push(lot.batchId);
    const take = available.lessThan(remaining) ? available : remaining;
    if (take.lessThanOrEqualTo(0)) continue;
    allocations.push({
      batchId: lot.batchId,
      batchNumber: lot.batchNumber,
      quantity: take,
      expired,
      unitCost: toDecimal(lot.unitCost),
    });
    if (expired) expiredQuantity = expiredQuantity.plus(take);
    remaining = remaining.minus(take);
  }

  return {
    allocations,
    shortfall: remaining.lessThan(0) ? new Prisma.Decimal(0) : remaining,
    expiredQuantity,
    considered,
  };
}

/// The moving weighted average after a receipt.
///
/// `(value on hand + value received) / (quantity on hand + quantity received)`.
/// The unit cost is reported at six places and the value at four: a shop that
/// receives 3 for 10.00 next to 7 for 23.33 must see the same total it paid,
/// not a total rounded per unit.
export function movingAverage(
  onHand: { quantity: Prisma.Decimal | number | string; value: Prisma.Decimal | number | string },
  incoming: { quantity: Prisma.Decimal | number | string; value: Prisma.Decimal | number | string },
): { quantity: Prisma.Decimal; value: Prisma.Decimal; unitCost: Prisma.Decimal } {
  const quantity = toDecimal(onHand.quantity).plus(toDecimal(incoming.quantity));
  const value = toDecimal(onHand.value)
    .plus(toDecimal(incoming.value))
    .toDecimalPlaces(4);
  const unitCost = quantity.isZero()
    ? new Prisma.Decimal(0)
    : value.div(quantity).toDecimalPlaces(6);
  return { quantity, value, unitCost };
}

/// The value an issue leaves at: the average cost of what is on hand.
///
/// An issue never changes the average - that is what "average" means - so the
/// unit cost is read before the quantity is reduced, and the value removed is
/// the same unit cost times the quantity issued.
export function issueAtAverage(
  onHand: { quantity: Prisma.Decimal | number | string; value: Prisma.Decimal | number | string },
  quantity: Prisma.Decimal | number | string,
): { unitCost: Prisma.Decimal; value: Prisma.Decimal; remainingQuantity: Prisma.Decimal; remainingValue: Prisma.Decimal } {
  const available = toDecimal(onHand.quantity);
  const value = toDecimal(onHand.value);
  const issued = toDecimal(quantity);
  const unitCost = available.isZero() ? new Prisma.Decimal(0) : value.div(available).toDecimalPlaces(6);
  const removed = unitCost.mul(issued).toDecimalPlaces(4);
  // When the whole balance leaves, the whole value leaves with it: a rounded
  // average must not leave a dinar of valuation behind on an empty shelf.
  const removedValue = issued.greaterThanOrEqualTo(available) ? value : removed;
  return {
    unitCost,
    value: removedValue,
    remainingQuantity: available.minus(issued),
    remainingValue: value.minus(removedValue),
  };
}

/// What a receipt must carry, read from the item's own policy.
export interface BatchPolicy {
  requiresBatch: boolean;
  requiresProductionDate: boolean;
  requiresExpiryDate: boolean;
  useFefo: boolean;
  allowExpiredIssue: boolean;
  expiredIssueNeedsApproval: boolean;
}

export const DEFAULT_BATCH_POLICY: BatchPolicy = {
  requiresBatch: false,
  requiresProductionDate: false,
  requiresExpiryDate: false,
  useFefo: true,
  allowExpiredIssue: false,
  expiredIssueNeedsApproval: false,
};

export function batchPolicyOf(item: Partial<BatchPolicy> | null | undefined): BatchPolicy {
  return {
    requiresBatch: item?.requiresBatch ?? DEFAULT_BATCH_POLICY.requiresBatch,
    requiresProductionDate:
      item?.requiresProductionDate ?? DEFAULT_BATCH_POLICY.requiresProductionDate,
    requiresExpiryDate: item?.requiresExpiryDate ?? DEFAULT_BATCH_POLICY.requiresExpiryDate,
    useFefo: item?.useFefo ?? DEFAULT_BATCH_POLICY.useFefo,
    allowExpiredIssue: item?.allowExpiredIssue ?? DEFAULT_BATCH_POLICY.allowExpiredIssue,
    expiredIssueNeedsApproval:
      item?.expiredIssueNeedsApproval ?? DEFAULT_BATCH_POLICY.expiredIssueNeedsApproval,
  };
}

/// The list of what a receipt is missing, empty when it is complete.
///
/// Returned as messages rather than thrown, so the API can report every
/// problem at once: "give a lot number and an expiry date" is one correction,
/// two dialogs is two.
export function receiptProblems(
  input: {
    batchNumber?: string | null;
    productionDate?: Date | string | null;
    expiryDate?: Date | string | null;
  },
  policy: BatchPolicy,
): string[] {
  const problems: string[] = [];
  if (policy.requiresBatch && !input.batchNumber?.trim()) {
    problems.push('هذا الصنف يتطلب رقم دفعة. / This item requires a lot number.');
  }
  if (policy.requiresProductionDate && !input.productionDate) {
    problems.push('هذا الصنف يتطلب تاريخ إنتاج. / This item requires a production date.');
  }
  if (policy.requiresExpiryDate && !input.expiryDate) {
    problems.push('هذا الصنف يتطلب تاريخ صلاحية. / This item requires an expiry date.');
  }
  if (input.productionDate && input.expiryDate) {
    if (dayOnly(input.expiryDate).getTime() < dayOnly(input.productionDate).getTime()) {
      problems.push(
        'تاريخ الصلاحية قبل تاريخ الإنتاج. / The expiry date is before the production date.',
      );
    }
  }
  return problems;
}
