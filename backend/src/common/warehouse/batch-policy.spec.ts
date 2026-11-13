import { Prisma } from '@prisma/client';

import {
  DEFAULT_EXPIRY_DAYS,
  bandSeverity,
  batchPolicyOf,
  daysUntil,
  expiryBand,
  issueAtAverage,
  movingAverage,
  normalizeExpiryDays,
  receiptProblems,
  selectLotsFefo,
  withinExpiryWindow,
} from './batch-policy';

/// The three decisions that cost money when they are wrong, pinned.
///
/// These are the rules a person would check by hand on the shelf, written as
/// arithmetic so they can be checked a thousand times a night instead.
const D = (value: string | number) => new Prisma.Decimal(value);
const TODAY = '2026-11-01';

/// `expiryDate: null` has to stay null, so the defaults are applied by the
/// presence of the key and not by `??` - which would quietly turn "no expiry"
/// into "expires next year" and make an undated-lot test pass for the wrong
/// reason.
const lot = (over: Partial<Parameters<typeof selectLotsFefo>[0][number]> = {}) => ({
  batchId: over.batchId ?? 'batch-a',
  batchNumber: over.batchNumber ?? 'LOT-A',
  expiryDate: 'expiryDate' in over ? over.expiryDate! : '2027-01-01',
  productionDate: over.productionDate ?? null,
  unitCost: over.unitCost ?? '10',
  remainingQuantity: over.remainingQuantity ?? '100',
  status: over.status ?? 'OPEN',
});

describe('expiry bands', () => {
  it('calls a lot expired the day after, not the morning of', () => {
    expect(expiryBand('2026-10-31', TODAY)).toBe('EXPIRED');
    expect(expiryBand('2026-11-01', TODAY)).toBe('TODAY');
    expect(daysUntil('2026-11-01', TODAY)).toBe(0);
    expect(daysUntil('2026-11-08', TODAY)).toBe(7);
  });

  it('groups the way the reports do', () => {
    expect(expiryBand('2026-11-03', TODAY)).toBe('IN_7');
    expect(expiryBand('2026-11-08', TODAY)).toBe('IN_7');
    expect(expiryBand('2026-11-09', TODAY)).toBe('IN_30');
    expect(expiryBand('2026-12-01', TODAY)).toBe('IN_30');
    expect(expiryBand('2026-12-31', TODAY)).toBe('IN_60');
    expect(expiryBand('2027-01-30', TODAY)).toBe('IN_90');
    expect(expiryBand('2027-06-01', TODAY)).toBe('LATER');
    expect(expiryBand(null, TODAY)).toBe('NO_EXPIRY');
  });

  it('shouts about the money that cannot be sold', () => {
    expect(bandSeverity('EXPIRED')).toBe('CRITICAL');
    expect(bandSeverity('IN_7')).toBe('WARNING');
    expect(bandSeverity('TODAY')).toBe('WARNING');
    expect(bandSeverity('IN_60')).toBe('INFO');
  });

  it('ignores the hour a report happens to run at', () => {
    // The same lot, read at 00:01 and at 23:59, is the same lot.
    expect(daysUntil(new Date('2026-11-05T00:01:00Z'), new Date('2026-11-01T23:59:00Z'))).toBe(4);
    expect(daysUntil('2026-11-05', '2026-11-01')).toBe(4);
  });

  it('keeps a sensible list of announcement days whatever is stored', () => {
    expect(normalizeExpiryDays([30, 90, 30, 7, 0])).toEqual([90, 30, 7, 0]);
    expect(normalizeExpiryDays(['60', 7])).toEqual([60, 7]);
    expect(normalizeExpiryDays([])).toEqual([...DEFAULT_EXPIRY_DAYS]);
    expect(normalizeExpiryDays('ninety')).toEqual([...DEFAULT_EXPIRY_DAYS]);
    expect(normalizeExpiryDays([-5, 20])).toEqual([20]);
  });

  it('counts a lot inside every band up to its own', () => {
    const days = normalizeExpiryDays([90, 30, 7, 0]);
    expect(withinExpiryWindow('2026-11-06', TODAY, days)).toBe(true);
    expect(withinExpiryWindow('2026-11-20', TODAY, days)).toBe(true);
    expect(withinExpiryWindow('2027-03-01', TODAY, days)).toBe(false);
    // An expired lot is not "within" a window: it is reported as expired.
    expect(withinExpiryWindow('2026-10-01', TODAY, days)).toBe(false);
    expect(withinExpiryWindow(null, TODAY, days)).toBe(false);
  });
});

describe('FEFO', () => {
  it('takes the nearest expiry first', () => {
    const result = selectLotsFefo(
      [
        lot({ batchId: 'far', batchNumber: 'LOT-FAR', expiryDate: '2027-06-01' }),
        lot({ batchId: 'near', batchNumber: 'LOT-NEAR', expiryDate: '2026-12-01' }),
        lot({ batchId: 'mid', batchNumber: 'LOT-MID', expiryDate: '2027-01-15' }),
      ],
      '150',
      { today: TODAY, allowExpired: false },
    );
    expect(result.allocations.map((row) => row.batchId)).toEqual(['near', 'mid']);
    expect(result.allocations[0].quantity.toFixed(4)).toBe('100.0000');
    expect(result.allocations[1].quantity.toFixed(4)).toBe('50.0000');
    expect(result.shortfall.toFixed(4)).toBe('0.0000');
  });

  it('walks the shelf in the same order twice', () => {
    const lots = [
      lot({ batchId: 'b', batchNumber: 'LOT-B' }),
      lot({ batchId: 'a', batchNumber: 'LOT-A' }),
      lot({ batchId: 'c', batchNumber: 'LOT-C', expiryDate: '2027-05-05' }),
    ];
    const first = selectLotsFefo(lots, '200', { today: TODAY, allowExpired: false });
    const second = selectLotsFefo([...lots].reverse(), '200', {
      today: TODAY,
      allowExpired: false,
    });
    expect(first.allocations.map((row) => row.batchId)).toEqual(
      second.allocations.map((row) => row.batchId),
    );
    // Same expiry: the lot number decides, so the answer is not the order the
    // rows happened to come back in.
    expect(first.allocations.map((row) => row.batchId)).toEqual(['a', 'b']);
  });

  it('skips an expired lot instead of selling it', () => {
    const result = selectLotsFefo(
      [
        lot({ batchId: 'dead', batchNumber: 'LOT-DEAD', expiryDate: '2026-10-01' }),
        lot({ batchId: 'good', batchNumber: 'LOT-GOOD', expiryDate: '2027-02-01' }),
      ],
      '10',
      { today: TODAY, allowExpired: false },
    );
    expect(result.allocations.map((row) => row.batchId)).toEqual(['good']);
    expect(result.expiredQuantity.toFixed(4)).toBe('0.0000');
  });

  it('reports how much of an issue came from expired stock when allowed', () => {
    const result = selectLotsFefo(
      [
        lot({ batchId: 'dead', batchNumber: 'LOT-DEAD', expiryDate: '2026-10-01', remainingQuantity: '4' }),
        lot({ batchId: 'good', batchNumber: 'LOT-GOOD', expiryDate: '2027-02-01', remainingQuantity: '100' }),
      ],
      '10',
      { today: TODAY, allowExpired: true },
    );
    expect(result.allocations.map((row) => row.batchId)).toEqual(['dead', 'good']);
    expect(result.expiredQuantity.toFixed(4)).toBe('4.0000');
  });

  it('never takes more than a lot holds, and says what is missing', () => {
    const result = selectLotsFefo(
      [lot({ batchId: 'only', remainingQuantity: '3' })],
      '10',
      { today: TODAY, allowExpired: false },
    );
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].quantity.toFixed(4)).toBe('3.0000');
    expect(result.shortfall.toFixed(4)).toBe('7.0000');
  });

  it('leaves out lots that cannot be handed over', () => {
    const result = selectLotsFefo(
      [
        lot({ batchId: 'quarantine', status: 'QUARANTINE', expiryDate: '2026-11-05' }),
        lot({ batchId: 'written', status: 'WRITTEN_OFF', expiryDate: '2026-11-05' }),
        lot({ batchId: 'empty', remainingQuantity: '0', expiryDate: '2026-11-05' }),
        lot({ batchId: 'usable', expiryDate: '2027-03-01' }),
      ],
      '1',
      { today: TODAY, allowExpired: false },
    );
    expect(result.allocations.map((row) => row.batchId)).toEqual(['usable']);
  });

  it('puts an undated lot last but still uses it', () => {
    const result = selectLotsFefo(
      [
        lot({ batchId: 'undated', batchNumber: 'LOT-1', expiryDate: null }),
        lot({ batchId: 'dated', batchNumber: 'LOT-2', expiryDate: '2027-01-01' }),
      ],
      '150',
      { today: TODAY, allowExpired: false },
    );
    expect(result.allocations.map((row) => row.batchId)).toEqual(['dated', 'undated']);
  });

  it('falls back to the oldest lot when FEFO is off for the item', () => {
    const lots = [
      lot({ batchId: 'b2', batchNumber: 'LOT-2', expiryDate: '2027-05-01' }),
      lot({ batchId: 'b1', batchNumber: 'LOT-1', expiryDate: '2026-12-01' }),
    ];
    const fefo = selectLotsFefo(lots, '10', { today: TODAY, allowExpired: false });
    const lifoOff = selectLotsFefo(lots, '10', {
      today: TODAY,
      allowExpired: false,
      useFefo: false,
    });
    expect(fefo.allocations[0].batchId).toBe('b1');
    expect(lifoOff.allocations[0].batchId).toBe('b1'); // lot number, not expiry
  });

  it('does nothing at all for a zero request', () => {
    const result = selectLotsFefo([lot()], '0', { today: TODAY, allowExpired: false });
    expect(result.allocations).toHaveLength(0);
    expect(result.shortfall.toFixed(4)).toBe('0.0000');
  });
});

describe('moving weighted average', () => {
  it('averages two receipts at different prices', () => {
    // 10 at 10.00, then 10 at 20.00 -> 300 / 20 = 15.00
    const first = movingAverage(
      { quantity: 0, value: 0 },
      { quantity: 10, value: 100 },
    );
    expect(first.unitCost.toFixed(4)).toBe('10.0000');
    const second = movingAverage(first, { quantity: 10, value: 200 });
    expect(second.quantity.toFixed(4)).toBe('20.0000');
    expect(second.value.toFixed(4)).toBe('300.0000');
    expect(second.unitCost.toFixed(4)).toBe('15.0000');
  });

  it('keeps the value the company actually paid, without rounding per unit', () => {
    const after = movingAverage(
      { quantity: 3, value: '10.0000' },
      { quantity: 7, value: '23.3300' },
    );
    expect(after.value.toFixed(4)).toBe('33.3300');
    expect(after.unitCost.toFixed(6)).toBe('3.333000');
  });

  it('an issue leaves at the average and does not move it', () => {
    const onHand = { quantity: 20, value: 300 };
    const out = issueAtAverage(onHand, 5);
    expect(out.unitCost.toFixed(4)).toBe('15.0000');
    expect(out.value.toFixed(4)).toBe('75.0000');
    expect(out.remainingQuantity.toFixed(4)).toBe('15.0000');
    expect(out.remainingValue.toFixed(4)).toBe('225.0000');
  });

  it('empties the value with the shelf, so nothing is left behind', () => {
    // 3 units for 10.00: the average is 3.333333, and taking all three must
    // leave exactly zero, not a rounding residue.
    const out = issueAtAverage({ quantity: 3, value: '10.0000' }, 3);
    expect(out.remainingQuantity.toFixed(4)).toBe('0.0000');
    expect(out.remainingValue.toFixed(4)).toBe('0.0000');
  });

  it('costs nothing when there is nothing', () => {
    const out = issueAtAverage({ quantity: 0, value: 0 }, 0);
    expect(out.unitCost.toFixed(4)).toBe('0.0000');
    expect(out.remainingValue.toFixed(4)).toBe('0.0000');
  });
});

describe('what a receipt has to carry', () => {
  const strict = batchPolicyOf({
    requiresBatch: true,
    requiresExpiryDate: true,
    requiresProductionDate: true,
  });

  it('is silent for an item with no policy', () => {
    expect(receiptProblems({}, batchPolicyOf(null))).toEqual([]);
    expect(receiptProblems({ batchNumber: '' }, batchPolicyOf({}))).toEqual([]);
  });

  it('asks for every field the item needs, in one answer', () => {
    const problems = receiptProblems({}, strict);
    expect(problems).toHaveLength(3);
    expect(problems.join(' ')).toContain('lot number');
    expect(problems.join(' ')).toContain('expiry date');
  });

  it('accepts a complete lot', () => {
    expect(
      receiptProblems(
        { batchNumber: 'B-1', productionDate: '2026-01-01', expiryDate: '2027-01-01' },
        strict,
      ),
    ).toEqual([]);
  });

  it('refuses a lot that expires before it was made', () => {
    const problems = receiptProblems(
      { batchNumber: 'B-1', productionDate: '2026-05-01', expiryDate: '2026-04-01' },
      strict,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('before the production date');
  });

  it('does not require dates from an item that only wants a lot number', () => {
    const lotOnly = batchPolicyOf({ requiresBatch: true });
    expect(receiptProblems({ batchNumber: 'B-1' }, lotOnly)).toEqual([]);
  });
});
