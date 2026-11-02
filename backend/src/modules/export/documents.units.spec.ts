import { Prisma } from '@prisma/client';

import { DocumentsService } from './documents.service';

const D = (v: string | number) => new Prisma.Decimal(v);

/**
 * The same ReportTable feeds the Excel, CSV and PDF writers, so asserting on
 * its rows proves all three render the unit the user actually chose — not the
 * internal base-unit conversion.
 */
function serviceWith(lines: any[], model: 'salesInvoice' | 'purchaseInvoice') {
  const party = { code: 'P-1', nameEn: 'Party', nameAr: 'جهة' };
  const branch = { code: 'HQ', nameEn: 'HQ', nameAr: 'الرئيسية' };
  const invoice = {
    id: 'doc-1',
    invoiceNumber: 'DOC-1',
    invoiceDate: new Date('2026-10-27T00:00:00Z'),
    status: 'posted',
    notes: null,
    subTotal: D(124),
    taxAmount: D(0),
    totalAmount: D(124),
    customer: party,
    supplier: party,
    branch,
    lines,
  };
  const prisma = {
    [model]: { findFirst: jest.fn(async () => invoice) },
  } as Record<string, any>;
  return new DocumentsService(prisma as never);
}

const multiUnitLine = {
  lineNumber: 1,
  itemId: 'item-1',
  description: 'Milk',
  // One carton chosen by the user; internally ten base pieces.
  unitName: 'كرتونة',
  unitFactor: D(10),
  unitQuantity: D(1),
  quantity: D(10),
  unitPrice: D(97),
  taxAmount: D(0),
  lineTotal: D(97),
  item: { code: 'MILK', nameEn: 'Milk', nameAr: 'لبن', unit: 'علبة' },
};

const legacyLine = {
  lineNumber: 2,
  itemId: 'item-2',
  description: 'Old item',
  // No unit snapshot at all: a row written before multi-unit existed.
  unitName: null,
  unitFactor: null,
  unitQuantity: null,
  quantity: D(5),
  unitPrice: D(9),
  taxAmount: D(0),
  lineTotal: D(45),
  item: { code: 'OLD', nameEn: 'Old', nameAr: 'قديم', unit: 'piece' },
};

describe('document export unit display', () => {
  it('a sales invoice shows 1 carton at 97, never 10 pieces at 97', async () => {
    const service = serviceWith([multiUnitLine, legacyLine], 'salesInvoice');
    const table = await service.build('sales-invoice', 'company-1', 'doc-1', 'ar');

    const carton = table.rows[0];
    expect(carton.unit).toBe('كرتونة');
    expect(carton.quantity).toBe('1.0000');
    expect(carton.unitPrice).toBe('97.0000');
    expect(carton.lineTotal).toBe('97.0000');

    // Legacy row keeps its historical quantity and the item base unit.
    const legacy = table.rows[1];
    expect(legacy.unit).toBe('piece');
    expect(legacy.quantity).toBe('5.0000');
    expect(legacy.unitPrice).toBe('9.0000');
  });

  it('a purchase invoice renders the chosen purchase unit and entered quantity', async () => {
    const service = serviceWith([multiUnitLine], 'purchaseInvoice');
    const table = await service.build('purchase-invoice', 'company-1', 'doc-1', 'en');
    expect(table.rows[0].unit).toBe('كرتونة');
    expect(table.rows[0].quantity).toBe('1.0000');
    expect(table.rows[0].unitPrice).toBe('97.0000');
  });
});
