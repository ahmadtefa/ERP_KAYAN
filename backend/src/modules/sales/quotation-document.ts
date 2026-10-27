import { KAYAN_FONT_FAMILY, NASKH_FONT_FACE } from './quotation-fonts';
import {
  COLUMN_LABELS,
  QuotationColumn,
  columnIsNumeric,
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
    /// This section's own columns when it has them; absent on snapshots
    /// frozen before per-table layouts, which keep printing the
    /// quotation-level [columns] for every section.
    columns?: QuotationColumn[];
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

function safeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(v) ? v : null;
}

function safeFont(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > 80 || !/^[A-Za-z0-9 _,-]+$/.test(v)) return null;
  return v;
}

function designCss(design: Record<string, unknown> | null | undefined): string {
  if (!design) return '';
  const rules: string[] = [];
  const targets: Record<string, string> = {
    title: '.title-band h2', company: '.brand h1', customer: '.panels .panel',
    sectionTitle: '.section-head h3', tableHeader: '.items thead th', tableCell: '.items tbody td',
    totalsLabel: '.summary tbody tr.discount td:first-child, .summary tbody tr.tax td:first-child, .totals td:first-child',
    totalsValue: '.summary tbody tr.discount td.num, .summary tbody tr.tax td.num, .totals td.num',
    finalTotal: '.summary tr.grand td, .totals tr.grand td',
    header: '.masthead, .custom-header', footer: '.page-footer',
  };
  for (const [key, selector] of Object.entries(targets)) {
    const raw = design[key];
    if (!raw || typeof raw !== 'object') continue;
    const v = raw as Record<string, unknown>;
    const css: string[] = [];
    const color = safeColor(v.color); const bg = safeColor(v.backgroundColor); const bc = safeColor(v.borderColor);
    const font = safeFont(v.fontFamily); const size = Number(v.fontSizeMultiplier); const lh = Number(v.lineHeight); const bw = Number(v.borderWidth);
    const weight = typeof v.fontWeight === 'string' && /^w[1-9]00$/.test(v.fontWeight) ? Number(v.fontWeight.slice(1)) : null;
    if (color) css.push(`color:${color}`); if (bg) css.push(`background-color:${bg}`); if (bc && bw > 0) css.push(`border-color:${bc}`);
    if (bw > 0 && bw < 20) css.push(`border-width:${bw}mm`); if (font) css.push(`font-family:${font},Tahoma,Arial,sans-serif`); if (weight) css.push(`font-weight:${weight}`);
    if (Number.isFinite(size) && size >= 0.5 && size <= 3) css.push(`font-size:${size}em`);
    if (Number.isFinite(lh) && lh >= 0.8 && lh <= 3) css.push(`line-height:${lh}`);
    if (typeof v.textAlign === 'string' && ['left','right','center','justify','start','end'].includes(v.textAlign)) css.push(`text-align:${v.textAlign}`);
    if (v.visible === false) css.push('display:none !important');
    if (css.length) rules.push(`${selector}{${css.join(';')}}`);
  }
  return rules.join('\n');
}

function designCustomText(
  design: Record<string, unknown> | null | undefined,
  key: string,
): string {
  const raw = design?.[key];
  if (!raw || typeof raw !== 'object') return '';
  const value = (raw as Record<string, unknown>).customText;
  return typeof value === 'string' ? value.trim() : '';
}

function quantity(value: string): string {
  return Number(value).toLocaleString('en-US', {
    maximumFractionDigits: 4,
  });
}

function columnCell(
  column: QuotationColumn,
  line: QuotationSnapshotLine,
  lang: 'en' | 'ar' = 'en',
): { text: string; numeric: boolean; strong: boolean } {
  const builtIn = COLUMN_LABELS[column.key];
  const numeric = builtIn ? builtIn.numeric : columnIsNumeric(column);
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
    default: {
      const raw = line.customValues?.[column.key] ?? '';
      // A numeric custom column prints like the built-in numbers around it
      // (grouped, trimmed) instead of echoing whatever was typed; text
      // that does not parse as a number is shown as written rather than
      // dropped, because a wrong-looking value beats a missing one.
      if (numeric && raw.trim() !== '' && Number.isFinite(Number(raw))) {
        const formatted =
          column.kind === 'price' ? amount(raw) : quantity(raw);
        return {
          text:
            column.kind === 'percent'
              ? `${formatted}${lang === 'ar' ? '٪' : '%'}`
              : formatted,
          numeric,
          strong: false,
        };
      }
      return { text: raw, numeric, strong: false };
    }
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

/// The two bands the page design owns, in millimetres.
///
/// The content table reserves exactly these heights with an empty `thead` and
/// `tfoot` (see `.page-flow` in the stylesheet), so a long offer that spills
/// onto a second page cannot print its last row underneath the legal footer:
/// Chromium repeats the header and footer groups on every page it writes, and
/// the fixed background layer paints behind them.
export const QUOTATION_TOP_BAND_MM = 28;
export const QUOTATION_BOTTOM_BAND_MM = 26;

/// How far above the paper's bottom edge the footer's last line sits.
///
/// The footer is anchored to the band, not to the paper, so this is measured
/// from the bottom of the design. Everything below it belongs to the stamped
/// page number.
export const QUOTATION_FOOTER_INSET_MM = 9.5;

/// Where `PdfService` stamps "n / N", in PDF points from the bottom edge, and
/// how large the digits are.
///
/// 10 pt puts the digits' top at roughly 17 pt while the footer's last line
/// starts at {@link QUOTATION_FOOTER_INSET_MM} (27 pt): the two cannot touch,
/// and both are inside the {@link QUOTATION_BOTTOM_BAND_MM} band.
export const QUOTATION_PAGE_NUMBER = { y: 10, size: 9 };

export interface PageNumberInk {
  r: number;
  g: number;
  b: number;
}

/// The colour the stamped page number is drawn in.
///
/// The bottom band is brand navy unless the offer's own design overrode the
/// footer background, so the digits are white by default and switch to the
/// deep brand ink when the band a design asked for is light. Without this the
/// number would be invisible on one of the two, and it is stamped after the
/// browser has finished, so it cannot inherit the band's colour.
export function quotationPageNumberInk(
  design: Record<string, unknown> | null | undefined,
): PageNumberInk {
  const white: PageNumberInk = { r: 1, g: 1, b: 1 };
  const dark: PageNumberInk = { r: 0.086, g: 0.161, b: 0.29 };
  const footer = design?.footer;
  const raw =
    footer && typeof footer === 'object'
      ? (footer as Record<string, unknown>).backgroundColor
      : null;
  const hex = safeColor(raw);
  if (!hex) return white;
  const value = hex.slice(1, 7);
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 0.6 ? dark : white;
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

  // A phone number, an e-mail and a tax number are left-to-right runs even in
  // an Arabic page: without `bdi` the bidi algorithm decides a trailing digit
  // belongs to the other end of the line and prints "+20 2 1234 5678" as
  // "5678 1234 2 20+".
  const customerRows = [
    content.customer.phone
      ? `<div class="row"><span>${L('Phone', 'الهاتف')}</span><b><bdi>${escapeHtml(
          content.customer.phone,
        )}</bdi></b></div>`
      : '',
    content.customer.email
      ? `<div class="row"><span>${L('Email', 'البريد الإلكتروني')}</span><b><bdi>${escapeHtml(
          content.customer.email,
        )}</bdi></b></div>`
      : '',
    content.customer.taxNumber
      ? `<div class="row"><span>${L('Tax number', 'الرقم الضريبي')}</span><b><bdi>${escapeHtml(
          content.customer.taxNumber,
        )}</bdi></b></div>`
      : '',
    content.customer.address
      ? `<div class="row"><span>${L('Address', 'العنوان')}</span><b>${escapeHtml(
          content.customer.address,
        )}</b></div>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  // The quotation-level layout: every section's fallback, and the only
  // layout a snapshot frozen before per-table columns has.
  const fallbackColumns = (
    content.columns?.length ? content.columns : standardColumns()
  ).filter((column) => column.visible);

  const tables = content.tables
    .map((table, index) => {
      // This section's own columns when it carries them. Widths, header
      // cells and the footer span are per-section now, because sections
      // of one offer no longer have to share one layout.
      const columns =
        table.columns?.length
          ? table.columns.filter((column) => column.visible)
          : fallbackColumns;
      const columnCount =
        columns.reduce((sum, column) => sum + column.width, 0) || 1;
      const span = columns.length + 1;
      const headCells = columns
        .map((column) => {
          const numeric = columnIsNumeric(column);
          const width = `${Math.round((column.width / columnCount) * 100)}%`;
          return `<th${numeric ? ` class="num"` : ''} style="width:${width}">${escapeHtml(
            columnLabel(column, lang),
          )}</th>`;
        })
        .join('');

      const rows = table.lines
        .map((line, lineIndex) => {
          const cells = columns
            .map((column) => {
              const cell = columnCell(column, line, lang);
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

  // Keep the gross, table-level discount and net visible per table.
  // The offer-level discount is separate; totals are displayed, never recalculated.
  const summaryRows = content.tables
    .map(
      (table) => `<tr>
        <td>${escapeHtml(table.title)}</td>
        <td class="num">${money(table.subTotal)}</td>
        <td class="num discount-value">${Number(table.discountAmount) > 0 ? '− ' : ''}${money(table.discountAmount)}</td>
        <td class="num strong">${money(table.netTotal)}</td>
      </tr>`,
    )
    .join('');
  const summarySubtotalRow = `<tr class="subtotal"><td colspan="3">${L(
    'Subtotal before discount',
    'الإجمالي قبل الخصم',
  )}</td><td class="num">${money(content.totals.subTotal)}</td></tr>`;
  const summaryDiscountRow =
    quotationDiscount > 0
      ? `<tr class="discount"><td colspan="3">${L(
          'Quotation discount',
          'خصم العرض',
        )}</td><td class="num">− ${money(quotationDiscount.toFixed(2))}</td></tr>`
      : '';
  const summaryTaxRow = showTax
    ? `<tr class="tax"><td colspan="3">${L('Tax (VAT)', 'الضريبة المضافة')}${
        taxRate > 0 ? ` (${taxRate.toFixed(2)}%)` : ''
      }</td><td class="num">+ ${money(taxAmount.toFixed(2))}</td></tr>`
    : '';

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
    content.company.phone ? `<bdi>${escapeHtml(content.company.phone)}</bdi>` : '',
    content.company.email ? `<bdi>${escapeHtml(content.company.email)}</bdi>` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const legalLine = [
    content.showTaxId && content.company.taxId
      ? `${L('Tax registration', 'الرقم الضريبي')}: <bdi>${escapeHtml(
          content.company.taxId,
        )}</bdi>`
      : '',
    content.company.commercialRegistration
      ? `${L('Commercial registration', 'السجل التجاري')}: <bdi>${escapeHtml(
          content.company.commercialRegistration,
        )}</bdi>`
      : '',
    L('This offer is not a tax invoice.', 'هذا العرض ليس فاتورة ضريبية.'),
  ]
    .filter(Boolean)
    .join(' · ');

  // A wordmark for the watermark: the company's own name, trimmed to the two
  // words that still read at 66pt behind the text.
  const watermark = companyName
    .replace(/^(شركة|مؤسسة|company)\s+/i, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(' ')
    .slice(0, 28);

  return `<!doctype html>
<html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(content.quotationNumber)} — ${escapeHtml(companyName)}</title>
<style>
${NASKH_FONT_FACE}
  /* The sheet is the whole page: the design owns the margins, so the fixed
     background can reach the paper's edge. */
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    direction: ${rtl ? 'rtl' : 'ltr'};
    font-family: '${KAYAN_FONT_FAMILY}', 'Tahoma', 'Segoe UI', 'Arial', sans-serif;
    color: ${INK};
    font-size: 9.5pt;
    line-height: 1.45;
    background: #f3f4f6;
    position: relative;
  }
  .toolbar { position: relative; z-index: 3; display: flex; gap: 8px; justify-content: flex-end; padding: 10px 4px; background: #ffffff; }
  .toolbar button { font: inherit; padding: 7px 15px; border-radius: 4px; border: 1px solid ${LINE}; background: #fff; color: ${INK}; cursor: pointer; }
  .toolbar button.primary { background: ${PRIMARY}; border-color: ${PRIMARY}; color: #fff; }

  /* ── the page design: one fixed layer, painted behind everything and
        repeated by Chromium at the top of every printed page ─────────────── */
  /* Fixed, and sized to the page box: Chromium paints this layer again at the
     top of every printed page, behind everything else. Inset to zero rather than
     a fixed 210x297mm keeps the design whole even if a printer (or the user's
     own print dialog) insists on its own margins. */
  .page-bg { position: fixed; inset: 0; z-index: 0; overflow: hidden; }
  .page-bg .band { position: absolute; left: 0; right: 0; }
  .page-bg .band-top { top: 0; height: ${QUOTATION_TOP_BAND_MM}mm; background: ${PRIMARY_DEEP}; }
  .page-bg .band-top .rule { position: absolute; left: 0; right: 0; bottom: 0; height: 1.1mm; background: ${SECONDARY}; }
  .page-bg .band-bottom { bottom: 0; height: ${QUOTATION_BOTTOM_BAND_MM}mm; background: ${PRIMARY_DEEP}; }
  .page-bg .band-bottom .rule { position: absolute; left: 0; right: 0; top: 0; height: 1.1mm; background: ${SECONDARY}; }

  .page-bg .masthead {
    position: absolute; top: 5.5mm; left: 12mm; right: 12mm;
    display: flex; align-items: flex-start; justify-content: space-between; gap: 8mm;
    color: #ffffff; padding: 0; border: 0;
  }
  .page-bg .brand { flex: 1; min-width: 0; }
  .page-bg .brand h1 { margin: 0; color: #ffffff; font-family: '${KAYAN_FONT_FAMILY}', 'Tahoma', 'Segoe UI', Arial, sans-serif; font-size: 13pt; font-weight: 700; line-height: 1.3; }
  .page-bg .brand .secondary { margin-top: 0.6mm; color: #cfe0f6; font-family: '${KAYAN_FONT_FAMILY}', 'Tahoma', 'Segoe UI', Arial, sans-serif; font-size: 7.5pt; font-weight: 400; letter-spacing: 0.02em; }
  .page-bg .brand .contact { margin-top: 1.6mm; color: #d6e4f6; font-size: 7pt; line-height: 1.5; }
  .page-bg .brand .custom-header { margin-top: 1mm; color: #d6e4f6; font-size: 7pt; }

  .page-bg .mark { flex: none; width: 38mm; display: flex; justify-content: flex-end; align-items: flex-start; }
  .page-bg .mark img { max-width: 38mm; max-height: 19mm; width: auto; height: auto; object-fit: contain; background: #ffffff; padding: 1.1mm; border-radius: 1.6mm; }

  /* The frame and the watermark are the design's own furniture: they run the
     full height of the content area, between the two bands. */
  .page-bg .frame {
    position: absolute; top: ${QUOTATION_TOP_BAND_MM}mm; bottom: ${QUOTATION_BOTTOM_BAND_MM}mm;
    left: 7mm; right: 7mm;
    border-left: 0.35mm solid ${LINE}; border-right: 0.35mm solid ${LINE};
  }
  .page-bg .watermark {
    position: absolute; top: 118mm; left: 8mm; right: 8mm; text-align: center;
    color: ${PRIMARY}; opacity: 0.04; font-size: 62pt; font-weight: 700;
    letter-spacing: 0.06em; transform: rotate(-22deg); white-space: nowrap;
  }

  .page-bg .page-footer {
    position: absolute; left: 14mm; right: 14mm; bottom: ${QUOTATION_FOOTER_INSET_MM}mm;
    color: #d6e4f6; font-size: 7pt; line-height: 1.45; text-align: center;
    margin: 0; padding: 0; border: 0;
  }
  .page-bg .page-footer .name { color: #ffffff; font-weight: 700; font-size: 7.8pt; }
  .page-bg .page-footer .legal { margin-top: 0.5mm; color: #c8d9ef; }
  .page-bg .page-footer .custom-footer { margin-top: 0.5mm; color: #d6e4f6; }

  /* ── the variable content: a table whose empty header/footer groups reserve
        the two bands on every page the offer runs onto ───────────────────── */
  /* 186mm = A4 less the 12mm margin on each side. The width lives on the
     table, not in the cell's padding: padding is applied to the first fragment
     of a row only, so a row that runs onto a second page would otherwise
     widen to the paper's edge there. */
  table.page-flow { position: relative; z-index: 1; width: 186mm; margin: 0 auto; border-collapse: collapse; table-layout: fixed; }
  /* The two bands, plus a little air: the header and footer groups repeat on
     every page, so the gap they leave is repeated too. */
  .page-flow > thead > tr > td { height: ${QUOTATION_TOP_BAND_MM + 4}mm; padding: 0; }
  .page-flow > tfoot > tr > td { height: ${QUOTATION_BOTTOM_BAND_MM + 3}mm; padding: 0; }
  .page-flow > tbody > tr > td { padding: 0; vertical-align: top; }

  .title-band { text-align: center; padding: 1mm 0 3mm; }
  .title-band .rule { width: 18mm; height: 0.8mm; background: ${SECONDARY}; margin: 0 auto 3mm; }
  .title-band h2 { margin: 0; color: ${PRIMARY_DEEP}; font-size: 21pt; font-weight: 700; line-height: 1.15; letter-spacing: 0.01em; }
  .title-band .english { margin-top: 1mm; color: ${MUTED}; font-size: 8.5pt; line-height: 1.2; letter-spacing: 0.18em; text-transform: uppercase; }
  .title-band .number { margin-top: 1.5mm; color: ${PRIMARY_DEEP}; font-size: 10pt; line-height: 1.2; font-weight: 700; font-variant-numeric: tabular-nums; }
  .panels { display: flex; gap: 4mm; margin-bottom: 4mm; }
  .panel { flex: 1; border: 0.3mm solid ${LINE}; border-radius: 1.5mm; padding: 2.4mm 3mm; background: ${SURFACE}; }
  .panel .eyebrow { color: ${PRIMARY}; font-size: 7.5pt; line-height: 1.2; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 1.2mm; }
  .panel h3 { margin: 0 0 0.6mm; font-size: 10.5pt; line-height: 1.25; }
  .panel .code { color: ${MUTED}; font-size: 8pt; line-height: 1.3; margin-bottom: 1.5mm; }
  .panel .row { display: flex; justify-content: space-between; gap: 4mm; font-size: 8.2pt; line-height: 1.25; padding: 0.15mm 0; }
  .panel .row span { color: ${MUTED}; }
  .panel .row b { font-weight: 700; text-align: ${rtl ? 'left' : 'right'}; }
  .facts .number { color: ${PRIMARY_DEEP}; font-size: 12pt; font-weight: 800; font-variant-numeric: tabular-nums; }
  .status { display: inline-block; margin-top: 2mm; padding: 0.6mm 2.5mm; border-radius: 10mm; background: ${WASH}; color: ${PRIMARY}; font-size: 8pt; font-weight: 800; }
  .subject { border-inline-start: 0.8mm solid ${PRIMARY}; background: ${WASH}; padding: 2mm 3.5mm; margin-bottom: 4mm; font-size: 9.5pt; line-height: 1.35; }
  .subject span { color: ${MUTED}; font-size: 8pt; margin-inline-end: 2mm; }
  .block { margin-bottom: 3.5mm; }
  .section-head { display: flex; align-items: center; gap: 2.5mm; margin-bottom: 1mm; break-after: avoid; }
  .section-index { display: inline-flex; align-items: center; justify-content: center; width: 6.5mm; height: 6.5mm; border-radius: 50%; background: ${PRIMARY}; color: #fff; font-size: 7.5pt; font-weight: 800; }
  .section-head h3 { margin: 0; color: ${PRIMARY}; font-size: 11pt; line-height: 1.2; font-weight: 800; }
  table { width: 100%; border-collapse: collapse; }
  .items { font-size: 8.5pt; border: 0.3mm solid ${LINE}; }
  .items th, .items td { padding: 1.5mm 2mm; vertical-align: top; border-bottom: 0.25mm solid ${LINE}; }
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
  .summary { margin-top: 0; margin-bottom: 4mm; break-inside: avoid; }
  .summary h3 { margin: 0 0 2mm; color: ${PRIMARY}; font-size: 11pt; line-height: 1.2; font-weight: 800; }
  .summary table { font-size: 8.5pt; border: 0.3mm solid ${LINE}; }
  .summary thead th { background: ${TABLE_HEADER_BG}; color: ${TABLE_HEADER_TEXT}; text-align: start; padding: 1.6mm 2mm; border-bottom: 0.4mm solid ${SECONDARY}; }
  .summary tbody td { padding: 1.4mm 2mm; border-bottom: 0.25mm solid ${LINE}; }
  .summary thead th.num { text-align: ${numAlign}; }
  .summary tbody tr.discount td { color: ${MUTED}; }
  .summary tbody td.discount-value { color: ${MUTED}; }
  .summary tbody tr.tax td { background: ${WASH}; color: ${ACCENT}; font-weight: 800; }
  .summary tbody tr.grand td { background: ${PRIMARY}; color: #fff; font-weight: 800; font-size: 11pt; border-bottom: none; }
  .summary tbody tr.grand td:first-child { color: #fff; }
  .totals { display: flex; justify-content: ${rtl ? 'flex-start' : 'flex-end'}; margin-top: 2mm; }
  .totals table { width: 82mm; border: 0.3mm solid ${LINE}; }
  .totals td { padding: 1.3mm 2.5mm; border-bottom: 0.25mm solid ${LINE}; }
  .totals td:first-child { color: ${MUTED}; }
  .totals tr.grand td { background: ${PRIMARY}; color: #fff; font-weight: 800; font-size: 11pt; border-bottom: none; }
  .totals tr.grand td:first-child { color: #fff; }
  .totals tr.tax td { background: ${WASH}; color: ${ACCENT}; font-weight: 800; }
  .terms, .notes { margin-top: 2.5mm; break-inside: avoid; }
  .terms h3, .notes h3 { margin: 0 0 1mm; color: ${PRIMARY}; font-size: 10pt; line-height: 1.2; font-weight: 800; }
  .terms div, .notes div { color: ${MUTED}; font-size: 8.3pt; line-height: 1.45; }
  .signs { display: flex; gap: 12mm; margin-top: 4mm; break-inside: avoid; }
  .sign { flex: 1; font-size: 8.5pt; }
  .sign .line { border-bottom: 0.3mm solid #95a0b0; height: 8mm; margin-bottom: 1.2mm; }
  .sign span { color: ${MUTED}; font-size: 7.5pt; display: block; }
  .sign b { display: block; font-size: 9.5pt; margin-top: 0.5mm; }
  .sign .small { color: ${MUTED}; font-size: 8pt; }

  /* On screen the design sits at the top of the sheet instead of sticking to
     the viewport; the print pipeline is the only place it repeats. */
  @media screen {
    body { width: 210mm; margin: 0 auto; background: #e9edf3; }
    .page-bg { position: absolute; }
  }
  @media print {
    body { background: #fff; }
    .toolbar { display: none; }
    .items thead { display: table-header-group; }
    /* One subtotal per section, not one per printed fragment. */
    .items tfoot { display: table-row-group; }
    .items tr { break-inside: avoid; }
    .block { break-inside: auto; }
    .summary, .terms, .notes, .signs { break-inside: avoid; }
    .section-head { break-after: avoid; }
  }
${designCss(content.design)}
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
<!-- The page design. Fixed, so Chromium repeats it on every printed page;
     everything below is drawn on top of it. -->
<div class="page-bg" aria-hidden="true">
  <div class="band band-top">
    <header class="masthead">
      <div class="brand">
        <h1>${escapeHtml(companyName)}</h1>
        ${secondaryName ? `<div class="secondary">${escapeHtml(secondaryName)}</div>` : ''}
        ${contactLine ? `<div class="contact">${contactLine}</div>` : ''}
        ${designCustomText(content.design, 'header') ? `<div class="custom-header">${escapeHtml(designCustomText(content.design, 'header'))}</div>` : ''}
      </div>
      <div class="mark">${logo
        ? `<img src="${logo}" alt="${escapeHtml(companyName)}">`
        : ''
      }</div>
    </header>
    <div class="rule"></div>
  </div>
  <div class="frame"></div>
  <div class="watermark">${escapeHtml(watermark)}</div>
  <div class="band band-bottom">
    <div class="rule"></div>
    <footer class="page-footer">
      <div class="name">${escapeHtml(companyName)}</div>
      ${designCustomText(content.design, 'footer') ? `<div class="custom-footer">${escapeHtml(designCustomText(content.design, 'footer'))}</div>` : ''}
      <div class="legal">${legalLine}</div>
    </footer>
  </div>
</div>

<table class="page-flow">
  <thead><tr><td></td></tr></thead>
  <tfoot><tr><td></td></tr></tfoot>
  <tbody><tr><td>

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
    <h3>${L('Tables summary', 'ملخص الجداول')}</h3>
    <table>
      <thead>
        <tr>
          <th>${L('Table', 'الجدول')}</th>
          <th class="num">${L('Before discount', 'قبل الخصم')}</th>
          <th class="num">${L('Table discount', 'خصم الجدول')}</th>
          <th class="num">${L('Net', 'الصافي')}</th>
        </tr>
      </thead>
      <tbody>
        ${summaryRows}
        ${summarySubtotalRow}
        ${summaryDiscountRow}
        ${summaryTaxRow}
        <tr class="grand">
          <td colspan="3">${L('Final total', 'الإجمالي النهائي')}</td>
          <td class="num">${money(content.totals.totalAmount)}</td>
        </tr>
      </tbody>
    </table>
  </section>

  ${terms}
  ${notes}
  ${signatureBlock}

  </td></tr></tbody>
</table>
${autoPrint ? '<script>window.addEventListener("load",()=>window.print())</script>' : ''}
</body>
</html>
`;
}
