import { ReportTable } from './report-table';

/**
 * Price redaction is applied to a copy of the export table, never to source
 * records or the in-memory business document. Omitted query options preserve
 * the historical behaviour (show prices).
 */
export interface PriceVisibilityOptions {
  showSalePrice?: string | boolean;
  showCost?: string | boolean;
}

function enabled(value: string | boolean | undefined): boolean {
  return value === undefined || value === true || value === 'true';
}

function matchesSalePrice(key: string, label: string): boolean {
  return /^(salePrice|sellingPrice|unitPrice|lineTotal|subTotal|taxAmount|totalAmount|discountAmount|salesValue)$/i.test(key) ||
    /sale price|selling price|unit price|سعر البيع|سعر الوحدة|قيمة البيع|إجمالي البيع/i.test(label);
}

function matchesCost(key: string, label: string): boolean {
  return /^(purchasePrice|unitCost|totalCost|averageCost|runningValue|stockValue|costValue|costOfGoodsSold)$/i.test(key) ||
    /cost|purchase price|valuation|تكلفة|التكلفة|قيمة المخزون/i.test(label);
}

function isMonetaryDocument(slug: string): boolean {
  return /sales-invoice|purchase-invoice|sales-order|purchase-order|sales-quotation/i.test(slug);
}

/**
 * Removes sensitive price/cost columns and their row values before a PDF or
 * print page is rendered. Monetary document totals are removed with their
 * corresponding prices because otherwise the line totals would disclose the
 * hidden prices indirectly.
 */
export function applyPriceVisibility<T extends ReportTable>(
  source: T,
  options: PriceVisibilityOptions,
): T {
  const showSalePrice = enabled(options.showSalePrice);
  const showCost = enabled(options.showCost);
  if (showSalePrice && showCost) return source;

  const hideAllDocumentMoney = isMonetaryDocument(source.slug) &&
    ((!showSalePrice && /sales/i.test(source.slug)) ||
     (!showCost && /purchase/i.test(source.slug)) ||
     (!showSalePrice && source.slug === 'sales-quotation'));

  const hiddenKeys = new Set(
    source.columns
      .filter((column) =>
        (!showSalePrice && matchesSalePrice(column.key, column.labelEn + ' ' + column.labelAr)) ||
        (!showCost && matchesCost(column.key, column.labelEn + ' ' + column.labelAr)) ||
        (hideAllDocumentMoney && /^(quantity|lineNumber|itemCode|description|unit|status|date|entryDate)$/i.test(column.key) === false &&
          column.numeric === true &&
          !/taxRate|quantity|discountPercent/i.test(column.key)),
      )
      .map((column) => column.key),
  );

  const monetaryTotal = (label: string) =>
    /subtotal|total|tax|discount|amount|price|cost|value|الإجمالي|المجموع|الضريبة|الخصم|التكلفة|السعر|القيمة/i.test(label);

  return {
    ...source,
    columns: source.columns.filter((column) => !hiddenKeys.has(column.key)),
    rows: source.rows.map((row) => {
      const next = { ...row };
      for (const key of hiddenKeys) delete next[key];
      return next;
    }),
    totals: source.totals.filter((total) => {
      if (hideAllDocumentMoney) return false;
      if (!showSalePrice && /sale|sales|revenue|بيع|مبيعات/i.test(total.labelEn + ' ' + total.labelAr)) return false;
      if (!showCost && /cost|purchase|valuation|تكلفة|مشتريات|قيمة المخزون/i.test(total.labelEn + ' ' + total.labelAr)) return false;
      return !((!showSalePrice || !showCost) && monetaryTotal(total.labelEn + ' ' + total.labelAr) &&
        /^(sale|sales|cost|purchase|valuation|profit|revenue|قيمة|إجمالي|مجموع)/i.test(total.labelEn + ' ' + total.labelAr));
    }),
  } as T;
}
