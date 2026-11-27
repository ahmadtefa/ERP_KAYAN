import { commissionPiasters, CommissionError, invoiceBasis, money, parseRate, payoutTotal, rateToPercent, toPiasters } from './commission-rules';

describe('commission rules', () => {
  it('parses rates strictly', () => {
    expect(parseRate('2.5')).toBe(25000);
    expect(parseRate('100')).toBe(1_000_000);
    expect(parseRate('0')).toBe(0);
    expect(rateToPercent(parseRate('0.0125'))).toBe(0.0125);
    for (const bad of ['', '-1', '100.0001', '101', 'abc', '1.23456', '1,5', null]) expect(() => parseRate(bad)).toThrow(CommissionError);
  });
  it('computes in piasters with half away from zero', () => {
    expect(commissionPiasters(100000, 25000)).toBe(2500); // 1000.00 x 2.5% = 25.00
    expect(commissionPiasters(1, 5000)).toBe(0); // 0.01 x 0.5% = 0.00005
    expect(commissionPiasters(10000, 50000)).toBe(500);
  });
  it('rounds .5 piaster away from zero in both directions', () => {
    expect(commissionPiasters(10050, 50000)).toBe(503); // 502.5 piasters -> 503
    expect(commissionPiasters(1050, 50000)).toBe(53); // 52.5 -> 53
    expect(commissionPiasters(-1050, 50000)).toBe(-53);
    expect(commissionPiasters(1049, 50000)).toBe(52); // 52.45
  });
  it('does not overflow on very large amounts', () => {
    expect(commissionPiasters(99_999_999_999_999, 1_000_000)).toBe(99_999_999_999_999);
  });
  it('uses the total without VAT', () => {
    expect(invoiceBasis('1140.00', '140.00')).toBe(100000);
    expect(money(invoiceBasis('1140', '140'))).toBe('1000.00');
  });
  it('reads money', () => {
    expect(toPiasters('12.34')).toBe(1234);
    expect(toPiasters('-5')).toBe(-500);
    expect(() => toPiasters('1.2.3')).toThrow(CommissionError);
  });
  it('nets returns in a payout and refuses zero or negative', () => {
    expect(payoutTotal([{ id: 'a', amountPiasters: 5000 }, { id: 'b', amountPiasters: -1000 }])).toBe(4000);
    expect(() => payoutTotal([])).toThrow(CommissionError);
    expect(() => payoutTotal([{ id: 'a', amountPiasters: 1000 }, { id: 'b', amountPiasters: -1000 }])).toThrow(CommissionError);
  });
});
