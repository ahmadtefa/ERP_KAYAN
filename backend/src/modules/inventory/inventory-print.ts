import type { ReportTable } from '../export/report-table';

/// The printable shape of a stock document and of the inventory reports.
///
/// These are plain functions rather than methods so the tables - which columns
/// a sheet has, what it totals, which figures are money - can be pinned by a
/// unit test without a database. The prices they contain are then redacted by
/// the same `applyPriceVisibility` every other print route uses, so a stock
/// document and a sales invoice obey one rule rather than two.

const KIND_LABELS: Record<string, { en: string; ar: string }> = {
  ADJUSTMENT: { en: 'Stock adjustment', ar: 'تسوية مخزون' },
  TRANSFER: { en: 'Stock transfer', ar: 'تحويل مخزون' },
  COUNT: { en: 'Physical count', ar: 'جرد فعلي' },
  OPENING: { en: 'Opening stock', ar: 'مخزون افتتاحي' },
};

export interface StockDocumentView {
  documentNumber: string;
  kind: string;
  documentDate: string;
  branch?: { code?: string | null; nameEn?: string | null; nameAr?: string | null } | null;
  fromBranch?: { nameEn?: string | null; nameAr?: string | null } | null;
  toBranch?: { nameEn?: string | null; nameAr?: string | null } | null;
  notes?: string | null;
  lines: Array<{
    lineNumber?: number;
    itemCode?: string | null;
    itemNameEn?: string | null;
    itemNameAr?: string | null;
    unit?: string | null;
    unitName?: string | null;
    unitFactor?: string | number | null;
    unitQuantity?: string | number | null;
    quantity?: string | number | null;
    unitCost?: string | number | null;
    countedQuantity?: string | number | null;
    notes?: string | null;
  }>;
}

function sumLineValues(
  lines: StockDocumentView['lines'],
): string | null {
  let total = 0;
  let seen = false;
  for (const line of lines) {
    const quantity = Number(line.quantity ?? 0);
    const cost = line.unitCost === null || line.unitCost === undefined ? null : Number(line.unitCost);
    if (cost === null || !Number.isFinite(cost)) continue;
    if (!Number.isFinite(quantity)) continue;
    total += quantity * cost;
    seen = true;
  }
  return seen ? (Math.round(total * 10000) / 10000).toFixed(4) : null;
}

/// A stock document as a printable table.
///
/// The unit columns are the point of the sheet for a warehouse: what was
/// entered ("3 cartons"), what that means in the base unit the ledger keeps,
/// and the factor between them. A count prints the counted figure next to the
/// system figure so the difference is visible on paper.
export function stockDocumentTable(document: StockDocumentView): ReportTable {
  const kind = KIND_LABELS[document.kind] ?? { en: document.kind, ar: document.kind };
  const columns = [
    { key: 'lineNumber', labelEn: '#', labelAr: 'م', numeric: true, width: 5 },
    { key: 'itemCode', labelEn: 'Item code', labelAr: 'كود الصنف', width: 14 },
    { key: 'itemName', labelEn: 'Item', labelAr: 'الصنف', width: 34 },
    { key: 'unit', labelEn: 'Unit entered', labelAr: 'الوحدة المدخلة', width: 14 },
    { key: 'unitFactor', labelEn: 'Factor', labelAr: 'معامل التحويل', numeric: true, width: 10 },
    { key: 'unitQuantity', labelEn: 'Quantity in unit', labelAr: 'الكمية بالوحدة', numeric: true, width: 14 },
    { key: 'quantity', labelEn: 'Base quantity', labelAr: 'الكمية بالوحدة الأساسية', numeric: true, width: 16 },
    { key: 'unitCost', labelEn: 'Unit cost', labelAr: 'تكلفة الوحدة', numeric: true, width: 12 },
    // The key names the figure as a cost so the shared redaction recognises
    // it: a warehouse sheet printed without costs must not disclose what the
    // goods are worth.
    { key: 'costValue', labelEn: 'Value', labelAr: 'القيمة', numeric: true, width: 14 },
    { key: 'notes', labelEn: 'Notes', labelAr: 'ملاحظات', width: 20 },
  ];
  if (document.kind === 'COUNT') {
    columns.splice(6, 0, {
      key: 'countedQuantity',
      labelEn: 'Counted',
      labelAr: 'المعدود',
      numeric: true,
      width: 12,
    });
  }

  const rows = document.lines.map((line) => {
    const quantity = Number(line.quantity ?? 0);
    const cost = line.unitCost === null || line.unitCost === undefined ? null : Number(line.unitCost);
    return {
      lineNumber: line.lineNumber ?? '',
      itemCode: line.itemCode ?? '',
      itemName: line.itemNameEn || line.itemNameAr || '',
      unit: line.unitName || line.unit || '',
      unitFactor: line.unitFactor === null || line.unitFactor === undefined ? '' : line.unitFactor,
      unitQuantity: line.unitQuantity ?? line.quantity ?? '',
      quantity: line.quantity ?? '',
      countedQuantity: line.countedQuantity ?? '',
      unitCost: line.unitCost ?? '',
      costValue:
        cost === null || !Number.isFinite(cost) || !Number.isFinite(quantity)
          ? ''
          : (Math.round(quantity * cost * 10000) / 10000).toFixed(4),
      notes: line.notes ?? '',
    };
  });

  const totalValue = sumLineValues(document.lines);
  const meta = [
    { labelEn: 'Document', labelAr: 'المستند', value: `${kind.en} · ${document.documentNumber}` },
    { labelEn: 'Date', labelAr: 'التاريخ', value: document.documentDate },
    {
      labelEn: 'Branch',
      labelAr: 'الفرع',
      value: document.branch?.nameEn || document.branch?.nameAr || '',
    },
  ];
  if (document.fromBranch || document.toBranch) {
    meta.push({
      labelEn: 'From',
      labelAr: 'من',
      value: document.fromBranch?.nameEn || document.fromBranch?.nameAr || '',
    });
    meta.push({
      labelEn: 'To',
      labelAr: 'إلى',
      value: document.toBranch?.nameEn || document.toBranch?.nameAr || '',
    });
  }

  return {
    slug: 'stock-document',
    titleEn: kind.en,
    titleAr: kind.ar,
    meta,
    columns,
    rows,
    totals: totalValue
      ? [
          {
            // "cost value", not "value": the totals filter recognises a cost
            // total by its label, and this one is a cost.
            labelEn: 'Total cost value',
            labelAr: 'إجمالي تكلفة المخزون',
            value: totalValue,
            stretch: 8,
          },
        ]
      : [],
    notes: document.notes ? [{ en: document.notes, ar: document.notes }] : [],
  };
}

interface ValuationRow {
  itemCode?: string | null;
  itemNameEn?: string | null;
  itemNameAr?: string | null;
  unit?: string | null;
  branchCode?: string | null;
  quantity?: string | null;
  averageCost?: string | null;
  value?: string | null;
}

/// The valuation report as a printable table. Money columns are named so the
/// existing redaction recognises them (`averageCost`, `value` on the `stock`
/// side of the catalogue), and the totals carry the same labels.
export function inventoryValuationTable(
  report: { rows: ValuationRow[]; totals: { value: string | null } },
): ReportTable {
  return {
    slug: 'stock',
    titleEn: 'Inventory valuation',
    titleAr: 'تقييم المخزون',
    meta: [],
    columns: [
      { key: 'itemCode', labelEn: 'Item code', labelAr: 'كود الصنف', width: 16 },
      { key: 'itemName', labelEn: 'Item', labelAr: 'الصنف', width: 40 },
      { key: 'unit', labelEn: 'Unit', labelAr: 'الوحدة', width: 12 },
      { key: 'branchCode', labelEn: 'Branch', labelAr: 'الفرع', width: 10 },
      { key: 'quantity', labelEn: 'Quantity', labelAr: 'الكمية', numeric: true, width: 14 },
      { key: 'averageCost', labelEn: 'Average cost', labelAr: 'متوسط التكلفة', numeric: true, width: 14 },
      { key: 'value', labelEn: 'Value', labelAr: 'القيمة', numeric: true, width: 16 },
    ],
    rows: report.rows.map((row) => ({
      itemCode: row.itemCode ?? '',
      itemName: row.itemNameEn || row.itemNameAr || '',
      unit: row.unit ?? '',
      branchCode: row.branchCode ?? '',
      quantity: row.quantity ?? '',
      averageCost: row.averageCost ?? '',
      value: row.value ?? '',
    })),
    totals: report.totals.value
      ? [
          {
            labelEn: 'Total valuation',
            labelAr: 'إجمالي التقييم',
            value: report.totals.value,
            stretch: 6,
          },
        ]
      : [],
    notes: [],
  };
}

export function slowMovingTable(report: {
  rows: Array<{
    itemCode?: string | null;
    itemNameEn?: string | null;
    itemNameAr?: string | null;
    unit?: string | null;
    quantity?: string | null;
    value?: string | null;
    lastIssuedOn?: string | null;
    daysSinceLastIssue?: number | null;
  }>;
  totals: { value: string | null; items: number };
  days: number;
}): ReportTable {
  return {
    slug: 'stock',
    titleEn: `Slow-moving stock (${report.days} days)`,
    titleAr: `المخزون الراكد (${report.days} يومًا)`,
    meta: [],
    columns: [
      { key: 'itemCode', labelEn: 'Item code', labelAr: 'كود الصنف', width: 16 },
      { key: 'itemName', labelEn: 'Item', labelAr: 'الصنف', width: 40 },
      { key: 'unit', labelEn: 'Unit', labelAr: 'الوحدة', width: 12 },
      { key: 'quantity', labelEn: 'Quantity', labelAr: 'الكمية', numeric: true, width: 14 },
      { key: 'value', labelEn: 'Value', labelAr: 'القيمة', numeric: true, width: 16 },
      { key: 'lastIssuedOn', labelEn: 'Last issued', labelAr: 'آخر صرف', date: true, width: 14 },
      { key: 'daysSinceLastIssue', labelEn: 'Days idle', labelAr: 'أيام بدون حركة', numeric: true, width: 12 },
    ],
    rows: report.rows.map((row) => ({
      itemCode: row.itemCode ?? '',
      itemName: row.itemNameEn || row.itemNameAr || '',
      unit: row.unit ?? '',
      quantity: row.quantity ?? '',
      value: row.value ?? '',
      lastIssuedOn: row.lastIssuedOn ?? '',
      daysSinceLastIssue: row.daysSinceLastIssue ?? '',
    })),
    totals: report.totals.value
      ? [
          {
            labelEn: 'Total valuation',
            labelAr: 'إجمالي التقييم',
            value: report.totals.value,
            stretch: 4,
          },
        ]
      : [],
    notes: [],
  };
}

export function reorderTable(report: {
  rows: Array<{
    itemCode?: string | null;
    itemNameEn?: string | null;
    itemNameAr?: string | null;
    unit?: string | null;
    quantity?: string | null;
    reorderLevel?: string | number | null;
    shortfall?: string | number | null;
  }>;
}): ReportTable {
  return {
    slug: 'stock',
    titleEn: 'Reorder levels',
    titleAr: 'حدود إعادة الطلب',
    meta: [],
    columns: [
      { key: 'itemCode', labelEn: 'Item code', labelAr: 'كود الصنف', width: 16 },
      { key: 'itemName', labelEn: 'Item', labelAr: 'الصنف', width: 40 },
      { key: 'unit', labelEn: 'Unit', labelAr: 'الوحدة', width: 12 },
      { key: 'quantity', labelEn: 'On hand', labelAr: 'المتاح', numeric: true, width: 14 },
      { key: 'reorderLevel', labelEn: 'Reorder level', labelAr: 'حد الطلب', numeric: true, width: 14 },
      { key: 'shortfall', labelEn: 'Shortfall', labelAr: 'النقص', numeric: true, width: 14 },
    ],
    rows: report.rows.map((row) => ({
      itemCode: row.itemCode ?? '',
      itemName: row.itemNameEn || row.itemNameAr || '',
      unit: row.unit ?? '',
      quantity: row.quantity ?? '',
      reorderLevel: row.reorderLevel ?? '',
      shortfall: row.shortfall ?? '',
    })),
    totals: [],
    notes: [],
  };
}

/// A stock-take sheet: what the ledger said, what was counted, and the
/// difference that was posted.
///
/// The unit columns come first because that is how the count was written down
/// on the shelf ("4 cartons"), followed by the base figure the ledger holds, so
/// the two can be checked against each other on paper. The variance value is a
/// cost and carries a key the shared redaction recognises.
export function stockTakeVarianceTable(report: {
  rows: Array<{
    documentNumber?: string | null;
    documentDate?: string | null;
    branchCode?: string | null;
    warehouseCode?: string | null;
    itemCode?: string | null;
    itemNameEn?: string | null;
    itemNameAr?: string | null;
    unit?: string | null;
    unitName?: string | null;
    unitFactor?: string | null;
    unitQuantity?: string | null;
    systemQuantity?: string | null;
    countedQuantity?: string | null;
    varianceQuantity?: string | null;
    unitCost?: string | number | null;
    varianceValue?: string | number | null;
    notes?: string | null;
  }>;
  totals?: {
    shortageQuantity?: string | null;
    surplusQuantity?: string | null;
    shortageValue?: string | null;
    surplusValue?: string | null;
    netValue?: string | null;
  };
}): ReportTable {
  const columns = [
    { key: 'documentNumber', labelEn: 'Count', labelAr: 'الجرد', width: 14 },
    { key: 'documentDate', labelEn: 'Date', labelAr: 'التاريخ', width: 12 },
    { key: 'warehouseCode', labelEn: 'Warehouse', labelAr: 'المخزن', width: 12 },
    { key: 'itemCode', labelEn: 'Item code', labelAr: 'كود الصنف', width: 14 },
    { key: 'itemName', labelEn: 'Item', labelAr: 'الصنف', width: 30 },
    { key: 'unitName', labelEn: 'Unit counted', labelAr: 'الوحدة المجرودة', width: 14 },
    { key: 'unitFactor', labelEn: 'Factor', labelAr: 'معامل التحويل', numeric: true, width: 10 },
    { key: 'unitQuantity', labelEn: 'Quantity in unit', labelAr: 'الكمية بالوحدة', numeric: true, width: 12 },
    { key: 'systemQuantity', labelEn: 'System (base)', labelAr: 'رصيد الدفتر (أساسي)', numeric: true, width: 14 },
    { key: 'countedQuantity', labelEn: 'Counted (base)', labelAr: 'المجرود (أساسي)', numeric: true, width: 14 },
    { key: 'varianceQuantity', labelEn: 'Difference', labelAr: 'الفرق', numeric: true, width: 12 },
    // Named as a cost twice over: the key is on the slug's cost list and the
    // label says "cost", so either rule removes it on its own.
    { key: 'unitCost', labelEn: 'Unit cost', labelAr: 'تكلفة الوحدة', numeric: true, width: 12 },
    { key: 'varianceValue', labelEn: 'Variance cost', labelAr: 'تكلفة الفرق', numeric: true, width: 14 },
    { key: 'notes', labelEn: 'Notes', labelAr: 'ملاحظات', width: 18 },
  ];

  const rows = report.rows.map((row) => ({
    documentNumber: row.documentNumber ?? '',
    documentDate: row.documentDate ?? '',
    warehouseCode: row.warehouseCode ?? row.branchCode ?? '',
    itemCode: row.itemCode ?? '',
    itemName: row.itemNameEn || row.itemNameAr || '',
    unitName: row.unitName ?? row.unit ?? '',
    unitFactor: row.unitFactor ?? '',
    unitQuantity: row.unitQuantity ?? '',
    systemQuantity: row.systemQuantity ?? '',
    countedQuantity: row.countedQuantity ?? '',
    varianceQuantity: row.varianceQuantity ?? '',
    unitCost: row.unitCost ?? '',
    varianceValue: row.varianceValue ?? '',
    notes: row.notes ?? '',
  }));

  const totals: ReportTable['totals'] = [];
  const totalsSource = report.totals ?? {};
  if (totalsSource.shortageQuantity != null) {
    totals.push({
      labelEn: 'Shortage quantity',
      labelAr: 'كمية النقص',
      value: totalsSource.shortageQuantity,
    });
  }
  if (totalsSource.surplusQuantity != null) {
    totals.push({
      labelEn: 'Surplus quantity',
      labelAr: 'كمية الزيادة',
      value: totalsSource.surplusQuantity,
    });
  }
  if (totalsSource.shortageValue != null) {
    totals.push({
      labelEn: 'Shortage cost',
      labelAr: 'تكلفة النقص',
      value: totalsSource.shortageValue,
    });
  }
  if (totalsSource.surplusValue != null) {
    totals.push({
      labelEn: 'Surplus cost',
      labelAr: 'تكلفة الزيادة',
      value: totalsSource.surplusValue,
    });
  }
  if (totalsSource.netValue != null) {
    totals.push({
      labelEn: 'Net cost of differences',
      labelAr: 'صافي تكلفة الفروق',
      value: totalsSource.netValue,
    });
  }

  return {
    slug: 'stock-take-variance',
    titleEn: 'Stock-take differences',
    titleAr: 'فروق الجرد',
    meta: [],
    columns,
    rows,
    totals,
    notes: [],
  };
}
