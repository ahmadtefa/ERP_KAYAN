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
    item: { create: jest.fn().mockResolvedValue(item) },
    // Every new item gets a factor-1 base unit row in the same transaction.
    itemUnit: { create: jest.fn().mockResolvedValue({}) },
    stockMovement: { create: jest.fn().mockResolvedValue({}) },
    stockBalance: { upsert: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    item: { findFirst: jest.fn().mockResolvedValue(null) },
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
  const service = new ItemsService(
    prisma as any,
    { record: jest.fn().mockResolvedValue(undefined) } as any,
    accounts as any,
    posting as any,
    warehouses as any,
  );
  return { service, prisma, tx, accounts, posting, warehouses };
}

describe('ItemsService opening stock', () => {
  it('writes stock, balance and a balanced opening entry with the item', async () => {
    const { service, prisma, tx, posting } = build();

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
    expect(tx.stockBalance.upsert).toHaveBeenCalledWith({
      where: {
        companyId_branchId_itemId: {
          companyId: 'company-1',
          branchId: 'branch-1',
          itemId: 'item-1',
        },
      },
      create: expect.objectContaining({
        quantity: expect.any(Prisma.Decimal),
        value: expect.any(Prisma.Decimal),
      }),
      update: expect.objectContaining({
        quantity: { increment: expect.any(Prisma.Decimal) },
        value: { increment: expect.any(Prisma.Decimal) },
      }),
    });
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
