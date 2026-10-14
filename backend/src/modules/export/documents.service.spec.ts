import { DOCUMENT_KINDS, DOCUMENT_SPECS } from './documents.service';

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
