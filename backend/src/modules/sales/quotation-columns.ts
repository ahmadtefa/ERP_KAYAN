/// The columns an offer's line table can print.
///
/// A column key can be any string the user chooses — not only the built-in
/// catalogue keys. The built-in keys (itemCode, description, quantity, …)
/// keep their default labels and numeric formatting; a user-defined key gets
/// the label the user typed and is treated as a text column. The order of
/// [COLUMN_KEYS] is the order the picker offers them in; an offer stores its
/// own order.
export interface QuotationColumn {
  /// The column's key. For built-in keys this is one of [COLUMN_KEYS]; for
  /// user-defined columns it is any free text the user typed.
  key: string;
  /// A label this offer uses instead of the built-in one.
  labelEn: string | null;
  labelAr: string | null;
  /// Hidden columns stay in the layout so they can be turned back on.
  visible: boolean;
  /// Relative width in print, 1..6.
  width: number;
  /// Whether the column holds a monetary quantity. Built-in money keys are
  /// numeric; user-defined columns default to text.
  numeric: boolean;
}

/// Built-in column keys offered by the picker. Users are not limited to
/// these: any free-text key can be added.
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
  { key: 'description', labelEn: null, labelAr: null, visible: true, width: 4, numeric: false },
  { key: 'countryOfOrigin', labelEn: null, labelAr: null, visible: true, width: 2, numeric: false },
  { key: 'unit', labelEn: null, labelAr: null, visible: true, width: 1, numeric: false },
  { key: 'quantity', labelEn: null, labelAr: null, visible: true, width: 1, numeric: true },
  { key: 'unitPrice', labelEn: null, labelAr: null, visible: true, width: 2, numeric: true },
  { key: 'lineTotal', labelEn: null, labelAr: null, visible: true, width: 2, numeric: true },
];

/// Header labels for the built-in keys only. User-defined columns carry
/// their own labels.
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

/// Reads a stored layout. Any key is accepted — built-in keys keep their
/// labels, user-defined keys keep the label stored with them. Anything
/// unreadable falls back to the standard six rather than to a blank table.
export function normalizeColumns(raw: unknown): QuotationColumn[] {
  if (!Array.isArray(raw) || raw.length === 0) return standardColumns();
  const seen = new Set<string>();
  const columns: QuotationColumn[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const key = typeof row.key === 'string' && row.key.trim() ? row.key.trim() : '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const width = Number(row.width);
    const builtIn = COLUMN_LABELS[key];
    columns.push({
      key,
      labelEn:
        typeof row.labelEn === 'string' && row.labelEn.trim()
          ? row.labelEn.trim()
          : builtIn ? builtIn.en : null,
      labelAr:
        typeof row.labelAr === 'string' && row.labelAr.trim()
          ? row.labelAr.trim()
          : builtIn ? builtIn.ar : null,
      visible: row.visible !== false,
      width: Number.isFinite(width) ? Math.min(6, Math.max(1, Math.round(width))) : 2,
      numeric: builtIn ? builtIn.numeric : Boolean(row.numeric),
    });
  }
  return columns.length ? columns : standardColumns();
}

/// The label printed for a column: the offer's own text when it has one,
/// otherwise the built-in translation. A user-defined key with no stored
/// label prints its key as-is.
export function columnLabel(column: QuotationColumn, lang: 'en' | 'ar'): string {
  const override = lang === 'ar' ? column.labelAr : column.labelEn;
  if (override && override.trim()) return override;
  const builtIn = COLUMN_LABELS[column.key];
  return builtIn ? builtIn[lang] : column.key;
}
