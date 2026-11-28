import { checkBrackets, daysInMonth, HrError, isoDate, maskTail, money, monthKey, nationalId, percent } from './hr-rules';

describe('hr rules', () => {
  it('validates money, dates, months and percentages', () => {
    expect(money('1500.5', 'basic').toFixed(4)).toBe('1500.5000');
    for (const bad of ['', '-1', '0', 'abc', '1.23456']) expect(() => money(bad, 'basic')).toThrow(HrError);
    expect(money('0', 'x', { allowZero: true }).isZero()).toBe(true);
    expect(isoDate('2026-02-28', 'd')).toBe('2026-02-28');
    expect(() => isoDate('2026-02-30', 'd')).toThrow(HrError);
    expect(monthKey('2026-12')).toBe('2026-12');
    expect(() => monthKey('2026-13')).toThrow(HrError);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2027-02')).toBe(28);
    expect(percent('14', 'r').toFixed(4)).toBe('14.0000');
    expect(() => percent('101', 'r')).toThrow(HrError);
  });

  it('accepts brackets that chain from zero and refuses gaps, overlaps and early open ends', () => {
    const ok = checkBrackets([
      { from: '0', to: '1000', ratePercent: '0' },
      { from: '1000', to: '5000', ratePercent: '10' },
      { from: '5000', ratePercent: '20' },
    ]);
    expect(ok).toHaveLength(3);
    expect(ok[2].to).toBeNull();
    expect(() => checkBrackets([{ from: '10', to: '20', ratePercent: '1' }])).toThrow(HrError);
    expect(() => checkBrackets([{ from: '0', to: '10', ratePercent: '1' }, { from: '11', to: '20', ratePercent: '1' }])).toThrow(HrError);
    expect(() => checkBrackets([{ from: '0', to: '10', ratePercent: '1' }, { from: '5', to: '20', ratePercent: '1' }])).toThrow(HrError);
    expect(() => checkBrackets([{ from: '0', ratePercent: '1' }, { from: '10', ratePercent: '1' }])).toThrow(HrError);
    expect(() => checkBrackets([{ from: '0', to: '0', ratePercent: '1' }])).toThrow(HrError);
    expect(() => checkBrackets('x')).toThrow(HrError);
    expect(checkBrackets([])).toEqual([]);
  });

  it('national id is 14 digits or empty; masking keeps the last four', () => {
    expect(nationalId('')).toBeNull();
    expect(nationalId('29001011234567')).toBe('29001011234567');
    expect(() => nationalId('123')).toThrow(HrError);
    expect(maskTail('29001011234567')).toBe('**********4567');
    expect(maskTail('12')).toBe('****');
    expect(maskTail(null)).toBeNull();
  });
});
