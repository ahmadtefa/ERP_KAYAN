import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  defaultUnitPrice,
  displayQuantity,
  displayUnitName,
  parseFactor,
  resolveUnitSelection,
  toBaseQuantity,
} from './unit-math';

const D = (value: string | number) => new Prisma.Decimal(value);

const milkUnits = [
  { id: 'u-piece', unit: 'علبة', factor: D(1), isActive: true, salePrice: D(9), purchasePrice: null },
  { id: 'u-carton', unit: 'كرتونة', factor: D(10), isActive: true, salePrice: D(97), purchasePrice: D(75) },
];

const cableUnits = [
  { id: 'u-metre', unit: 'متر', factor: D(1), isActive: true },
  { id: 'u-reel', unit: 'بكرة', factor: D(100), isActive: true, salePrice: null, purchasePrice: D(5000) },
];

describe('unit conversion arithmetic', () => {
  it('converts a large purchase unit into the base stock unit', () => {
    // 5 cartons x 10 pieces = 50 pieces added to stock
    expect(toBaseQuantity(D(5), D(10)).toFixed(4)).toBe('50.0000');
    // 2 reels x 100 metres = 200 metres
    expect(toBaseQuantity(D(2), D(100)).toFixed(4)).toBe('200.0000');
  });

  it('keeps the base unit at factor one unchanged', () => {
    expect(toBaseQuantity(D(3), D(1)).toFixed(4)).toBe('3.0000');
  });

  it('supports fractional quantities when the precision allows it', () => {
    // Half a reel = 50 metres
    expect(toBaseQuantity(D('0.5'), D(100)).toFixed(4)).toBe('50.0000');
  });

  it('rejects a zero or negative factor', () => {
    expect(() => parseFactor('0')).toThrow(BadRequestException);
    expect(() => parseFactor('-3')).toThrow(BadRequestException);
    expect(() => parseFactor('abc')).toThrow(BadRequestException);
  });
});

describe('resolveUnitSelection', () => {
  it('milk: buying 5 cartons resolves to 50 base pieces with a frozen snapshot', () => {
    const resolved = resolveUnitSelection({
      lineLabel: 'Line 1',
      requestedUnitName: 'كرتونة',
      enteredQuantity: D(5),
      baseUnitName: 'علبة',
      units: milkUnits,
    });
    expect(resolved.isLegacy).toBe(false);
    expect(resolved.snapshot.unitName).toBe('كرتونة');
    expect(resolved.snapshot.unitFactor?.toFixed(6)).toBe('10.000000');
    expect(resolved.snapshot.unitQuantity?.toFixed(4)).toBe('5.0000');
    expect(resolved.baseQuantity.toFixed(4)).toBe('50.0000');
  });

  it('milk: selling 3 base pieces keeps 3 in both views', () => {
    const resolved = resolveUnitSelection({
      lineLabel: 'Line 2',
      requestedUnitName: 'علبة',
      enteredQuantity: D(3),
      baseUnitName: 'علبة',
      units: milkUnits,
    });
    expect(resolved.baseQuantity.toFixed(4)).toBe('3.0000');
    expect(resolved.snapshot.unitQuantity?.toFixed(4)).toBe('3.0000');
    expect(resolved.snapshot.unitFactor?.toFixed(6)).toBe('1.000000');
  });

  it('milk: one sold carton becomes 10 base pieces while the snapshot still says 1 carton', () => {
    const resolved = resolveUnitSelection({
      lineLabel: 'Line 3',
      requestedUnitId: 'u-carton',
      enteredQuantity: D(1),
      baseUnitName: 'علبة',
      units: milkUnits,
    });
    expect(resolved.snapshot.unitName).toBe('كرتونة');
    expect(resolved.snapshot.unitQuantity?.toFixed(4)).toBe('1.0000');
    expect(resolved.baseQuantity.toFixed(4)).toBe('10.0000');
  });

  it('cable: half a reel resolves to 50 metres', () => {
    const resolved = resolveUnitSelection({
      lineLabel: 'Line 1',
      requestedUnitName: 'بكرة',
      enteredQuantity: D('0.5'),
      baseUnitName: 'متر',
      units: cableUnits,
    });
    expect(resolved.baseQuantity.toFixed(4)).toBe('50.0000');
    expect(resolved.snapshot.unitQuantity?.toFixed(4)).toBe('0.5000');
  });

  it('returns a legacy (null) snapshot when no unit is requested', () => {
    const resolved = resolveUnitSelection({
      lineLabel: 'Line 1',
      enteredQuantity: D(7),
      baseUnitName: 'piece',
      units: milkUnits,
    });
    expect(resolved.isLegacy).toBe(true);
    expect(resolved.snapshot.unitName).toBeNull();
    expect(resolved.snapshot.unitFactor).toBeNull();
    expect(resolved.snapshot.unitQuantity).toBeNull();
    expect(resolved.baseQuantity.toFixed(4)).toBe('7.0000');
  });

  it('accepts the item base unit by name even without an ItemUnit row', () => {
    const resolved = resolveUnitSelection({
      lineLabel: 'Line 1',
      requestedUnitName: 'piece',
      enteredQuantity: D(4),
      baseUnitName: 'piece',
      units: [],
    });
    expect(resolved.baseQuantity.toFixed(4)).toBe('4.0000');
    expect(resolved.snapshot.unitName).toBe('piece');
  });

  it('rejects an unknown unit', () => {
    expect(() =>
      resolveUnitSelection({
        lineLabel: 'Line 1',
        requestedUnitName: 'pallet',
        enteredQuantity: D(1),
        baseUnitName: 'علبة',
        units: milkUnits,
      }),
    ).toThrow(/not defined/);
  });

  it('rejects an inactive unit for a new document with a clear message', () => {
    const inactive = [{ ...milkUnits[1], isActive: false }];
    expect(() =>
      resolveUnitSelection({
        lineLabel: 'Line 1',
        requestedUnitName: 'كرتونة',
        enteredQuantity: D(1),
        baseUnitName: 'علبة',
        units: inactive,
      }),
    ).toThrow(/inactive/);
  });

  it('rejects a unit id that does not belong to the item', () => {
    expect(() =>
      resolveUnitSelection({
        lineLabel: 'Line 1',
        requestedUnitId: 'u-other',
        enteredQuantity: D(1),
        baseUnitName: 'علبة',
        units: milkUnits,
      }),
    ).toThrow(/does not belong/);
  });
});

describe('unit prices and display fallbacks', () => {
  it('uses the independent unit price when configured', () => {
    const carton = milkUnits[1];
    expect(defaultUnitPrice('sale', carton, D(9)).toFixed(4)).toBe('97.0000');
    expect(defaultUnitPrice('purchase', carton, D(8)).toFixed(4)).toBe('75.0000');
  });

  it('falls back to the item-level price when the unit has no own price', () => {
    const metre = cableUnits[0];
    expect(defaultUnitPrice('sale', metre, D(12)).toFixed(4)).toBe('12.0000');
  });

  it('a legacy line displays the stored quantity and the base unit', () => {
    const line = { unitName: null as string | null, unitQuantity: null as Prisma.Decimal | null, quantity: D(10) };
    expect(displayQuantity(line).toFixed(4)).toBe('10.0000');
    expect(displayUnitName(line, 'piece')).toBe('piece');
  });

  it('a multi-unit line displays the entered quantity, never the converted one', () => {
    const line = { unitName: 'كرتونة', unitQuantity: D(1), quantity: D(10) };
    expect(displayQuantity(line).toFixed(4)).toBe('1.0000');
    expect(displayUnitName(line, 'علبة')).toBe('كرتونة');
  });
});
