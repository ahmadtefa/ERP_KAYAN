import { DOCUMENT_KINDS, DOCUMENT_SPECS } from './documents.service';

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
