import { BadRequestException } from '@nestjs/common';
import {
  InvoiceDocumentType,
  InvoiceStatus,
  Prisma,
} from '@prisma/client';

import { ReturnsService } from './returns.service';

const D = (value: string | number) => new Prisma.Decimal(value);
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const BRANCH_ID = '33333333-3333-4333-8333-333333333333';
const WAREHOUSE_ID = '44444444-4444-4444-8444-444444444444';
const ITEM_ID = '55555555-5555-4555-8555-555555555555';
const SOURCE_INVOICE_ID = '66666666-6666-4666-8666-666666666666';
const SOURCE_LINE_ID = '77777777-7777-4777-8777-777777777777';
const RETURN_ID = '88888888-8888-4888-8888-888888888888';
const RETURN_LINE_ID = '99999999-9999-4999-8999-999999999999';
const TODAY = new Date('2026-10-18T00:00:00.000Z');

function dependencies(prisma: Record<string, any>, posting = { post: jest.fn(), reverse: jest.fn() }) {
  const numbers = { next: jest.fn().mockResolvedValue('RT-0001') };
  const accounts = {
    resolve: jest.fn().mockResolvedValue({
      accountsReceivable: 'ar',
      accountsPayable: 'ap',
      salesReturns: 'sales-returns',
      vatPayable: 'vat-payable',
      vatReceivable: 'vat-receivable',
      inventory: 'inventory',
      costOfGoodsSold: 'cogs',
    }),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const warehouses = {
    resolve: jest.fn().mockResolvedValue(WAREHOUSE_ID),
    resolveForReversal: jest.fn().mockResolvedValue(WAREHOUSE_ID),
  };
  const service = new ReturnsService(
    prisma as never,
    numbers as never,
    posting as never,
    accounts as never,
    audit as never,
    warehouses as never,
  );
  return { service, numbers, posting, accounts, audit, warehouses };
}

function summaryFields(overrides: Record<string, unknown> = {}) {
  return {
    id: RETURN_ID,
    invoiceNumber: 'PR-RT-0001',
    invoiceDate: TODAY,
    status: InvoiceStatus.POSTED,
    documentType: InvoiceDocumentType.DEBIT_NOTE,
    currency: 'EGP',
    subTotal: D(10),
    taxAmount: D(1),
    landedCostAmount: D(3),
    totalAmount: D(14),
    paidAmount: D(0),
    returnReason: 'Damaged package',
    createdAt: TODAY,
    originalInvoice: { invoiceNumber: 'PI-0001' },
    supplier: { code: 'SUP-1', nameEn: 'Supplier', nameAr: 'مورد' },
    customer: null,
    lines: [],
    ...overrides,
  };
}

function transactionPrisma(tx: Record<string, any>, model: 'salesInvoice' | 'purchaseInvoice', findResults: unknown[]) {
  return {
    $transaction: jest.fn(async (work: unknown) =>
      typeof work === 'function'
        ? (work as (transaction: unknown) => unknown)(tx)
        : Promise.all(work as Promise<unknown>[]),
    ),
    [model]: {
      findFirst: jest.fn().mockImplementation(async () => findResults.shift() ?? null),
    },
  };
}

describe('ReturnsService', () => {
  it('refuses to post or reverse ordinary invoices through return endpoints', async () => {
    const ordinarySalesInvoice = {
      ...summaryFields({
        status: InvoiceStatus.POSTED,
        documentType: InvoiceDocumentType.INVOICE,
      }),
      journalEntryId: 'sales-journal',
    };
    const salesTx = { salesInvoice: { updateMany: jest.fn() } };
    const salesPrisma = transactionPrisma(salesTx, 'salesInvoice', [ordinarySalesInvoice, ordinarySalesInvoice]);
    const sales = dependencies(salesPrisma).service;
    await expect(sales.reverse(COMPANY_ID, USER_ID, 'sales', RETURN_ID)).rejects.toBeInstanceOf(BadRequestException);
    expect(salesPrisma.$transaction).not.toHaveBeenCalled();

    const ordinaryPurchaseInvoice = {
      ...summaryFields({
        status: InvoiceStatus.POSTED,
        documentType: InvoiceDocumentType.INVOICE,
      }),
      journalEntryId: 'purchase-journal',
    };
    const purchaseTx = { purchaseInvoice: { updateMany: jest.fn() } };
    const purchasePrisma = transactionPrisma(purchaseTx, 'purchaseInvoice', [ordinaryPurchaseInvoice, ordinaryPurchaseInvoice]);
    const purchases = dependencies(purchasePrisma).service;
    await expect(purchases.reverse(COMPANY_ID, USER_ID, 'purchases', RETURN_ID)).rejects.toBeInstanceOf(BadRequestException);
    expect(purchasePrisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses sales and purchase returns when the locked source invoice is no longer posted', async () => {
    const salesDocument = {
      ...summaryFields({
        status: InvoiceStatus.DRAFT,
        documentType: InvoiceDocumentType.CREDIT_NOTE,
      }),
      branchId: BRANCH_ID,
      warehouseId: WAREHOUSE_ID,
      originalInvoiceId: SOURCE_INVOICE_ID,
    };
    const salesTx = {
      $queryRaw: jest.fn().mockResolvedValueOnce([
        { status: InvoiceStatus.REVERSED, documentType: InvoiceDocumentType.INVOICE },
      ]),
      salesInvoice: { updateMany: jest.fn() },
    };
    const salesPrisma = transactionPrisma(salesTx, 'salesInvoice', [salesDocument]);
    const sales = dependencies(salesPrisma).service;
    await expect(sales.postSalesReturn(COMPANY_ID, USER_ID, RETURN_ID)).rejects.toThrow(
      /source sales invoice is no longer posted/i,
    );
    expect(salesTx.salesInvoice.updateMany).not.toHaveBeenCalled();

    const purchaseDocument = {
      ...summaryFields({
        status: InvoiceStatus.DRAFT,
        documentType: InvoiceDocumentType.DEBIT_NOTE,
      }),
      branchId: BRANCH_ID,
      warehouseId: WAREHOUSE_ID,
      originalInvoiceId: SOURCE_INVOICE_ID,
    };
    const purchaseTx = {
      $queryRaw: jest.fn().mockResolvedValueOnce([
        { status: InvoiceStatus.POSTED, documentType: InvoiceDocumentType.DEBIT_NOTE },
      ]),
      purchaseInvoice: { updateMany: jest.fn() },
    };
    const purchasePrisma = transactionPrisma(purchaseTx, 'purchaseInvoice', [purchaseDocument]);
    const purchases = dependencies(purchasePrisma).service;
    await expect(purchases.postPurchaseReturn(COMPANY_ID, USER_ID, RETURN_ID)).rejects.toThrow(
      /source purchase invoice is no longer posted/i,
    );
    expect(purchaseTx.purchaseInvoice.updateMany).not.toHaveBeenCalled();
  });

  it('allocates every fractional remainder to the final partial return', () => {
    const { service } = dependencies({});
    const allocate = (service as any).allocateReturnedCost.bind(service) as (
      total: Prisma.Decimal,
      returned: Prisma.Decimal,
      fullQuantity: Prisma.Decimal,
      returnedQuantity: Prisma.Decimal,
      quantity: Prisma.Decimal,
      field: string,
    ) => Prisma.Decimal;

    const first = allocate(D('1.0001'), D(0), D(3), D(0), D(1), 'line');
    const second = allocate(D('1.0001'), first, D(3), D(1), D(1), 'line');
    const last = allocate(D('1.0001'), first.plus(second), D(3), D(2), D(1), 'line');

    expect([first.toFixed(4), second.toFixed(4), last.toFixed(4)]).toEqual([
      '0.3334',
      '0.3334',
      '0.3333',
    ]);
    expect(first.plus(second).plus(last).toFixed(4)).toBe('1.0001');
  });

  it('creates purchase returns with the allocated landed cost, original value, and tax', async () => {
    const original = {
      id: SOURCE_INVOICE_ID,
      invoiceNumber: 'PI-0001',
      invoiceDate: new Date('2026-10-01T00:00:00.000Z'),
      status: InvoiceStatus.POSTED,
      documentType: InvoiceDocumentType.INVOICE,
      branchId: BRANCH_ID,
      warehouseId: WAREHOUSE_ID,
      supplierId: 'supplier-1',
      currency: 'EGP',
      lines: [
        {
          id: SOURCE_LINE_ID,
          itemId: ITEM_ID,
          description: 'Widget',
          quantity: D(3),
          returnedQuantity: D(0),
          returnedSubTotal: D(0),
          unitPrice: D(10),
          taxRate: D(10),
          taxAmount: D(3),
          returnedTaxTotal: D(0),
          lineTotal: D(30),
          landedCostAmount: D(9),
          inventoryCostTotal: D(39),
          returnedCostTotal: D(0),
        },
      ],
    };
    const created = { id: RETURN_ID, invoiceNumber: 'PR-RT-0001', totalAmount: D(14) };
    const tx = { purchaseInvoice: { create: jest.fn().mockResolvedValue(created) } };
    const detail = summaryFields({ status: InvoiceStatus.DRAFT, lines: [] });
    const prisma = transactionPrisma(tx, 'purchaseInvoice', [original, detail]);
    const { service, numbers, audit } = dependencies(prisma);

    await service.createPurchaseReturn(COMPANY_ID, BRANCH_ID, USER_ID, {
      originalInvoiceId: SOURCE_INVOICE_ID,
      returnDate: '2026-10-18',
      reason: 'Damaged package',
      lines: [{ originalLineId: SOURCE_LINE_ID, quantity: '1' }],
    });

    expect(numbers.next).toHaveBeenCalledWith(expect.anything(), COMPANY_ID, 'PURCHASE_RETURN', 'PR');
    const data = tx.purchaseInvoice.create.mock.calls[0]![0].data;
    expect(data.subTotal.toFixed(4)).toBe('10.0000');
    expect(data.taxAmount.toFixed(4)).toBe('1.0000');
    expect(data.landedCostAmount.toFixed(4)).toBe('3.0000');
    expect(data.totalAmount.toFixed(4)).toBe('14.0000');
    expect(data.warehouseId).toBe(WAREHOUSE_ID);
    expect(data.lines.create[0].inventoryCostTotal.toFixed(4)).toBe('13.0000');
    expect(data.lines.create[0].landedCostAmount.toFixed(4)).toBe('3.0000');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ entity: 'purchase_returns' }));
  });

  it('posts a sales return at exact original net, tax, and inventory cost totals', async () => {
    const document = {
      ...summaryFields({
        id: RETURN_ID,
        invoiceNumber: 'SR-0001',
        status: InvoiceStatus.DRAFT,
        documentType: InvoiceDocumentType.CREDIT_NOTE,
        subTotal: D('0.3334'),
        taxAmount: D('0.0001'),
        landedCostAmount: undefined,
        totalAmount: D('0.3335'),
        originalInvoiceId: SOURCE_INVOICE_ID,
        originalInvoice: { invoiceNumber: 'SI-0001' },
      }),
      branchId: BRANCH_ID,
      warehouseId: WAREHOUSE_ID,
      journalEntryId: null,
      lines: [
        {
          id: RETURN_LINE_ID,
          lineNumber: 1,
          originalLineId: SOURCE_LINE_ID,
          itemId: ITEM_ID,
          description: 'Widget',
          quantity: D(1),
          unitPrice: D('0.3334'),
          taxRate: D(10),
          taxAmount: D('0.0001'),
          lineTotal: D('0.3334'),
          unitCost: D('0.1000'),
          costTotal: D('0.1000'),
          item: null,
        },
      ],
    };
    const sourceLine = {
      id: SOURCE_LINE_ID,
      quantity: D(3),
      returnedQuantity: D(0),
      unitPrice: D('0.3334'),
      lineTotal: D('1.0001'),
      returnedSubTotal: D(0),
      costTotal: D('0.3001'),
      returnedCostTotal: D(0),
      taxAmount: D('0.0002'),
      returnedTaxTotal: D(0),
      description: 'Widget',
      itemId: ITEM_ID,
    };
    const tx = {
      salesInvoice: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      salesInvoiceLine: { update: jest.fn().mockResolvedValue({}) },
      item: { findFirst: jest.fn().mockResolvedValue({ id: ITEM_ID, isStockTracked: true }) },
      stockMovement: { create: jest.fn().mockResolvedValue({}) },
      stockBalance: { upsert: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ status: InvoiceStatus.POSTED, documentType: InvoiceDocumentType.INVOICE }])
        .mockResolvedValueOnce([sourceLine])
        .mockResolvedValueOnce([{ quantity: D(5), value: D(1) }]),
    };
    const prisma = transactionPrisma(tx, 'salesInvoice', [document, document]);
    const posting = { post: jest.fn().mockResolvedValue({ id: 'journal-1', entryNumber: 'JE-0001' }), reverse: jest.fn() };
    const { service, audit } = dependencies(prisma, posting);

    await service.postSalesReturn(COMPANY_ID, USER_ID, RETURN_ID);

    const updates = tx.salesInvoiceLine.update.mock.calls.map((call: any[]) => call[0]);
    expect(updates[0].data).toMatchObject({
      returnedQuantity: { increment: D(1) },
      returnedSubTotal: { increment: D('0.3334') },
      returnedCostTotal: { increment: D('0.1000') },
      returnedTaxTotal: { increment: D('0.0001') },
    });
    expect(updates[1].data.lineTotal.toFixed(4)).toBe('0.3334');
    expect(updates[1].data.costTotal.toFixed(4)).toBe('0.1000');
    expect(tx.stockMovement.create.mock.calls[0]![0].data.totalCost.toFixed(4)).toBe('0.1000');

    const journalLines = posting.post.mock.calls[0]![1].lines;
    const debit = journalLines.reduce((sum: Prisma.Decimal, line: any) => sum.plus(line.debit ?? 0), D(0));
    const credit = journalLines.reduce((sum: Prisma.Decimal, line: any) => sum.plus(line.credit ?? 0), D(0));
    expect(debit.toFixed(4)).toBe('0.4335');
    expect(credit.toFixed(4)).toBe('0.4335');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'sales_returns', after: expect.objectContaining({ totalAmount: '0.3335' }) }),
    );
  });

  it('posts a purchase return with landed cost in inventory and a balanced supplier credit', async () => {
    const document = {
      ...summaryFields({
        id: RETURN_ID,
        invoiceNumber: 'PR-0001',
        status: InvoiceStatus.DRAFT,
        documentType: InvoiceDocumentType.DEBIT_NOTE,
        originalInvoiceId: SOURCE_INVOICE_ID,
        originalInvoice: { invoiceNumber: 'PI-0001' },
      }),
      branchId: BRANCH_ID,
      warehouseId: WAREHOUSE_ID,
      journalEntryId: null,
      lines: [
        {
          id: RETURN_LINE_ID,
          lineNumber: 1,
          originalLineId: SOURCE_LINE_ID,
          itemId: ITEM_ID,
          description: 'Widget',
          quantity: D(1),
          unitPrice: D(10),
          taxRate: D(10),
          taxAmount: D(1),
          lineTotal: D(10),
          landedCostAmount: D(3),
          inventoryCostTotal: D(13),
        },
      ],
    };
    const sourceLine = {
      id: SOURCE_LINE_ID,
      quantity: D(3),
      returnedQuantity: D(0),
      unitPrice: D(10),
      lineTotal: D(30),
      returnedSubTotal: D(0),
      inventoryCostTotal: D(39),
      returnedCostTotal: D(0),
      taxAmount: D(3),
      returnedTaxTotal: D(0),
      description: 'Widget',
      itemId: ITEM_ID,
    };
    const tx = {
      purchaseInvoice: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      purchaseInvoiceLine: { update: jest.fn().mockResolvedValue({}) },
      item: { findFirst: jest.fn().mockResolvedValue({ id: ITEM_ID, isStockTracked: true }) },
      stockMovement: { create: jest.fn().mockResolvedValue({}) },
      stockBalance: { update: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ status: InvoiceStatus.POSTED, documentType: InvoiceDocumentType.INVOICE }])
        .mockResolvedValueOnce([sourceLine])
        .mockResolvedValueOnce([{ quantity: D(5), value: D(100) }]),
    };
    const prisma = transactionPrisma(tx, 'purchaseInvoice', [document, document]);
    const posting = { post: jest.fn().mockResolvedValue({ id: 'journal-2', entryNumber: 'JE-0002' }), reverse: jest.fn() };
    const { service, audit } = dependencies(prisma, posting);

    await service.postPurchaseReturn(COMPANY_ID, USER_ID, RETURN_ID);

    const updates = tx.purchaseInvoiceLine.update.mock.calls.map((call: any[]) => call[0]);
    expect(updates[0].data).toMatchObject({
      returnedQuantity: { increment: D(1) },
      returnedSubTotal: { increment: D(10) },
      returnedCostTotal: { increment: D(13) },
      returnedTaxTotal: { increment: D(1) },
    });
    expect(updates[1].data.inventoryCostTotal.toFixed(4)).toBe('13.0000');
    expect(updates[1].data.landedCostAmount.toFixed(4)).toBe('3.0000');
    expect(tx.stockMovement.create.mock.calls[0]![0].data.totalCost.toFixed(4)).toBe('13.0000');

    const journalLines = posting.post.mock.calls[0]![1].lines;
    const debit = journalLines.reduce((sum: Prisma.Decimal, line: any) => sum.plus(line.debit ?? 0), D(0));
    const credit = journalLines.reduce((sum: Prisma.Decimal, line: any) => sum.plus(line.credit ?? 0), D(0));
    expect(journalLines.find((line: any) => line.accountId === 'inventory').credit.toFixed(4)).toBe('13.0000');
    expect(debit.toFixed(4)).toBe('14.0000');
    expect(credit.toFixed(4)).toBe('14.0000');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'purchase_returns', after: expect.objectContaining({ totalAmount: '14.0000' }) }),
    );
  });

  it('reverses sales returns at the credited cost and frees net, tax, and quantity totals', async () => {
    const document = {
      ...summaryFields({
        id: RETURN_ID,
        invoiceNumber: 'SR-0001',
        status: InvoiceStatus.POSTED,
        documentType: InvoiceDocumentType.CREDIT_NOTE,
        subTotal: D('0.3334'),
        taxAmount: D('0.0001'),
        landedCostAmount: undefined,
        totalAmount: D('0.3335'),
        originalInvoice: { invoiceNumber: 'SI-0001' },
      }),
      branchId: BRANCH_ID,
      warehouseId: WAREHOUSE_ID,
      journalEntryId: 'journal-sales-return',
      lines: [
        {
          id: RETURN_LINE_ID,
          originalLineId: SOURCE_LINE_ID,
          itemId: ITEM_ID,
          description: 'Widget',
          quantity: D(1),
          unitPrice: D('0.3334'),
          taxRate: D(10),
          taxAmount: D('0.0001'),
          lineTotal: D('0.3334'),
          unitCost: D('0.1000'),
          costTotal: D('0.1000'),
        },
      ],
    };
    const originalLine = { id: SOURCE_LINE_ID };
    const tx = {
      salesInvoice: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
      salesInvoiceLine: {
        findUnique: jest.fn().mockResolvedValue(originalLine),
        update: jest.fn().mockResolvedValue({}),
      },
      item: { findFirst: jest.fn().mockResolvedValue({ id: ITEM_ID, isStockTracked: true }) },
      stockMovement: { create: jest.fn().mockResolvedValue({}) },
      stockBalance: { update: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ quantity: D(5), value: D(1) }]),
    };
    const prisma = transactionPrisma(tx, 'salesInvoice', [document, document]);
    const posting = { post: jest.fn(), reverse: jest.fn().mockResolvedValue(undefined) };
    const { service } = dependencies(prisma, posting);

    await service.reverse(COMPANY_ID, USER_ID, 'sales', RETURN_ID);

    expect(tx.salesInvoiceLine.update.mock.calls[0]![0].data).toMatchObject({
      returnedQuantity: { decrement: D(1) },
      returnedSubTotal: { decrement: D('0.3334') },
      returnedCostTotal: { decrement: D('0.1000') },
      returnedTaxTotal: { decrement: D('0.0001') },
    });
    expect(tx.stockMovement.create.mock.calls[0]![0].data.totalCost.toFixed(4)).toBe('0.1000');
    expect(tx.stockMovement.create.mock.calls[0]![0].data.warehouseId).toBe(WAREHOUSE_ID);
    expect(posting.reverse).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_ID,
      USER_ID,
      'journal-sales-return',
      'Reversal of sales return SR-0001',
    );
  });

  it('removes zero-cost stock quantity when a sales return is reversed', async () => {
    const document = {
      ...summaryFields({
        id: RETURN_ID,
        invoiceNumber: 'SR-FREE-0001',
        status: InvoiceStatus.POSTED,
        documentType: InvoiceDocumentType.CREDIT_NOTE,
        subTotal: D(0),
        taxAmount: D(0),
        totalAmount: D(0),
      }),
      branchId: BRANCH_ID,
      warehouseId: WAREHOUSE_ID,
      journalEntryId: 'journal-free-return',
      lines: [
        {
          id: RETURN_LINE_ID,
          originalLineId: SOURCE_LINE_ID,
          itemId: ITEM_ID,
          quantity: D(1),
          unitPrice: D(0),
          taxRate: D(0),
          taxAmount: D(0),
          lineTotal: D(0),
          unitCost: D(0),
          costTotal: D(0),
        },
      ],
    };
    const tx = {
      salesInvoice: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
      salesInvoiceLine: {
        findUnique: jest.fn().mockResolvedValue({ id: SOURCE_LINE_ID }),
        update: jest.fn().mockResolvedValue({}),
      },
      item: { findFirst: jest.fn().mockResolvedValue({ id: ITEM_ID, isStockTracked: true }) },
      stockMovement: { create: jest.fn().mockResolvedValue({}) },
      stockBalance: { update: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ quantity: D(1), value: D(0) }]),
    };
    const prisma = transactionPrisma(tx, 'salesInvoice', [document, document]);
    const posting = { post: jest.fn(), reverse: jest.fn().mockResolvedValue(undefined) };
    const { service } = dependencies(prisma, posting);

    await service.reverse(COMPANY_ID, USER_ID, 'sales', RETURN_ID);

    expect(tx.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: 'OUT',
        quantity: D(1),
        totalCost: D(0),
        referenceType: 'SALES_RETURN_REVERSAL',
      }),
    });
    expect(tx.stockBalance.update).toHaveBeenCalledWith({
      where: expect.any(Object),
      data: { quantity: { decrement: D(1) }, value: { decrement: D(0) } },
    });
  });

  it('reverses purchase returns using the stored landed inventory cost and releases all accumulators', async () => {
    const document = {
      ...summaryFields({
        id: RETURN_ID,
        invoiceNumber: 'PR-0001',
        status: InvoiceStatus.POSTED,
        documentType: InvoiceDocumentType.DEBIT_NOTE,
        originalInvoice: { invoiceNumber: 'PI-0001' },
      }),
      branchId: BRANCH_ID,
      warehouseId: WAREHOUSE_ID,
      journalEntryId: 'journal-3',
      lines: [
        {
          id: RETURN_LINE_ID,
          originalLineId: SOURCE_LINE_ID,
          itemId: ITEM_ID,
          quantity: D(1),
          unitPrice: D(10),
          taxRate: D(10),
          lineTotal: D(10),
          taxAmount: D(1),
          landedCostAmount: D(3),
          inventoryCostTotal: D(13),
        },
      ],
    };
    const originalLine = { id: SOURCE_LINE_ID, unitPrice: D(10), inventoryCostTotal: D(39) };
    const tx = {
      purchaseInvoice: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
      purchaseInvoiceLine: {
        findUnique: jest.fn().mockResolvedValue(originalLine),
        update: jest.fn().mockResolvedValue({}),
      },
      stockMovement: { create: jest.fn().mockResolvedValue({}) },
      stockBalance: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const prisma = transactionPrisma(tx, 'purchaseInvoice', [document, document]);
    const posting = { post: jest.fn(), reverse: jest.fn().mockResolvedValue(undefined) };
    const { service } = dependencies(prisma, posting);

    await service.reverse(COMPANY_ID, USER_ID, 'purchases', RETURN_ID);

    const update = tx.purchaseInvoiceLine.update.mock.calls[0]![0];
    expect(update.data).toMatchObject({
      returnedQuantity: { decrement: D(1) },
      returnedSubTotal: { decrement: D(10) },
      returnedCostTotal: { decrement: D(13) },
      returnedTaxTotal: { decrement: D(1) },
    });
    expect(tx.stockMovement.create.mock.calls[0]![0].data.totalCost.toFixed(4)).toBe('13.0000');
    expect(tx.stockMovement.create.mock.calls[0]![0].data.warehouseId).toBe(WAREHOUSE_ID);
    expect(posting.reverse).toHaveBeenCalledWith(
      expect.anything(),
      COMPANY_ID,
      USER_ID,
      'journal-3',
      'Reversal of purchase return PR-0001',
    );
  });
});
