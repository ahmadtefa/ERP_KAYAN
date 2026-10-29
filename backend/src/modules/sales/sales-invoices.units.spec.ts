import { BadRequestException } from '@nestjs/common';
import {
  InvoiceDocumentType,
  InvoiceStatus,
  Prisma,
  StockDirection,
} from '@prisma/client';

import { SalesInvoicesService } from './sales-invoices.service';

const D = (v: string | number) => new Prisma.Decimal(v);
const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '33333333-3333-4333-8333-333333333333';
const CUSTOMER = '99999999-9999-4999-8999-999999999999';
const MILK = '77777777-7777-4777-8777-777777777777';

const milkItem = {
  id: MILK,
  code: 'MILK',
  nameEn: 'Milk',
  nameAr: 'لبن',
  taxRate: D(0),
  isActive: true,
  isStockTracked: true,
  salePrice: D(9),
  unit: 'علبة',
  units: [
    { id: 'u-piece', unit: 'علبة', factor: D(1), isActive: true, salePrice: D(9), purchasePrice: null },
    { id: 'u-carton', unit: 'كرتونة', factor: D(10), isActive: true, salePrice: D(97), purchasePrice: D(75) },
  ],
};

function makeService(itemOverride: any = milkItem) {
  const itemFind = jest.fn(async () => itemOverride);
  const tx = {
    salesInvoice: {
      create: jest.fn(async ({ data }: { data: any }) => ({
        id: 'invoice-1',
        invoiceNumber: data.invoiceNumber,
        subTotal: data.subTotal,
        taxAmount: data.taxAmount,
        totalAmount: data.totalAmount,
        costOfGoods: D(0),
      })),
      update: jest.fn(async () => ({ id: 'invoice-1' })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    salesInvoiceLine: { update: jest.fn(async () => ({})) },
    item: { findFirst: itemFind },
    stockMovement: { create: jest.fn(async () => ({})) },
    stockBalance: { update: jest.fn(async () => ({})) },
    $queryRaw: jest.fn(async () => [{ quantity: D(50), value: D(375) }]),
  };

  const prisma = {
    customer: { findFirst: jest.fn(async () => ({ id: CUSTOMER, nameEn: 'Cust', isActive: true })) },
    item: { findFirst: itemFind },
    costCenter: { findFirst: jest.fn() },
    salesInvoice: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(async (work: (client: unknown) => unknown) => work(tx)),
  };

  const numbers = { next: jest.fn(async () => 'SI-0001') };
  const posting = { post: jest.fn(async () => ({ id: 'je-1', entryNumber: 'JV-1' })) };
  const accounts = { resolve: jest.fn(async () => ({})) };
  const settings = {
    get: jest.fn(async () => ({
      taxRate: '0.0000',
      maxDiscountPercent: '100.0000',
      pricesIncludeTax: false,
    })),
  };
  // The warehouse-level guard itself is covered in warehouse-guard.spec.ts and
  // stock-documents.warehouse-guard.spec.ts; this suite stays focused on units.
  const warehouses = {
    resolve: jest.fn(async () => 'warehouse-1'),
    assertWarehouseAvailable: jest.fn().mockResolvedValue(undefined),
  };
  const prices = { resolvePrice: jest.fn(async () => null) };
  const audit = { record: jest.fn(async () => undefined) };

  const service = new SalesInvoicesService(
    prisma as never,
    numbers as never,
    posting as never,
    accounts as never,
    settings as never,
    warehouses as never,
    prices as never,
    audit as never,
  );
  jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'invoice-1' } as never);

  return { service, prisma, tx, prices, posting, warehouses };
}

const baseDto = {
  invoiceDate: '2026-10-27',
  customerId: CUSTOMER,
  lines: [] as any[],
};

describe('Sales multi-unit — milk scenario', () => {
  it('sells 3 pieces: base qty 3 at 9 each, line total 27', async () => {
    const { service, tx } = makeService();
    await service.create(COMPANY, BRANCH, 'user-1', {
      ...baseDto,
      lines: [{ itemId: MILK, quantity: '3', unitName: 'علبة' }],
    } as any);
    const line = tx.salesInvoice.create.mock.calls[0][0].data.lines.create[0];
    expect(line.unitPrice.toFixed(4)).toBe('9.0000');
    expect(line.quantity.toFixed(4)).toBe('3.0000');
    expect(line.unitQuantity.toFixed(4)).toBe('3.0000');
    expect(line.grossLineTotal.toFixed(4)).toBe('27.0000');
    expect(line.unitName).toBe('علبة');
    expect(line.unitFactor.toFixed(6)).toBe('1.000000');
  });

  it('sells ONE carton at 97: shows 1 carton but stock moves 10 pieces — never 10 cartons', async () => {
    const { service, tx } = makeService();
    await service.create(COMPANY, BRANCH, 'user-1', {
      ...baseDto,
      lines: [{ itemId: MILK, quantity: '1', unitName: 'كرتونة' }],
    } as any);
    const line = tx.salesInvoice.create.mock.calls[0][0].data.lines.create[0];
    // Independent carton price, independent of 10 x piece price.
    expect(line.unitPrice.toFixed(4)).toBe('97.0000');
    // Money is entered qty (1) x carton price (97) = 97, not 10 x 97.
    expect(line.grossLineTotal.toFixed(4)).toBe('97.0000');
    expect(line.lineTotal.toFixed(4)).toBe('97.0000');
    // Display snapshot stays exactly what the user typed.
    expect(line.unitName).toBe('كرتونة');
    expect(line.unitQuantity.toFixed(4)).toBe('1.0000');
    expect(line.unitFactor.toFixed(6)).toBe('10.000000');
    // Internal stock quantity is 10 base pieces.
    expect(line.quantity.toFixed(4)).toBe('10.0000');
  });

  it('posts both lines: exactly two OUT movements of 3 and 10 base pieces at average cost, never doubled', async () => {
    const { service, prisma, tx } = makeService();
    await service.create(COMPANY, BRANCH, 'user-1', {
      ...baseDto,
      lines: [
        { itemId: MILK, quantity: '3', unitName: 'علبة' },
        { itemId: MILK, quantity: '1', unitName: 'كرتونة' },
      ],
    } as any);

    // Build the posted invoice from the lines create() stored, with ids + item.
    const stored = tx.salesInvoice.create.mock.calls[0][0].data.lines.create.map(
      (l: any, i: number) => ({ ...l, id: `line-${i}`, itemId: MILK }),
    );

    (prisma.salesInvoice.findFirst as jest.Mock).mockResolvedValue({
      id: 'invoice-1',
      companyId: COMPANY,
      branchId: BRANCH,
      invoiceNumber: 'SI-0001',
      invoiceDate: new Date('2026-10-27T00:00:00Z'),
      status: InvoiceStatus.DRAFT,
      documentType: InvoiceDocumentType.INVOICE,
      warehouseId: null,
      customer: { code: 'C-1', nameEn: 'Cust' },
      totalAmount: D(124),
      taxAmount: D(0),
      lines: stored,
    });
    await service.post(COMPANY, 'user-1', 'invoice-1');

    // Two lines -> exactly two stock OUT movements (one per line), not four.
    const outMoves = tx.stockMovement.create.mock.calls.map((c: any) => c[0].data);
    expect(outMoves).toHaveLength(2);
    expect(outMoves.every((m: any) => m.direction === StockDirection.OUT)).toBe(true);
    expect(outMoves.map((m: any) => m.quantity.toFixed(4))).toEqual(['3.0000', '10.0000']);
    // Average cost 375 / 50 = 7.5 per piece.
    expect(outMoves.map((m: any) => m.totalCost.toFixed(4))).toEqual(['22.5000', '75.0000']);
    // Two balance decrements matching the same base quantities (no double movement).
    const decrements = tx.stockBalance.update.mock.calls.map((c: any) =>
      c[0].data.quantity.decrement.toFixed(4),
    );
    expect(decrements).toEqual(['3.0000', '10.0000']);
  });
});

describe('Sales unit validation and legacy behaviour', () => {
  it('rejects an inactive unit on a new document', async () => {
    const { service } = makeService({
      ...milkItem,
      units: [milkItem.units[0], { ...milkItem.units[1], isActive: false }],
    });
    await expect(
      service.create(COMPANY, BRANCH, 'user-1', {
        ...baseDto,
        lines: [{ itemId: MILK, quantity: '1', unitName: 'كرتونة' }],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown unit', async () => {
    const { service } = makeService();
    await expect(
      service.create(COMPANY, BRANCH, 'user-1', {
        ...baseDto,
        lines: [{ itemId: MILK, quantity: '1', unitName: 'بالته' }],
      } as any),
    ).rejects.toThrow(/not defined/);
  });

  it('a legacy line with no unit stores a null snapshot and keeps quantity as entered', async () => {
    const { service, tx } = makeService();
    await service.create(COMPANY, BRANCH, 'user-1', {
      ...baseDto,
      lines: [{ itemId: MILK, quantity: '5', unitPrice: '9' }],
    } as any);
    const line = tx.salesInvoice.create.mock.calls[0][0].data.lines.create[0];
    expect(line.quantity.toFixed(4)).toBe('5.0000');
    expect(line.unitName).toBeNull();
    expect(line.unitFactor).toBeNull();
    expect(line.unitQuantity).toBeNull();
    expect(line.grossLineTotal.toFixed(4)).toBe('45.0000');
  });
});
