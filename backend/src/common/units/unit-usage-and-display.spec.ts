import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  composeQuantity,
  defaultUnitPrice,
  impliedUnitPrice,
  movementUnitSnapshot,
  priceConsistency,
  resolveUnitSelection,
  trimZeros,
} from './unit-math';

const D = (value: string | number) => new Prisma.Decimal(value);

/// The cable the whole feature is described with: metres on the shelf, reels
/// of five hundred metres in the yard.
const cable = (overrides: Partial<Record<string, unknown>> = {}) => [
  { id: 'm', unit: 'متر', factor: D(1), isActive: true, sortOrder: 0, ...overrides },
  { id: 'r', unit: 'لفة', factor: D(500), isActive: true, sortOrder: 1, ...overrides },
];

/// The milk: pieces on the shelf, cartons of twenty-four that cannot be split.
const milk = () => [
  { id: 'p', unit: 'قطعة', factor: D(1), isActive: true, allowFraction: true },
  {
    id: 'c',
    unit: 'كرتونة',
    factor: D(24),
    isActive: true,
    allowFraction: false,
    usedInSales: true,
    usedInPurchases: true,
  },
];

describe('whole units', () => {
  it('refuses half a carton when the unit says whole units only', () => {
    expect(() =>
      resolveUnitSelection({
        lineLabel: 'Line 1',
        requestedUnitName: 'كرتونة',
        enteredQuantity: D('0.5'),
        baseUnitName: 'قطعة',
        units: milk(),
      }),
    ).toThrow(/does not accept fractional quantities/);
  });

  it('accepts a whole carton', () => {
    const resolved = resolveUnitSelection({
      lineLabel: 'Line 1',
      requestedUnitName: 'كرتونة',
      enteredQuantity: D(2),
      baseUnitName: 'قطعة',
      units: milk(),
    });
    expect(resolved.baseQuantity.toFixed(4)).toBe('48.0000');
  });

  it('accepts a fraction of a unit that allows it: half a reel is 250 m', () => {
    const resolved = resolveUnitSelection({
      lineLabel: 'Line 1',
      requestedUnitName: 'لفة',
      enteredQuantity: D('0.5'),
      baseUnitName: 'متر',
      units: cable(),
    });
    expect(resolved.baseQuantity.toFixed(4)).toBe('250.0000');
  });

  it('treats a unit written before the flag existed as allowing fractions', () => {
    const units = [{ id: 'r', unit: 'لفة', factor: D(500), isActive: true }];
    const resolved = resolveUnitSelection({
      lineLabel: 'Line 1',
      requestedUnitName: 'لفة',
      enteredQuantity: D('1.5'),
      baseUnitName: 'متر',
      units,
    });
    expect(resolved.baseQuantity.toFixed(4)).toBe('750.0000');
  });
});

describe('where a unit may be used', () => {
  const units = () => [
    { id: 'p', unit: 'قطعة', factor: D(1), isActive: true },
    { id: 'b', unit: 'كرتونة', factor: D(12), isActive: true, usedInSales: false },
    { id: 's', unit: 'صندوق', factor: D(48), isActive: true, usedInPurchases: false },
  ];

  it('refuses a purchase-only unit on a sale', () => {
    expect(() =>
      resolveUnitSelection({
        lineLabel: 'Line 2',
        requestedUnitName: 'كرتونة',
        enteredQuantity: D(1),
        baseUnitName: 'قطعة',
        units: units(),
        purpose: 'sale',
      }),
    ).toThrow(/not a selling unit/);
  });

  it('allows the same unit on a purchase', () => {
    const resolved = resolveUnitSelection({
      lineLabel: 'Line 2',
      requestedUnitName: 'كرتونة',
      enteredQuantity: D(1),
      baseUnitName: 'قطعة',
      units: units(),
      purpose: 'purchase',
    });
    expect(resolved.baseQuantity.toFixed(4)).toBe('12.0000');
  });

  it('refuses a sale-only unit on a purchase', () => {
    expect(() =>
      resolveUnitSelection({
        lineLabel: 'Line 3',
        requestedUnitName: 'صندوق',
        enteredQuantity: D(1),
        baseUnitName: 'قطعة',
        units: units(),
        purpose: 'purchase',
      }),
    ).toThrow(/not a purchasing unit/);
  });

  it('still lets a stock document count goods in either of them', () => {
    for (const name of ['كرتونة', 'صندوق']) {
      const resolved = resolveUnitSelection({
        lineLabel: 'Line 4',
        requestedUnitName: name,
        enteredQuantity: D(1),
        baseUnitName: 'قطعة',
        units: units(),
        purpose: 'stock',
      });
      expect(resolved.snapshot.unitName).toBe(name);
    }
  });

  it('does not enforce usage when the caller names no purpose', () => {
    const resolved = resolveUnitSelection({
      lineLabel: 'Line 5',
      requestedUnitName: 'كرتونة',
      enteredQuantity: D(1),
      baseUnitName: 'قطعة',
      units: units(),
    });
    expect(resolved.snapshot.unitName).toBe('كرتونة');
  });
});

describe('a balance said in the item own units', () => {
  it('says 4,900 metres as 9 reels + 400 m', () => {
    expect(composeQuantity(D(4900), cable(), 'متر').text).toBe('9 لفة + 400 متر');
  });

  it('says 4,400 metres as 8 reels + 400 m', () => {
    expect(composeQuantity(D(4400), cable(), 'متر').text).toBe('8 لفة + 400 متر');
  });

  it('says 222 pieces as 9 cartons + 6 pieces', () => {
    expect(composeQuantity(D(222), milk(), 'قطعة').text).toBe('9 كرتونة + 6 قطعة');
  });

  it('leaves an exact multiple with no remainder', () => {
    const composed = composeQuantity(D(5000), cable(), 'متر');
    expect(composed.text).toBe('10 لفة');
    expect(composed.parts).toHaveLength(1);
  });

  it('shows a quantity below one reel in the base unit alone', () => {
    expect(composeQuantity(D(400), cable(), 'متر').text).toBe('400 متر');
  });

  it('shows zero rather than nothing', () => {
    expect(composeQuantity(D(0), cable(), 'متر').text).toBe('0 متر');
  });

  it('keeps the sign of a negative balance on every part', () => {
    const composed = composeQuantity(D(-600), cable(), 'متر');
    expect(composed.text).toBe('-1 لفة - 100 متر');
    expect(composed.parts.every((part) => part.quantity.startsWith('-'))).toBe(true);
  });

  it('falls back to the base unit for an item that has only that one', () => {
    expect(composeQuantity(D('12.5'), [], 'متر').text).toBe('12.5 متر');
  });

  it('uses the largest unit first when an item has several', () => {
    const units = [
      { id: 'p', unit: 'قطعة', factor: D(1), isActive: true },
      { id: 'b', unit: 'علبة', factor: D(6), isActive: true },
      { id: 'c', unit: 'كرتونة', factor: D(24), isActive: true },
    ];
    expect(composeQuantity(D(30), units, 'قطعة').text).toBe('1 كرتونة + 1 علبة');
  });

  it('ignores an inactive unit when composing a balance', () => {
    const units = [
      { id: 'm', unit: 'متر', factor: D(1), isActive: true },
      { id: 'r', unit: 'لفة', factor: D(500), isActive: false },
    ];
    expect(composeQuantity(D(4900), units, 'متر').text).toBe('4900 متر');
  });

  it('prints a quantity without a tail of zeros', () => {
    expect(trimZeros(D('400.0000'))).toBe('400');
    expect(trimZeros(D('0.5000'))).toBe('0.5');
    expect(trimZeros(D('12.2500'))).toBe('12.25');
    expect(trimZeros(D(0))).toBe('0');
  });
});

describe('prices that follow the unit', () => {
  it('sees 5,000 a reel of 500 as 10 a metre', () => {
    expect(impliedUnitPrice({ fromPrice: '5000', fromFactor: 500, toFactor: 1 }).toFixed(4)).toBe(
      '10.0000',
    );
  });

  it('sees 10 a metre as 5,000 a reel of 500', () => {
    expect(impliedUnitPrice({ fromPrice: 10, fromFactor: 1, toFactor: 500 }).toFixed(4)).toBe(
      '5000.0000',
    );
  });

  it('calls a reel of 500 at 5,000 consistent with a metre at 10', () => {
    const result = priceConsistency({
      price: '5000',
      factor: 500,
      expectedPerBaseUnit: D(10),
    });
    expect(result.perBaseUnit.toFixed(4)).toBe('10.0000');
    expect(result.consistent).toBe(true);
  });

  it('calls the same 5,000 on a reel of 400 a different price', () => {
    const result = priceConsistency({ price: '5000', factor: 400, expectedPerBaseUnit: D(10) });
    expect(result.perBaseUnit.toFixed(4)).toBe('12.5000');
    expect(result.consistent).toBe(false);
  });

  it('allows a rounding difference of one piastre', () => {
    const result = priceConsistency({ price: '3.3333', factor: 3, expectedPerBaseUnit: D('1.1111') });
    expect(result.consistent).toBe(true);
  });

  it('defaults a unit with no price of its own to the item price times its factor', () => {
    const reel = { id: 'r', unit: 'لفة', factor: D(500), isActive: true, salePrice: null };
    expect(defaultUnitPrice('sale', reel, D(10)).toFixed(4)).toBe('5000.0000');
  });

  it('prefers the price the unit itself carries', () => {
    const reel = { id: 'r', unit: 'لفة', factor: D(500), isActive: true, salePrice: D('4900') };
    expect(defaultUnitPrice('sale', reel, D(10)).toFixed(4)).toBe('4900.0000');
  });

  it('leaves the base unit at the item price', () => {
    const metre = { id: 'm', unit: 'متر', factor: D(1), isActive: true };
    expect(defaultUnitPrice('sale', metre, D(10)).toFixed(4)).toBe('10.0000');
  });

  it('prices a line that names no unit at the item price', () => {
    expect(defaultUnitPrice('sale', null, D(10)).toFixed(4)).toBe('10.0000');
  });

  it('scales a purchase price by the factor too', () => {
    const carton = { id: 'c', unit: 'كرتونة', factor: D(24), isActive: true };
    expect(defaultUnitPrice('purchase', carton, D('2.5')).toFixed(4)).toBe('60.0000');
  });
});

describe('the unit a movement was written in', () => {
  it('keeps the typed unit, quantity and frozen factor', () => {
    const snapshot = movementUnitSnapshot({
      enteredUnit: 'لفة',
      enteredQuantity: D(2),
      unitFactor: D(500),
      baseUnitName: 'متر',
      baseQuantity: D(1000),
    });
    expect(snapshot.enteredUnit).toBe('لفة');
    expect(snapshot.enteredQuantity.toFixed(4)).toBe('2.0000');
    expect(snapshot.unitFactor.toFixed(6)).toBe('500.000000');
  });

  it('writes a base-unit movement explicitly as factor one', () => {
    const snapshot = movementUnitSnapshot({
      baseUnitName: 'متر',
      baseQuantity: D('12.5'),
    });
    expect(snapshot.enteredUnit).toBe('متر');
    expect(snapshot.enteredQuantity.toFixed(4)).toBe('12.5000');
    expect(snapshot.unitFactor.toFixed(6)).toBe('1.000000');
  });

  it('never leaves the unit blank, even for an unnamed base unit', () => {
    const snapshot = movementUnitSnapshot({ baseUnitName: '   ', baseQuantity: D(1) });
    expect(snapshot.enteredUnit).toBe('unit');
  });
});

describe('precision', () => {
  it('does not drift over a chain of conversions', () => {
    const perReel = D(500);
    let base = D(0);
    for (let index = 0; index < 10; index += 1) {
      base = base.plus(D(1).mul(perReel).toDecimalPlaces(4));
    }
    base = base.minus(D(100)).minus(D(500)).plus(D(1000)).minus(D(100));
    expect(base.toFixed(4)).toBe('5300.0000');
  });

  it('converts a decimal factor exactly', () => {
    const resolved = resolveUnitSelection({
      lineLabel: 'Line 1',
      requestedUnitName: 'علبة',
      enteredQuantity: D(3),
      baseUnitName: 'قطعة',
      units: [
        { id: 'p', unit: 'قطعة', factor: D(1), isActive: true },
        { id: 'b', unit: 'علبة', factor: D('2.5'), isActive: true },
      ],
    });
    expect(resolved.baseQuantity.toFixed(4)).toBe('7.5000');
  });

  it('refuses a quantity that converts to nothing', () => {
    expect(() =>
      resolveUnitSelection({
        lineLabel: 'Line 1',
        requestedUnitName: 'لفة',
        enteredQuantity: D(0),
        baseUnitName: 'متر',
        units: cable(),
      }),
    ).toThrow(BadRequestException);
  });
});
