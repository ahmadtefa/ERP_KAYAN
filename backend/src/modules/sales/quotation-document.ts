import {
  COLUMN_LABELS,
  QuotationColumn,
  columnLabel,
  standardColumns,
} from './quotation-columns';

/// The frozen content of an issued offer, or the live content of a draft.
///
/// Deliberately narrow: only what the document needs to print itself. The
/// service builds it once and stores it when the offer is issued, so a later
/// edit to the company profile or the catalogue cannot rewrite history.
export interface QuotationSnapshotLine {
  itemCode: string | null;
  description: string;
  countryOfOrigin: string | null;
  unit: string | null;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  /// Values for user-defined columns that are not one of the built-in keys.
  /// Keyed by the column's key, holding the cell's display text.
  customValues?: Record<string, string> | null;
}

export interface QuotationSnapshot {
  quotationNumber: string;
  quotationDate: string;
  validUntil: string | null;
  currency: string;
  version: number;
  status: string;
  customer: {
    code: string;
    nameEn: string;
    nameAr: string;
    phone: string | null;
    email: string | null;
    taxNumber: string | null;
    address: string | null;
  };
  company: {
    nameEn: string;
    nameAr: string;
    taxId: string | null;
    commercialRegistration: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    addressAr: string | null;
  };
  showTaxId: boolean;
  subject: string | null;
  columns: QuotationColumn[];
  managerName: string | null;
  responsibleName: string | null;
  responsiblePhone: string | null;
  notes: string | null;
  terms: string | null;
  /// Persisted per-element presentation settings; absent on legacy quotations.
  design?: Record<string, unknown> | null;
  discountType: string | null;
  discountPercent: string;
  discountAmount: string;
  tables: Array<{
    title: string;
    sortOrder: number;
    subTotal: string;
    discountPercent: string;
    discountAmount: string;
    netTotal: string;
    lines: QuotationSnapshotLine[];
  }>;
  totals: {
    subTotal: string;
    discountTotal: string;
    totalAmount: string;
    /// The company's VAT rate in percent that was in force when the offer was
    /// prepared. Stored so the printed document never changes retroactively.
    taxRate?: string;
    /// VAT charged on the discounted net value. Applied exactly once.
    taxAmount?: string;
  };
}

/// The live company row used only for the mark. Every other company field in
/// the document comes from [QuotationSnapshot.company], so an issued offer
/// keeps the legal identity it was issued under.
export interface QuotationDocumentCompanyMark {
  logoData: Uint8Array | null;
  logoMime: string | null;
}

/// The palette of the printed quotation. These are the Stitch reference
/// identity colours carried into the real ERP document:
///
///   primary   #1e60aa  (brand, headings, rules)
///   secondary #0088cc  (secondary text, sub-brand)
///   accent    #e67e22  (totals emphasis, accents)
const PRIMARY = '#1e60aa';
const SECONDARY = '#0088cc';
const ACCENT = '#e67e22';
const PRIMARY_DEEP = '#164d84';
const INK = '#111827';
const MUTED = '#4b5563';
const LINE = '#d3e4fe';
const WASH = '#eff4ff';
const SURFACE = '#f8f9ff';
const TABLE_HEADER_BG = '#6ba4d9';
const TABLE_HEADER_TEXT = '#ffffff';
const TABLE_TOTAL_BG = '#93c5fd';
const TABLE_TOTAL_TEXT = '#0b2244';
const FOOTER_BG = '#1e5ba3';

const STATUS_LABELS: Record<string, [string, string]> = {
  DRAFT: ['Draft', 'مسودة'],
  SENT: ['Sent', 'مُرسل'],
  ACCEPTED: ['Accepted', 'مقبول'],
  REJECTED: ['Rejected', 'مرفوض'],
  EXPIRED: ['Expired', 'منتهي'],
  CONVERTED: ['Converted', 'محوّل إلى فاتورة'],
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function multiline(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

function statusLabel(status: string, rtl: boolean): string {
  const label = STATUS_LABELS[status.toUpperCase()];
  if (!label) return status;
  return rtl ? label[1] : label[0];
}

/// Two decimals, Western digits, grouped: the same text the Flutter preview
/// shows through `formatAmount`.
function amount(value: string): string {
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function quantity(value: string): string {
  return Number(value).toLocaleString('en-US', {
    maximumFractionDigits: 4,
  });
}

function columnCell(
  column: QuotationColumn,
  line: QuotationSnapshotLine,
): { text: string; numeric: boolean; strong: boolean } {
  const builtIn = COLUMN_LABELS[column.key];
  const numeric = builtIn ? builtIn.numeric : column.numeric ?? false;
  switch (column.key) {
    case 'description':
      return { text: line.description, numeric: false, strong: false };
    case 'itemCode':
      return { text: line.itemCode ?? '', numeric: false, strong: false };
    case 'countryOfOrigin':
      return {
        text: line.countryOfOrigin ?? '',
        numeric: false,
        strong: false,
      };
    case 'unit':
      return { text: line.unit ?? '', numeric: false, strong: false };
    case 'quantity':
      return { text: quantity(line.quantity), numeric: true, strong: false };
    case 'unitPrice':
      return { text: amount(line.unitPrice), numeric: true, strong: false };
    case 'lineTotal':
      return { text: amount(line.lineTotal), numeric: true, strong: true };
    default:
      return {
        text: line.customValues?.[column.key] ?? '',
        numeric,
        strong: false,
      };
  }
}

/// A name a customer-facing file can carry: the quotation number when it is
/// made of safe characters, otherwise the identifier the server knows.
export function quotationDocumentFileName(
  quotationNumber: string | null | undefined,
  fallback = 'quotation',
): string {
  const safe = (quotationNumber ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `quotation-${safe || fallback}.pdf`;
}

/// The print page and the PDF, in one self-contained HTML document.
///
/// No external stylesheet, font or image is referenced: the logo is inlined
/// as a data URI and the only script is the optional auto-print call. A
/// browser therefore lays out the Arabic itself, with the letters joined and
/// in the right order, which a server-side PDF library cannot promise.
///
/// The visual identity follows the Stitch reference (primary #1e60aa,
/// secondary #0088cc, accent #e67e22, right-to-left Arabic) while keeping
/// the structural hooks the Flutter preview and the document tests rely on.
export function renderQuotationDocument(
  content: QuotationSnapshot,
  company: QuotationDocumentCompanyMark,
  lang: 'en' | 'ar',
  autoPrint: boolean,
): string {
  const rtl = lang === 'ar';
  const L = (en: string, ar: string) => (rtl ? ar : en);
  const numAlign = rtl ? 'left' : 'right';
  const money = (value: string) => `${amount(value)} ${content.currency}`;

  const logo =
    company.logoData && company.logoData.length > 0
      ? `data:${company.logoMime ?? 'image/png'};base64,${Buffer.from(
          company.logoData,
        ).toString('base64')}`
      : null;

  const companyName = rtl
    ? content.company.nameAr || content.company.nameEn
    : content.company.nameEn || content.company.nameAr;
  const secondaryName = rtl
    ? content.company.nameEn || ''
    : content.company.nameAr || '';
  const companyAddress = rtl
    ? content.company.addressAr || content.company.address
    : content.company.address || content.company.addressAr;
  const customerName = rtl
    ? content.customer.nameAr || content.customer.nameEn
    : content.customer.nameEn || content.customer.nameAr;

  const customerRows = [
    content.customer.phone
      ? `<div><span>${L('Phone', 'الهاتف')}</span><b>${escapeHtml(
          content.customer.phone,
        )}</b></div>`
      : '',
    content.customer.email
      ? `<div><span>${L('Email', 'البريد الإلكتروني')}</span><b>${escapeHtml(
          content.customer.email,
        )}</b></div>`
      : '',
    content.customer.taxNumber
      ? `<div><span>${L('Tax number', 'الرقم الضريبي')}</span><b>${escapeHtml(
          content.customer.taxNumber,
        )}</b></div>`
      : '',
    content.customer.address
      ? `<div><span>${L('Address', 'العنوان')}</span><b>${escapeHtml(
          content.customer.address,
        )}</b></div>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  const columns = (
    content.columns?.length ? content.columns : standardColumns()
  ).filter((column) => column.visible);
  const columnCount =
    columns.reduce((sum, column) => sum + column.width, 0) || 1;
  const span = columns.length + 1;
  const headCells = columns
    .map((column) => {
      const builtIn = COLUMN_LABELS[column.key];
      const numeric = builtIn ? builtIn.numeric : column.numeric ?? false;
      const width = `${Math.round((column.width / columnCount) * 100)}%`;
      return `<th${numeric ? ` class="num"` : ''} style="width:${width}">${escapeHtml(
        columnLabel(column, lang),
      )}</th>`;
    })
    .join('');

  const tables = content.tables
    .map((table, index) => {
      const rows = table.lines
        .map((line, lineIndex) => {
          const cells = columns
            .map((column) => {
              const cell = columnCell(column, line);
              const classes = [
                cell.numeric ? 'num' : '',
                cell.strong ? 'strong' : '',
                column.key === 'description' ? 'desc' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return `<td${classes ? ` class="${classes}"` : ''}>${escapeHtml(
                cell.text,
              )}</td>`;
            })
            .join('');
          return `<tr>
            <td class="idx">${lineIndex + 1}</td>
            ${cells}
          </tr>`;
        })
        .join('');

      const tableDiscount = Number(table.discountAmount) > 0;
      return `<section class="block">
        <div class="section-head">
          <span class="section-index">${String(index + 1).padStart(2, '0')}</span>
          <h3>${escapeHtml(table.title)}</h3>
        </div>
        <table class="items">
          <thead>
            <tr>
              <th class="idx">#</th>
              ${headCells}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr>
              <th colspan="${span - 1}">${L('Section subtotal', 'إجمالي القسم')}</th>
              <td class="num strong">${money(table.subTotal)}</td>
            </tr>
            ${
              tableDiscount
                ? `<tr class="discount"><th colspan="${span - 1}">${L(
                    'Section discount',
                    'خصم القسم',
                  )}${
                    Number(table.discountPercent) > 0
                      ? ` (${Number(table.discountPercent)}%)`
                      : ''
                  }</th><td class="num">− ${money(
                    table.discountAmount,
                  )}</td></tr>
                <tr class="net"><th colspan="${span - 1}">${L(
                  'Net after discount',
                  'الصافي بعد الخصم',
                )}</th><td class="num strong">${money(table.netTotal)}</td></tr>`
                : ''
            }
          </tfoot>
        </table>
      </section>`;
    })
    .join('');

  const tableDiscountTotal = content.tables.reduce(
    (sum, table) => sum + Number(table.discountAmount),
    0,
  );
  const quotationDiscount = Math.max(
    0,
    Math.round((Number(content.totals.discountTotal) - tableDiscountTotal) * 10000) /
      10000,
  );

  /// The tax already computed and stored by the service: VAT on the discounted
  /// net value, applied exactly once, never recomputed here.
  const taxRate = Number(content.totals.taxRate ?? 0);
  const taxAmount = Number(content.totals.taxAmount ?? 0);
  const showTax = taxAmount > 0;

  const summaryRows = content.tables
    .map(
      (table) => `<tr>
        <td>${escapeHtml(table.title)}</td>
        <td class="num">${money(table.subTotal)}</td>
        <td class="num">${Number(table.discountAmount) > 0 ? `− ${money(table.discountAmount)}` : '—'}</td>
        <td class="num strong">${money(table.netTotal)}</td>
      </tr>`,
    )
    .join('');

  const totalsRows = [
    `<tr><td>${L('Subtotal before discount', 'الإجمالي قبل الخصم')}</td><td class="num">${money(
      content.totals.subTotal,
    )}</td></tr>`,
    tableDiscountTotal > 0
      ? `<tr><td>${L('Table discounts', 'خصومات الجداول')}</td><td class="num">− ${money(
          tableDiscountTotal.toFixed(2),
        )}</td></tr>`
      : '',
    quotationDiscount > 0
      ? `<tr><td>${L('Quotation discount', 'خصم العرض')}</td><td class="num">− ${money(
          quotationDiscount.toFixed(2),
        )}</td></tr>`
      : '',
    showTax
      ? `<tr class="tax"><td>${L('Tax (VAT)', 'الضريبة المضافة')}${
          taxRate > 0 ? ` (${taxRate.toFixed(2)}%)` : ''
        }</td><td class="num">+ ${money(taxAmount.toFixed(2))}</td></tr>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  const terms = content.terms?.trim()
    ? `<section class="terms">
         <h3>${L('Terms and conditions', 'الشروط والأحكام')}</h3>
         <div>${multiline(content.terms)}</div>
       </section>`
    : '';
  const notes = content.notes?.trim()
    ? `<section class="notes">
         <h3>${L('Notes', 'ملاحظات')}</h3>
         <div>${multiline(content.notes)}</div>
       </section>`
    : '';

  const signatures = [
    content.managerName
      ? `<div class="sign"><div class="line"></div><span>${L(
          'Company manager',
          'مدير الشركة',
        )}</span><b>${escapeHtml(content.managerName)}</b></div>`
      : '',
    content.responsibleName
      ? `<div class="sign"><div class="line"></div><span>${L(
          'Responsible person',
          'المسؤول',
        )}</span><b>${escapeHtml(content.responsibleName)}</b>${content.responsiblePhone
          ? `<div class="small">${escapeHtml(content.responsiblePhone)}</div>`
          : ''
        }</div>`
      : '',
  ]
    .filter(Boolean)
    .join('');
  const signatureBlock = signatures
    ? `<section class="signs">${signatures}</section>`
    : '';

  const contactLine = [
    companyAddress ? escapeHtml(companyAddress) : '',
    content.company.phone ? escapeHtml(content.company.phone) : '',
    content.company.email ? escapeHtml(content.company.email) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const legalLine = [
    content.showTaxId && content.company.taxId
      ? `${L('Tax registration', 'الرقم الضريبي')}: ${escapeHtml(
          content.company.taxId,
        )}`
      : '',
    content.company.commercialRegistration
      ? `${L('Commercial registration', 'السجل التجاري')}: ${escapeHtml(
          content.company.commercialRegistration,
        )}`
      : '',
    L('This offer is not a tax invoice.', 'هذا العرض ليس فاتورة ضريبية.'),
  ]
    .filter(Boolean)
    .join(' · ');

  return `<!doctype html>
<html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(content.quotationNumber)} — ${escapeHtml(companyName)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm 12mm 16mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    direction: ${rtl ? 'rtl' : 'ltr'};
    font-family: 'Segoe UI', 'Tahoma', 'Arial', 'sans-serif';
    color: ${INK};
    font-size: 9.5pt;
    line-height: 1.45;
    background: #f3f4f6;
  }
  .toolbar { display: flex; gap: 8px; justify-content: flex-end; padding: 10px 4px; background: #ffffff; }
  .toolbar button { font: inherit; padding: 7px 15px; border-radius: 4px; border: 1px solid ${LINE}; background: #fff; color: ${INK}; cursor: pointer; }
  .toolbar button.primary { background: ${PRIMARY}; border-color: ${PRIMARY}; color: #fff; }
  .sheet {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    padding: 0 0 6mm;
    background: #fff;
    color: ${INK};
  }
  .masthead { display: flex; align-items: flex-start; justify-content: space-between; gap: 8mm; padding-bottom: 5mm; border-bottom: 0.6mm solid ${PRIMARY}; }
  .brand { flex: 1; }
  .brand h1 { margin: 0; color: ${PRIMARY}; font-size: 16.5pt; font-weight: 800; line-height: 1.3; }
  .brand .secondary { margin-top: 1mm; color: ${SECONDARY}; font-size: 8pt; letter-spacing: 0.06em; text-transform: uppercase; }
  .mark { width: 42mm; display: flex; justify-content: flex-end; }
  .mark img { max-height: 14mm; width: auto; object-fit: contain; }
  .monogram { width: 18mm; height: 18mm; border-radius: 3mm; background: ${PRIMARY}; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 16pt; font-weight: 800; }
  .title-band { text-align: center; padding: 6mm 0 5mm; }
  .title-band .rule { width: 18mm; height: 0.8mm; background: ${SECONDARY}; margin: 0 auto 3mm; }
  .title-band h2 { margin: 0; color: ${PRIMARY_DEEP}; font-size: 23pt; font-weight: 800; letter-spacing: 0.01em; }
  .title-band .english { margin-top: 1mm; color: ${MUTED}; font-size: 8.5pt; letter-spacing: 0.18em; text-transform: uppercase; }
  .title-band .number { margin-top: 2mm; color: ${PRIMARY_DEEP}; font-size: 10pt; font-weight: 700; font-variant-numeric: tabular-nums; }
  .panels { display: flex; gap: 4mm; margin-bottom: 5mm; }
  .panel { flex: 1; border: 0.3mm solid ${LINE}; border-radius: 1.5mm; padding: 3.5mm 4mm; background: ${SURFACE}; }
  .panel .eyebrow { color: ${PRIMARY}; font-size: 7.5pt; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 1.5mm; }
  .panel h3 { margin: 0 0 1mm; font-size: 10.5pt; }
  .panel .code { color: ${MUTED}; font-size: 8pt; margin-bottom: 2mm; }
  .panel .row { display: flex; justify-content: space-between; gap: 4mm; font-size: 8.5pt; padding: 0.6mm 0; }
  .panel .row span { color: ${MUTED}; }
  .panel .row b { font-weight: 700; text-align: ${rtl ? 'left' : 'right'}; }
  .facts .number { color: ${PRIMARY_DEEP}; font-size: 12pt; font-weight: 800; font-variant-numeric: tabular-nums; }
  .status { display: inline-block; margin-top: 2mm; padding: 0.6mm 2.5mm; border-radius: 10mm; background: ${WASH}; color: ${PRIMARY}; font-size: 8pt; font-weight: 800; }
  .subject { border-inline-start: 0.8mm solid ${PRIMARY}; background: ${WASH}; padding: 2.5mm 3.5mm; margin-bottom: 5mm; font-size: 9.5pt; }
  .subject span { color: ${MUTED}; font-size: 8pt; margin-inline-end: 2mm; }
  .block { margin-bottom: 6mm; }
  .section-head { display: flex; align-items: center; gap: 2.5mm; margin-bottom: 2mm; break-after: avoid; }
  .section-index { display: inline-flex; align-items: center; justify-content: center; width: 6.5mm; height: 6.5mm; border-radius: 50%; background: ${PRIMARY}; color: #fff; font-size: 7.5pt; font-weight: 800; }
  .section-head h3 { margin: 0; color: ${PRIMARY}; font-size: 11pt; font-weight: 800; }
  table { width: 100%; border-collapse: collapse; }
  .items { font-size: 8.5pt; border: 0.3mm solid ${LINE}; }
  .items th, .items td { padding: 1.8mm 2mm; vertical-align: top; border-bottom: 0.25mm solid ${LINE}; }
  .items thead th { background: ${TABLE_HEADER_BG}; color: ${TABLE_HEADER_TEXT}; font-size: 8pt; font-weight: 800; text-align: start; border-bottom: 0.4mm solid ${SECONDARY}; }
  .items thead th.num { text-align: ${numAlign}; }
  .items tbody tr:nth-child(even) { background: #fbfcff; }
  .items tfoot th { background: ${SURFACE}; text-align: start; font-weight: 700; }
  .items tfoot td { background: ${SURFACE}; }
  .items tfoot .discount th, .items tfoot .discount td { color: ${MUTED}; }
  .items tfoot .net th, .items tfoot .net td { background: ${TABLE_TOTAL_BG}; color: ${TABLE_TOTAL_TEXT}; font-weight: 800; }
  .idx { width: 7mm; color: ${MUTED}; text-align: center; }
  .desc { word-break: break-word; }
  .num { text-align: ${numAlign}; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .strong { font-weight: 700; }
  .summary { margin-top: 2mm; margin-bottom: 6mm; break-inside: avoid; }
  .summary h3 { margin: 0 0 2.5mm; color: ${PRIMARY}; font-size: 11pt; font-weight: 800; }
  .summary table { font-size: 8.5pt; border: 0.3mm solid ${LINE}; }
  .summary thead th { background: ${TABLE_HEADER_BG}; color: ${TABLE_HEADER_TEXT}; text-align: start; padding: 2mm; border-bottom: 0.4mm solid ${SECONDARY}; }
  .summary tbody td { padding: 1.8mm 2mm; border-bottom: 0.25mm solid ${LINE}; }
  .summary thead th.num { text-align: ${numAlign}; }
  .totals { display: flex; justify-content: ${rtl ? 'flex-start' : 'flex-end'}; margin-top: 4mm; }
  .totals table { width: 82mm; border: 0.3mm solid ${LINE}; }
  .totals td { padding: 2mm 2.5mm; border-bottom: 0.25mm solid ${LINE}; }
  .totals td:first-child { color: ${MUTED}; }
  .totals tr.grand td { background: ${PRIMARY}; color: #fff; font-weight: 800; font-size: 11pt; border-bottom: none; }
  .totals tr.grand td:first-child { color: #fff; }
  .totals tr.tax td { background: ${WASH}; color: ${ACCENT}; font-weight: 800; }
  .terms, .notes { margin-top: 4mm; break-inside: avoid; }
  .terms h3, .notes h3 { margin: 0 0 1.5mm; color: ${PRIMARY}; font-size: 10pt; font-weight: 800; }
  .terms div, .notes div { color: ${MUTED}; font-size: 8.5pt; line-height: 1.6; }
  .signs { display: flex; gap: 12mm; margin-top: 10mm; break-inside: avoid; }
  .sign { flex: 1; font-size: 8.5pt; }
  .sign .line { border-bottom: 0.3mm solid #95a0b0; height: 11mm; margin-bottom: 1.5mm; }
  .sign span { color: ${MUTED}; font-size: 7.5pt; display: block; }
  .sign b { display: block; font-size: 9.5pt; margin-top: 0.5mm; }
  .sign .small { color: ${MUTED}; font-size: 8pt; }
  .page-footer { margin-top: 8mm; padding-top: 2.5mm; border-top: 0.3mm solid ${LINE}; color: ${MUTED}; font-size: 7.5pt; }
  .page-footer .name { color: ${PRIMARY}; font-weight: 800; font-size: 8.5pt; }
  .page-footer .legal { margin-top: 1mm; color: ${MUTED}; }
  @media print {
    body { background: #fff; }
    .toolbar { display: none; }
    .sheet { width: auto; min-height: 0; margin: 0; }
    .items thead { display: table-header-group; }
    /* One subtotal per section, not one per printed fragment. */
    .items tfoot { display: table-row-group; }
    .items tr { break-inside: avoid; }
    .block { break-inside: auto; }
    .summary, .terms, .notes, .signs, .page-footer { break-inside: avoid; }
    .section-head { break-after: avoid; }
  }
</style>
</head>
<body>
${
  autoPrint
    ? ''
    : `<div class="toolbar">
         <button class="primary" onclick="window.print()">${L(
           'Print',
           'طباعة',
         )}</button>
       </div>`
}
<div class="sheet">
  <header class="masthead">
    <div class="brand">
      <h1>${escapeHtml(companyName)}</h1>
      ${secondaryName ? `<div class="secondary">${escapeHtml(secondaryName)}</div>` : ''}
    </div>
    <div class="mark">${logo
      ? `<img src="${logo}" alt="${escapeHtml(companyName)}">`
      : `<div class="monogram">${escapeHtml((companyName || 'K').trim().charAt(0))}</div>`
    }</div>
  </header>

  <div class="title-band">
    <div class="rule"></div>
    <h2>${L('QUOTATION', 'عرض سعر')}</h2>
    <div class="english">${L('Quotation', 'QUOTATION')}</div>
    <div class="number">${escapeHtml(content.quotationNumber)}</div>
  </div>

  <div class="panels">
    <section class="panel">
      <div class="eyebrow">${L('Prepared for', 'مقدم إلى')}</div>
      <h3>${escapeHtml(customerName)}</h3>
      <div class="code">${L('Customer code', 'كود العميل')}: ${escapeHtml(content.customer.code)}</div>
      ${customerRows}
    </section>
    <section class="panel facts">
      <div class="eyebrow">${L('Quotation details', 'بيانات العرض')}</div>
      <div class="row"><span>${L('Number', 'الرقم')}</span><b class="number">${escapeHtml(content.quotationNumber)}</b></div>
      <div class="row"><span>${L('Date', 'التاريخ')}</span><b>${escapeHtml(content.quotationDate)}</b></div>
      ${
        content.validUntil
          ? `<div class="row"><span>${L('Valid until', 'صالح حتى')}</span><b>${escapeHtml(content.validUntil)}</b></div>`
          : ''
      }
      <div class="row"><span>${L('Currency', 'العملة')}</span><b>${escapeHtml(content.currency)}</b></div>
      <div class="row"><span>${L('Version', 'الإصدار')}</span><b>${content.version}</b></div>
      <div class="status">${escapeHtml(statusLabel(content.status, rtl))}</div>
    </section>
  </div>

  ${
    content.subject?.trim()
      ? `<div class="subject"><span>${L('Subject', 'الموضوع')}</span>${escapeHtml(content.subject.trim())}</div>`
      : ''
  }

  ${tables}

  <section class="summary">
    <h3>${L('Section summary', 'ملخص الأقسام')}</h3>
    <table>
      <thead>
        <tr>
          <th>${L('Section', 'القسم')}</th>
          <th class="num">${L('Before discount', 'قبل الخصم')}</th>
          <th class="num">${L('Discount', 'الخصم')}</th>
          <th class="num">${L('Net', 'الصافي')}</th>
        </tr>
      </thead>
      <tbody>${summaryRows}</tbody>
    </table>
    <div class="totals">
      <table>
        ${totalsRows}
        <tr class="grand">
          <td>${L('Final total', 'الإجمالي النهائي')}</td>
          <td class="num">${money(content.totals.totalAmount)}</td>
        </tr>
      </table>
    </div>
  </section>

  ${terms}
  ${notes}
  ${signatureBlock}

  <footer class="page-footer">
    <div class="name">${escapeHtml(companyName)}</div>
    ${contactLine ? `<div>${contactLine}</div>` : ''}
    <div class="legal">${legalLine}</div>
  </footer>
</div>
${autoPrint ? '<script>window.addEventListener("load",()=>window.print())</script>' : ''}
</body>
</html>
`;
}
