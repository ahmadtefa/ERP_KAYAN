import { Prisma } from '@prisma/client';

import {
  bookValue,
  depreciableBase,
  disposalResult,
  monthlyCharge,
  nextCharge,
} from './depreciation';

const D = (value: string) => new Prisma.Decimal(value);

describe('straight-line depreciation arithmetic', () => {
  it('charges (cost − salvage) / life each month', () => {
    // The worked example: (120,000 − 12,000) / 60 = 1,800 a month.
    expect(depreciableBase(D('120000'), D('12000')).toFixed(4)).toBe('108000.0000');
    expect(monthlyCharge(D('120000'), D('12000'), 60).toFixed(4)).toBe('1800.0000');
    expect(nextCharge(D('120000'), D('12000'), 60, D('0')).toFixed(4)).toBe('1800.0000');
    expect(nextCharge(D('120000'), D('12000'), 60, D('54000')).toFixed(4)).toBe('1800.0000');
  });

  it('never takes the book value below salvage', () => {
    // One charge of 100 remains before the floor, monthly would be 100.
    expect(nextCharge(D('1200'), D('200'), 10, D('900')).toFixed(4)).toBe('100.0000');
    // At the floor there is nothing left to charge.
    expect(nextCharge(D('1200'), D('200'), 10, D('1000')).toFixed(4)).toBe('0.0000');
    // A life that does not divide the base: the last charge takes the
    // remainder, so the schedule sums exactly to the base.
    let accumulated = D('0');
    for (let month = 0; month < 3; month += 1) {
      accumulated = accumulated.plus(nextCharge(D('1000'), D('0'), 3, accumulated));
    }
    expect(accumulated.toFixed(4)).toBe('1000.0000');
    expect(bookValue(D('1000'), accumulated).toFixed(4)).toBe('0.0000');
    expect(nextCharge(D('1000'), D('0'), 3, accumulated).toFixed(4)).toBe('0.0000');
  });

  it('works out disposal gain and loss from book value', () => {
    // Cost 100,000, accumulated 70,000 → NBV 30,000; sold for 35,000 → gain 5,000.
    expect(bookValue(D('100000'), D('70000')).toFixed(4)).toBe('30000.0000');
    expect(disposalResult(D('100000'), D('70000'), D('35000')).toFixed(4)).toBe('5000.0000');
    expect(disposalResult(D('100000'), D('70000'), D('20000')).toFixed(4)).toBe('-10000.0000');
    expect(disposalResult(D('100000'), D('100000'), D('0')).toFixed(4)).toBe('0.0000');
  });
});
