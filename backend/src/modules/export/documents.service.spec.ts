import { Prisma } from '@prisma/client';
import { DocumentsService, DOCUMENT_KINDS, DOCUMENT_SPECS } from './documents.service';

describe('document export catalogue', () => {
  it('names every printable document and the permission that opens it', () => {
    expect(DOCUMENT_KINDS).toEqual([
      'sales-invoice',
      'purchase-invoice',
      'sales-order',
      'purchase-order',
      'cash-voucher',
      'journal-entry',
    ]);
    for (const kind of DOCUMENT_KINDS) {
      expect(DOCUMENT_SPECS[kind].readPermission).toMatch(/\./);
      expect(DOCUMENT_SPECS[kind].exportPermission).toMatch(/\./);
    }
  });
});


describe('invoice discount document export', () => {
  const invoice = {
    id: '44444444-4444-4444-8444-444444444444',
    invoiceNumber: 'SI-0001',
    invoiceDate: new Date('2026-10-19T00:00:00.000Z'),
    status: 'DRAFT',
    customer: { code: 'C-1', nameEn: 'Customer', nameAr: 'عميل' },
    supplier: { code: 'S-1', nameEn: 'Supplier', nameAr: 'مورد' },
    branch: { code: 'B-1', nameEn: 'Main', nameAr: 'الرئيسي' },
    notes: null,
    subTotal: new Prisma.Decimal('90'),
    discountPercent: new Prisma.Decimal('10'),
    discountAmount: new Prisma.Decimal('10'),
    taxAmount: new Prisma.Decimal('12.6'),
    totalAmount: new Prisma.Decimal('102.6'),
    lines: [{
      lineNumber: 1,
      item: { code: 'ITEM-1', nameEn: 'Item', nameAr: 'صنف', unit: 'piece' },
      description: 'Item',
      quantity: new Prisma.Decimal('1'),
      unitPrice: new Prisma.Decimal('100'),
      discountAmount: new Prisma.Decimal('10'),
      taxAmount: new Prisma.Decimal('12.6'),
      lineTotal: new Prisma.Decimal('90'),
    }],
  };

  it('prints sales invoice discount and the reconstructed gross subtotal', async () => {
    const prisma = {
      salesInvoice: { findFirst: jest.fn().mockResolvedValue(invoice) },
    };
    const service = new DocumentsService(prisma as never);
    const table = await service.build('sales-invoice', 'company-id', invoice.id, 'en');

    expect(table.columns.map(column => column.key)).toContain('discountAmount');
    expect(table.rows[0].discountAmount).toBe('10.0000');
    expect(table.totals).toEqual(expect.arrayContaining([
      expect.objectContaining({ labelEn: 'Subtotal before discount', value: '100.0000' }),
      expect.objectContaining({ labelEn: 'Discount', value: '-10.0000' }),
      expect.objectContaining({ labelEn: 'Total', value: '102.6000' }),
    ]));
  });

  it('prints purchase invoice discount and the reconstructed gross subtotal', async () => {
    const prisma = {
      purchaseInvoice: { findFirst: jest.fn().mockResolvedValue(invoice) },
    };
    const service = new DocumentsService(prisma as never);
    const table = await service.build('purchase-invoice', 'company-id', invoice.id, 'en');

    expect(table.rows[0].discountAmount).toBe('10.0000');
    expect(table.totals).toEqual(expect.arrayContaining([
      expect.objectContaining({ labelEn: 'Subtotal before discount', value: '100.0000' }),
      expect.objectContaining({ labelEn: 'Discount', value: '-10.0000' }),
    ]));
  });
});
