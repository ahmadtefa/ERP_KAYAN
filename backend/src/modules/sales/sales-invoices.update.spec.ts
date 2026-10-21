import { InvoiceDocumentType, InvoiceStatus, Prisma } from '@prisma/client';
import { SalesInvoicesService } from './sales-invoices.service';

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const BRANCH_ID = '33333333-3333-4333-8333-333333333333';
const INVOICE_ID = '44444444-4444-4444-8444-444444444444';
const CUSTOMER_ID = '55555555-5555-4555-8555-555555555555';
const ITEM_ID = '66666666-6666-4666-8666-666666666666';

/// A draft may be replaced; a posted invoice may not. These tests pin the
/// write path: the discount detail and the totals the prepare step computed
/// must reach the row, and the audit trail must say an update happened.
describe('SalesInvoicesService.updateDraft', () => {
  function serviceWith(existing: Record<string, unknown>) {
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
    jest.spyOn(service as any, 'dueDateFromTerms').mockResolvedValue(null);
    return { service, tx, prisma, audit };
  }

  it('writes the discounted line, the document discount and the reconciled totals', async () => {
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
    };
    const { service, tx, audit } = serviceWith(existing);
    jest.spyOn(service as any, 'prepareLines').mockResolvedValue({
        lines: [
          {
            lineNumber: 1,
            itemId: ITEM_ID,
            description: 'Test item',
            quantity: new Prisma.Decimal('2'),
            unitPrice: new Prisma.Decimal('10'),
            taxRate: new Prisma.Decimal('10'),
            taxAmount: new Prisma.Decimal('1.5000'),
            lineTotal: new Prisma.Decimal('15.0000'),
            grossLineTotal: new Prisma.Decimal('20.0000'),
            discountType: null,
            discountPercent: new Prisma.Decimal('0'),
            discountAmount: new Prisma.Decimal('0'),
            invoiceDiscountAmount: new Prisma.Decimal('5.0000'),
            costCenterId: null,
          },
        ],
        documentDiscount: {
          type: 'AMOUNT',
          percent: new Prisma.Decimal('0'),
          amount: new Prisma.Decimal('5.0000'),
          base: new Prisma.Decimal('20.0000'),
          net: new Prisma.Decimal('15.0000'),
        },
        lineDiscountTotal: new Prisma.Decimal('0'),
      });

    await service.updateDraft(COMPANY_ID, BRANCH_ID, USER_ID, INVOICE_ID, {
      invoiceDate: '2026-10-19',
      customerId: CUSTOMER_ID,
      discountType: 'AMOUNT',
      discountAmount: '5',
      lines: [{ quantity: '2', unitPrice: '10' }],
    } as never);

    expect(tx.salesInvoice.update).toHaveBeenCalledWith({
      where: { id: INVOICE_ID },
      data: expect.objectContaining({
        discountType: 'AMOUNT',
        discountAmount: new Prisma.Decimal('5.0000'),
        lineDiscountTotal: new Prisma.Decimal('0'),
        subTotal: new Prisma.Decimal('15.0000'),
        taxAmount: new Prisma.Decimal('1.5000'),
        totalAmount: new Prisma.Decimal('16.5000'),
        lines: {
          deleteMany: {},
          create: [
            expect.objectContaining({
              lineTotal: new Prisma.Decimal('15.0000'),
              grossLineTotal: new Prisma.Decimal('20.0000'),
              invoiceDiscountAmount: new Prisma.Decimal('5.0000'),
            }),
          ],
        },
      }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', entity: 'sales_invoices', entityId: INVOICE_ID }),
    );
  });

  it('refuses to rewrite a posted invoice', async () => {
    const existing = {
      id: INVOICE_ID,
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      documentType: InvoiceDocumentType.INVOICE,
      status: InvoiceStatus.POSTED,
      totalAmount: new Prisma.Decimal('22.0000'),
      deletedAt: null,
    };
    const { service } = serviceWith(existing);

    await expect(
      service.updateDraft(COMPANY_ID, BRANCH_ID, USER_ID, INVOICE_ID, {
        invoiceDate: '2026-10-19',
        customerId: CUSTOMER_ID,
        lines: [{ quantity: '1', unitPrice: '1' }],
      } as never),
    ).rejects.toThrow('Only a draft sales invoice can be edited');
  });
});
