import { Prisma } from '@prisma/client';

import { assertForeign, CurrencyError, normalizeCode, parseRate, realizedDifference, toBase } from './currency-rules';

describe('currency rules', () => {
  it('normalizes and rejects currency codes', () => {
    expect(normalizeCode(' usd ')).toBe('USD');
    expect(() => normalizeCode('US')).toThrow(CurrencyError);
    expect(() => normalizeCode('U$D')).toThrow(CurrencyError);
    expect(() => normalizeCode(undefined)).toThrow(CurrencyError);
  });

  it('accepts only positive plain-number rates and keeps 8 places', () => {
    expect(parseRate('48.5').toFixed(8)).toBe('48.50000000');
    expect(parseRate('0.123456789').toFixed(8)).toBe('0.12345679');
    for (const bad of ['0', '-1', 'abc', '', '1e3', '1000000000', null]) {
      expect(() => parseRate(bad)).toThrow(CurrencyError);
    }
  });

  it('converts half-up to 4 places', () => {
    expect(toBase('100', '48.5').toFixed(4)).toBe('4850.0000');
    expect(toBase('0.00005', '1').toFixed(4)).toBe('0.0001');
    expect(toBase('1.00004', '1').toFixed(4)).toBe('1.0000');
  });

  it('realized difference: receivable gains when the rate rose, payable loses', () => {
    expect(realizedDifference('1000', '48', '50', 'RECEIVABLE').toFixed(4)).toBe('2000.0000');
    expect(realizedDifference('1000', '48', '50', 'PAYABLE').toFixed(4)).toBe('-2000.0000');
    expect(realizedDifference('1000', '50', '48', 'RECEIVABLE').toFixed(4)).toBe('-2000.0000');
    expect(realizedDifference('1000', '48', '48', 'PAYABLE').isZero()).toBe(true);
  });

  it('settling in parts never drifts from the whole by more than rounding', () => {
    const whole = realizedDifference('300', '48.1234', '49.9876', 'RECEIVABLE');
    const parts = ['100', '100', '100'].reduce(
      (a, p) => a.add(realizedDifference(p, '48.1234', '49.9876', 'RECEIVABLE')),
      new Prisma.Decimal(0),
    );
    expect(parts.sub(whole).abs().lte(new Prisma.Decimal('0.0003'))).toBe(true);
  });

  it('refuses a rate for the company currency', () => {
    expect(() => assertForeign('EGP', 'EGP')).toThrow(CurrencyError);
    expect(() => assertForeign('USD', 'EGP')).not.toThrow();
  });
});
