import { allocateLandedCostAmounts } from './landed-cost-allocation';

describe('allocateLandedCostAmounts', () => {
  test('allocates by line value and keeps the exact invoice total', () => {
    const allocations = allocateLandedCostAmounts(
      ['100.0000', '200.0000', '300.0000'],
      '100.0000',
    );

    expect(allocations).toEqual(['16.6667', '33.3333', '50.0000']);
    expect(allocations.reduce((sum, value) => sum + BigInt(value.replace('.', '')), 0n))
      .toBe(10_000_00n);
  });

  test('distributes a one-unit remainder without a negative final line', () => {
    expect(
      allocateLandedCostAmounts(['1.0000', '1.0000', '1.0000'], '0.0001'),
    ).toEqual(['0.0001', '0.0000', '0.0000']);
  });

  test('does not assign landed cost to zero-value lines', () => {
    expect(
      allocateLandedCostAmounts(['0.0000', '25.0000', '75.0000'], '4.0000'),
    ).toEqual(['0.0000', '1.0000', '3.0000']);
  });

  test('rejects positive landed costs when there is no positive line value', () => {
    expect(() => allocateLandedCostAmounts(['0.0000', '0.0000'], '1.0000'))
      .toThrow(/positive invoice line value/);
  });

  test('rejects negative inputs', () => {
    expect(() => allocateLandedCostAmounts(['-1.0000'], '0.5000')).toThrow(/negative/);
    expect(() => allocateLandedCostAmounts(['1.0000'], '-0.5000')).toThrow(/negative/);
  });
});
