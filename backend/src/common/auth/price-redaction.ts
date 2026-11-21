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

const SALE_KEYS = new Set([
  'salePrice', 'sellingPrice', 'salesValue', 'invoiceDiscountAmount',
]);
const PURCHASE_KEYS = new Set([
  'purchasePrice', 'purchaseUnitPrice',
]);
const COST_KEYS = new Set([
  'unitCost', 'averageCost', 'costPrice', 'costOfGoods', 'costTotal',
  'landedCostAmount', 'landedCostCharges', 'runningValue', 'stockValue',
  'costValue', 'valuation', 'costOfGoodsSold',
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
): T {
  if (Array.isArray(value)) {
    return value.map((entry) => redactPriceFields(entry, visibility, amountSide)) as T;
  }
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  const result: Record<string, unknown> = {};
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
      (!visibility.purchase && (PURCHASE_KEYS.has(key) || hiddenPurchaseAmount)) ||
      (!visibility.cost && COST_KEYS.has(key));
    if (!hidden) result[key] = redactPriceFields(child, visibility, amountSide);
  }
  return result as T;
}
