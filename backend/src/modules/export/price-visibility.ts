import { ReportTable } from './report-table';
import {
  canReadCost,
  canReadPurchasePrice,
  canReadSalePrice,
  COST_READ_PERMISSION,
  type CostVisibilityCaller,
} from '../../common/auth/cost-visibility';

export { COST_READ_PERMISSION };
export type PriceVisibilityCaller = CostVisibilityCaller;

/** Enforce the caller's permissions as well as the requested print options. */
export function resolvePriceVisibility(
  caller: PriceVisibilityCaller,
  requested: PriceVisibilityOptions,
): PriceVisibilityOptions {
  return {
    showSalePrice: canReadSalePrice(caller) ? requested.showSalePrice : false,
    showPurchasePrice: canReadPurchasePrice(caller) ? requested.showPurchasePrice : false,
    showCost: canReadCost(caller) ? requested.showCost : false,
  };
}

/** Applied to an output copy only; an omitted option keeps legacy print choices. */
export interface PriceVisibilityOptions {
  showSalePrice?: string | boolean;
  showPurchasePrice?: string | boolean;
  showCost?: string | boolean;
}

function enabled(value: string | boolean | undefined): boolean {
  return value === undefined || value === true || value === 'true';
}

type MoneySide = 'sale' | 'purchase' | null;

function moneySide(slug: string): MoneySide {
  if (/^sales(?:-|$)/.test(slug)) return 'sale';
  if (/^purchases?(?:-|$)/.test(slug)) return 'purchase';
  return null;
}

function matchesSalePrice(key: string, label: string): boolean {
  return /^(salePrice|sellingPrice|unitPrice|salesValue)$/i.test(key) ||
    /sale price|selling price|unit price|quotation price|سعر البيع|سعر الوحدة|قيمة البيع/i.test(label);
}

function matchesPurchasePrice(key: string, label: string): boolean {
  return /^(purchasePrice|purchaseUnitPrice)$/i.test(key) ||
    /purchase price|سعر الشراء/i.test(label);
}

const PROFIT_LABEL = /gross profit|profit margin|مجمل الربح|هامش الربح/i;
const PROFIT_KEY = /^(grossProfit|grossMargin|profitMargin|grossProfitMargin)$/i;

function matchesCost(key: string, label: string): boolean {
  return /^(unitCost|averageCost|costPrice|runningValue|stockValue|costValue|costOfGoods|costOfGoodsSold|landedCostAmount|landedCostCharges|inventoryCostTotal|returnedCostTotal|valuation)$/i.test(key) ||
    /unit cost|average cost|cost price|valuation|تكلفة|التكلفة|قيمة المخزون|تقييم/i.test(label);
}

const SLUG_COST_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  stock: new Set(['value', 'averageCost']),
};

const MONEY_AMOUNT_COLUMN =
  /^(amount|total|totalAmount|subTotal|subtotal|taxAmount|tax|discount|discountAmount|lineTotal|grandTotal|netTotal|paid|paidAmount|balance|balanceDue|outstanding|rounding)$/i;
const SALE_TOTAL_LABEL = /sale|sales|revenue|invoice total|بيع|مبيعات/i;
const PURCHASE_TOTAL_LABEL = /purchase|مشتريات|المشتريات|إجمالي الشراء/i;
const COST_TOTAL_LABEL = /cost|valuation|stock value|تكلفة|قيمة المخزون|تقييم/i;

/** Removes sensitive columns, row values, derived sums, and their output totals. */
export function applyPriceVisibility<T extends ReportTable>(
  source: T,
  options: PriceVisibilityOptions,
): T {
  const showSalePrice = enabled(options.showSalePrice);
  const showPurchasePrice = enabled(options.showPurchasePrice);
  const showCost = enabled(options.showCost);
  if (showSalePrice && showPurchasePrice && showCost) return source;

  const side = moneySide(source.slug);
  const hidden = (key: string, labels: string) => {
    if ((!showSalePrice || !showCost) && (PROFIT_KEY.test(key) || PROFIT_LABEL.test(labels))) return true;
    const isGenericPurchaseUnitPrice = side === 'purchase' &&
      /^(unitPrice|netUnitPrice|grossLineTotal|lineTotal)$/i.test(key);
    if (!showSalePrice && matchesSalePrice(key, labels) && !isGenericPurchaseUnitPrice) return true;
    if (!showPurchasePrice && (matchesPurchasePrice(key, labels) ||
        (side === 'purchase' && /^(unitPrice|netUnitPrice|grossLineTotal|lineTotal)$/i.test(key)))) return true;
    if (!showCost && (matchesCost(key, labels) || SLUG_COST_KEYS[source.slug]?.has(key))) return true;
    if (side === 'sale' && !showSalePrice && MONEY_AMOUNT_COLUMN.test(key)) return true;
    if (side === 'purchase' && !showPurchasePrice && MONEY_AMOUNT_COLUMN.test(key)) return true;
    return false;
  };
  const hiddenKeys = new Set(source.columns
    .filter(column => hidden(column.key, column.labelEn + ' ' + column.labelAr))
    .map(column => column.key));

  return {
    ...source,
    columns: source.columns.filter((column) => !hiddenKeys.has(column.key)),
    rows: source.rows.map((row) => {
      const next = { ...row };
      for (const key of Object.keys(next)) if (hiddenKeys.has(key) || hidden(key, '')) delete next[key];
      return next;
    }),
    totals: source.totals.filter((total) => {
      const labels = total.labelEn + ' ' + total.labelAr;
      if ((!showSalePrice || !showCost) && PROFIT_LABEL.test(labels)) return false;
      if (side === 'sale' && !showSalePrice &&
          !(showCost && COST_TOTAL_LABEL.test(labels))) return false;
      if (side === 'purchase' && !showPurchasePrice) return false;
      if (!showSalePrice && SALE_TOTAL_LABEL.test(labels)) return false;
      if (!showPurchasePrice && PURCHASE_TOTAL_LABEL.test(labels)) return false;
      if (!showCost && COST_TOTAL_LABEL.test(labels)) return false;
      return true;
    }),
  } as T;
}
