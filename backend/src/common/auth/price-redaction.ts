/** API-edge redaction for sale prices, purchase prices and inventory costs.
 * This changes serialized responses only; business calculations and accepted
 * writes remain internal. Sensitive leaf fields are omitted rather than sent
 * with a placeholder that reveals the shape of a price column.
 */
export interface PriceVisibility {
  sale: boolean;
  purchase: boolean;
  cost: boolean;
}

/** Field names a specific response shape hides on top of the shared sets.
 * The inventory reports name the same figure differently per report - a
 * valuation column is `value`, a reconciliation difference is `difference` -
 * so the caller supplies those names instead of each controller re-implementing
 * its own recursive walk. Passing them here keeps one redaction routine and
 * avoids a local copy that quietly hides less than the shared sets do.
 */
export interface RedactionOptions {
  /** Extra keys removed when cost visibility is denied. */
  costKeys?: Iterable<string>;
  /** Extra keys removed when purchase-price visibility is denied. */
  purchaseKeys?: Iterable<string>;
}

const SALE_KEYS = new Set([
  'salePrice', 'sellingPrice', 'salesValue', 'invoiceDiscountAmount',
]);
const PURCHASE_KEYS = new Set([
  'purchasePrice', 'purchaseUnitPrice',
]);
const COST_KEYS = new Set([
  'unitCost', 'averageCost', 'costPrice', 'costOfGoods', 'costTotal',
  'inventoryCostTotal', 'returnedCostTotal', 'landedCostAmount', 'landedCostCharges',
  'runningValue', 'stockValue', 'costValue', 'valuation', 'costOfGoodsSold',
]);
const SALE_AMOUNT_KEYS = new Set([
  'subTotal', 'subtotal', 'totalAmount', 'grandTotal', 'netTotal', 'total',
  'paid', 'outstanding', 'paidAmount', 'balanceDue', 'discount', 'discountAmount', 'lineDiscountTotal',
]);
const PURCHASE_AMOUNT_KEYS = new Set([
  'subTotal', 'subtotal', 'totalAmount', 'grandTotal', 'netTotal', 'total',
  'paid', 'outstanding', 'paidAmount', 'balanceDue', 'discount', 'discountAmount', 'taxAmount',
]);
const PROFIT_KEYS = new Set(['grossProfit', 'grossMargin', 'profitMargin', 'grossProfitMargin']);

export function redactPriceFields<T>(
  value: T,
  visibility: PriceVisibility,
  amountSide: 'sale' | 'purchase' | null = null,
  options: RedactionOptions = {},
): T {
  if (Array.isArray(value)) {
    return value.map((entry) => redactPriceFields(entry, visibility, amountSide, options)) as T;
  }
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  const result: Record<string, unknown> = {};
  const extraCost = extraKeys(options.costKeys);
  const extraPurchase = extraKeys(options.purchaseKeys);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const hiddenProfit = PROFIT_KEYS.has(key) && (!visibility.sale || !visibility.cost);
    const hiddenSaleAmount = amountSide === 'sale' && (
      SALE_AMOUNT_KEYS.has(key) || key === 'unitPrice' || key === 'netUnitPrice' ||
      key === 'lineTotal' || key === 'grossLineTotal' || key === 'taxAmount'
    );
    const hiddenPurchaseAmount = amountSide === 'purchase' && (
      PURCHASE_AMOUNT_KEYS.has(key) || key === 'unitPrice' || key === 'netUnitPrice' ||
      key === 'lineTotal' || key === 'grossLineTotal'
    );
    const hidden = hiddenProfit ||
      (!visibility.sale && (SALE_KEYS.has(key) || hiddenSaleAmount)) ||
      (!visibility.purchase && (PURCHASE_KEYS.has(key) || hiddenPurchaseAmount || extraPurchase.has(key))) ||
      (!visibility.cost && (COST_KEYS.has(key) || extraCost.has(key)));
    if (!hidden) result[key] = redactPriceFields(child, visibility, amountSide, options);
  }
  return result as T;
}

/** Building a Set on every node would be wasteful; an array is already cheap
 * to scan and most callers pass nothing at all. */
function extraKeys(keys: Iterable<string> | undefined): ReadonlySet<string> {
  if (!keys) return EMPTY_KEYS;
  return keys instanceof Set ? keys : new Set(keys);
}

const EMPTY_KEYS: ReadonlySet<string> = new Set<string>();
