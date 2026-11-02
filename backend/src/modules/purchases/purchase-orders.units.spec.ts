import { Prisma } from '@prisma/client';

import { PurchaseOrdersService } from './purchase-orders.service';

const D = (v: string | number) => new Prisma.Decimal(v);
const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const ITEM = '33333333-3333-4333-8333-333333333333';

const item = {
  id: ITEM,
  code: 'MILK',
  nameEn: 'Milk',
  unit: 'علبة',
  isActive: true,
  purchasePrice: D(7),
  taxRate: D(0),
  units: [
    { id: 'u-piece', unit: 'علبة', factor: D(1), isActive: true, purchasePrice: null },
    { id: 'u-carton', unit: 'كرتونة', factor: D(10), isActive: true, purchasePrice: D(75) },
  ],
};

function makeService() {
  const tx = {
    purchaseOrder: {
      create: jest.fn(async ({ data }: { data: any }) => ({
        id: 'order-1',
        orderNumber: data.orderNumber,
        subTotal: data.subTotal,
        taxAmount: data.taxAmount,
        totalAmount: data.totalAmount,
      })),
    },
  };
  const prisma = {
    supplier: { findFirst: jest.fn(async () => ({ id: 'supplier-1', isActive: true, code: 'SUP' })) },
    item: { findFirst: jest.fn(async () => item) },
    $transaction: jest.fn(async (work: (client: unknown) => unknown) => work(tx)),
  };
  const invoices = {
    create: jest.fn(async () => ({ id: 'invoice-1' })),
  };
  const service = new PurchaseOrdersService(
    prisma as never,
    { next: jest.fn(async () => 'PO-0001') } as never,
    { get: jest.fn(async () => ({ taxRate: '0', maxDiscountPercent: '100' })) } as never,
    { resolvePrice: jest.fn(async () => null) } as never,
    invoices as never,
    { record: jest.fn(async () => undefined) } as never,
  );
  jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'order-1' } as never);
  return { service, tx, invoices };
}

describe('purchase orders with multiple units', () => {
  it('orders 5 cartons: stores 50 base pieces with the carton snapshot', async () => {
    const { service, tx } = makeService();
    await service.create(COMPANY, BRANCH, 'user-1', {
      supplierId: 'supplier-1',
      orderDate: '2026-10-27',
      lines: [{ itemId: ITEM, quantity: '5', unitName: 'كرتونة' }],
    } as any);

    const line = tx.purchaseOrder.create.mock.calls[0][0].data.lines.create[0];
    expect(line.quantity.toFixed(4)).toBe('50.0000');
    expect(line.unitQuantity.toFixed(4)).toBe('5.0000');
    expect(line.unitName).toBe('كرتونة');
    expect(line.unitFactor.toFixed(6)).toBe('10.000000');
    // 5 x 75 independent carton price.
    expect(line.unitPrice.toFixed(4)).toBe('75.0000');
    expect(line.lineTotal.toFixed(4)).toBe('375.0000');
  });

  it('converts the order to an invoice in the chosen unit so no double conversion happens', async () => {
    const { service, invoices } = makeService();
    const order = {
      id: 'order-1',
      companyId: COMPANY,
      branchId: BRANCH,
      supplierId: 'supplier-1',
      orderNumber: 'PO-0001',
      status: 'APPROVED',
      lines: [
        {
          id: 'ol-1',
          itemId: ITEM,
          description: 'Milk',
          // 5 cartons = 50 base, none invoiced yet.
          quantity: D(50),
          invoicedQuantity: D(0),
          unitPrice: D(75),
          taxRate: D(0),
          unitName: 'كرتونة',
          unitFactor: D(10),
          unitQuantity: D(5),
        },
      ],
    };
    // The service re-reads the order before converting.
    const tx = {
      purchaseOrderLine: {
        update: jest.fn(async () => ({})),
        findMany: jest.fn(async () => [
          { quantity: D(50), invoicedQuantity: D(50) },
        ]),
      },
      purchaseInvoice: { update: jest.fn(async () => ({})) },
      purchaseOrder: { update: jest.fn(async () => ({})) },
    };
    const prisma = {
      purchaseOrder: { findFirst: jest.fn(async () => order) },
      $transaction: jest.fn(async (work: (client: unknown) => unknown) => work(tx)),
    };
    (service as any).prisma = prisma;

    await service.convertToInvoice(COMPANY, BRANCH, 'user-1', 'order-1', {
      invoiceDate: '2026-10-27',
    } as any);

    const dto = (invoices.create.mock.calls as any[])[0][3];
    expect(dto.lines[0].unitName).toBe('كرتونة');
    // 50 base / factor 10 = 5 cartons handed to the invoice service.
    expect(dto.lines[0].quantity).toBe('5.0000');
    expect(dto.lines[0].unitPrice).toBe('75.0000');
  });
});
