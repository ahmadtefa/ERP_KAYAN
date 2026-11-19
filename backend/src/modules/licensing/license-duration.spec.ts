import {
  addCalendarMonths,
  daysRemaining,
  renewalEnd,
  activationEnd,
  monthsFrom,
} from './license-duration';

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('licence terms are counted in calendar months', () => {
  it('adds months without drifting through thirty-day blocks', () => {
    expect(addCalendarMonths(utc('2026-01-15'), 1).toISOString()).toBe(
      '2026-02-15T00:00:00.000Z',
    );
    expect(addCalendarMonths(utc('2026-01-15'), 12).toISOString()).toBe(
      '2027-01-15T00:00:00.000Z',
    );
    expect(addCalendarMonths(utc('2026-03-31'), 1).toISOString()).toBe(
      '2026-04-30T00:00:00.000Z',
    );
  });

  it('clamps the 31st to the last day of a shorter month', () => {
    // 2026 is not a leap year; 2028 is.
    expect(addCalendarMonths(utc('2026-01-31'), 1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
    expect(addCalendarMonths(utc('2028-01-31'), 1).toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
    // A whole year from 29 February 2028 lands on 28 February 2029.
    expect(addCalendarMonths(utc('2028-02-29'), 12).toISOString()).toBe(
      '2029-02-28T00:00:00.000Z',
    );
  });

  it('keeps the time of day, so a term is not shortened by hours', () => {
    const start = new Date('2026-01-31T09:30:00.000Z');
    expect(addCalendarMonths(start, 1).toISOString()).toBe(
      '2026-02-28T09:30:00.000Z',
    );
  });

  it('reads a term in years without inventing days', () => {
    expect(monthsFrom(2, 0)).toBe(24);
    expect(monthsFrom(1, 3)).toBe(15);
  });

  it('makes a perpetual term have no end at all', () => {
    const start = new Date('2026-05-01T00:00:00.000Z');
    expect(activationEnd({ kind: 'PERPETUAL' }, start)).toBeNull();
    expect(daysRemaining(null, start)).toBeNull();
  });
});

describe('renewal policy', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');

  it('adds the new term to the current end when renewed early', () => {
    const currentEnd = new Date('2026-07-01T00:00:00.000Z');
    expect(renewalEnd(currentEnd, 12, now)?.toISOString()).toBe(
      '2027-07-01T00:00:00.000Z',
    );
  });

  it('starts a new term at the day of renewal when already expired', () => {
    const expiredEnd = new Date('2026-05-01T00:00:00.000Z');
    expect(renewalEnd(expiredEnd, 1, now)?.toISOString()).toBe(
      '2026-07-15T12:00:00.000Z',
    );
  });

  it('never gives free time for the gap after an expiry', () => {
    const longExpired = new Date('2025-01-01T00:00:00.000Z');
    const result = renewalEnd(longExpired, 1, now)!;
    expect(result.getTime()).toBeGreaterThan(now.getTime());
    expect(result.getTime() - now.getTime()).toBeLessThan(31 * 86_400_000);
  });

  it('keeps a perpetual licence perpetual', () => {
    expect(renewalEnd(null, 12, now)).toBeNull();
  });
});

describe('daysRemaining', () => {
  it('counts whole days up and reports zero on the last day', () => {
    const now = new Date('2026-06-15T10:00:00.000Z');
    expect(daysRemaining(new Date('2026-06-16T10:00:00.000Z'), now)).toBe(1);
    expect(daysRemaining(new Date('2026-06-15T10:00:00.000Z'), now)).toBe(0);
    expect(daysRemaining(new Date('2026-06-14T10:00:00.000Z'), now)).toBe(0);
  });
});
