import { Prisma } from '@prisma/client';
import { SalesOrdersService } from './sales-orders.service';

const D = (value: number) => new Prisma.Decimal(value);

describe('sales order prices and tax', () => {
  it('uses customer pricing and distinguishes cleared and omitted tax', async () => {
    const orderCreate = jest.fn(async ({ data }: { data: any }) => ({
      id: 'order', orderNumber: data.orderNumber, totalAmount: data.totalAmount,
    }));
    const prisma = {
      customer: { findFirst: jest.fn(async () => ({ id: 'customer', code: 'C', isActive: true })) },
      item: { findFirst: jest.fn(async () => ({ id: 'item', code: 'I', nameEn: 'Item', unit: 'piece',
        isActive: true, salePrice: D(9), taxRate: D(14), units: [] })) },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({ salesOrder: { create: orderCreate } })),
    };
    const prices = { resolvePrice: jest.fn(async () => ({ price: D(20) })) };
    const service = new SalesOrdersService(prisma as never, { next: async () => 'SO-1' } as never,
      { get: async () => ({ taxRate: '14' }) } as never, prices as never, {} as never,
      { record: async () => {} } as never);
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'order' } as never);
    await service.create('company', 'branch', 'user', { customerId: 'customer', orderDate: '2026-01-01',
      lines: [
        { itemId: 'item', quantity: '1', taxRate: '  ' },
        { itemId: 'item', quantity: '1', taxRate: null },
        { itemId: 'item', quantity: '1' },
      ],
    });
    expect(prices.resolvePrice).toHaveBeenCalledWith(prisma, 'company', expect.objectContaining({
      partyId: 'customer', partyKind: 'CUSTOMER', itemId: 'item', unit: 'piece',
    }));
    const lines = orderCreate.mock.calls[0][0].data.lines.create;
    expect(lines.map((line: any) => line.taxRate.toFixed(4))).toEqual(['0.0000', '0.0000', '14.0000']);
    expect(lines.map((line: any) => line.unitPrice.toFixed(4))).toEqual(['20.0000', '20.0000', '20.0000']);
  });
});
