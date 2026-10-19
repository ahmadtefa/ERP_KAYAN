/// The columns an offer's line table can print.
///
/// One definition shared by the quotation editor, the printed page and the
/// spreadsheet, so a column renamed on screen is renamed in all three. The
/// order of [COLUMN_KEYS] is the order the picker offers them in; an offer
/// stores its own order.

export interface QuotationColumn {
  /// One of [COLUMN_KEYS].
  key: string;
  /// A label this offer uses instead of the built-in one.
  labelEn: string | null;
  labelAr: string | null;
  /// Hidden columns stay in the layout so they can be turned back on.
  visible: boolean;
  /// Relative width in print, 1..6.
  width: number;
}

export const COLUMN_KEYS = [
  'itemCode',
  'description',
  'countryOfOrigin',
  'unit',
  'quantity',
  'unitPrice',
  'lineTotal',
] as const;

/// The six columns every offer printed before layouts were configurable. An
/// offer that never chose a layout keeps printing exactly this.
export const STANDARD_COLUMNS: QuotationColumn[] = [
  { key: 'description', labelEn: null, labelAr: null, visible: true, width: 4 },
  { key: 'countryOfOrigin', labelEn: null, labelAr: null, visible: true, width: 2 },
  { key: 'unit', labelEn: null, labelAr: null, visible: true, width: 1 },
  { key: 'quantity', labelEn: null, labelAr: null, visible: true, width: 1 },
  { key: 'unitPrice', labelEn: null, labelAr: null, visible: true, width: 2 },
  { key: 'lineTotal', labelEn: null, labelAr: null, visible: true, width: 2 },
];

export const COLUMN_LABELS: Record<
  string,
  { en: string; ar: string; numeric: boolean }
> = {
  itemCode: { en: 'Item code', ar: 'كود الصنف', numeric: false },
  description: { en: 'Description', ar: 'الوصف', numeric: false },
  countryOfOrigin: { en: 'Origin', ar: 'بلد المنشأ', numeric: false },
  unit: { en: 'Unit', ar: 'الوحدة', numeric: false },
  quantity: { en: 'Qty', ar: 'الكمية', numeric: true },
  unitPrice: { en: 'Unit price', ar: 'سعر الوحدة', numeric: true },
  lineTotal: { en: 'Total', ar: 'الإجمالي', numeric: true },
};

export function standardColumns(): QuotationColumn[] {
  return STANDARD_COLUMNS.map((column) => ({ ...column }));
}

/// Reads a stored layout. Anything unrecognised is dropped rather than
/// printed as an empty column, and an unreadable layout falls back to the
/// standard six rather than to a blank table.
export function normalizeColumns(raw: unknown): QuotationColumn[] {
  if (!Array.isArray(raw) || raw.length === 0) return standardColumns();
  const seen = new Set<string>();
  const columns: QuotationColumn[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const key = typeof row.key === 'string' ? row.key : '';
    if (!COLUMN_LABELS[key] || seen.has(key)) continue;
    seen.add(key);
    const width = Number(row.width);
    columns.push({
      key,
      labelEn: typeof row.labelEn === 'string' && row.labelEn.trim() ? row.labelEn.trim() : null,
      labelAr: typeof row.labelAr === 'string' && row.labelAr.trim() ? row.labelAr.trim() : null,
      visible: row.visible !== false,
      width: Number.isFinite(width) ? Math.min(6, Math.max(1, Math.round(width))) : 2,
    });
  }
  return columns.length ? columns : standardColumns();
}

/// The label printed for a column: the offer's own text when it has one,
/// otherwise the built-in translation.
export function columnLabel(column: QuotationColumn, lang: 'en' | 'ar'): string {
  const override = lang === 'ar' ? column.labelAr : column.labelEn;
  if (override && override.trim()) return override;
  return COLUMN_LABELS[column.key][lang];
}
