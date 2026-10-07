/// A report reduced to a plain table, so that one writer can render it as
/// Excel, as CSV or as a printable page without knowing which report it is.

export interface TableColumn {
  key: string;
  labelEn: string;
  labelAr: string;
  /// Numbers are written as numbers into a spreadsheet and right-aligned in
  /// print, so the column type has to travel with the column.
  numeric?: boolean;
  /// Excel column width in characters. Sensible defaults are computed when
  /// this is left out.
  width?: number;
}

export interface TableTotal {
  labelEn: string;
  labelAr: string;
  value: string;
  /// How many of the leading columns the label spans in the printed page.
  stretch?: number;
}

export interface TableMeta {
  labelEn: string;
  labelAr: string;
  value: string;
}

export interface ReportTable {
  slug: string;
  titleEn: string;
  titleAr: string;
  meta: TableMeta[];
  columns: TableColumn[];
  /// Anything the report returned. The writer turns each value into text,
  /// and a null or missing value becomes an empty cell rather than "null".
  rows: Array<Record<string, unknown>>;
  totals: TableTotal[];
  notes: Array<{ en: string; ar: string }>;
}
