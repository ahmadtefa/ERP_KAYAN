import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';
import { PdfService } from '../export/pdf.service';
import {
  QUOTATION_PAGE_NUMBER,
  QuotationSnapshot,
  quotationPageNumberInk,
  renderQuotationDocument,
} from './quotation-document';

/**
 * The only test that exercises the real PDF pipeline: the template is handed
 * to the browser the installation would use, and the bytes that come back are
 * opened with pdf-lib.
 *
 * It skips, rather than fails, on a machine without a browser - the
 * developer's laptop is not the deployment target - so CI (which ships Chrome)
 * is where this proves what the customer receives: a sheet whose design is
 * painted on every page, whose Arabic is embedded, and whose page number sits
 * in the band where it belongs.
 */
function snapshot(
  lines: number,
  sections: number,
  options: { language?: 'en' | 'ar'; custom?: boolean; discount?: boolean; short?: boolean } = {},
): QuotationSnapshot {
  const arabic = options.language === 'ar';
  const tableLines = (section: number) =>
    Array.from({ length: lines }, (_, index) => ({
      itemCode: arabic ? `صنف-${section}-${index}` : `SKU-${section}-${index}`,
      description: arabic
        ? 'خادم حاسوبي مزود بوحدتي تغذية وذاكرة سعة أربعة وستين جيجابايت وضمان موقعي لثلاث سنوات.'
        : options.short
          ? 'Rack server, 64 GB memory, three-year on-site warranty.'
          : 'Rack server with redundant power supplies, sixty-four gigabytes of memory and a three-year on-site warranty.',
      countryOfOrigin: arabic ? 'ألمانيا' : 'DE',
      unit: arabic ? 'قطعة' : 'piece',
      quantity: '1.0000',
      unitPrice: '1250.0000',
      lineTotal: '1250.0000',
      ...(options.custom
        ? {
            customValues: {
              origin: 'Germany',
              leadTime: '14 days',
              weight: '12.5',
            },
          }
        : {}),
    }));

  const tables = Array.from({ length: sections }, (_, index) => {
    const gross = lines * 1250;
    const discount = options.discount ? Math.round(gross * 0.05 * 10000) / 10000 : 0;
    return {
      title: arabic ? `قسم ${index + 1}` : `Section ${index + 1}`,
      sortOrder: index + 1,
      subTotal: gross.toFixed(4),
      discountPercent: options.discount ? '5.0000' : '0.0000',
      discountAmount: discount.toFixed(4),
      netTotal: (gross - discount).toFixed(4),
      lines: tableLines(index + 1),
      ...(options.custom ? { columns: customColumns() } : {}),
    };
  });
  const subTotal = tables.reduce((sum, table) => sum + Number(table.subTotal), 0);
  const discountTotal = tables.reduce((sum, table) => sum + Number(table.discountAmount), 0);
  const net = subTotal - discountTotal;
  const taxAmount = Math.round(net * 0.14 * 10000) / 10000;

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
      nameAr: 'دلتا للهندسة والمقاولات',
      phone: '+20 100 000 0000',
      email: 'buyer@delta.example',
      taxNumber: 'CUST-TAX-77',
      address: arabic ? 'القاهرة، مصر' : 'Cairo, Egypt',
    },
    company: {
      nameEn: 'KAYAN Integrated Solutions',
      nameAr: 'كيان للحلول المتكاملة',
      taxId: 'TAX-999-888',
      commercialRegistration: 'CR-123456',
      phone: '+20 2 1234 5678',
      email: 'sales@kayan.example',
      address: 'Nasr City, Cairo',
      addressAr: 'مدينة نصر، القاهرة',
    },
    showTaxId: true,
    subject: arabic ? 'غرفة الخدمات والشبكة' : 'Server room and network',
    columns: options.custom
      ? customColumns()
      : [
          { key: 'description', labelEn: null, labelAr: null, visible: true, width: 4 },
          { key: 'quantity', labelEn: null, labelAr: null, visible: true, width: 1 },
          { key: 'unitPrice', labelEn: null, labelAr: null, visible: true, width: 2 },
          { key: 'lineTotal', labelEn: null, labelAr: null, visible: true, width: 2 },
        ],
    managerName: arabic ? 'م. سمير عبد الله' : 'Eng. Samir',
    responsibleName: arabic ? 'منى عادل' : 'Mona Adel',
    responsiblePhone: '+20 111 222 3333',
    notes: arabic ? 'التسليم إلى موقع العميل.' : 'Delivery to the site.',
    terms: arabic
      ? 'السداد خلال ثلاثين يوماً من تاريخ العرض.'
      : 'Payment within 30 days.',
    discountType: options.discount ? 'PERCENT' : null,
    discountPercent: '0.0000',
    discountAmount: '0.0000',
    tables,
    totals: {
      subTotal: subTotal.toFixed(4),
      discountTotal: discountTotal.toFixed(4),
      taxRate: '14',
      taxAmount: taxAmount.toFixed(4),
      totalAmount: (net + taxAmount).toFixed(4),
    },
  } as QuotationSnapshot;
}

/// The layout case 3 is about: three user-defined columns with their own
/// names, a numeric one among them, in the order the offer stores them.
function customColumns() {
  return [
    { key: 'description', labelEn: null, labelAr: null, visible: true, width: 4 },
    { key: 'quantity', labelEn: null, labelAr: null, visible: true, width: 1 },
    { key: 'origin', labelEn: 'Country of origin', labelAr: 'بلد المنشأ', visible: true, width: 2, kind: 'text' as const },
    { key: 'leadTime', labelEn: 'Lead time', labelAr: 'مدة التوريد', visible: true, width: 2, kind: 'text' as const },
    { key: 'weight', labelEn: 'Weight (kg)', labelAr: 'الوزن (كجم)', visible: true, width: 1, kind: 'number' as const },
    { key: 'lineTotal', labelEn: null, labelAr: null, visible: true, width: 2 },
  ];
}

const LOGO = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const browser = new PdfService();
const describeWithBrowser = browser.available ? describe : describe.skip;

/// The drawing instructions of every page, decompressed: what a viewer reads.
async function pageDrawing(pdf: Buffer): Promise<string[]> {
  const document = await PDFDocument.load(pdf);
  const decoder = new TextDecoder('latin1');
  return document.getPages().map((page) => {
    const contents = page.node.Contents();
    if (!contents) return '';
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((reference) => document.context.lookup(reference))
        : [contents];
    return streams
      .map((stream) =>
        stream instanceof PDFRawStream
          ? decoder.decode(decodePDFRawStream(stream).decode())
          : '',
      )
      .join('\n');
  });
}

/// Whether this page paints the logo: an image, at the page level or inside
/// the form XObject Chromium wraps the repeating design layer in.
function paintsAnImage(document: PDFDocument, pageIndex: number): boolean {
  const entriesOf = (object: unknown): PDFDict | null => {
    if (object instanceof PDFDict) return object;
    if (object instanceof PDFRawStream) return object.dict;
    return null;
  };
  const visit = (resources: unknown, depth: number): boolean => {
    const dictionary = entriesOf(resources);
    if (!dictionary || depth > 3) return false;
    const xobjects = dictionary.lookup(PDFName.of('XObject'));
    const xobjectDict = entriesOf(xobjects);
    if (!xobjectDict) return false;
    for (const [, reference] of xobjectDict.entries()) {
      const object = entriesOf(document.context.lookup(reference));
      if (!object) continue;
      const subtype = object.get(PDFName.of('Subtype'))?.toString();
      if (subtype === '/Image') return true;
      if (subtype === '/Form' && visit(object.lookup(PDFName.of('Resources')), depth + 1)) {
        return true;
      }
    }
    return false;
  };
  return visit(document.getPage(pageIndex).node.Resources(), 0);
}

/// The fonts the page may use, by base name.
function pageFonts(document: PDFDocument, pageIndex: number): string[] {
  const resources = document.getPage(pageIndex).node.Resources();
  const fonts = resources?.lookup(PDFName.of('Font'));
  if (!(fonts instanceof PDFDict)) return [];
  const names: string[] = [];
  for (const [, reference] of fonts.entries()) {
    const font = document.context.lookup(reference);
    if (font instanceof PDFDict) {
      names.push(font.get(PDFName.of('BaseFont'))?.toString() ?? '');
    }
  }
  return names;
}

/// Every page must carry the design: a band of brand navy across the full
/// sheet, the logo, the Arabic face, and on top of that exactly one page
/// number, drawn after the browser finished.
async function expectDesignedPages(pdf: Buffer, pageCount: number) {
  expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  const document = await PDFDocument.load(pdf);
  expect(document.getPageCount()).toBe(pageCount);
  const drawing = await pageDrawing(pdf);

  drawing.forEach((page, index) => {
    const { width, height } = document.getPage(index).getSize();
    expect(width).toBeCloseTo(595.28, 0);
    expect(height).toBeCloseTo(841.89, 0);

    // The bands: a filled rectangle as wide as the sheet and at least 20mm
    // tall, repeated by Chromium on this page.
    const bands = [...page.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re/g)]
      .map((match) => ({
        width: Number(match[3]),
        height: Number(match[4]),
      }))
      .filter((rectangle) => rectangle.width > 560 && rectangle.height > 55);
    expect(bands.length).toBeGreaterThan(0);

    // The logo, painted on this page.
    expect(paintsAnImage(document, index)).toBe(true);

    // The bundled Arabic face and the standard face of the stamped number.
    const fonts = pageFonts(document, index).join(' ');
    expect(fonts).toMatch(/NotoNaskhArabic/);
    expect(fonts).toMatch(/Helvetica/);

    // Exactly one "n / N", the right one, and it is not made by the stylesheet.
    const labels = [...page.matchAll(/<([0-9A-F]+)> Tj/g)].map((match) =>
      Buffer.from(match[1], 'hex').toString('latin1'),
    );
    const numbers = labels.filter((label) => /^\d+ \/ \d+$/.test(label));
    expect(numbers).toEqual([`${index + 1} / ${pageCount}`]);
  });

  // Nothing points at the network: no link annotations, no remote resources.
  const bytes = pdf.toString('latin1');
  expect((bytes.match(/\/URI/g) ?? []).length).toBe(0);
  expect((bytes.match(/https?:\/\//g) ?? []).length).toBe(0);
}

const render = async (content: QuotationSnapshot, language: 'en' | 'ar' = 'en') => {
  const html = renderQuotationDocument(
    content,
    { logoData: LOGO, logoMime: 'image/png' },
    language,
    false,
  );
  const pdf = await browser.render(html, {
    fullBleed: true,
    pageNumberColor: quotationPageNumberInk(content.design),
    pageNumberY: QUOTATION_PAGE_NUMBER.y,
    pageNumberSize: QUOTATION_PAGE_NUMBER.size,
  });
  // The design can only be printed through the browser's own protocol: the
  // command line printer would have dropped the background, and a test that
  // let it pass anyway would be checking a file nobody would recognise.
  expect(browser.lastRenderRoute).toBe('devtools');
  return { html, pdf };
};

describeWithBrowser('quotation PDF through the real browser renderer', () => {
  // The five documents a quotation actually has to survive. Each one is a
  // complete print, through the same code the download button calls.
  const cases: Array<[string, QuotationSnapshot, 'en' | 'ar', number]> = [
    // 1. A short offer that must stay on one page.
    ['one page', snapshot(2, 1, { short: true }), 'en', 1],
    // 2. A long offer that must break across at least three, losing nothing.
    ['three or more pages', snapshot(20, 4), 'en', 3],
    // 3. Many items, and user-defined columns of more than one kind.
    ['many items and mixed custom columns', snapshot(26, 3, { custom: true }), 'en', 3],
    // 4. Arabic throughout: company, customer, items, terms, notes.
    ['fully Arabic', snapshot(12, 2, { language: 'ar' }), 'ar', 1],
    // 5. Table and quotation discounts, VAT, terms, notes, signatures.
    ['discounts, totals, terms and signatures', snapshot(5, 2, { discount: true }), 'en', 1],
  ];

  it.each(cases)('prints %s with the design on every page', async (_name, content, language, minimum) => {
    const { pdf } = await render(content, language);
    const document = await PDFDocument.load(pdf);
    expect(pdf.length).toBeGreaterThan(20_000);
    expect(document.getPageCount()).toBeGreaterThanOrEqual(minimum);
    await expectDesignedPages(pdf, document.getPageCount());
  }, 240_000);

  it(
    'keeps a one-page offer on one page instead of spilling a blank sheet',
    async () => {
      const { pdf } = await render(snapshot(2, 1, { short: true }));
      expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    },
    240_000,
  );

  it(
    'prints the custom column names, in their stored order',
    async () => {
      const { html } = await render(snapshot(6, 1, { custom: true }));
      const order = [
        'Country of origin',
        'Lead time',
        'Weight (kg)',
        'Total',
      ].map((label) => html.indexOf(`>${label}</th>`));
      expect(order.every((position) => position > 0)).toBe(true);
      expect([...order].sort((left, right) => left - right)).toEqual(order);
      // And the cells the user typed, not the empty space of an unknown column.
      expect(html).toContain('14 days');
      expect(html).toContain('12.5');
    },
    240_000,
  );

  it(
    'writes the Arabic in the bundled face, not in a system guess',
    async () => {
      const { pdf } = await render(snapshot(12, 2, { language: 'ar' }), 'ar');
      const document = await PDFDocument.load(pdf);
      const fonts = pageFonts(document, 0).join(' ');
      expect(fonts).toMatch(/NotoNaskhArabic-Regular/);
      // DejaVu is Chromium's own fallback for Latin; the Arabic must not be in it.
      expect(fonts).toMatch(/NotoNaskhArabic-Bold/);
    },
    240_000,
  );
});
