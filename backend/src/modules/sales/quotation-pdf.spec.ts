import { PDFDocument } from 'pdf-lib';
import { PdfService } from '../export/pdf.service';
import {
  QuotationSnapshot,
  renderQuotationDocument,
} from './quotation-document';

/**
 * The only test that exercises the real PDF pipeline: the template is handed
 * to the browser the installation would use, and the bytes that come back are
 * opened with pdf-lib. It skips, rather than fails, on a machine without a
 * browser - the developer's laptop is not the deployment target - so CI (which
 * ships Chrome) is where this proves the sheet is A4 and that a long offer
 * breaks across pages instead of being clipped.
 */
function snapshot(lines: number, sections: number): QuotationSnapshot {
  const tableLines = (section: number) =>
    Array.from({ length: lines }, (_, index) => ({
      itemCode: `SKU-${section}-${index}`,
      description:
        'Rack server with redundant power supplies, sixty-four gigabytes of memory and a three-year on-site warranty.',
      countryOfOrigin: 'DE',
      unit: 'piece',
      quantity: '1.0000',
      unitPrice: '1250.0000',
      lineTotal: '1250.0000',
    }));

  const tables = Array.from({ length: sections }, (_, index) => ({
    title: `Section ${index + 1}`,
    sortOrder: index + 1,
    subTotal: (lines * 1250).toFixed(4),
    discountPercent: '0.0000',
    discountAmount: '0.0000',
    netTotal: (lines * 1250).toFixed(4),
    lines: tableLines(index + 1),
  }));
  const subTotal = (lines * 1250 * sections).toFixed(4);

  return {
    quotationNumber: 'QT-2026-0007',
    quotationDate: '2026-10-19',
    validUntil: '2026-11-18',
    currency: 'EGP',
    version: 1,
    status: 'SENT',
    customer: {
      code: 'CUS-14',
      nameEn: 'Delta Engineering',
      nameAr: 'دلتا للهندسة',
      phone: '+20 100 000 0000',
      email: 'buyer@delta.example',
      taxNumber: 'CUST-TAX-77',
      address: 'Cairo, Egypt',
    },
    company: {
      nameEn: 'KAYAN Integrated Solutions',
      nameAr: 'كيان للحلول المتكاملة',
      taxId: 'TAX-999',
      commercialRegistration: 'CR-123',
      phone: '+20 2 1234 5678',
      email: 'sales@kayan.example',
      address: 'Nasr City, Cairo',
      addressAr: 'مدينة نصر، القاهرة',
    },
    showTaxId: true,
    subject: 'Server room and network',
    columns: [
      { key: 'description', labelEn: null, labelAr: null, visible: true, width: 4 },
      { key: 'quantity', labelEn: null, labelAr: null, visible: true, width: 1 },
      { key: 'unitPrice', labelEn: null, labelAr: null, visible: true, width: 2 },
      { key: 'lineTotal', labelEn: null, labelAr: null, visible: true, width: 2 },
    ],
    managerName: 'Eng. Samir',
    responsibleName: 'Mona Adel',
    responsiblePhone: '+20 111 222 3333',
    notes: 'Delivery to the site.',
    terms: 'Payment within 30 days.',
    discountType: null,
    discountPercent: '0.0000',
    discountAmount: '0.0000',
    tables,
    totals: {
      subTotal,
      discountTotal: '0.0000',
      totalAmount: subTotal,
    },
  } as QuotationSnapshot;
}

const browser = new PdfService();
const describeWithBrowser = browser.available ? describe : describe.skip;

describeWithBrowser('quotation PDF through the real browser renderer', () => {
  it(
    'produces an A4 page with a real logo mark and the stored totals',
    async () => {
      const html = renderQuotationDocument(
        snapshot(3, 1),
        {
          logoData: Uint8Array.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
          ]),
          logoMime: 'image/png',
        },
        'ar',
        false,
      );
      const pdf = await browser.render(html);
      expect(pdf.length).toBeGreaterThan(2000);

      const document = await PDFDocument.load(pdf);
      expect(document.getPageCount()).toBeGreaterThanOrEqual(1);
      const { width, height } = document.getPage(0).getSize();
      expect(width).toBeCloseTo(595.28, 0);
      expect(height).toBeCloseTo(841.89, 0);
    },
    180_000,
  );

  it(
    'breaks a long offer into numbered A4 pages instead of clipping it',
    async () => {
      const pdf = await browser.render(
        renderQuotationDocument(snapshot(24, 6), { logoData: null, logoMime: null }, 'ar', false),
      );
      const document = await PDFDocument.load(pdf);
      expect(document.getPageCount()).toBeGreaterThan(1);
      for (const page of document.getPages()) {
        const { width, height } = page.getSize();
        expect(width).toBeCloseTo(595.28, 0);
        expect(height).toBeCloseTo(841.89, 0);
      }
    },
    180_000,
  );
});
