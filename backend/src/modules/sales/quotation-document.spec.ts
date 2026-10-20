import {
  QuotationSnapshot,
  quotationDocumentFileName,
  renderQuotationDocument,
} from './quotation-document';

const COMPANY = {
  logoData: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  logoMime: 'image/png',
};

function snapshot(overrides: Partial<QuotationSnapshot> = {}): QuotationSnapshot {
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
      {
        key: 'description',
        labelEn: null,
        labelAr: null,
        visible: true,
        width: 4,
      },
      { key: 'unit', labelEn: null, labelAr: null, visible: true, width: 1 },
      {
        key: 'quantity',
        labelEn: null,
        labelAr: null,
        visible: true,
        width: 1,
      },
      {
        key: 'unitPrice',
        labelEn: null,
        labelAr: null,
        visible: true,
        width: 2,
      },
      {
        key: 'lineTotal',
        labelEn: null,
        labelAr: null,
        visible: true,
        width: 2,
      },
      {
        key: 'countryOfOrigin',
        labelEn: null,
        labelAr: null,
        visible: false,
        width: 2,
      },
    ],
    managerName: 'Eng. Samir',
    responsibleName: 'Mona Adel',
    responsiblePhone: '+20 111 222 3333',
    notes: 'Delivery to the site.',
    terms: 'Payment within 30 days.\nPrices are valid for 30 days.',
    discountType: 'PERCENT',
    discountPercent: '2.0000',
    discountAmount: '0.0000',
    tables: [
      {
        title: 'Hardware',
        sortOrder: 1,
        subTotal: '1000.0000',
        discountPercent: '0.0000',
        discountAmount: '0.0000',
        netTotal: '1000.0000',
        lines: [
          {
            itemCode: 'SRV-1',
            description: 'Rack server with <script>alert(1)</script>',
            countryOfOrigin: 'DE',
            unit: 'piece',
            quantity: '2.0000',
            unitPrice: '400.0000',
            lineTotal: '800.0000',
          },
          {
            itemCode: null,
            description: 'Installation',
            countryOfOrigin: null,
            unit: 'service',
            quantity: '1.0000',
            unitPrice: '200.0000',
            lineTotal: '200.0000',
          },
        ],
      },
      {
        title: 'Software',
        sortOrder: 2,
        subTotal: '500.0000',
        discountPercent: '10.0000',
        discountAmount: '50.0000',
        netTotal: '450.0000',
        lines: [
          {
            itemCode: 'LIC-1',
            description: 'Annual licence',
            countryOfOrigin: null,
            unit: 'licence',
            quantity: '1.0000',
            unitPrice: '500.0000',
            lineTotal: '500.0000',
          },
        ],
      },
    ],
    totals: {
      subTotal: '1500.0000',
      discountTotal: '80.0000',
      totalAmount: '1420.0000',
    },
    ...overrides,
  };
}

describe('quotation document template', () => {
  it('renders the premium Arabic document with the real logo and every section', () => {
    const html = renderQuotationDocument(snapshot(), COMPANY, 'ar', false);

    expect(html).toContain('lang="ar" dir="rtl"');
    expect(html).toContain('<h2>عرض سعر</h2>');
    expect(html).toContain('QUOTATION');
    expect(html).toContain('كيان للحلول المتكاملة');
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('QT-2026-0007');
    expect(html).toContain('دلتا للهندسة');
    expect(html).toContain('CUST-TAX-77');
    expect(html).toContain('Hardware');
    expect(html).toContain('Software');
    expect(html).toContain('1,000.00 EGP');
    expect(html).toContain('1,420.00 EGP');
    expect(html).toContain('الشروط والأحكام');
    expect(html).toContain('Payment within 30 days.');
    expect(html).toContain('Eng. Samir');
    expect(html).toContain('Mona Adel');
  });

  it('lays the letterhead out as name, centred title, mark', () => {
    const html = renderQuotationDocument(snapshot(), COMPANY, 'ar', false);
    const header = html.slice(
      html.indexOf('<header class="masthead">'),
      html.indexOf('</header>'),
    );
    // One row: the company name at the start, the title in the middle and
    // the logo at the opposite end.
    expect(header.indexOf('<div class="brand">')).toBeGreaterThan(-1);
    expect(header.indexOf('<div class="title">')).toBeGreaterThan(
      header.indexOf('<div class="brand">'),
    );
    expect(header.indexOf('<div class="mark">')).toBeGreaterThan(
      header.indexOf('<div class="title">'),
    );
    expect(header).toContain('<h2>عرض سعر</h2>');
    expect(header).toContain('QT-2026-0007');
    expect(header).toContain('<img src="data:image/png;base64,');
  });

  it('renders every section title once in the header and once in the summary', () => {
    const html = renderQuotationDocument(snapshot(), COMPANY, 'ar', false);
    const hardware = html.split('Hardware').length - 1;
    const software = html.split('Software').length - 1;
    expect(hardware).toBe(2);
    expect(software).toBe(2);

    const summary = html.slice(
      html.indexOf('<section class="summary">'),
      html.indexOf('</section>', html.indexOf('<section class="summary">')),
    );
    // the header row, one row per section, the quotation-discount row and
    // the grand-total row in the table footer
    expect(summary.match(/<tr[\s>]/g)).toHaveLength(5);
    expect(summary).toContain('Hardware');
    expect(summary).toContain('Software');
  });

  it('summarises every table by name with its total, then the grand total', () => {
    const html = renderQuotationDocument(snapshot(), COMPANY, 'ar', false);
    const summaryStart = html.indexOf('<section class="summary">');
    const summary = html.slice(
      summaryStart,
      html.indexOf('</section>', summaryStart),
    );

    // Two columns: the description and the table total.
    expect(summary).toContain('البيان');
    expect(summary).toContain('إجمالي الجدول');

    // One row per table, carrying that table's net total (its own discount
    // is already applied once, on the table itself).
    const hardwareRow = summary.slice(
      summary.indexOf('<td>Hardware</td>'),
      summary.indexOf('</tr>', summary.indexOf('<td>Hardware</td>')),
    );
    expect(hardwareRow).toContain('1,000.00 EGP');
    const softwareRow = summary.slice(
      summary.indexOf('<td>Software</td>'),
      summary.indexOf('</tr>', summary.indexOf('<td>Software</td>')),
    );
    expect(softwareRow).toContain('450.00 EGP');

    // The offer-level discount appears once, between the section rows and
    // the grand total; the table discounts do not repeat here.
    expect(summary).toContain('خصم العرض');
    expect(summary).toContain('− 30.00 EGP');
    expect(summary).not.toContain('− 50.00 EGP');
    expect(summary).not.toContain('خصومات الجداول');

    // The grand total is the final row of the same table, and it is the
    // stored total — never a sum that discounts are applied to again.
    const grand = summary.slice(summary.indexOf('<tr class="grand">'));
    expect(grand).toContain('المجموع الكلي');
    expect(grand).toContain('1,420.00 EGP');
    expect(html.indexOf('<tr class="grand">')).toBeGreaterThan(
      html.indexOf('<td>Software</td>'),
    );
  });

  it('summarises a single-table offer and hides the summary for none', () => {
    const oneTable = {
      tables: [snapshot().tables[0]],
      totals: { subTotal: '1000.0000', discountTotal: '0.0000', totalAmount: '1000.0000' },
    };
    const single = renderQuotationDocument(snapshot(oneTable), COMPANY, 'ar', false);
    const summaryStart = single.indexOf('<section class="summary">');
    const summary = single.slice(
      summaryStart,
      single.indexOf('</section>', summaryStart),
    );
    expect(summary.match(/<tr[\s>]/g)).toHaveLength(3); // header + section + grand
    expect(summary).toContain('Hardware');
    expect(summary).not.toContain('خصم العرض');
    expect(summary).toContain('1,000.00 EGP');

    const empty = renderQuotationDocument(
      snapshot({ tables: [], totals: { subTotal: '0.0000', discountTotal: '0.0000', totalAmount: '0.0000' } }),
      COMPANY,
      'ar',
      false,
    );
    expect(empty).not.toContain('ملخص الجداول');
  });

  it('keeps the arithmetic of the stored totals and shows every discount once', () => {
    const html = renderQuotationDocument(snapshot(), COMPANY, 'en', false);
    expect(html).toContain('− 50.00 EGP'); // the table's own discount, on the table
    expect(html).toContain('− 30.00 EGP'); // the quotation-level part of the discounts
    expect(html).toContain('1,420.00 EGP');
    // The table discount is not repeated as "total discounts".
    expect(html).not.toContain('Total discounts');
    // Final total appears once: in the grand total row.
    expect(html.split('1,420.00 EGP').length - 1).toBe(1);
    // The section rows (1,000 net + 450 net) minus the offer discount (30)
    // equal the stored grand total; the page never re-derives it.
    expect(1000 + 450 - 30).toBe(1420);
  });

  it('places the company contact details in the footer, not the header', () => {
    const html = renderQuotationDocument(snapshot(), COMPANY, 'ar', false);
    const header = html.slice(html.indexOf('<header class="masthead">'), html.indexOf('</header>'));
    expect(header).not.toContain('+20 2 1234 5678');
    expect(header).not.toContain('sales@kayan.example');
    expect(header).not.toContain('TAX-999');

    const footer = html.slice(html.indexOf('<footer class="page-footer">'));
    expect(footer).toContain('+20 2 1234 5678');
    expect(footer).toContain('sales@kayan.example');
    expect(footer).toContain('TAX-999');
    expect(footer).toContain('CR-123');
    expect(footer).toContain('مدينة نصر، القاهرة');
    expect(footer).toContain('هذا العرض ليس فاتورة ضريبية.');
  });

  it('omits the company tax number when the offer turned it off', () => {
    const html = renderQuotationDocument(
      snapshot({ showTaxId: false }),
      COMPANY,
      'ar',
      false,
    );
    expect(html).not.toContain('TAX-999');
    expect(html).toContain('CUST-TAX-77');
  });

  it('handles a missing logo with a monogram and no image tag', () => {
    const html = renderQuotationDocument(
      snapshot(),
      { logoData: null, logoMime: null },
      'ar',
      false,
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('class="monogram"');
  });

  it('escapes user text and keeps long descriptions intact', () => {
    const html = renderQuotationDocument(snapshot(), COMPANY, 'en', false);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    const long = 'A'.repeat(400);
    const withLong = renderQuotationDocument(
      snapshot({
        tables: [
          {
            ...snapshot().tables[0],
            lines: [
              {
                ...snapshot().tables[0].lines[0],
                description: long,
              },
            ],
          },
        ],
        totals: {
          subTotal: '800.0000',
          discountTotal: '0.0000',
          totalAmount: '800.0000',
        },
      }),
      COMPANY,
      'en',
      false,
    );
    expect(withLong).toContain(long);
  });

  it('omits the toolbar for an auto-print page and keeps it for a preview', () => {
    expect(renderQuotationDocument(snapshot(), COMPANY, 'en', false)).toContain(
      'class="toolbar"',
    );
    expect(renderQuotationDocument(snapshot(), COMPANY, 'en', true)).not.toContain(
      'class="toolbar"',
    );
  });

  it('declares A4 portrait, repeating table headers and safe breaks', () => {
    const html = renderQuotationDocument(snapshot(), COMPANY, 'en', false);
    expect(html).toContain('@page { size: A4 portrait; margin: 12mm 12mm 16mm; }');
    expect(html).toContain('display: table-header-group');
    expect(html).toContain('break-inside: avoid');
    expect(html).toContain('break-after: avoid');
  });

  it('builds a safe file name from the real quotation number', () => {
    expect(quotationDocumentFileName('QT-2026-0007')).toBe(
      'quotation-QT-2026-0007.pdf',
    );
    expect(quotationDocumentFileName('QT/2026 0007')).toBe(
      'quotation-QT-2026-0007.pdf',
    );
    expect(quotationDocumentFileName('', 'fallback-id')).toBe(
      'quotation-fallback-id.pdf',
    );
  });
});
