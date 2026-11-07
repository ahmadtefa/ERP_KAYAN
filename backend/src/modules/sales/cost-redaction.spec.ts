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
    updatedAt: new Date('2026-10-27T00:00:00Z'),
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

describe('sales invoice write responses honour cost permission', () => {
  it('passes the current cost permission through every response-producing mutation', async () => {
    const { SalesInvoicesController } = await import('./sales-invoices.controller');
    const service = {create:jest.fn(),updateDraft:jest.fn(),post:jest.fn(),reverse:jest.fn()};
    const controller = new SalesInvoicesController(service as never);
    const principal = {userId:'u',companyId:'c',branchId:'b',username:'test',isSuperAdmin:false,permissions:[]};
    const dto = {lines:[]} as never;
    controller.create(principal,dto);
    controller.updateDraft(principal,'i',dto);
    controller.post(principal,'i');
    controller.reverse(principal,'i');
    expect(service.create).toHaveBeenLastCalledWith('c','b','u',dto,undefined,false);
    expect(service.updateDraft).toHaveBeenLastCalledWith('c','b','u','i',dto,false);
    // Posting now also carries what the caller is allowed to do about expired
    // stock. It is derived from their permissions in the controller, never from
    // the request body - here the principal has neither, so both are false.
    expect(service.post).toHaveBeenLastCalledWith('c','u','i',false,{
      mayIssueExpired: false,
      reason: null,
    });
    expect(service.reverse).toHaveBeenLastCalledWith('c','u','i',false);
    const allowed = {...principal,permissions:['inventory.cost.read']};
    controller.create(allowed,dto);
    controller.updateDraft(allowed,'i',dto);
    controller.post(allowed,'i');
    controller.reverse(allowed,'i');
    expect(service.create).toHaveBeenLastCalledWith('c','b','u',dto,undefined,true);
    expect(service.updateDraft).toHaveBeenLastCalledWith('c','b','u','i',dto,true);
    expect(service.post).toHaveBeenLastCalledWith('c','u','i',true,{
      mayIssueExpired: false,
      reason: null,
    });
    expect(service.reverse).toHaveBeenLastCalledWith('c','u','i',true);
  });
});

describe('return write responses honour cost permission on both sides', () => {
  it('passes current cost permission for creation, posting and reversal', async () => {
    const { ReturnsController } = await import('../returns/returns.controller');
    const service = {createSalesReturn:jest.fn(),postSalesReturn:jest.fn(),createPurchaseReturn:jest.fn(),
      postPurchaseReturn:jest.fn(),reverse:jest.fn()};
    const controller = new ReturnsController(service as never);
    const principal = {userId:'u',companyId:'c',branchId:'b',username:'test',isSuperAdmin:false,permissions:[]};
    const body = {originalInvoiceId:'i'};
    for (const allowed of [false,true]) {
      const caller = {...principal,permissions:allowed ? ['inventory.cost.read'] : []};
      controller.createSales(caller,body);
      controller.postSales(caller,'i');
      controller.reverseSales(caller,'i');
      expect(service.createSalesReturn).toHaveBeenLastCalledWith('c','b','u',body,allowed);
      expect(service.postSalesReturn).toHaveBeenLastCalledWith('c','u','i',allowed);
      expect(service.reverse).toHaveBeenLastCalledWith('c','u','sales','i',allowed);
      controller.createPurchase(caller,body);
      controller.postPurchase(caller,'i');
      controller.reversePurchase(caller,'i');
      expect(service.createPurchaseReturn).toHaveBeenLastCalledWith('c','b','u',body,allowed);
      expect(service.postPurchaseReturn).toHaveBeenLastCalledWith('c','u','i',allowed);
      expect(service.reverse).toHaveBeenLastCalledWith('c','u','purchases','i',allowed);
    }
  });
});
