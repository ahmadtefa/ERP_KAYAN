import { InvoiceStatus, Prisma } from '@prisma/client';

import { SalesInvoicesService } from './sales-invoices.service';
import { ReturnsService } from '../returns/returns.service';
import { OperationsReportsService } from '../reports/operations-reports.service';

const D = (value: string) => new Prisma.Decimal(value);
const NO_COST = false;
const WITH_COST = true;

function invoiceRow() {
  return {
    id: 'inv-1',
    branchId: 'branch-1',
    invoiceNumber: 'SI-1',
    invoiceDate: new Date('2026-10-05T00:00:00Z'),
    dueDate: null,
    status: InvoiceStatus.POSTED,
    currency: 'EGP',
    subTotal: D('100'),
    taxAmount: D('14'),
    totalAmount: D('114'),
    paidAmount: D('114'),
    costOfGoods: D('60'),
    createdAt: new Date('2026-10-05T00:00:00Z'),
    discountType: null,
    discountPercent: D('0'),
    discountAmount: D('0'),
    lineDiscountTotal: D('0'),
    customer: { id: 'c1', code: 'C1', nameEn: 'Cust', nameAr: 'عميل' },
    lines: [
      {
        id: 'l1',
        lineNumber: 1,
        itemId: 'item-1',
        item: { code: 'MILK', nameEn: 'Milk', nameAr: 'لبن', unit: 'piece' },
        unitName: null,
        unitFactor: null,
        unitQuantity: D('2'),
        description: null,
        quantity: D('2'),
        returnedQuantity: D('0'),
        unitPrice: D('50'),
        taxRate: D('14'),
        taxAmount: D('14'),
        lineTotal: D('114'),
        grossLineTotal: D('100'),
        discountType: null,
        discountPercent: D('0'),
        discountAmount: D('0'),
        invoiceDiscountAmount: D('0'),
        costCenterId: null,
        unitCost: D('30'),
        costTotal: D('60'),
      },
    ],
  };
}

describe('cost redaction - sales invoices', () => {
  function buildService() {
    const invoice = invoiceRow();
    const prisma = {
      salesInvoice: {
        findFirst: jest.fn().mockResolvedValue(invoice),
        findMany: jest.fn().mockResolvedValue([invoice]),
        count: jest.fn().mockResolvedValue(1),
      },
      $transaction: jest.fn(async (arg: unknown) =>
        Array.isArray(arg) ? [[invoice], 1] : arg,
      ),
    };
    return {
      invoice,
      service: new SalesInvoicesService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      ),
    };
  }

  it('list withholds costOfGoods and grossProfit without cost.read', async () => {
    const { service } = buildService();
    const redacted = await service.findAll('c1', {}, NO_COST);
    expect(redacted.items[0].costOfGoods).toBeNull();
    expect(redacted.items[0].grossProfit).toBeNull();
    // Selling figures remain.
    expect(redacted.items[0].totalAmount).toBe('114.0000');

    const allowed = await service.findAll('c1', {}, WITH_COST);
    expect(allowed.items[0].costOfGoods).toBe('60.0000');
    expect(allowed.items[0].grossProfit).toBe('40.0000');
  });

  it('detail withholds per-line cost snapshots without cost.read', async () => {
    const { service } = buildService();
    const redacted = await service.findOne('c1', 'inv-1', NO_COST);
    expect(redacted.costOfGoods).toBeNull();
    expect(redacted.grossProfit).toBeNull();
    expect(redacted.lines[0].unitCost).toBeNull();
    expect(redacted.lines[0].costTotal).toBeNull();
    // The sale itself stays fully readable.
    expect(redacted.lines[0].unitPrice).toBe('50.0000');
    expect(redacted.lines[0].lineTotal).toBe('114.0000');

    const allowed = await service.findOne('c1', 'inv-1', WITH_COST);
    expect(allowed.lines[0].unitCost).toBe('30.0000');
    expect(allowed.lines[0].costTotal).toBe('60.0000');
  });
});

describe('cost redaction - sales returns', () => {
  it('credit note detail withholds cost snapshots without cost.read', async () => {
    const creditNote = {
      ...invoiceRow(),
      documentType: 'CREDIT_NOTE' as never,
      originalInvoice: { id: 'inv-1', invoiceNumber: 'SI-1', invoiceDate: new Date() },
    };
    const prisma = {
      salesInvoice: { findFirst: jest.fn().mockResolvedValue(creditNote) },
      purchaseInvoice: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    const service = new ReturnsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const redacted = (await service.findOne('c1', 'sales', 'cn-1', NO_COST)) as any;
    expect(redacted.lines[0].unitCost).toBeNull();
    expect(redacted.lines[0].costTotal).toBeNull();
    expect(redacted.lines[0].unitPrice).toBe('50.0000');

    const allowed = (await service.findOne('c1', 'sales', 'cn-1', WITH_COST)) as any;
    expect(allowed.lines[0].unitCost).toBe('30.0000');
    expect(allowed.lines[0].costTotal).toBe('60.0000');
  });
});

describe('cost redaction - operations sales report', () => {
  it('withholds costOfGoods and grossProfit without cost.read', async () => {
    const row = {
      id: 'inv-1',
      invoiceNumber: 'SI-1',
      invoiceDate: new Date('2026-10-05T00:00:00Z'),
      dueDate: null,
      documentType: 'INVOICE' as never,
      status: InvoiceStatus.POSTED,
      subTotal: D('100'),
      discountAmount: D('0'),
      taxAmount: D('14'),
      totalAmount: D('114'),
      paidAmount: D('114'),
      costOfGoods: D('60'),
      customer: { id: 'c1', code: 'C1', nameEn: 'Cust', nameAr: 'عميل' },
    };
    const prisma = {
      salesInvoice: { findMany: jest.fn().mockResolvedValue([row]) },
    };
    const service = new OperationsReportsService(prisma as never);

    const redacted = await service.sales('c1', {}, NO_COST);
    expect(redacted.rows[0].costOfGoods).toBeNull();
    expect(redacted.rows[0].grossProfit).toBeNull();
    expect(redacted.totals.costOfGoods).toBeNull();
    expect(redacted.totals.grossProfit).toBeNull();
    expect(redacted.rows[0].totalAmount).toBe('114.0000');

    const allowed = await service.sales('c1', {}, WITH_COST);
    expect(allowed.rows[0].costOfGoods).toBe('60.0000');
    expect(allowed.totals.grossProfit).toBe('54.0000');
  });
});
