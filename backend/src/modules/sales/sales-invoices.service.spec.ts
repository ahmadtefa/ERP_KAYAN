import { InvoiceStatus, Prisma, StockDirection } from '@prisma/client';

import { SalesInvoicesService } from './sales-invoices.service';

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const BRANCH_ID = '33333333-3333-4333-8333-333333333333';
const INVOICE_ID = '44444444-4444-4444-8444-444444444444';
const JOURNAL_ID = '55555555-5555-4555-8555-555555555555';
const WAREHOUSE_ID = '66666666-6666-4666-8666-666666666666';
const TRACKED_ITEM_ID = '77777777-7777-4777-8777-777777777777';
const SERVICE_ITEM_ID = '88888888-8888-4888-8888-888888888888';

function serviceWith(prisma: Record<string, any>, tx: Record<string, any>) {
  const numbers = { next: jest.fn().mockResolvedValue('JV-REV-1') };
  // The mirror entry itself is the central PostingService's job now;
  // this spec asserts the invoice delegates to it (and what the invoice
  // still owns: the stock coming back).
  const posting = {
    reverse: jest
      .fn()
      .mockResolvedValue({ id: 'reversal-id', entryNumber: 'JV-REV-1' }),
  };
  const warehouses = { resolveForReversal: jest.fn().mockResolvedValue(WAREHOUSE_ID) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new SalesInvoicesService(
    prisma as never,
    numbers as never,
    posting as never,
    {} as never,
    {} as never,
    warehouses as never,
    {} as never,
    audit as never,
  );
  jest.spyOn(service, 'findOne').mockResolvedValue({ id: INVOICE_ID } as never);
  return { service, numbers, posting, warehouses, audit, tx };
}

describe('SalesInvoicesService.reverse', () => {
  const invoice = (lines: any[] = []) => ({
    id: INVOICE_ID,
    companyId: COMPANY_ID,
    branchId: BRANCH_ID,
    warehouseId: WAREHOUSE_ID,
    invoiceNumber: 'SI-0001',
    status: InvoiceStatus.POSTED,
    journalEntryId: JOURNAL_ID,
    lines,
  });
  const originalJournal = {
    id: JOURNAL_ID,
    branchId: BRANCH_ID,
    currency: 'EGP',
    totalDebit: new Prisma.Decimal(0),
    totalCredit: new Prisma.Decimal(0),
    lines: [],
  };

  it('refuses to reverse a source invoice while a posted sales return is active', async () => {
    const tx = {
      salesInvoice: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(1),
      },
      journalEntry: { updateMany: jest.fn(), create: jest.fn() },
      stockMovement: { create: jest.fn() },
      stockBalance: { upsert: jest.fn() },
    };
    const prisma = {
      salesInvoice: { findFirst: jest.fn().mockResolvedValue(invoice()) },
      journalEntry: { findFirst: jest.fn().mockResolvedValue(originalJournal) },
      $transaction: jest.fn(async (work: (client: unknown) => unknown) => work(tx)),
    };
    const { service } = serviceWith(prisma, tx);

    await expect(service.reverse(COMPANY_ID, USER_ID, INVOICE_ID)).rejects.toThrow(
      /reverse the posted sales returns/i,
    );

    expect(tx.salesInvoice.count).toHaveBeenCalledWith({
      where: {
        companyId: COMPANY_ID,
        originalInvoiceId: INVOICE_ID,
        documentType: 'CREDIT_NOTE',
        status: InvoiceStatus.POSTED,
        deletedAt: null,
      },
    });
    expect(tx.journalEntry.updateMany).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('reverses zero-cost tracked stock into its historical warehouse, but not a non-stock line', async () => {
    const lines = [
      {
        lineNumber: 1,
        itemId: TRACKED_ITEM_ID,
        quantity: new Prisma.Decimal(2),
        unitCost: new Prisma.Decimal(0),
        costTotal: new Prisma.Decimal(0),
      },
      {
        lineNumber: 2,
        itemId: SERVICE_ITEM_ID,
        quantity: new Prisma.Decimal(1),
        unitCost: new Prisma.Decimal(0),
        costTotal: new Prisma.Decimal(0),
      },
    ];
    const tx = {
      salesInvoice: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
      journalEntry: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'reversal-id', entryNumber: 'JV-REV-1' }),
      },
      item: {
        findFirst: jest.fn(async ({ where }: { where: { id: string } }) => ({
          id: where.id,
          isStockTracked: where.id === TRACKED_ITEM_ID,
        })),
      },
      stockMovement: { create: jest.fn().mockResolvedValue({}) },
      stockBalance: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      salesInvoice: { findFirst: jest.fn().mockResolvedValue(invoice(lines)) },
      journalEntry: { findFirst: jest.fn().mockResolvedValue(originalJournal) },
      $transaction: jest.fn(async (work: (client: unknown) => unknown) => work(tx)),
    };
    const { service, numbers, posting, warehouses, audit } = serviceWith(prisma, tx);

    await service.reverse(COMPANY_ID, USER_ID, INVOICE_ID);

    expect(warehouses.resolveForReversal).toHaveBeenCalledWith(
      tx,
      COMPANY_ID,
      BRANCH_ID,
      WAREHOUSE_ID,
    );
    expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);
    expect(tx.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: COMPANY_ID,
        branchId: BRANCH_ID,
        warehouseId: WAREHOUSE_ID,
        itemId: TRACKED_ITEM_ID,
        direction: StockDirection.IN,
        quantity: new Prisma.Decimal(2),
        unitCost: new Prisma.Decimal(0),
        totalCost: new Prisma.Decimal(0),
        referenceType: 'SALES_INVOICE_REVERSAL',
      }),
    });
    expect(tx.stockBalance.upsert).toHaveBeenCalledTimes(1);
    // The mirror goes through the one central reversal path — the
    // invoice no longer claims/creates journal rows itself.
    expect(posting.reverse).toHaveBeenCalledWith(
      tx,
      COMPANY_ID,
      USER_ID,
      JOURNAL_ID,
      'Reversal of sales invoice SI-0001',
    );
    expect(numbers.next).not.toHaveBeenCalledWith(tx, COMPANY_ID, 'JOURNAL', 'JV');
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REVERSE', entity: 'sales_invoices' }),
    );
  });
});
