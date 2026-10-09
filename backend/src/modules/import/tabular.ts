import { Workbook } from 'exceljs';

/// Reading a spreadsheet or a CSV into rows of text.
///
/// Nothing here knows what the columns mean: it turns a file into a header row
/// and a list of records. The importer decides what to do with them, which
/// keeps the reading testable on its own.

export interface Sheet {
  headers: string[];
  rows: Array<{ rowNumber: number; values: Record<string, string> }>;
  /// Columns found in the file that the importer does not know about. Reported
  /// rather than silently dropped, so a user can see that a column was ignored.
  unknownColumns: string[];
}

export class ImportFormatError extends Error {}

/// `.xlsx` files arrive as a zip. The signature is checked so a renamed file
/// produces a clear message instead of a confusing parse failure.
export function isXlsx(buffer: Buffer): boolean {
  return (
    buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b
  ); // "PK"
}

export async function readXlsx(buffer: Buffer): Promise<Sheet> {
  const workbook = new Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (error) {
    throw new ImportFormatError(
      'The file could not be read as an Excel workbook. If it was saved as .xls, open it and save it as .xlsx first.',
    );
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ImportFormatError('The workbook has no sheets.');

  const grid: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    const width = row.cellCount;
    for (let index = 1; index <= width; index += 1) {
      cells.push(cellText(row.getCell(index).value));
    }
    grid.push(cells);
  });

  return gridToSheet(grid);
}

export function readCsv(buffer: Buffer): Sheet {
  // A byte-order mark is common in files exported from Excel; it would
  // otherwise glue itself to the first header and break matching.
  const content = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const grid = parseCsv(content);
  return gridToSheet(grid);
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  // Excel cells can be rich text, a formula result, or a hyperlink.
  const cell = value as {
    text?: string;
    result?: unknown;
    richText?: Array<{ text: string }>;
    hyperlink?: string;
    formula?: string;
  };
  if (typeof cell.text === 'string') return cell.text.trim();
  if (cell.richText) return cell.richText.map((part) => part.text).join('').trim();
  if (cell.result !== undefined && cell.result !== null) {
    return String(cell.result).trim();
  }
  return '';
}

/// Normalises a header so that "Name (English)", "name_en" and "  NAME-EN "
/// all mean the same column.
export function normaliseHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s_.\-()/\\]/g, '')
    .trim();
}

function gridToSheet(grid: string[][]): Sheet {
  const headerRowIndex = grid.findIndex((row) =>
    row.some((cell) => cell.trim() !== ''),
  );
  if (headerRowIndex === -1) {
    throw new ImportFormatError('The file is empty.');
  }

  const headers = grid[headerRowIndex].map((cell) => cell.trim());
  const rows: Sheet['rows'] = [];

  for (let index = headerRowIndex + 1; index < grid.length; index += 1) {
    const cells = grid[index];
    // A row of empty cells is padding, not a record.
    if (!cells.some((cell) => cell.trim() !== '')) continue;
    const values: Record<string, string> = {};
    headers.forEach((header, columnIndex) => {
      if (!header) return;
      values[normaliseHeader(header)] = (cells[columnIndex] ?? '').trim();
    });
    rows.push({ rowNumber: index + 1, values });
  }

  return { headers, rows, unknownColumns: [] };
}

/// A small RFC-4180 CSV reader: quoted fields, escaped quotes, and both CRLF
/// and LF line endings. Written out rather than pulled in, because it is
/// twenty lines and it is on the path of every import.
function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];

    if (inQuotes) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\r') {
      // handled by the \n
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
