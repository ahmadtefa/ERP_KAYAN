import { ConflictException, NotFoundException } from '@nestjs/common';
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
    expect(result.quantityPerScan).toBe('1.0000');
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
    expect(result.quantityPerScan).toBe('24.0000');
    // The unit's own price wins over the item's.
    expect(result.salePrice).toBe('220.0000');
  });

  it('returns the base prices multiplied by the unit factor when unit prices are unset', async () => {
    const { service, prisma } = build();
    const noPriceCarton = { ...carton, salePrice: null, purchasePrice: null, isActive: true };
    prisma.itemUnit.findFirst.mockResolvedValue({ ...noPriceCarton, item: { ...baseItem, units: [noPriceCarton] } });

    const result = await service.findByBarcode('company-1', '2000000000505');
    expect(result.salePrice).toBe('240.0000');
    expect(result.purchasePrice).toBe('168.0000');
    const noCost = await service.findByBarcode('company-1', '2000000000505', false);
    expect(noCost.purchasePrice).toBeNull();
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
