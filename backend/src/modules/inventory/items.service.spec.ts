import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ItemsService } from './items.service';

const item = {
  id: 'item-1',
  companyId: 'company-1',
  code: 'OPEN1',
  nameEn: 'Opening item',
  nameAr: 'صنف افتتاحي',
  unit: 'piece',
  barcode: null,
  salePrice: new Prisma.Decimal(0),
  purchasePrice: new Prisma.Decimal(0),
  reorderLevel: new Prisma.Decimal(0),
  taxRate: null,
  isStockTracked: true,
  isActive: true,
  categoryId: null,
  notes: null,
  createdAt: new Date('2026-10-19T00:00:00Z'),
};

function build() {
  const tx = {
    openingBalance: { findFirst: jest.fn().mockResolvedValue(null) },
    item: { create: jest.fn().mockResolvedValue(item), update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...item, ...data })) },
    // Every new item gets a factor-1 base unit row in the same transaction.
    itemUnit: { create: jest.fn().mockResolvedValue({}) },
    stockMovement: { create: jest.fn().mockResolvedValue({}) },
    stockBalance: { upsert: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
  itemUnit: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    item: { findFirst: jest.fn().mockResolvedValue(null) },
    stockMovement: { count: jest.fn(async () => 0) },
    stockBalance: { findFirst: jest.fn(async () => null) },
    stockDocumentLine: { count: jest.fn(async () => 0) },
    salesInvoiceLine: { count: jest.fn(async () => 0) },
    purchaseInvoiceLine: { count: jest.fn(async () => 0) },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const accounts = {
    resolve: jest.fn().mockResolvedValue({
      inventory: 'account-inventory',
      openingBalanceEquity: 'account-equity',
    }),
  };
  const posting = { post: jest.fn().mockResolvedValue({ id: 'entry-1' }) };
  const warehouses = { resolve: jest.fn().mockResolvedValue('warehouse-1') };
  const ledger = { post: jest.fn(async () => undefined), position: jest.fn(async () => ({ quantity: new Prisma.Decimal(0), value: new Prisma.Decimal(0), unitCost: new Prisma.Decimal(0) })) };
  const service = new ItemsService(
    prisma as any,
    { record: jest.fn().mockResolvedValue(undefined) } as any,
    accounts as any,
    posting as any,
    warehouses as any, ledger as any);
  return { service, prisma, tx, accounts, posting, warehouses, ledger };
}

describe('ItemsService opening stock', () => {
  it('writes stock, balance and a balanced opening entry with the item', async () => {
    const { service, prisma, tx, posting, ledger } = build();

    const created = await service.create(
      'company-1',
      'user-1',
      {
        code: 'OPEN1',
        nameEn: 'Opening item',
        nameAr: 'صنف افتتاحي',
        openingQuantity: '5',
        openingUnitCost: '10',
      },
      'branch-1',
    );

    expect(created.code).toBe('OPEN1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company-1',
        branchId: 'branch-1',
        itemId: 'item-1',
        direction: 'IN',
        quantity: expect.any(Prisma.Decimal),
        unitCost: expect.any(Prisma.Decimal),
        totalCost: expect.any(Prisma.Decimal),
        referenceType: 'ITEM_OPENING_STOCK',
      }),
    });
    const quantity = (
      tx.stockMovement.create.mock.calls[0][0].data.quantity as Prisma.Decimal
    ).toFixed(4);
    const total = (
      tx.stockMovement.create.mock.calls[0][0].data.totalCost as Prisma.Decimal
    ).toFixed(4);
    expect(quantity).toBe('5.0000');
    expect(total).toBe('50.0000');
    // The branch balance and the warehouse book are written by the ledger.
    expect(ledger.post).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        companyId: 'company-1',
        branchId: 'branch-1',
        itemId: 'item-1',
        quantity: expect.any(Prisma.Decimal),
        value: expect.any(Prisma.Decimal),
      }),
    );
    expect(((ledger.post.mock.calls[0] as unknown[])[1] as { quantity: Prisma.Decimal }).quantity.toFixed(4)).toBe('5.0000');
    expect(((ledger.post.mock.calls[0] as unknown[])[1] as { value: Prisma.Decimal }).value.toFixed(4)).toBe('50.0000');
    expect(posting.post).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        branchId: 'branch-1',
        sourceType: 'OPENING_BALANCE',
        lines: [
          expect.objectContaining({
            accountId: 'account-inventory',
            debit: expect.any(Prisma.Decimal),
          }),
          expect.objectContaining({
            accountId: 'account-equity',
            credit: expect.any(Prisma.Decimal),
          }),
        ],
      }),
    );
  });

  it('refuses half an opening stock pair before writing anything', async () => {
    const { service, prisma } = build();

    await expect(
      service.create(
        'company-1',
        'user-1',
        {
          code: 'OPEN1',
          nameEn: 'Opening item',
          nameAr: 'صنف',
          openingQuantity: '5',
        },
        'branch-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses an opening quantity on a non-stock item', async () => {
    const { service, prisma } = build();

    await expect(
      service.create(
        'company-1',
        'user-1',
        {
          code: 'SERVICE1',
          nameEn: 'Service',
          nameAr: 'خدمة',
          isStockTracked: false,
          openingQuantity: '1',
          openingUnitCost: '10',
        },
        'branch-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses to add item opening stock when the branch already has an opening document', async () => {
    const { service, tx } = build();
    tx.openingBalance.findFirst.mockResolvedValue({ documentNumber: 'OB-000001' });

    await expect(
      service.create(
        'company-1',
        'user-1',
        {
          code: 'OPEN1',
          nameEn: 'Opening item',
          nameAr: 'صنف',
          openingQuantity: '5',
          openingUnitCost: '10',
        },
        'branch-1',
      ),
    ).rejects.toThrow(/already has an opening balance \(OB-000001\)/);
    expect(tx.item.create).not.toHaveBeenCalled();
  });
});


describe('base unit preservation', () => {
  it('rejects renaming the base unit of an item that has already moved, before any write', async () => {
    const { service, prisma } = build();
    prisma.item.findFirst.mockResolvedValue(item as never);
    // A single recorded movement is enough: every stored quantity was counted
    // in the old unit, so the rename would re-read them as something else.
    prisma.stockMovement.count.mockResolvedValue(1 as never);
    await expect(service.update('company-1', 'user-1', 'item-1', { unit: 'carton' }))
      .rejects.toThrow(/cannot be renamed/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
