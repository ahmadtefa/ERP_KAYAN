import { claimFigures, amount, percent } from './contract-rules';

const base = { effectiveValue: '1000000', contractValue: '1000000', advanceAmount: '100000', advanceRecovered: '0', retentionPercent: '5', taxRatePercent: '14', previousWork: '0', cumulativeWork: '200000' };

describe('contract claim figures', () => {
  it('works period, proportional advance recovery, retention and VAT', () => {
    const f = claimFigures(base);
    expect(f.periodWork.toFixed(2)).toBe('200000.00');
    expect(f.advanceRecovery.toFixed(2)).toBe('20000.00');
    expect(f.retention.toFixed(2)).toBe('10000.00');
    expect(f.vat.toFixed(2)).toBe('28000.00');
    expect(f.netDueNow.toFixed(2)).toBe('198000.00');
  });
  it('never recovers more advance than remains', () => {
    const f = claimFigures({ ...base, advanceRecovered: '95000' });
    expect(f.advanceRecovery.toFixed(2)).toBe('5000.00');
  });
  it('uses the work already billed', () => {
    const f = claimFigures({ ...base, previousWork: '200000', cumulativeWork: '500000' });
    expect(f.periodWork.toFixed(2)).toBe('300000.00');
  });
  it('refuses a claim not above the previous one or above the contract', () => {
    expect(() => claimFigures({ ...base, previousWork: '200000', cumulativeWork: '200000' })).toThrow();
    expect(() => claimFigures({ ...base, cumulativeWork: '1000000.01' })).toThrow();
  });
  it('treats a missing tax rate as no VAT', () => {
    expect(claimFigures({ ...base, taxRatePercent: null }).vat.toFixed(2)).toBe('0.00');
  });
  it('validates input', () => {
    expect(() => amount('12.345', 'x')).toThrow();
    expect(() => percent('101', 'p')).toThrow();
    expect(amount('-5', 'x', { negative: true }).toFixed(2)).toBe('-5.00');
  });
});
