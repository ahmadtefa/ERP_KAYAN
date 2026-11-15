import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { fakeLedger } from '../../testing/stock-ledger.fake';
import { Prisma } from '@prisma/client';

import { ItemsService } from './items.service';

/**
 * The item form now saves the item and its whole packing table in one request.
 * These tests pin the two things that can go badly wrong there:
 *
 *   - a half-saved catalogue (item written, units lost), and
 *   - a base unit renamed under stock that was recorded in the old one.
 */

const baseItem = {
  id: 'item-1',
  companyId: 'company-1',
  code: 'WATER',
  nameEn: 'Water bottle',
  nameAr: 'مياه',
  unit: 'عبوة',
  barcode: null,
  salePrice: new Prisma.Decimal(0),
  purchasePrice: new Prisma.Decimal(0),
  reorderLevel: new Prisma.Decimal(0),
  taxRate: null,
  isStockTracked: true,
  isActive: true,
  categoryId: null,
  notes: null,
  countryOfOrigin: null,
  createdAt: new Date('2026-11-01T00:00:00Z'),
};

function build(options: {
  existingUnits?: Array<Record<string, unknown>>;
  history?: { movements?: number; balance?: boolean; stockLines?: number; sales?: number; purchases?: number };
  unitBarcodeClash?: Record<string, unknown> | null;
  itemBarcodeClash?: Record<string, unknown> | null;
} = {}) {
  const existingUnits = options.existingUnits ?? [];
  const history = {
    movements: 0,
    balance: false,
    stockLines: 0,
    sales: 0,
    purchases: 0,
    ...(options.history ?? {}),
  };

  const tx = {
    item: {
      create: jest.fn().mockResolvedValue(baseItem),
      // Mirror what the database does: the row comes back carrying the new
      // name, which is what the unit sync below compares against.
      update: jest.fn(async (args: any) => ({
        ...baseItem,
        ...(args?.data?.unit ? { unit: args.data.unit } : {}),
      })),
      findFirst: jest.fn().mockResolvedValue(options.itemBarcodeClash ?? null),
    },
    itemUnit: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue(existingUnits),
      findFirst: jest.fn().mockResolvedValue(options.unitBarcodeClash ?? null),
    },
    openingBalance: { findFirst: jest.fn().mockResolvedValue(null) },
    stockMovement: { create: jest.fn().mockResolvedValue({}) },
    stockBalance: { upsert: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    item: {
      update: jest.fn(async (args: any) => ({
        ...baseItem,
        ...(args?.data?.unit ? { unit: args.data.unit } : {}),
      })),
      findFirst: jest.fn(async (args: any) => {
        if (args?.where?.barcode) return options.itemBarcodeClash ?? null;
        // The item being edited; a code-uniqueness probe finds nothing.
        if (args?.where?.id) return baseItem;
        return null;
      }),
    },
    itemUnit: {
      findMany: jest.fn().mockResolvedValue(existingUnits),
      findFirst: jest.fn().mockResolvedValue(options.unitBarcodeClash ?? null),
    },
    stockMovement: { count: jest.fn().mockResolvedValue(history.movements) },
    stockBalance: {
      findFirst: jest.fn().mockResolvedValue(history.balance ? { id: 'balance-1' } : null),
    },
    stockDocumentLine: { count: jest.fn().mockResolvedValue(history.stockLines) },
    salesInvoiceLine: { count: jest.fn().mockResolvedValue(history.sales) },
    purchaseInvoiceLine: { count: jest.fn().mockResolvedValue(history.purchases) },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };

  const service = new ItemsService(
    prisma as any,
    { record: jest.fn().mockResolvedValue(undefined) } as any,
    { resolve: jest.fn().mockResolvedValue({}) } as any,
    { post: jest.fn().mockResolvedValue({ id: 'entry-1' }) } as any,
    { resolve: jest.fn().mockResolvedValue('warehouse-1') } as any,
    fakeLedger() as any,
  );
  return { service, prisma, tx };
}

/** Every row written to `item_units` in this call, in order. */
function written(tx: { itemUnit: { create: jest.Mock } }) {
  return tx.itemUnit.create.mock.calls.map((call) => call[0].data);
}

describe('ItemsService saving the packing table with the item', () => {
  it('creates the base unit and the cartons in the same transaction', async () => {
    const { service, tx, prisma } = build();

    await service.create('company-1', 'user-1', {
      code: 'WATER',
      nameEn: 'Water bottle',
      nameAr: 'مياه',
      unit: 'عبوة',
      units: [
        { unit: 'عبوة', factor: '1', salePrice: '5' },
        { unit: 'كرتونة', factor: '12', salePrice: '55', barcode: '6221234567890' },
      ],
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.item.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ unit: 'عبوة' }),
    });
    const rows = written(tx);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(
      expect.objectContaining({ unit: 'عبوة', factor: new Prisma.Decimal(1) }),
    );
    expect(rows[1]).toEqual(
      expect.objectContaining({
        unit: 'كرتونة',
        factor: new Prisma.Decimal(12),
        salePrice: new Prisma.Decimal(55),
        barcode: '6221234567890',
      }),
    );
  });

  it('takes the base unit from the single factor-1 row when no base is named', async () => {
    const { service, tx } = build();

    await service.create('company-1', 'user-1', {
      code: 'WATER',
      nameEn: 'Water bottle',
      nameAr: 'مياه',
      units: [
        { unit: 'عبوة', factor: '1' },
        { unit: 'كرتونة', factor: '12' },
      ],
    });

    expect(tx.item.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ unit: 'عبوة' }),
    });
    expect(written(tx)[0]).toEqual(expect.objectContaining({ unit: 'عبوة' }));
  });

  it('refuses a duplicate unit name before writing the item', async () => {
    const { service, prisma } = build();

    await expect(
      service.create('company-1', 'user-1', {
        code: 'WATER',
        nameEn: 'Water bottle',
        nameAr: 'مياه',
        unit: 'عبوة',
        units: [
          { unit: 'كرتونة', factor: '12' },
          { unit: 'كرتونة', factor: '24' },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a base unit whose factor is not 1', async () => {
    const { service, prisma } = build();

    await expect(
      service.create('company-1', 'user-1', {
        code: 'WATER',
        nameEn: 'Water bottle',
        nameAr: 'مياه',
        unit: 'عبوة',
        units: [{ unit: 'عبوة', factor: '12' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a unit barcode already used by another item', async () => {
    const { service, tx } = build({
      unitBarcodeClash: {
        unit: 'كرتونة',
        barcode: '6221234567890',
        item: { code: 'OTHER' },
      },
    });

    await expect(
      service.create('company-1', 'user-1', {
        code: 'WATER',
        nameEn: 'Water bottle',
        nameAr: 'مياه',
        unit: 'عبوة',
        units: [{ unit: 'كرتونة', factor: '12', barcode: '6221234567890' }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // Barcodes are checked before anything is written, so the clash leaves no
    // half-built catalogue behind either.
    expect(tx.itemUnit.create).not.toHaveBeenCalled();
  });
});

describe('ItemsService protecting a base unit that has history', () => {
  const existingUnits = [
    { id: 'unit-base', unit: 'عبوة', factor: new Prisma.Decimal(1), isActive: true, barcode: null },
    { id: 'unit-carton', unit: 'كرتونة', factor: new Prisma.Decimal(12), isActive: true, barcode: null },
  ];

  it('refuses to rename a base unit that has movements, and says why in Arabic', async () => {
    const { service, tx, prisma } = build({ existingUnits, history: { movements: 4 } });

    await expect(
      service.update('company-1', 'user-1', 'item-1', { unit: 'علبة' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.item.update).not.toHaveBeenCalled();
    expect(tx.itemUnit.update).not.toHaveBeenCalled();

    let message = '';
    try {
      await service.update('company-1', 'user-1', 'item-1', { unit: 'علبة' });
    } catch (caught) {
      message = (caught as BadRequestException).message;
    }
    expect(message).toContain('لا يمكن تغيير وحدة الأساس');
    expect(message).toContain('عبوة');
    expect(message).toContain('علبة');
  });

  it('refuses the rename when the form renames the base row inside the units table', async () => {
    const { service, prisma } = build({ existingUnits, history: { sales: 2 } });

    await expect(
      service.update('company-1', 'user-1', 'item-1', {
        units: [
          { id: 'unit-base', unit: 'علبة', factor: '1' },
          { id: 'unit-carton', unit: 'كرتونة', factor: '12' },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.item.update).not.toHaveBeenCalled();
  });

  it('still lets a carton be added to an item that has moved', async () => {
    const { service, tx } = build({ existingUnits: [existingUnits[0]], history: { movements: 9 } });

    await service.update('company-1', 'user-1', 'item-1', {
      units: [
        { id: 'unit-base', unit: 'عبوة', factor: '1' },
        { unit: 'كرتونة', factor: '12' },
      ],
    });

    expect(tx.item.create).not.toHaveBeenCalled();
    expect(written(tx)).toEqual([expect.objectContaining({ unit: 'كرتونة' })]);
  });

  it('allows the rename when the item has no history at all', async () => {
    const { service, tx } = build({ existingUnits });

    await service.update('company-1', 'user-1', 'item-1', { unit: 'علبة' });

    expect(tx.item.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: expect.objectContaining({ unit: 'علبة' }),
    });
    expect(tx.itemUnit.update).toHaveBeenCalledWith({
      where: { id: 'unit-base' },
      data: { unit: 'علبة' },
    });
  });

  it('switches off a removed unit instead of deleting it', async () => {
    const { service, tx } = build({ existingUnits });

    await service.update('company-1', 'user-1', 'item-1', {
      units: [{ id: 'unit-base', unit: 'عبوة', factor: '1' }],
    });

    expect(tx.itemUnit.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['unit-carton'] } },
      data: { isActive: false },
    });
    expect(tx.itemUnit).not.toHaveProperty('delete');
  });

  it('leaves the catalogue untouched when the request carries no units', async () => {
    const { service, tx } = build({ existingUnits });

    await service.update('company-1', 'user-1', 'item-1', { nameEn: 'Renamed' });

    expect(tx.itemUnit.findMany).not.toHaveBeenCalled();
    expect(tx.itemUnit.updateMany).not.toHaveBeenCalled();
  });
});

describe('ItemsService never wipes a column the form did not send', () => {
  const existingUnits = [
    { id: 'unit-base', unit: 'عبوة', factor: new Prisma.Decimal(1), isActive: true, barcode: null },
    {
      id: 'unit-carton',
      unit: 'كرتونة',
      factor: new Prisma.Decimal(12),
      isActive: true,
      barcode: '6220000000017',
    },
  ];

  it('leaves the stored purchase price alone when the caller cannot see costs', async () => {
    const { service, tx } = build({ existingUnits });

    // The editor hides the purchase price from this role, so the row it sends
    // has no `purchasePrice` key at all - which must mean "leave it", not
    // "clear it".
    await service.update(
      'company-1',
      'user-1',
      'item-1',
      {
        units: [
          { id: 'unit-base', unit: 'عبوة', factor: '1' },
          { id: 'unit-carton', unit: 'كرتونة', factor: '12', salePrice: '55' },
        ],
      },
      true,
      true,
    );

    const cartonWrite = tx.itemUnit.update.mock.calls
      .map((call) => call[0])
      .find((call) => call.where.id === 'unit-carton');
    expect(cartonWrite.data).not.toHaveProperty('purchasePrice');
    expect(cartonWrite.data.salePrice).toEqual(new Prisma.Decimal(55));
  });

  it('does clear a price the form explicitly emptied', async () => {
    const { service, tx } = build({ existingUnits });

    await service.update('company-1', 'user-1', 'item-1', {
      units: [
        { id: 'unit-base', unit: 'عبوة', factor: '1' },
        { id: 'unit-carton', unit: 'كرتونة', factor: '12', salePrice: '' },
      ],
    });

    const cartonWrite = tx.itemUnit.update.mock.calls
      .map((call) => call[0])
      .find((call) => call.where.id === 'unit-carton');
    expect(cartonWrite.data.salePrice).toBeNull();
  });

  it('still writes every column on a brand-new row', async () => {
    const { service, tx } = build({ existingUnits: [existingUnits[0]] });

    await service.update('company-1', 'user-1', 'item-1', {
      units: [
        { id: 'unit-base', unit: 'عبوة', factor: '1' },
        { unit: 'كرتونة', factor: '12' },
      ],
    });

    const created = tx.itemUnit.create.mock.calls[0][0].data;
    expect(created).toHaveProperty('salePrice', null);
    expect(created).toHaveProperty('purchasePrice', null);
    expect(created.allowFraction).toBe(true);
    expect(created.usedInSales).toBe(true);
  });
});

describe('ItemsService barcode permission on the packing table', () => {
  const existingUnits = [
    { id: 'unit-base', unit: 'عبوة', factor: new Prisma.Decimal(1), isActive: true, barcode: null },
    {
      id: 'unit-carton',
      unit: 'كرتونة',
      factor: new Prisma.Decimal(12),
      isActive: true,
      barcode: '6220000000017',
    },
  ];

  it('refuses a new unit barcode without inventory.barcodes.manage', async () => {
    const { service, tx } = build({ existingUnits });

    await expect(
      service.update(
        'company-1',
        'user-1',
        'item-1',
        {
          units: [
            { id: 'unit-base', unit: 'عبوة', factor: '1' },
            { id: 'unit-carton', unit: 'كرتونة', factor: '12', barcode: '6220000000099' },
          ],
        },
        true,
        false,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.itemUnit.update).not.toHaveBeenCalled();
  });

  it('lets the same form be saved when it leaves the existing codes alone', async () => {
    const { service, tx } = build({ existingUnits });

    await service.update(
      'company-1',
      'user-1',
      'item-1',
      {
        units: [
          { id: 'unit-base', unit: 'عبوة', factor: '1' },
          { id: 'unit-carton', unit: 'كرتونة', factor: '12', barcode: '6220000000017' },
        ],
      },
      true,
      false,
    );

    // The row is edited, but `barcode` is not among the fields written, so
    // the code stays exactly where it was.
    const cartonWrite = tx.itemUnit.update.mock.calls
      .map((call) => call[0])
      .find((call) => call.where.id === 'unit-carton');
    expect(cartonWrite).toBeDefined();
    expect(cartonWrite.data).not.toHaveProperty('barcode');
    expect(cartonWrite.data.factor).toEqual(new Prisma.Decimal(12));
  });
});
