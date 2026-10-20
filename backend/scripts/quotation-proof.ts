/**
 * Renders the quotation template through the same browser-backed pipeline the
 * application uses, and leaves the HTML and the PDF in `backend/artifacts/`.
 *
 * This is a diagnostic for a machine with a browser (a developer's Windows
 * desk, or a CI runner): it is how the printed page can be looked at without
 * opening a real quotation, and it fails when the sheet is not A4.
 *
 *   npx ts-node --transpile-only scripts/quotation-proof.ts
 *
 * The data below is a fixture, never a company record: the real document is
 * built from the database by QuotationsService.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PDFDocument } from 'pdf-lib';
import { PdfService } from '../src/modules/export/pdf.service';
import {
  QuotationSnapshot,
  renderQuotationDocument,
} from '../src/modules/sales/quotation-document';

const LINES_PER_SECTION = 14;
const SECTIONS = 3;

function fixture(): QuotationSnapshot {
  const tables = Array.from({ length: SECTIONS }, (_, section) => ({
    title: section === 0 ? 'الأجهزة والشبكات' : section === 1 ? 'البرمجيات' : 'خدمات التركيب',
    sortOrder: section + 1,
    subTotal: (LINES_PER_SECTION * 1250).toFixed(4),
    discountPercent: section === 1 ? '5.0000' : '0.0000',
    discountAmount: section === 1 ? '875.0000' : '0.0000',
    netTotal: section === 1
      ? (LINES_PER_SECTION * 1250 - 875).toFixed(4)
      : (LINES_PER_SECTION * 1250).toFixed(4),
    lines: Array.from({ length: LINES_PER_SECTION }, (_, line) => ({
      itemCode: `SKU-${section + 1}${String(line + 1).padStart(3, '0')}`,
      description:
        line === 0
          ? 'سيرفر رفّي بمعالجين وذاكرة 64 جيجابايت ومزود طاقة احتياطي وضمان ثلاثة أعوام، وتركيب داخل غرفة الخوادم.'
          : 'بند توريد وتركيب واختبار وفق المواصفات الفنية المعتمدة في العرض.',
      countryOfOrigin: 'DE',
      unit: 'قطعة',
      quantity: '1.0000',
      unitPrice: '1250.0000',
      lineTotal: '1250.0000',
    })),
  }));

  const subTotal = (LINES_PER_SECTION * 1250 * SECTIONS).toFixed(4);

  return {
    quotationNumber: 'QT-2026-0007',
    quotationDate: '2026-10-19',
    validUntil: '2026-11-18',
    currency: 'EGP',
    version: 2,
    status: 'SENT',
    customer: {
      code: 'CUS-14',
      nameEn: 'Delta Engineering',
      nameAr: 'دلتا للهندسة والتوريدات',
      phone: '+20 100 000 0000',
      email: 'purchasing@delta.example',
      taxNumber: 'CUST-TAX-77',
      address: 'القاهرة الجديدة، التجمع الخامس',
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
    subject: 'تجهيز غرفة الخوادم والشبكة الرئيسية',
    columns: [
      { key: 'itemCode', labelEn: null, labelAr: null, visible: true, width: 2 },
      { key: 'description', labelEn: null, labelAr: null, visible: true, width: 5 },
      { key: 'unit', labelEn: null, labelAr: null, visible: true, width: 1 },
      { key: 'quantity', labelEn: null, labelAr: null, visible: true, width: 1 },
      { key: 'unitPrice', labelEn: null, labelAr: null, visible: true, width: 2 },
      { key: 'lineTotal', labelEn: null, labelAr: null, visible: true, width: 2 },
    ],
    managerName: 'م. سمير عبد الرحمن',
    responsibleName: 'منى عادل',
    responsiblePhone: '+20 111 222 3333',
    notes: 'التسليم داخل الموقع خلال أسبوعين من استلام أمر الشراء.',
    terms:
      'الدفع خلال ثلاثين يومًا من تاريخ التسليم.\nالأسعار سارية لمدة ثلاثين يومًا.\nالضمان ثلاثة أعوام على الأجهزة وعام على الأعمال.',
    discountType: 'PERCENT',
    discountPercent: '2.0000',
    discountAmount: '950.0000',
    tables,
    totals: {
      subTotal,
      discountTotal: '1825.0000',
      totalAmount: (Number(subTotal) - 1825).toFixed(4),
    },
  };
}

async function main() {
  const folder = join(process.cwd(), 'artifacts');
  mkdirSync(folder, { recursive: true });

  const snapshot = fixture();
  const arabicHtml = renderQuotationDocument(
    snapshot,
    { logoData: null, logoMime: null },
    'ar',
    false,
  );
  const englishHtml = renderQuotationDocument(
    snapshot,
    { logoData: null, logoMime: null },
    'en',
    true,
  );
  writeFileSync(join(folder, 'quotation-ar.html'), arabicHtml, 'utf8');
  writeFileSync(join(folder, 'quotation-en.html'), englishHtml, 'utf8');

  const pdfService = new PdfService();
  if (!pdfService.available) {
    writeFileSync(
      join(folder, 'summary.json'),
      JSON.stringify({ browser: null, pdf: null }, null, 2),
    );
    console.error('NO_BROWSER: nothing was rendered.');
    process.exit(1);
  }

  const pdf = await pdfService.render(arabicHtml);
  writeFileSync(join(folder, 'quotation-ar.pdf'), pdf);

  const document = await PDFDocument.load(pdf);
  const pages = document.getPages().map((page) => page.getSize());
  const summary = {
    browser: true,
    bytes: pdf.length,
    pages: pages.length,
    sizes: pages.map(({ width, height }) => ({
      width: Number(width.toFixed(2)),
      height: Number(height.toFixed(2)),
    })),
  };
  writeFileSync(join(folder, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  // Surfaces the measured sheet in the CI run's annotations, where it can be
  // read without downloading the artifact.
  console.log(`::notice title=Quotation PDF proof::${JSON.stringify(summary)}`);

  const notA4 = pages.some(
    ({ width, height }) =>
      Math.abs(width - 595.28) > 1 || Math.abs(height - 841.89) > 1,
  );
  if (notA4 || pages.length < 2) {
    console.error('The rendered sheet is not a multi-page A4 document.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
