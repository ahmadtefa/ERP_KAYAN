import { BadRequestException } from '@nestjs/common';
import {
  InvoiceDocumentType,
  InvoiceStatus,
  Prisma,
  StockDirection,
} from '@prisma/client';

import { PurchaseInvoicesService } from './purchase-invoices.service';

const D = (v: string | number) => new Prisma.Decimal(v);
const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const SUPPLIER = '33333333-3333-4333-8333-333333333333';
const MILK = '44444444-4444-4444-8444-444444444444';
const CABLE = '55555555-5555-4555-8555-555555555555';

const milkItem = {
  id: MILK,
  code: 'MILK',
  nameEn: 'Milk',
  nameAr: 'لبن',
  taxRate: D(0),
  isActive: true,
  isStockTracked: true,
  purchasePrice: D(7),
  unit: 'علبة',
  units: [
    { id: 'u-piece', unit: 'علبة', factor: D(1), isActive: true, purchasePrice: null, salePrice: D(9) },
    { id: 'u-carton', unit: 'كرتونة', factor: D(10), isActive: true, purchasePrice: D(75), salePrice: D(97) },
  ],
};

const cableItem = {
  id: CABLE,
  code: 'CABLE',
  nameEn: 'Cable',
  nameAr: 'كابل',
  taxRate: D(0),
  isActive: true,
  isStockTracked: true,
  purchasePrice: D(20),
  unit: 'متر',
  units: [
    { id: 'u-metre', unit: 'متر', factor: D(1), isActive: true, purchasePrice: null },
    { id: 'u-reel', unit: 'بكرة', factor: D(100), isActive: true, purchasePrice: D(5000) },
  ],
};

function makeService(itemOverrides: Record<string, any> = {}) {
  const items: Record<string, any> = { [MILK]: milkItem, [CABLE]: cableItem, ...itemOverrides };
  const itemFind = jest.fn(async ({ where }: { where: { id: string } }) => items[where.id] ?? null);

  const detail: any = {
    id: 'invoice-1',
    companyId: COMPANY,
    branchId: BRANCH,
    invoiceNumber: 'PI-0001',
    invoiceDate: new Date('2026-10-27T00:00:00Z'),
    dueDate: null,
    status: InvoiceStatus.DRAFT,
    documentType: InvoiceDocumentType.INVOICE,
    supplierId: SUPPLIER,
    warehouseId: null,
    currency: 'EGP',
    subTotal: D(0),
    taxAmount: D(0),
    totalAmount: D(0),
    paidAmount: D(0),
    landedCostAmount: D(0),
    discountType: null,
    discountPercent: D(0),
    discountAmount: D(0),
    lineDiscountTotal: D(0),
    supplierReference: null,
    notes: null,
    journalEntryId: null,
    postedAt: null,
    createdAt: new Date('2026-10-27T00:00:00Z'),
    supplier: { id: SUPPLIER, code: 'SUP-1', nameEn: 'Supplier', nameAr: 'مورد' },
    branch: { code: 'HQ', nameEn: 'HQ', nameAr: 'الرئيسية' },
    lines: [],
  };

  const decorate = (line: any, index: number) => ({
    ...line,
    id: `line-${index + 1}`,
    returnedQuantity: D(0),
    returnedSubTotal: D(0),
    returnedCostTotal: D(0),
    returnedTaxTotal: D(0),
    discountPercent: line.discountPercent ?? D(0),
    discountAmount: line.discountAmount ?? D(0),
    discountType: line.discountType ?? null,
    invoiceDiscountAmount: line.invoiceDiscountAmount ?? D(0),
    grossLineTotal: line.grossLineTotal ?? line.lineTotal,
    landedCostAmount: line.landedCostAmount ?? D(0),
    item: { code: 'X', nameEn: 'X', nameAr: 'س', unit: items[line.itemId]?.unit ?? 'piece' },
  });

  const tx = {
    purchaseInvoice: {
      create: jest.fn(async ({ data }: { data: any }) => {
        detail.subTotal = data.subTotal;
        detail.taxAmount = data.taxAmount;
        detail.totalAmount = data.totalAmount;
        detail.landedCostAmount = data.landedCostAmount;
        detail.lines = data.lines.create.map((line: any, index: number) => decorate(line, index));
        return { id: detail.id, invoiceNumber: detail.invoiceNumber, totalAmount: detail.totalAmount };
      }),
      update: jest.fn(async ({ data }: { data: any }) => {
        if (data.lines?.create) {
          detail.lines = data.lines.create.map((line: any, index: number) => decorate(line, index));
        }
        return detail;
      }),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    item: { findFirst: itemFind },
    stockMovement: { create: jest.fn(async () => ({})) },
    stockBalance: { upsert: jest.fn(async () => ({})) },
  };

  const prisma = {
    supplier: { findFirst: jest.fn().mockResolvedValue({ id: SUPPLIER, isActive: true }) },
    item: { findFirst: itemFind },
    purchaseInvoice: {
      findFirst: jest.fn(async () => detail),
    },
    $transaction: jest.fn(async (work: (client: unknown) => unknown) => work(tx)),
  };

  const numbers = { next: jest.fn().mockResolvedValue('PI-0001') };
  const posting = { post: jest.fn(async () => ({ id: 'je-1', entryNumber: 'JV-1' })) };
  const accounts = { resolve: jest.fn(async () => ({})) };
  const settings = {
    get: jest.fn(async () => ({
      maxDiscountPercent: '100.0000',
      taxRate: '0.0000',
      pricesIncludeTax: false,
    })),
  };
  const warehouses = { resolve: jest.fn(async () => 'warehouse-1') };
  const prices = { resolvePrice: jest.fn(async () => null) };
  const audit = { record: jest.fn(async () => undefined) };

  const service = new PurchaseInvoicesService(
    prisma as never,
    numbers as never,
    posting as never,
    accounts as never,
    settings as never,
    warehouses as never,
    prices as never,
    audit as never,
  );
  return { service, prisma, tx, prices };
}

describe('Purchase multi-unit — milk scenario', () => {
  it('buys 5 cartons (factor 10): 50 pieces received, cost 375, snapshot retained', async () => {
    const { service, tx } = makeService();
    await service.create(COMPANY, BRANCH, 'user-1', {
      invoiceDate: '2026-10-27',
      supplierId: SUPPLIER,
      lines: [
        { itemId: MILK, quantity: '5', unitName: 'كرتونة', taxRate: '0' },
      ],
    } as any);

    const line = tx.purchaseInvoice.create.mock.calls[0][0].data.lines.create[0];
    // Independent unit price pulled from the carton row.
    expect(line.unitPrice.toFixed(4)).toBe('75.0000');
    // Money: 5 x 75 = 375, computed from the ENTERED quantity.
    expect(line.grossLineTotal.toFixed(4)).toBe('375.0000');
    expect(line.lineTotal.toFixed(4)).toBe('375.0000');
    expect(line.inventoryCostTotal.toFixed(4)).toBe('375.0000');
    // Internal base quantity is 50 pieces.
    expect(line.quantity.toFixed(4)).toBe('50.0000');
    // Snapshot for display/history.
    expect(line.unitName).toBe('كرتونة');
    expect(line.unitFactor.toFixed(6)).toBe('10.000000');
    expect(line.unitQuantity.toFixed(4)).toBe('5.0000');
  });

  it('posting receives 50 pieces at a weighted unit cost of 7.50 each', async () => {
    const { service, tx } = makeService();
    await service.create(COMPANY, BRANCH, 'user-1', {
      invoiceDate: '2026-10-27',
      supplierId: SUPPLIER,
      lines: [{ itemId: MILK, quantity: '5', unitName: 'كرتونة', unitPrice: '75', taxRate: '0' }],
    } as any);

    // The shared detail fixture now holds the decorated lines create() built.
    await service.post(COMPANY, 'user-1', 'invoice-1');

    const movement = (tx.stockMovement.create.mock.calls as any[])[0][0].data;
    expect(movement.direction).toBe(StockDirection.IN);
    expect(movement.quantity.toFixed(4)).toBe('50.0000');
    // 375 / 50 = 7.5 per base piece — average-cost valuation stays correct.
    expect(movement.unitCost.toFixed(4)).toBe('7.5000');
    expect(movement.totalCost.toFixed(4)).toBe('375.0000');
    const upsert = (tx.stockBalance.upsert.mock.calls as any[])[0][0];
    expect(upsert.update.quantity.increment.toFixed(4)).toBe('50.0000');
    expect(upsert.update.value.increment.toFixed(4)).toBe('375.0000');
  });
});

describe('Purchase multi-unit — cable scenario', () => {
  it('buys 2 reels (factor 100): 200 metres received', async () => {
    const { service, tx } = makeService();
    await service.create(COMPANY, BRANCH, 'user-1', {
      invoiceDate: '2026-10-27',
      supplierId: SUPPLIER,
      lines: [{ itemId: CABLE, quantity: '2', unitName: 'بكرة', unitPrice: '5000', taxRate: '0' }],
    } as any);
    const line = tx.purchaseInvoice.create.mock.calls[0][0].data.lines.create[0];
    expect(line.quantity.toFixed(4)).toBe('200.0000');
    expect(line.unitQuantity.toFixed(4)).toBe('2.0000');
    expect(line.unitFactor.toFixed(6)).toBe('100.000000');
    expect(line.grossLineTotal.toFixed(4)).toBe('10000.0000');
  });

  it('supports half a reel when decimal precision allows it (50 metres)', async () => {
    const { service, tx } = makeService();
    await service.create(COMPANY, BRANCH, 'user-1', {
      invoiceDate: '2026-10-27',
      supplierId: SUPPLIER,
      lines: [{ itemId: CABLE, quantity: '0.5', unitName: 'بكرة', unitPrice: '2500', taxRate: '0' }],
    } as any);
    const line = tx.purchaseInvoice.create.mock.calls[0][0].data.lines.create[0];
    expect(line.quantity.toFixed(4)).toBe('50.0000');
    expect(line.unitQuantity.toFixed(4)).toBe('0.5000');
  });
});

describe('Purchase unit validation and legacy behaviour', () => {
  it('rejects an inactive unit on a new document', async () => {
    const { service } = makeService({
      [MILK]: {
        ...milkItem,
        units: [
          milkItem.units[0],
          { ...milkItem.units[1], isActive: false },
        ],
      },
    });
    await expect(
      service.create(COMPANY, BRANCH, 'user-1', {
        invoiceDate: '2026-10-27',
        supplierId: SUPPLIER,
        lines: [{ itemId: MILK, quantity: '1', unitName: 'كرتونة', unitPrice: '75', taxRate: '0' }],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown unit', async () => {
    const { service } = makeService();
    await expect(
      service.create(COMPANY, BRANCH, 'user-1', {
        invoiceDate: '2026-10-27',
        supplierId: SUPPLIER,
        lines: [{ itemId: MILK, quantity: '1', unitName: 'بالته', unitPrice: '1', taxRate: '0' }],
      } as any),
    ).rejects.toThrow(/not defined/);
  });

  it('a legacy line with no unit keeps quantity as the base quantity and a null snapshot', async () => {
    const { service, tx } = makeService();
    await service.create(COMPANY, BRANCH, 'user-1', {
      invoiceDate: '2026-10-27',
      supplierId: SUPPLIER,
      lines: [{ itemId: MILK, quantity: '12', unitPrice: '7', taxRate: '0' }],
    } as any);
    const line = tx.purchaseInvoice.create.mock.calls[0][0].data.lines.create[0];
    expect(line.quantity.toFixed(4)).toBe('12.0000');
    expect(line.unitName).toBeNull();
    expect(line.unitFactor).toBeNull();
    expect(line.unitQuantity).toBeNull();
    expect(line.grossLineTotal.toFixed(4)).toBe('84.0000');
  });
});
