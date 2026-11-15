import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { parseUnitRows, planUnitChanges } from './unit-input';

/**
 * The rules behind the units section of the item form.
 *
 * These are pure decisions, so they are pinned here: what a valid unit row is,
 * which existing row a form row edits, and - the part that protects history -
 * that a row leaving the form is switched off rather than deleted.
 */
describe('parseUnitRows', () => {
  const base = 'عبوة';

  it('accepts the base unit and any number of packing units', () => {
    const rows = parseUnitRows(
      [
        { unit: 'عبوة', factor: '1' },
        { unit: 'باكت', factor: '6' },
        { unit: 'كرتونة', factor: '12' },
        { unit: 'دستة', factor: '12', allowFraction: false },
      ],
      base,
    );

    expect(rows).not.toBeNull();
    expect(rows!.map((row) => row.unit)).toEqual(['عبوة', 'باكت', 'كرتونة', 'دستة']);
    expect(rows!.map((row) => row.factor.toFixed(0))).toEqual(['1', '6', '12', '12']);
    expect(rows![3].allowFraction).toBe(false);
    // The default is "a fraction of this unit is real" only when not stated.
    expect(rows![1].allowFraction).toBe(true);
  });

  it('defaults the base row factor to 1 and refuses any other factor for it', () => {
    const rows = parseUnitRows([{ unit: 'عبوة' }], base);
    expect(rows![0].factor.toFixed(6)).toBe('1.000000');

    expect(() => parseUnitRows([{ unit: 'عبوة', factor: '12' }], base)).toThrow(
      BadRequestException,
    );
    expect(() => parseUnitRows([{ unit: 'عبوة', factor: '12' }], base)).toThrow(
      /1/,
    );
  });

  it('refuses a duplicate name inside one item, whatever its capitalisation', () => {
    expect(() =>
      parseUnitRows(
        [
          { unit: 'كرتونة', factor: '12' },
          { unit: 'كرتونة', factor: '24' },
        ],
        base,
      ),
    ).toThrow(/مكررة|twice/);

    expect(() =>
      parseUnitRows(
        [
          { unit: 'Carton', factor: '12' },
          { unit: 'carton', factor: '24' },
        ],
        base,
      ),
    ).toThrow(BadRequestException);
  });

  it('refuses an empty name, an unreadable factor, zero and a negative factor', () => {
    expect(() => parseUnitRows([{ unit: '  ', factor: '6' }], base)).toThrow();
    expect(() => parseUnitRows([{ unit: 'باكت', factor: 'six' }], base)).toThrow();
    expect(() => parseUnitRows([{ unit: 'باكت', factor: '0' }], base)).toThrow();
    expect(() => parseUnitRows([{ unit: 'باكت', factor: '-6' }], base)).toThrow();
  });

  it('keeps prices per unit, and leaves them empty when not given', () => {
    const rows = parseUnitRows(
      [
        { unit: 'عبوة', factor: '1', salePrice: '5', purchasePrice: '3.5' },
        { unit: 'كرتونة', factor: '12', salePrice: '60' },
      ],
      base,
    );

    expect(rows![0].salePrice!.toFixed(2)).toBe('5.00');
    expect(rows![0].purchasePrice!.toFixed(2)).toBe('3.50');
    expect(rows![1].salePrice!.toFixed(2)).toBe('60.00');
    // No purchase price typed means "work it out from the factor", which the
    // client does; the row must not pretend it is zero.
    expect(rows![1].purchasePrice).toBeNull();
  });

  it('refuses a negative price', () => {
    expect(() =>
      parseUnitRows([{ unit: 'كرتونة', factor: '12', salePrice: '-1' }], base),
    ).toThrow(BadRequestException);
  });

  it('carries each unit its own barcode', () => {
    const rows = parseUnitRows(
      [
        { unit: 'عبوة', factor: '1', barcode: '2000000000010' },
        { unit: 'كرتونة', factor: '12', barcode: '' },
      ],
      base,
    );
    expect(rows![0].barcode).toBe('2000000000010');
    expect(rows![1].barcode).toBeNull();
  });

  it('returns null when the request says nothing about units', () => {
    // "No units key" means leave the catalogue alone; an empty list means the
    // form showed none. Conflating them would switch a catalogue off by
    // omission.
    expect(parseUnitRows(undefined, base)).toBeNull();
    expect(parseUnitRows([], base)).toEqual([]);
  });
});

describe('planUnitChanges', () => {
  const existing = [
    { id: 'u-base', unit: 'عبوة', factor: new Prisma.Decimal(1), isActive: true },
    { id: 'u-carton', unit: 'كرتونة', factor: new Prisma.Decimal(12), isActive: true },
  ];

  it('creates the base row for an item that has none (imported items)', () => {
    const plan = planUnitChanges({
      baseUnit: 'عبوة',
      rows: [{ unit: 'كرتونة', factor: new Prisma.Decimal(12) } as never],
      existing: [],
    });

    expect(plan!.createBase).toBe(true);
    expect(plan!.creates).toHaveLength(1);
    expect(plan!.creates[0].unit).toBe('كرتونة');
  });

  it('renames the base row without touching its barcode or prices', () => {
    const plan = planUnitChanges({
      baseUnit: 'قطعة',
      rows: [{ unit: 'قطعة', factor: new Prisma.Decimal(1) } as never],
      existing: [{ id: 'u-base', unit: 'عبوة', factor: new Prisma.Decimal(1) }],
    });

    // The rename is a name-only change: the row is matched, not re-created.
    expect(plan!.updates).toHaveLength(1);
    expect(plan!.updates[0].id).toBe('u-base');
    expect(plan!.deactivateIds).toEqual([]);
    expect(plan!.createBase).toBe(false);
  });

  it('switches off a unit that left the form instead of deleting it', () => {
    const plan = planUnitChanges({
      baseUnit: 'عبوة',
      rows: [
        { unit: 'عبوة', factor: new Prisma.Decimal(1) } as never,
        { unit: 'باكت', factor: new Prisma.Decimal(6) } as never,
      ],
      existing,
    });

    expect(plan!.deactivateIds).toEqual(['u-carton']);
    expect(plan!.creates.map((row) => row.unit)).toEqual(['باكت']);
  });

  it('matches an existing row by name when the form sends no id', () => {
    const plan = planUnitChanges({
      baseUnit: 'عبوة',
      rows: [
        { unit: 'عبوة', factor: new Prisma.Decimal(1) } as never,
        { unit: 'كرتونة', factor: new Prisma.Decimal(24) } as never,
      ],
      existing,
    });

    expect(plan!.creates).toHaveLength(0);
    const carton = plan!.updates.find((entry) => entry.id === 'u-carton');
    expect(carton!.row.factor.toFixed(0)).toBe('24');
  });

  it('leaves everything alone when the request carried no units key', () => {
    expect(
      planUnitChanges({ baseUnit: 'عبوة', rows: null, existing }),
    ).toBeNull();
  });

  it('does not switch off a row that was already inactive', () => {
    const plan = planUnitChanges({
      baseUnit: 'عبوة',
      rows: [{ unit: 'عبوة', factor: new Prisma.Decimal(1) } as never],
      existing: [
        ...existing,
        { id: 'u-old', unit: 'لفة', factor: new Prisma.Decimal(500), isActive: false },
      ],
    });
    expect(plan!.deactivateIds).toEqual(['u-carton']);
  });
});
