/**
 * Licence terms are counted in calendar months, not in blocks of thirty days.
 *
 * A one-year licence bought on 31 January 2028 must end on 31 January 2029,
 * and a one-month licence bought on 31 January must end on the last day of
 * February - 29 in a leap year, 28 otherwise - because the 31st does not
 * exist in February. Thirty-day arithmetic gets both of those wrong, and the
 * customer notices every time.
 *
 * Every instant here is an absolute UTC instant. The company's timezone is a
 * display concern: the same deadline is shown as a local date in Cairo or in
 * Dubai, but it is one moment in time, so moving a server between timezones
 * cannot move a deadline.
 */

export const MAX_TERM_MONTHS = 1200; // 100 years

/** Days in a month, in UTC. */
export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Adds calendar months, clamping the day to the last day of the target month.
 *
 * The time of day is preserved, so a licence that starts at 09:00 on 31
 * January ends at 09:00 on the last day of February rather than at midnight,
 * which would silently shorten it by nine hours.
 */
export function addCalendarMonths(from: Date, months: number): Date {
  if (!Number.isInteger(months) || months === 0) {
    return new Date(from.getTime());
  }
  const year = from.getUTCFullYear();
  const monthIndex = from.getUTCMonth();
  const day = from.getUTCDate();

  const targetMonthIndex = monthIndex + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalisedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = daysInMonth(targetYear, normalisedMonth);

  const result = new Date(from.getTime());
  result.setUTCFullYear(targetYear, normalisedMonth, Math.min(day, lastDay));
  return result;
}

/** Months for a term written in years (or months). One year is twelve months. */
export function monthsFrom(years: number, months: number): number {
  return years * 12 + months;
}

export function isPerpetual(
  expiresAt: Date | null | undefined,
): expiresAt is null | undefined {
  return expiresAt === null || expiresAt === undefined;
}

/**
 * When a renewed term ends.
 *
 *  * Still valid: the new months are added to the date it already had, so the
 *    customer never loses the days they paid for by renewing early.
 *  * Already ended: the new term starts when the renewal key is applied, and
 *    the expired period is not back-filled - an expired licence buys nothing.
 *  * Perpetual: stays perpetual. A perpetual licence has no date to extend.
 */
export function renewalEnd(
  currentExpiresAt: Date | null,
  months: number,
  appliedAt: Date,
): Date | null {
  if (isPerpetual(currentExpiresAt)) return null;
  const base =
    currentExpiresAt.getTime() > appliedAt.getTime()
      ? currentExpiresAt
      : appliedAt;
  return addCalendarMonths(base, months);
}

/** The end of a term bought at activation. */
export function activationEnd(
  term: { kind: 'MONTHS'; months: number } | { kind: 'PERPETUAL' },
  startsAt: Date,
): Date | null {
  if (term.kind === 'PERPETUAL') return null;
  return addCalendarMonths(startsAt, term.months);
}

export interface TermDescription {
  ar: string;
  en: string;
}

/** A sentence a person can read, from the month count in the key. */
export function describeTerm(months: number | null): TermDescription {
  if (months === null) return { ar: 'ترخيص دائم', en: 'Perpetual' };
  if (months % 12 === 0) {
    const years = months / 12;
    if (years === 1) return { ar: 'سنة واحدة', en: 'One year' };
    if (years === 2) return { ar: 'سنتان', en: 'Two years' };
    return { ar: `${years} سنوات`, en: `${years} years` };
  }
  if (months === 1) return { ar: 'شهر واحد', en: 'One month' };
  if (months === 2) return { ar: 'شهران', en: 'Two months' };
  return { ar: `${months} أشهر`, en: `${months} months` };
}

/** Whole days left, rounded up, so "expires today" is 0 and tomorrow is 1. */
export function daysRemaining(expiresAt: Date | null, now: Date): number | null {
  if (isPerpetual(expiresAt)) return null;
  const diff = expiresAt.getTime() - now.getTime();
  if (diff <= 0) return 0;
  return Math.ceil(diff / 86_400_000);
}
