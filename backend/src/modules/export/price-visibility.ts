import { ReportTable } from './report-table';
import {
  canReadCost,
  COST_READ_PERMISSION,
  type CostVisibilityCaller,
} from '../../common/auth/cost-visibility';

/// Re-exported so existing imports keep working; the single definition lives
/// in the common auth helper used by every cost-bearing serializer.
export { COST_READ_PERMISSION };

/// Who is asking, as far as price redaction is concerned.
export type PriceVisibilityCaller = CostVisibilityCaller;

/// What the request asks for, and what the caller may have.
///
/// The dialog decides what a person wants to see in this copy; this decides
/// what the API is willing to send. A caller without the cost permission gets
/// costs forced off whatever the query says, so a hand-edited link or a direct
/// API call cannot restore a figure the role was never granted.
export function resolvePriceVisibility(
  caller: PriceVisibilityCaller,
  requested: PriceVisibilityOptions,
): PriceVisibilityOptions {
  const mayReadCost = canReadCost(caller);
  return {
    showSalePrice: requested.showSalePrice,
    showCost: mayReadCost ? requested.showCost : false,
  };
}

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

/// Which side of the money a document is made of. A sales invoice adds up
/// selling prices; a purchase invoice adds up costs. Anything else - a journal,
/// a voucher, an inventory report - is neither, and its amounts are accounting
/// figures that are not a price of anything.
type MoneySide = 'sale' | 'cost' | null;

function moneySide(slug: string): MoneySide {
  if (/^sales(?:-|$)/.test(slug)) return 'sale';
  if (/^purchases?(?:-|$)/.test(slug)) return 'cost';
  return null;
}

function matchesSalePrice(key: string, label: string): boolean {
  return /^(salePrice|sellingPrice|unitPrice|salesValue)$/i.test(key) ||
    /sale price|selling price|unit price|quotation price|سعر البيع|سعر الوحدة|قيمة البيع/i.test(label);
}

const PROFIT_LABEL = /gross profit|profit margin|مجمل الربح|هامش الربح/i;
const PROFIT_KEY = /^(grossProfit|grossMargin|profitMargin|grossProfitMargin)$/i;

function matchesCost(key: string, label: string): boolean {
  return /^(purchasePrice|unitCost|averageCost|runningValue|stockValue|costValue|costOfGoods|costOfGoodsSold)$/i.test(key) ||
    /cost|purchase price|valuation|تكلفة|التكلفة|قيمة المخزون/i.test(label);
}

/// Columns that are cost/valuation figures but carry an innocent generic key
/// the regex above cannot recognise on its own. Scoped per table slug so a
/// `value` column elsewhere keeps its ordinary meaning.
const SLUG_COST_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  // Stock balances: `value` is the cost valuation of the quantity on hand and
  // `averageCost` is its weighted-average unit cost (also matched by regex).
  stock: new Set(['value', 'averageCost']),
};

/// Columns that carry an amount rather than a quantity: a total, a subtotal, a
/// tax figure, a line total. On a document these are built from the side's
/// prices, so they disclose what the prices would have said.
const MONEY_AMOUNT_COLUMN =
  /^(amount|total|totalAmount|subTotal|subtotal|taxAmount|tax|discount|discountAmount|lineTotal|grandTotal|netTotal|paid|paidAmount|balance|balanceDue|outstanding|rounding)$/i;

const SALE_TOTAL_LABEL = /sale|sales|revenue|invoice total|بيع|مبيعات/i;
const COST_TOTAL_LABEL = /cost|purchase|valuation|stock value|تكلفة|مشتريات|قيمة المخزون|تقييم/i;

/**
 * Removes sensitive price/cost columns and their row values before a PDF or
 * print page is rendered.
 *
 * The two choices are independent: hiding the selling price of a sales invoice
 * leaves a cost the caller is allowed to see, and hiding a cost leaves the
 * prices. What is never independent is the arithmetic - a total made of hidden
 * prices leaves with them, because otherwise the printed copy would still tell
 * the reader what the hidden column said.
 */
export function applyPriceVisibility<T extends ReportTable>(
  source: T,
  options: PriceVisibilityOptions,
): T {
  const showSalePrice = enabled(options.showSalePrice);
  const showCost = enabled(options.showCost);
  if (showSalePrice && showCost) return source;

  const side = moneySide(source.slug);

  const hidden = (key: string, labels: string) => {
    if ((!showSalePrice || !showCost) && (PROFIT_KEY.test(key) || PROFIT_LABEL.test(labels))) return true;
    // Unit price means purchase price on purchase documents. Treat its
    // derived amounts the same way, including fields without export columns.
    if (side === 'cost' && /^(unitPrice|netUnitPrice|grossLineTotal|invoiceDiscountAmount)$/i.test(key)) return !showCost;
    if (!showSalePrice && matchesSalePrice(key, labels)) return true;
    if (!showCost && (matchesCost(key, labels) || SLUG_COST_KEYS[source.slug]?.has(key))) return true;
    return MONEY_AMOUNT_COLUMN.test(key) &&
      ((side === 'sale' && !showSalePrice) || (side === 'cost' && !showCost));
  };
  const hiddenKeys = new Set(source.columns
    .filter(column => hidden(column.key, column.labelEn + ' ' + column.labelAr))
    .map(column => column.key));

  return {
    ...source,
    columns: source.columns.filter((column) => !hiddenKeys.has(column.key)),
    rows: source.rows.map((row) => {
      const next = { ...row };
      for (const key of Object.keys(next)) {
        if (hiddenKeys.has(key) || hidden(key, '')) {
          delete next[key];
        }
      }
      return next;
    }),
    totals: source.totals.filter((total) => {
      const labels = total.labelEn + ' ' + total.labelAr;
      if ((!showSalePrice || !showCost) && PROFIT_LABEL.test(labels)) return false;
      if (side === 'sale') {
        // Every figure on a sales document is sale money, except a cost the
        // reader is still allowed to see.
        if (!showSalePrice) return showCost && COST_TOTAL_LABEL.test(labels);
        return showCost || !COST_TOTAL_LABEL.test(labels);
      }
      if (side === 'cost') {
        if (!showCost) return showSalePrice && SALE_TOTAL_LABEL.test(labels);
        return true;
      }
      // Reports and lists keep their totals unless the total is itself the
      // hidden figure (a valuation total, a sales total on a summary).
      if (!showCost && COST_TOTAL_LABEL.test(labels)) return false;
      if (!showSalePrice && SALE_TOTAL_LABEL.test(labels)) return false;
      return true;
    }),
  } as T;
}
