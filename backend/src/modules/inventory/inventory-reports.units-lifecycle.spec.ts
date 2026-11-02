import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { InventoryReportsService } from './inventory-reports.service';

const item = { id: 'item-1', code: 'IT-1', unit: 'piece' };

const carton = {
  id: 'unit-carton',
  itemId: 'item-1',
  unit: 'carton',
  factor: new Prisma.Decimal('10'),
  barcode: null as string | null,
  salePrice: null as Prisma.Decimal | null,
  purchasePrice: null as Prisma.Decimal | null,
  isActive: true,
  createdAt: new Date('2026-10-27T00:00:00.000Z'),
};

function build(options: { referenced?: boolean; unit?: typeof carton | null } = {}) {
  const referenced = options.referenced ?? false;
  const count = jest.fn(async () => (referenced ? 1 : 0));
  const prisma = {
    item: {
      findFirst: jest.fn(async () => item),
    },
    itemUnit: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where?.id) {
          const unit = options.unit === undefined ? carton : options.unit;
          return unit ? { ...unit, item: { code: item.code } } : null;
        }
        return null;
      }),
      findMany: jest.fn(async () => [carton]),
      create: jest.fn(async ({ data }: any) => ({ id: 'unit-new', ...data })),
      update: jest.fn(async ({ data }: any) => ({ ...carton, ...data })),
      delete: jest.fn(async () => carton),
    },
    // The five document line tables unitIsReferenced() inspects.
    salesInvoiceLine: { count },
    purchaseInvoiceLine: { count },
    stockDocumentLine: { count },
    purchaseOrderLine: { count },
    salesOrderLine: { count },
  };
  const audit = { record: jest.fn(async () => undefined) };
  const settings = { get: jest.fn() };
  const service = new InventoryReportsService(prisma as any, audit as any, settings as any);
  return { service, prisma, audit, count };
}

describe('InventoryReportsService multi-unit lifecycle', () => {
  it('deactivates instead of deleting a unit a saved document references', async () => {
    const { service, prisma } = build({ referenced: true });

    const result = await service.removeUnit('company-1', 'user-1', 'item-1', 'unit-carton');

    expect(prisma.itemUnit.delete).not.toHaveBeenCalled();
    const update = prisma.itemUnit.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'unit-carton' });
    expect(update.data).toEqual({ isActive: false });
    expect((result as { deactivated: boolean }).deactivated).toBe(true);
    // The list payload now exposes the active flag and timestamp.
    expect(result.items[0]).toEqual(
      expect.objectContaining({ unit: 'carton', isActive: true, isBase: false }),
    );
  });

  it('hard-deletes a unit no document ever named', async () => {
    const { service, prisma } = build({ referenced: false });

    const result = await service.removeUnit('company-1', 'user-1', 'item-1', 'unit-carton');

    expect(prisma.itemUnit.delete).toHaveBeenCalledWith({ where: { id: 'unit-carton' } });
    expect(prisma.itemUnit.update).not.toHaveBeenCalled();
    expect((result as { deactivated: boolean }).deactivated).toBe(false);
  });

  it('deactivates and reactivates through the dedicated methods', async () => {
    const { service, prisma } = build();

    await service.deactivateUnit('company-1', 'user-1', 'item-1', 'unit-carton');
    expect(prisma.itemUnit.update).toHaveBeenLastCalledWith({
      where: { id: 'unit-carton' },
      data: { isActive: false },
    });

    await service.reactivateUnit('company-1', 'user-1', 'item-1', 'unit-carton');
    expect(prisma.itemUnit.update).toHaveBeenLastCalledWith({
      where: { id: 'unit-carton' },
      data: { isActive: true },
    });
  });

  it('never deactivates the factor-1 base unit, even by name match', async () => {
    const base = { ...carton, unit: 'piece', factor: new Prisma.Decimal(1) };
    const { service, prisma } = build({ unit: base });

    await expect(
      service.deactivateUnit('company-1', 'user-1', 'item-1', 'unit-carton'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.itemUnit.update).not.toHaveBeenCalled();
  });

  it('creates new units explicitly active', async () => {
    const { service, prisma } = build();

    await service.addUnit('company-1', 'user-1', 'item-1', {
      unit: 'carton',
      factor: '10',
    });

    expect(prisma.itemUnit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ unit: 'carton', isActive: true }),
    });
  });
});
