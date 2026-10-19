import { InvoiceDocumentType, InvoiceStatus, Prisma } from '@prisma/client';
import { SalesInvoicesService } from './sales-invoices.service';

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const BRANCH_ID = '33333333-3333-4333-8333-333333333333';
const INVOICE_ID = '44444444-4444-4444-8444-444444444444';
const CUSTOMER_ID = '55555555-5555-4555-8555-555555555555';

describe('SalesInvoicesService.updateDraft', () => {
  it('updates a draft with the fixed discount reflected in line, tax and document totals', async () => {
    const existing = {
      id: INVOICE_ID,
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      documentType: InvoiceDocumentType.INVOICE,
      status: InvoiceStatus.DRAFT,
      invoiceNumber: 'SI-0001',
      invoiceDate: new Date('2026-10-01T00:00:00.000Z'),
      totalAmount: new Prisma.Decimal('22.0000'),
      deletedAt: null,
      warehouseId: null,
      lines: [],
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ status: InvoiceStatus.DRAFT }]),
      salesInvoice: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      salesInvoice: { findFirst: jest.fn().mockResolvedValue(existing) },
      customer: { findFirst: jest.fn().mockResolvedValue({ id: CUSTOMER_ID, isActive: true }) },
      $transaction: jest.fn(async (work: (client: unknown) => unknown) => work(tx)),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new SalesInvoicesService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      audit as never,
    );
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: INVOICE_ID } as never);
    jest.spyOn(service as any, 'prepareLines').mockResolvedValue([
      {
        lineNumber: 1,
        itemId: '66666666-6666-4666-8666-666666666666',
        description: 'Test item',
        quantity: new Prisma.Decimal('2'),
        unitPrice: new Prisma.Decimal('10'),
        taxRate: new Prisma.Decimal('10'),
        taxAmount: new Prisma.Decimal('2'),
        lineTotal: new Prisma.Decimal('20'),
        costCenterId: null,
      },
    ]);
    jest.spyOn(service as any, 'dueDateFromTerms').mockResolvedValue(null);

    await service.updateDraft(COMPANY_ID, BRANCH_ID, USER_ID, INVOICE_ID, {
      invoiceDate: '2026-10-19',
      customerId: CUSTOMER_ID,
      discountPercent: '0',
      discountAmount: '5',
      lines: [{ quantity: '2', unitPrice: '10', taxRate: '10' }],
    });

    expect(tx.salesInvoice.update).toHaveBeenCalledWith({
      where: { id: INVOICE_ID },
      data: expect.objectContaining({
        discountPercent: new Prisma.Decimal('0'),
        discountAmount: new Prisma.Decimal('5'),
        subTotal: new Prisma.Decimal('15.0000'),
        taxAmount: new Prisma.Decimal('1.5000'),
        totalAmount: new Prisma.Decimal('16.5000'),
        lines: {
          deleteMany: {},
          create: [
            expect.objectContaining({
              lineTotal: new Prisma.Decimal('15.0000'),
              taxAmount: new Prisma.Decimal('1.5000'),
              discountAmount: new Prisma.Decimal('5.0000'),
            }),
          ],
        },
      }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', entity: 'sales_invoices', entityId: INVOICE_ID }),
    );
  });
});
