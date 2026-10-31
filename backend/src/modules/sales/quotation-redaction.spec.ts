import {
  QuotationSnapshot,
  renderQuotationDocument,
} from './quotation-document';
import { redactQuotationPrices } from './quotation-redaction';

const COMPANY = { logoData: null, logoMime: null };

function snapshot(): QuotationSnapshot {
  return {
    quotationNumber: 'QT-2026-0042',
    quotationDate: '2026-10-19',
    validUntil: null,
    currency: 'EGP',
    version: 1,
    status: 'SENT',
    customer: {
      code: 'CUS-9',
      nameEn: 'Delta Engineering',
      nameAr: 'دلتا للهندسة',
      phone: null,
      email: null,
      taxNumber: null,
      address: null,
    },
    company: {
      nameEn: 'KAYAN',
      nameAr: 'كيان',
      taxId: null,
      commercialRegistration: null,
      phone: null,
      email: null,
      address: null,
      addressAr: null,
    },
    showTaxId: false,
    subject: null,
    columns: [
      { key: 'itemCode', labelEn: null, labelAr: null, visible: true, width: 1 },
      { key: 'description', labelEn: null, labelAr: null, visible: true, width: 4 },
      { key: 'quantity', labelEn: null, labelAr: null, visible: true, width: 1 },
      { key: 'unitPrice', labelEn: null, labelAr: null, visible: true, width: 1 },
      { key: 'lineTotal', labelEn: null, labelAr: null, visible: true, width: 1 },
    ],
    managerName: null,
    responsibleName: null,
    responsiblePhone: null,
    notes: null,
    terms: 'الدفع خلال 30 يومًا',
    discountType: 'PERCENT',
    discountPercent: '5.0000',
    discountAmount: '71.0000',
    // Tax is part of `totals`, which is where the document reads it from; a
    // top-level copy is not part of the snapshot.
    tables: [
      {
        title: 'توريد وتركيب',
        sortOrder: 1,
        columns: [],
        subTotal: '1420.0000',
        discountPercent: '0.0000',
        discountAmount: '0.0000',
        netTotal: '1420.0000',
        lines: [
          {
            itemCode: 'SKU-1',
            description: 'سيرفر رفّي بمعالجين',
            countryOfOrigin: 'DE',
            unit: 'قطعة',
            quantity: '24.0000',
            unitPrice: '1420.0000',
            lineTotal: '1420.0000',
            customValues: {},
          },
        ],
      },
    ],
    totals: {
      subTotal: '1420.0000',
      discountTotal: '71.0000',
      totalAmount: '1537.8600',
      taxRate: '14.0000',
      taxAmount: '188.8600',
    },
    design: {},
  };
}

const MONEY = ['1,420.00', '71.00', '1,537.86', '188.86', '14.00'];

describe('a quotation printed without prices', () => {
  it('leaves no price, discount or total in the produced document', () => {
    const redacted = redactQuotationPrices(snapshot(), { showSalePrice: false });
    const html = renderQuotationDocument(redacted, COMPANY, 'ar', false);

    for (const figure of MONEY) {
      expect(html).not.toContain(figure);
    }
    // Even the column headings are gone, not just their values.
    expect(html).not.toContain('سعر الوحدة');
    expect(html).not.toContain('الإجمالي النهائي');
    expect(html).not.toContain('خصم العرض');
  });

  it('still prints the offer itself: customer, items, quantities and terms', () => {
    const redacted = redactQuotationPrices(snapshot(), { showSalePrice: false });
    const html = renderQuotationDocument(redacted, COMPANY, 'ar', false);

    expect(html).toContain('دلتا للهندسة');
    expect(html).toContain('سيرفر رفّي بمعالجين');
    expect(html).toContain('SKU-1');
    expect(html).toContain('الدفع خلال 30 يومًا');
    expect(html).toContain('QT-2026-0042');
    // The quantity column survives: a quote without prices still says how
    // many the customer would be buying.
    expect(html).toContain('24');
  });

  it('says why the prices are missing instead of looking broken', () => {
    const redacted = redactQuotationPrices(snapshot(), { showSalePrice: false });
    const html = renderQuotationDocument(redacted, COMPANY, 'ar', false);
    expect(html).toContain('طُبعت هذه النسخة دون أسعار');
  });

  it('never changes the stored quotation', () => {
    const original = snapshot();
    const before = JSON.stringify(original);
    redactQuotationPrices(original, { showSalePrice: false });
    expect(JSON.stringify(original)).toBe(before);
  });

  it('returns the same snapshot when the copy is allowed to show prices', () => {
    const original = snapshot();
    const same = redactQuotationPrices(original, { showSalePrice: true });
    expect(same).toBe(original);
    const html = renderQuotationDocument(same, COMPANY, 'ar', false);
    expect(html).toContain('1,420.00');
    expect(html).toContain('1,537.86');
  });

  it('keeps working in English, with the same guarantee', () => {
    const redacted = redactQuotationPrices(snapshot(), { showSalePrice: false });
    const html = renderQuotationDocument(redacted, COMPANY, 'en', false);
    for (const figure of MONEY) {
      expect(html).not.toContain(figure);
    }
    expect(html).toContain('printed without prices');
    expect(html).toContain('Delta Engineering');
  });
});
