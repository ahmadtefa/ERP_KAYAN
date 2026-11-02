import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { InventoryReportsService } from './inventory-reports.service';

const item = { id: 'item-1', code: 'IT-1', unit: 'piece' };

const carton = {
  id: 'unit-carton',
  itemId: 'item-1',
  unit: 'carton',
  factor: new Prisma.Decimal('24'),
  barcode: null as string | null,
  salePrice: null as Prisma.Decimal | null,
  purchasePrice: null as Prisma.Decimal | null,
  isActive: true,
  createdAt: new Date('2026-10-27T00:00:00.000Z'),
};

/// The service asks the database three different questions - "which item is
/// this", "which unit of this item", "is this code taken" - so the fake answers
/// by the shape of the where clause rather than by call order. Order-based
/// mocks hide exactly the mistakes these tests are meant to catch.
function build(options: {
  unit?: typeof carton | null;
  itemBarcodeOwner?: { code: string } | null;
  unitBarcodeOwner?: { unit: string; item: { code: string } } | null;
  siblingUnit?: { id: string } | null;
} = {}) {
  const prisma = {
    item: {
      findFirst: jest.fn(async ({ where }: any) =>
        where?.barcode ? options.itemBarcodeOwner ?? null : item,
      ),
    },
    itemUnit: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where?.barcode) return options.unitBarcodeOwner ?? null;
        if (where?.unit) return options.siblingUnit ?? null;
        if (where?.id) {
          const unit = options.unit === undefined ? carton : options.unit;
          if (!unit) return null;
          // assignUnitBarcode and listUnits read the owning item's code.
          return where.item ? { ...unit, item: { code: item.code } } : unit;
        }
        return null;
      }),
      findMany: jest.fn().mockResolvedValue([carton]),
      create: jest.fn().mockResolvedValue(carton),
      update: jest.fn().mockResolvedValue(carton),
      delete: jest.fn().mockResolvedValue(carton),
    },
    // removeUnit() now checks document snapshots before deleting; these
    // fixtures have no references, so every count answers zero.
    salesInvoiceLine: { count: jest.fn(async () => 0) },
    purchaseInvoiceLine: { count: jest.fn(async () => 0) },
    stockDocumentLine: { count: jest.fn(async () => 0) },
    purchaseOrderLine: { count: jest.fn(async () => 0) },
    salesOrderLine: { count: jest.fn(async () => 0) },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const settings = { get: jest.fn() };
  const service = new InventoryReportsService(prisma as any, audit as any, settings as any);
  return { service, prisma, audit };
}

describe('InventoryReportsService unit management', () => {
  it('adds a unit with its own factor and reports it back', async () => {
    const { service, prisma } = build();

    const result = await service.addUnit('company-1', 'user-1', 'item-1', {
      unit: 'carton',
      factor: '24',
    });

    expect(prisma.itemUnit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ unit: 'carton' }),
    });
    expect(result.items[0]).toEqual(
      expect.objectContaining({ unit: 'carton', factor: '24.000000', isBase: false }),
    );
  });

  it('refuses a factor other than 1 on the base unit', async () => {
    const { service } = build();

    await expect(
      service.addUnit('company-1', 'user-1', 'item-1', { unit: 'piece', factor: '12' }),
    ).rejects.toThrow(/factor must be 1/);
  });

  it('refuses a barcode that an item in the same company already uses', async () => {
    const { service } = build({ itemBarcodeOwner: { code: 'IT-2' } });

    await expect(
      service.addUnit('company-1', 'user-1', 'item-1', {
        unit: 'carton',
        factor: '24',
        barcode: '2000000000423',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('renames a unit and converts its prices', async () => {
    const { service, prisma } = build();
    prisma.itemUnit.update.mockResolvedValue({ ...carton, unit: 'box' });
    prisma.itemUnit.findMany.mockResolvedValue([{ ...carton, unit: 'box' }]);

    const result = await service.updateUnit('company-1', 'user-1', 'item-1', 'unit-carton', {
      unit: 'box',
      factor: '12',
      salePrice: '110',
    });

    expect(prisma.itemUnit.update).toHaveBeenCalledWith({
      where: { id: 'unit-carton' },
      data: expect.objectContaining({
        unit: 'box',
        factor: expect.any(Prisma.Decimal),
        salePrice: expect.any(Prisma.Decimal),
      }),
    });
    expect(result.items[0].unit).toBe('box');
  });

  it('refuses a second unit with the same name', async () => {
    const { service } = build({ siblingUnit: { id: 'unit-box' } });

    await expect(
      service.updateUnit('company-1', 'user-1', 'item-1', 'unit-carton', { unit: 'box' }),
    ).rejects.toThrow(/already has a unit called box/);
  });

  it('refuses to change the base unit name or factor', async () => {
    const base = { ...carton, unit: 'piece', factor: new Prisma.Decimal(1) };
    const { service } = build({ unit: base });

    await expect(
      service.updateUnit('company-1', 'user-1', 'item-1', 'unit-carton', { unit: 'each' }),
    ).rejects.toThrow(/base unit/);
    await expect(
      service.updateUnit('company-1', 'user-1', 'item-1', 'unit-carton', { factor: '10' }),
    ).rejects.toThrow(/factor must be 1/);
  });

  it('refuses a barcode that a unit of another item already uses', async () => {
    const { service } = build({ unitBarcodeOwner: { unit: 'box', item: { code: 'IT-3' } } });

    await expect(
      service.updateUnit('company-1', 'user-1', 'item-1', 'unit-carton', { barcode: '2000000000999' }),
    ).rejects.toThrow(/already assigned to unit box of item IT-3/);
  });

  it('removes a non-base unit but never the base unit', async () => {
    const { service, prisma } = build();

    await service.removeUnit('company-1', 'user-1', 'item-1', 'unit-carton');
    expect(prisma.itemUnit.delete).toHaveBeenCalledWith({ where: { id: 'unit-carton' } });

    const base = { ...carton, unit: 'piece', factor: new Prisma.Decimal(1) };
    const second = build({ unit: base });
    await expect(
      second.service.removeUnit('company-1', 'user-1', 'item-1', 'unit-carton'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('says so when the unit does not belong to the item', async () => {
    const { service } = build({ unit: null });

    await expect(
      service.updateUnit('company-1', 'user-1', 'item-1', 'nope', { factor: '5' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('generates a readable internal code for a unit and audits it', async () => {
    const { service, prisma, audit } = build();

    await service.assignUnitBarcode('company-1', 'user-1', 'item-1', 'unit-carton', null);

    const update = prisma.itemUnit.update.mock.calls[0][0];
    expect(update.data.barcode).toMatch(/^200\d{10}$/);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'item_units', entityId: 'unit-carton' }),
    );
  });
});
