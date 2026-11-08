import { ConflictException, NotFoundException } from '@nestjs/common';
import { fakeLedger } from '../../testing/stock-ledger.fake';
import { Prisma } from '@prisma/client';

import { ItemsService } from './items.service';

const baseItem = {
  id: 'item-1',
  companyId: 'company-1',
  code: 'IT-1',
  nameEn: 'Sugar',
  nameAr: 'سكر',
  unit: 'piece',
  barcode: '2000000000423',
  salePrice: new Prisma.Decimal('10.0000'),
  purchasePrice: new Prisma.Decimal('7.0000'),
  reorderLevel: new Prisma.Decimal(0),
  taxRate: null,
  isStockTracked: true,
  isActive: true,
  categoryId: null,
  notes: null,
  createdAt: new Date('2026-10-27T00:00:00Z'),
  units: [],
};

const carton = {
  id: 'unit-carton',
  unit: 'carton',
  factor: new Prisma.Decimal('24'),
  barcode: '2000000000505',
  salePrice: new Prisma.Decimal('220.0000'),
  purchasePrice: new Prisma.Decimal('160.0000'),
};

function build() {
  const prisma = {
    item: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
      create: jest.fn(),
    },
    itemUnit: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ItemsService(
    prisma as any,
    audit as any,
    {} as any,
    {} as any,
    {} as any,
    fakeLedger() as any,
  );
  return { service, prisma, audit };
}

describe('ItemsService barcode lookup', () => {
  it('resolves an item barcode to the item itself, one base unit per scan', async () => {
    const { service, prisma } = build();
    prisma.item.findFirst.mockResolvedValue({ ...baseItem, units: [carton] });

    const result = await service.findByBarcode('company-1', '2000000000423');

    expect(result.matched).toBe('item');
    expect(result.unit).toBe('piece');
    expect(result.factor).toBe('1.000000');
    // A whole base unit per scan is exact at both the ledger scale and the
    // six-decimal unit factor, so it never needs rounding to be tellable.
    expect(result.quantityPerScan).toBe('1.000000');
    expect(result.quantityPerScanFitsLedgerScale).toBe(true);
    expect(result.item.code).toBe('IT-1');
    expect(result.units.map((unit: { unit: string }) => unit.unit)).toEqual(['carton']);
  });

  it('resolves a unit barcode to that unit and its saved factor', async () => {
    const { service, prisma } = build();
    prisma.item.findFirst.mockResolvedValue(null);
    prisma.itemUnit.findFirst.mockResolvedValue({ ...carton, item: { ...baseItem, units: [carton] } });

    const result = await service.findByBarcode('company-1', '2000000000505');

    expect(result.matched).toBe('unit');
    expect(result.unit).toBe('carton');
    expect(result.factor).toBe('24.000000');
    // One scan of a carton is 24 base units, taken from the saved factor.
    // The exact factor is returned unrounded: a 1.000000-factor scale (three
    // decimal places) could not hold e.g. a 1/3 case, and the caller has to
    // know that before it posts a document rather than lose stock silently.
    expect(result.quantityPerScan).toBe('24.000000');
    expect(result.quantityPerScanFitsLedgerScale).toBe(true);
    // The unit's own price wins over the item's.
    expect(result.salePrice).toBe('220.0000');
  });

  it('flags a scanned unit whose factor cannot be held by the ledger scale', async () => {
    const { service, prisma } = build();
    const thirdOfCarton = {
      ...carton,
      id: 'unit-third',
      unit: 'third',
      barcode: '2000000000777',
      // 1/3 of a base unit per scan: cannot be expressed at 4 decimal places.
      factor: new Prisma.Decimal('0.333333'),
    };
    prisma.item.findFirst.mockResolvedValue(null);
    prisma.itemUnit.findFirst.mockResolvedValue({
      ...thirdOfCarton,
      item: { ...baseItem, units: [thirdOfCarton] },
    });

    const result = await service.findByBarcode('company-1', '2000000000777');

    // The exact factor is still reported, so nothing is silently rounded...
    expect(result.factor).toBe('0.333333');
    expect(result.quantityPerScan).toBe('0.333333');
    // ...and the flag tells the caller one scan cannot be posted exactly.
    expect(result.quantityPerScanFitsLedgerScale).toBe(false);
  });

  it('says so when no item or unit carries the code', async () => {
    const { service, prisma } = build();
    prisma.item.findFirst.mockResolvedValue(null);
    prisma.itemUnit.findFirst.mockResolvedValue(null);

    await expect(service.findByBarcode('company-1', '999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('withholds the cost from a caller who may not read it', async () => {
    const { service, prisma } = build();
    prisma.item.findFirst.mockResolvedValue({ ...baseItem, units: [carton] });

    const result = await service.findByBarcode('company-1', '2000000000423', false);

    expect(result.purchasePrice).toBeNull();
    expect((result.item as { purchasePrice: unknown }).purchasePrice).toBeNull();
    // The selling price is a different figure and stays.
    expect(result.salePrice).toBe('10.0000');
  });

  it('requires a code', async () => {
    const { service } = build();
    await expect(service.findByBarcode('company-1', '   ')).rejects.toThrow(/required/);
  });
});

describe('ItemsService barcode assignment', () => {
  it('refuses a manual code another item already uses', async () => {
    const { service, prisma } = build();
    prisma.item.findFirst
      .mockResolvedValueOnce({ id: 'item-1', code: 'IT-1', barcode: null })
      .mockResolvedValueOnce({ code: 'IT-2' });
    prisma.itemUnit.findFirst.mockResolvedValue(null);

    await expect(
      service.assignBarcode('company-1', 'user-1', 'item-1', '123456'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a manual code that belongs to a unit of the same item', async () => {
    const { service, prisma } = build();
    prisma.item.findFirst
      .mockResolvedValueOnce({ id: 'item-1', code: 'IT-1', barcode: null })
      .mockResolvedValueOnce(null);
    prisma.itemUnit.findFirst.mockResolvedValue({
      id: 'unit-carton',
      unit: 'carton',
      item: { code: 'IT-1' },
    });

    await expect(
      service.assignBarcode('company-1', 'user-1', 'item-1', '2000000000505'),
    ).rejects.toThrow(/already assigned to unit carton/);
  });

  it('generates an internal code when none is supplied, and audits the change', async () => {
    const { service, prisma, audit } = build();
    prisma.item.findFirst
      .mockResolvedValueOnce({ id: 'item-1', code: 'IT-1', barcode: null })
      .mockResolvedValue(null);
    prisma.itemUnit.findFirst.mockResolvedValue(null);
    prisma.item.update.mockImplementation(async ({ data }: any) => ({
      ...baseItem,
      barcode: data.barcode,
      units: [],
    }));

    const result = await service.assignBarcode('company-1', 'user-1', 'item-1', null);

    const assigned = (result as { barcode: string }).barcode;
    expect(assigned).toMatch(/^200\d{10}$/);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'items', entityId: 'item-1' }),
    );
  });
});

describe('ItemsService cost exposure', () => {
  it('lists items without the cost for a caller without the cost permission', async () => {
    const { service, prisma } = build();
    prisma.$transaction.mockResolvedValue([[baseItem], 1]);

    const result = await service.findAll('company-1', {}, false);

    expect((result.items[0] as { purchasePrice: unknown }).purchasePrice).toBeNull();
    expect(result.items[0].salePrice).toBe('10.0000');
  });

  it('keeps the cost for a caller who may read it', async () => {
    const { service, prisma } = build();
    prisma.$transaction.mockResolvedValue([[baseItem], 1]);

    const result = await service.findAll('company-1', {});

    expect(result.items[0].purchasePrice).toBe('7.0000');
  });
});
