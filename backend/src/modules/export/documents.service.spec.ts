import { DOCUMENT_KINDS, DOCUMENT_SPECS, DocumentsService } from './documents.service';

describe('document export catalogue', () => {
  it('names every printable document and the permission that opens it', () => {
    expect(DOCUMENT_KINDS).toEqual([
      'sales-invoice',
      'purchase-invoice',
      'sales-order',
      'purchase-order',
      'sales-quotation',
      'cash-voucher',
      'journal-entry',
    ]);
    for (const kind of DOCUMENT_KINDS) {
      expect(DOCUMENT_SPECS[kind].readPermission).toMatch(/\./);
      expect(DOCUMENT_SPECS[kind].exportPermission).toMatch(/\./);
    }
  });

  it('exports a quotation with the permissions its own screens use', () => {
    // A quotation is a document like an invoice, but it is not an invoice:
    // reading and exporting it follow the quotation permissions.
    expect(DOCUMENT_SPECS['sales-quotation'].readPermission).toBe(
      'sales.quotations.read',
    );
    expect(DOCUMENT_SPECS['sales-quotation'].exportPermission).toBe(
      'sales.quotations.export',
    );
  });
});

describe('quotation spreadsheet export', () => {
  const d = (value: string) => new (require('@prisma/client').Prisma.Decimal)(value);
  const quotation = {
    id: 'quotation-1',
    quotationNumber: 'QT-000010',
    quotationDate: new Date('2026-10-20'),
    validUntil: new Date('2026-11-19'),
    subject: 'Windows',
    currency: 'EGP',
    version: 1,
    status: 'DRAFT',
    subTotal: d('300.0000'),
    discountTotal: d('0.0000'),
    totalAmount: d('300.0000'),
    terms: null,
    customer: { code: 'C-1', nameEn: 'Alpha', nameAr: 'ألفا' },
    columns: [
      { key: 'description', visible: true, width: 4 },
      { key: 'quantity', visible: true, width: 1 },
      { key: 'color', labelEn: 'Colour', labelAr: 'اللون', visible: true, width: 2, numeric: false },
    ],
    tables: [
      {
        title: 'Windows',
        discountTotal: d('0.0000'),
        lines: [
          {
            description: 'Window 120',
            item: { code: 'W-1', nameEn: 'Window', nameAr: 'شباك' },
            countryOfOrigin: null,
            unit: 'PCS',
            quantity: d('1.0000'),
            unitPrice: d('100.0000'),
            lineTotal: d('100.0000'),
            customValues: { color: 'أزرق / Blue' },
          },
          {
            description: 'Window 150',
            item: { code: 'W-2', nameEn: 'Window', nameAr: 'شباك' },
            countryOfOrigin: null,
            unit: 'PCS',
            quantity: d('2.0000'),
            unitPrice: d('100.0000'),
            lineTotal: d('200.0000'),
            customValues: null,
          },
        ],
      },
    ],
  };

  type ExportedTable = {
    columns: Array<{ key: string; labelEn: string; labelAr: string; numeric?: boolean }>;
    rows: Array<Record<string, unknown>>;
  };

  const build = async () =>
    (await new DocumentsService({
      quotation: { findFirst: jest.fn().mockResolvedValue(quotation) },
    } as never).build('sales-quotation', 'company-1', 'quotation-1', 'en')) as unknown as ExportedTable;

  it('exports a user-defined column with its own label instead of failing', async () => {
    const table = await build();
    const colour = table.columns.find((column) => column.key === 'color');
    expect(colour).toMatchObject({ labelEn: 'Colour', labelAr: 'اللون', numeric: false });
    expect(table.columns.find((column) => column.key === 'quantity')?.numeric).toBe(true);
  });

  it('puts each line value under its column and keeps blank cells aligned', async () => {
    const table = await build();
    expect(table.rows[0].color).toBe('أزرق / Blue');
    expect(table.rows[1].color).toBe('');
    expect(table.rows[1].description).toBe('Window 150');
  });

  it('never asks the built-in catalogue about a key it does not know', async () => {
    const table = await build();
    expect(table.columns.map((column) => column.key)).toEqual([
      'table',
      'description',
      'quantity',
      'color',
    ]);
  });
});
