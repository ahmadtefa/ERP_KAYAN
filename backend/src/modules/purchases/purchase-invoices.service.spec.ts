import { BadRequestException } from '@nestjs/common';
import { InvoiceDocumentType, InvoiceStatus, Prisma } from '@prisma/client';

import { PurchaseInvoicesService } from './purchase-invoices.service';

const D = (value: string | number) => new Prisma.Decimal(value);
const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const SUPPLIER = '33333333-3333-4333-8333-333333333333';
const ITEMS = [
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
];

function makeService() {
  const detail = {
    id: '77777777-7777-4777-8777-777777777777',
    branchId: BRANCH,
    invoiceNumber: 'PI-0001',
    supplierReference: null,
    invoiceDate: new Date('2026-10-18T00:00:00.000Z'),
    dueDate: null,
    status: InvoiceStatus.DRAFT,
    documentType: InvoiceDocumentType.INVOICE,
    supplierId: SUPPLIER,
    warehouseId: null,
    currency: 'EGP',
    subTotal: D(1000),
    taxAmount: D(0),
    totalAmount: D(1100),
    landedCostAmount: D(100),
    landedCostCharges: [
      { description: 'Sea freight', amount: '60.0000' },
      { description: 'Customs', amount: '30.0000' },
      { description: 'Insurance', amount: '10.0000' },
    ],
    paidAmount: D(0),
    createdAt: new Date('2026-10-18T00:00:00.000Z'),
    supplier: { id: SUPPLIER, code: 'SUP-1', nameEn: 'Supplier', nameAr: 'مورد' },
    branch: { code: 'HQ', nameEn: 'Head Office', nameAr: 'المركز الرئيسي' },
    notes: null,
    lines: [],
  };
  const supplierFind = jest.fn()
    .mockResolvedValueOnce({ id: SUPPLIER, isActive: true })
    .mockResolvedValue({ paymentTermDays: 0 });
  const itemFind = jest.fn(async ({ where }: { where: { id: string } }) => {
    const index = ITEMS.indexOf(where.id);
    return {
      code: `ITEM-${index + 1}`,
      nameEn: `Item ${index + 1}`,
      nameAr: `صنف ${index + 1}`,
      taxRate: D(0),
      isActive: true,
      purchasePrice: D([600, 300, 100][index] ?? 0),
      unit: 'piece',
    };
  });
  const tx = {
    purchaseInvoice: {
      create: jest.fn(async ({ data }: { data: Record<string, any> }) => {
        detail.subTotal = data.subTotal;
        detail.taxAmount = data.taxAmount;
        detail.totalAmount = data.totalAmount;
        detail.landedCostAmount = data.landedCostAmount;
        detail.landedCostCharges = data.landedCostCharges as typeof detail.landedCostCharges;
        detail.lines = data.lines.create.map((line: Record<string, any>, index: number) => ({
          ...line,
          id: `line-${index + 1}`,
          returnedQuantity: D(0),
          returnedCostTotal: D(0),
          item: { code: `ITEM-${index + 1}`, nameEn: `Item ${index + 1}`, nameAr: `صنف ${index + 1}`, unit: 'piece' },
        }));
        return { id: detail.id, invoiceNumber: detail.invoiceNumber, totalAmount: detail.totalAmount };
      }),
      update: jest.fn(async ({ data }: { data: Record<string, any> }) => {
        detail.subTotal = data.subTotal;
        detail.taxAmount = data.taxAmount;
        detail.totalAmount = data.totalAmount;
        detail.landedCostAmount = data.landedCostAmount;
        detail.landedCostCharges = data.landedCostCharges as typeof detail.landedCostCharges;
        detail.lines = data.lines.create.map((line: Record<string, any>, index: number) => ({
          ...line,
          id: `updated-line-${index + 1}`,
          returnedQuantity: D(0),
          returnedCostTotal: D(0),
          item: { code: `ITEM-${index + 1}`, nameEn: `Item ${index + 1}`, nameAr: `صنف ${index + 1}`, unit: 'piece' },
        }));
        return detail;
      }),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ status: InvoiceStatus.DRAFT }]),
  };
  const prisma = {
    supplier: { findFirst: supplierFind },
    item: { findFirst: itemFind },
    purchaseInvoice: { findFirst: jest.fn(async () => detail) },
    $transaction: jest.fn(async (work: (client: unknown) => unknown) => work(tx)),
  };
  const numbers = { next: jest.fn().mockResolvedValue('PI-0001') };
  const posting = {};
  const accounts = {};
  const settings = { get: jest.fn(async () => ({ maxDiscountPercent: '100.0000', taxRate: '14.0000' })) };
  const warehouses = {};
  const prices = { resolvePrice: jest.fn() };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
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
  return { service, prisma, tx, detail, numbers, audit };
}

describe('PurchaseInvoicesService landed-cost charges', () => {
  it('stores multiple named charges and allocates their exact total by line value', async () => {
    const { service, tx, detail } = makeService();

    const invoice = await service.create(COMPANY, BRANCH, 'user-1', {
      invoiceDate: '2026-10-18',
      supplierId: SUPPLIER,
      landedCostCharges: [
        { description: 'Sea freight', amount: '60.0000' },
        { description: 'Customs', amount: '30.0000' },
        { description: 'Insurance', amount: '10.0000' },
      ],
      lines: ITEMS.map((itemId, index) => ({
        itemId,
        quantity: '1.0000',
        unitPrice: ['600.0000', '300.0000', '100.0000'][index],
        taxRate: '0.0000',
      })),
    });

    const data = tx.purchaseInvoice.create.mock.calls[0]![0].data;
    expect(data.landedCostCharges).toEqual([
      { description: 'Sea freight', amount: '60.0000' },
      { description: 'Customs', amount: '30.0000' },
      { description: 'Insurance', amount: '10.0000' },
    ]);
    expect(data.landedCostAmount.toFixed(4)).toBe('100.0000');
    expect(data.totalAmount.toFixed(4)).toBe('1100.0000');
    expect(data.lines.create.map((line: any) => line.landedCostAmount.toFixed(4))).toEqual([
      '60.0000', '30.0000', '10.0000',
    ]);
    expect(data.lines.create.map((line: any) => line.inventoryCostTotal.toFixed(4))).toEqual([
      '660.0000', '330.0000', '110.0000',
    ]);
    expect(data.lines.create.reduce(
      (sum: Prisma.Decimal, line: any) => sum.plus(line.landedCostAmount), D(0),
    ).toFixed(4)).toBe('100.0000');
    expect(invoice.landedCostCharges).toEqual(data.landedCostCharges);
    expect(detail.landedCostAmount.toFixed(4)).toBe('100.0000');
  });

  it('replaces a draft charge breakdown and recalculates every line allocation on edit', async () => {
    const { service, tx } = makeService();

    const invoice = await service.updateDraft(COMPANY, BRANCH, 'user-1', '77777777-7777-4777-8777-777777777777', {
      invoiceDate: '2026-10-18',
      supplierId: SUPPLIER,
      landedCostCharges: [
        { description: 'Port freight', amount: '7.0000' },
        { description: 'Handling', amount: '3.0000' },
      ],
      lines: ITEMS.map((itemId, index) => ({
        itemId,
        quantity: '1.0000',
        unitPrice: ['600.0000', '300.0000', '100.0000'][index],
        taxRate: '0.0000',
      })),
    });

    const update = tx.purchaseInvoice.update.mock.calls[0]![0].data;
    expect(update.landedCostCharges).toEqual([
      { description: 'Port freight', amount: '7.0000' },
      { description: 'Handling', amount: '3.0000' },
    ]);
    expect(update.landedCostAmount.toFixed(4)).toBe('10.0000');
    expect(update.totalAmount.toFixed(4)).toBe('1010.0000');
    expect(update.lines.create.map((line: any) => line.landedCostAmount.toFixed(4))).toEqual([
      '6.0000', '3.0000', '1.0000',
    ]);
    expect(invoice.landedCostCharges).toEqual(update.landedCostCharges);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('assigns every rounding unit when multiple named charges share the allocation', async () => {
    const { service, tx } = makeService();

    await service.create(COMPANY, BRANCH, 'user-1', {
      invoiceDate: '2026-10-18',
      supplierId: SUPPLIER,
      landedCostCharges: [
        { description: 'Freight', amount: '0.0001' },
        { description: 'Insurance', amount: '0.0001' },
      ],
      lines: ITEMS.map((itemId) => ({
        itemId,
        quantity: '1.0000',
        unitPrice: '1.0000',
        taxRate: '0.0000',
      })),
    });

    const data = tx.purchaseInvoice.create.mock.calls[0]![0].data;
    const allocated = data.lines.create.map((line: any) => line.landedCostAmount.toFixed(4));
    expect(allocated).toEqual(['0.0001', '0.0001', '0.0000']);
    expect(allocated.reduce((sum: Prisma.Decimal, value: string) => sum.plus(value), D(0)).toFixed(4))
      .toBe('0.0002');
  });

  it('rejects an aggregate amount that disagrees with the named charges', async () => {
    const { service, prisma } = makeService();

    await expect(service.create(COMPANY, BRANCH, 'user-1', {
      invoiceDate: '2026-10-18',
      supplierId: SUPPLIER,
      landedCostAmount: '101.0000',
      landedCostCharges: [{ description: 'Freight', amount: '100.0000' }],
      lines: [{ itemId: ITEMS[0], quantity: '1.0000', unitPrice: '600.0000', taxRate: '0.0000' }],
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
