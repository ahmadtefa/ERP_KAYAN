import { Workbook, Worksheet } from 'exceljs';

import { ReportTable } from './report-table';

export type Lang = 'ar' | 'en';

/// ─────────────────────────────────────────────────────────────── Excel

/**
 * Writes the table as a real .xlsx workbook.
 *
 * A number column is written as a number with a thousands separator, so the
 * sheet can be summed in Excel rather than only read. The header row is frozen
 * and the columns are sized, because a report nobody can read is not a report.
 */
export async function toXlsx(
  table: ReportTable,
  lang: Lang,
  companyName: string,
): Promise<Buffer> {
  const workbook = new Workbook();
  workbook.creator = 'KAYAN ERP';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(take(table.titleEn), {
    views: [
      {
        state: 'frozen',
        ySplit: 1 + table.meta.length + 1,
        // An Arabic sheet reads right to left, the same direction as the
        // screen it was exported from. Without this Excel opens it with the
        // columns the wrong way round.
        rightToLeft: lang === 'ar',
      },
    ],
    pageSetup: { fitToPage: true, fitToWidth: 1, orientation: 'landscape' },
  });

  const columnCount = Math.max(table.columns.length, 2);

  // Title
  const titleRow = sheet.addRow([lang === 'ar' ? table.titleAr : table.titleEn]);
  titleRow.font = { bold: true, size: 14 };
  sheet.mergeCells(titleRow.number, 1, titleRow.number, columnCount);

  sheet.addRow([companyName]).font = { bold: true, size: 11 };

  // Metadata: period, as-at date, account.
  for (const meta of table.meta) {
    const row = sheet.addRow([lang === 'ar' ? meta.labelAr : meta.labelEn, meta.value]);
    row.getCell(1).font = { italic: true };
  }

  sheet.addRow([]);

  // Header
  const header = sheet.addRow(
    table.columns.map((column) => (lang === 'ar' ? column.labelAr : column.labelEn)),
  );
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE8EEF7' },
    };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF9AA7B8' } } };
  });

  // Rows
  for (const row of table.rows) {
    sheet.addRow(
      table.columns.map((column) => {
        const value = textOf(row[column.key]);
        if (column.numeric) {
          const parsed = Number(value);
          return Number.isFinite(parsed) && value.trim() !== '' ? parsed : value;
        }
        return value;
      }),
    );
  }

  // Totals
  if (table.totals.length || table.notes.length) sheet.addRow([]);
  for (const total of table.totals) {
    const row = sheet.addRow([
      lang === 'ar' ? total.labelAr : total.labelEn,
      Number.isFinite(Number(total.value)) ? Number(total.value) : total.value,
    ]);
    row.font = { bold: true };
    row.getCell(2).numFmt = MONEY_FORMAT;
  }

  // Notes
  if (table.notes.length) {
    sheet.addRow([]);
    for (const note of table.notes) {
      const row = sheet.addRow([lang === 'ar' ? note.ar : note.en]);
      row.font = { italic: true, size: 9, color: { argb: 'FF666666' } };
      sheet.mergeCells(row.number, 1, row.number, columnCount);
    }
  }

  // Column widths, and the number format on every numeric column.
  table.columns.forEach((column, index) => {
    const letter = sheet.getColumn(index + 1).letter;
    sheet.getColumn(index + 1).width =
      column.width ?? Math.min(Math.max(column.labelEn.length + 4, 12), 40);
    if (column.numeric) {
      for (let rowNumber = header.number + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const cell = sheet.getCell(`${letter}${rowNumber}`);
        if (typeof cell.value === 'number') cell.numFmt = MONEY_FORMAT;
      }
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

const MONEY_FORMAT = '#,##0.00;-#,##0.00';

/// A cell value as text. A number keeps its own digits; anything absent, null
/// or not printable becomes an empty cell rather than the word "null".
function textOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/// Excel rejects a sheet name longer than 31 characters and some punctuation.
function take(text: string): string {
  return text.replace(/[\\/*?:[\]]/g, '-').slice(0, 31) || 'Report';
}

/// ─────────────────────────────────────────────────────────────── CSV

/**
 * Comma-separated values, with a byte-order mark.
 *
 * The mark matters: without it Excel opens an Arabic file as mojibake. The
 * values are kept exactly as the API produced them.
 */
export function toCsv(table: ReportTable, lang: Lang, companyName: string): Buffer {
  const lines: string[] = [];

  lines.push(csvRow([lang === 'ar' ? table.titleAr : table.titleEn]));
  lines.push(csvRow([companyName]));
  for (const meta of table.meta) {
    lines.push(csvRow([lang === 'ar' ? meta.labelAr : meta.labelEn, meta.value]));
  }
  lines.push('');

  lines.push(
    csvRow(table.columns.map((c) => (lang === 'ar' ? c.labelAr : c.labelEn))),
  );
  for (const row of table.rows) {
    lines.push(csvRow(table.columns.map((c) => textOf(row[c.key]))));
  }

  if (table.totals.length) lines.push('');
  for (const total of table.totals) {
    lines.push(csvRow([lang === 'ar' ? total.labelAr : total.labelEn, total.value]));
  }

  if (table.notes.length) {
    lines.push('');
    for (const note of table.notes) {
      lines.push(csvRow([lang === 'ar' ? note.ar : note.en]));
    }
  }

  return Buffer.from('\uFEFF' + lines.join('\r\n') + '\r\n', 'utf8');
}

function csvRow(values: string[]): string {
  return values
    .map((value) => {
      const text = value ?? '';
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    })
    .join(',');
}

/// ───────────────────────────────────────────────────────── PDF / print

/**
 * A complete, self-contained page that prints correctly and can be saved as a
 * PDF from the browser's own print dialogue.
 *
 * The PDF is produced by the browser on purpose. Arabic needs a font with the
 * right glyphs and the right letter shaping, and every browser already has one
 * plus a print-to-PDF engine that handles it perfectly. Generating the page
 * here means the Arabic in the PDF is right, not merely present.
 */
export function toPrintHtml(
  table: ReportTable,
  lang: Lang,
  companyName: string,
  options: { autoPrint?: boolean; generatedAt?: Date } = {},
): string {
  const rtl = lang === 'ar';
  const title = rtl ? table.titleAr : table.titleEn;
  const generatedAt = options.generatedAt ?? new Date();

  const head = table.columns
    .map(
      (column) =>
        `<th class="${column.numeric ? 'num' : ''}">${
          rtl ? column.labelAr : column.labelEn
        }</th>`,
    )
    .join('');

  const body = table.rows
    .map(
      (row) =>
        '<tr>' +
        table.columns
          .map((column) => {
            const value = escapeHtml(textOf(row[column.key]));
            return `<td class="${column.numeric ? 'num' : ''}">${value || '—'}</td>`;
          })
          .join('') +
        '</tr>',
    )
    .join('');

  const totals = table.totals
    .map(
      (total) =>
        `<tr><th colspan="${Math.max(table.columns.length - 1, 1)}">${
          rtl ? total.labelAr : total.labelEn
        }</th><td class="num">${escapeHtml(total.value)}</td></tr>`,
    )
    .join('');

  const meta = table.meta
    .map(
      (item) =>
        `<div><span class="label">${rtl ? item.labelAr : item.labelEn}</span> ${escapeHtml(
          item.value,
        )}</div>`,
    )
    .join('');

  const notes = table.notes
    .map((note) => `<li>${escapeHtml(rtl ? note.ar : note.en)}</li>`)
    .join('');

  const stamp = generatedAt.toISOString().slice(0, 16).replace('T', ' ');

  return `<!doctype html>
<html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} — ${escapeHtml(companyName)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Tahoma, 'Noto Naskh Arabic', 'Arial', sans-serif;
    margin: 0; padding: 24px; color: #111; background: #f5f6f8;
  }
  .sheet {
    background: #fff; margin: 0 auto; padding: 24px;
    max-width: 1100px; box-shadow: 0 1px 4px rgba(0,0,0,.12);
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .company { font-size: 14px; color: #444; margin-bottom: 12px; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 24px; font-size: 13px; color: #333;
          border-top: 1px solid #ddd; border-bottom: 1px solid #ddd; padding: 8px 0; margin-bottom: 14px; }
  .meta .label { color: #666; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #d5d9e0; padding: 6px 8px; text-align: start; }
  thead th { background: #e8eef7; font-weight: 600; }
  tbody tr:nth-child(even) { background: #fafbfd; }
  .num { text-align: ${rtl ? 'left' : 'right'}; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tfoot th, tfoot td { background: #f0f3f8; font-weight: 700; }
  .notes { margin-top: 14px; font-size: 12px; color: #666; }
  .notes ul { margin: 6px 0 0; padding-inline-start: 18px; }
  .stamp { margin-top: 18px; font-size: 11px; color: #888; }
  .toolbar { max-width: 1100px; margin: 0 auto 12px; display: flex; gap: 8px; justify-content: flex-end; }
  .toolbar button {
    font: inherit; padding: 8px 16px; border-radius: 6px; border: 1px solid #c3cbd6;
    background: #fff; cursor: pointer;
  }
  .toolbar button.primary { background: #1f4e8c; border-color: #1f4e8c; color: #fff; }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { box-shadow: none; padding: 0; max-width: none; }
    .toolbar { display: none; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button class="primary" onclick="window.print()">${
      rtl ? 'طباعة / حفظ PDF' : 'Print / Save as PDF'
    }</button>
    <button onclick="window.close()">${rtl ? 'إغلاق' : 'Close'}</button>
  </div>
  <div class="sheet">
    <h1>${escapeHtml(title)}</h1>
    <div class="company">${escapeHtml(companyName)}</div>
    <div class="meta">${meta}</div>
    <table>
      <thead><tr>${head}</tr></thead>
      <tbody>${body || `<tr><td colspan="${table.columns.length}">${
        rtl ? 'لا توجد بيانات' : 'No data'
      }</td></tr>`}</tbody>
      ${totals ? `<tfoot>${totals}</tfoot>` : ''}
    </table>
    ${notes ? `<div class="notes"><ul>${notes}</ul></div>` : ''}
    <div class="stamp">${rtl ? 'أُنشئ في' : 'Generated'} ${stamp}</div>
  </div>
  ${options.autoPrint ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),300));</script>' : ''}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/// Referenced so the type is exported from one place for the workbook code.
export type { Worksheet };
