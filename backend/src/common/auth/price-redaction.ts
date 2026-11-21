/** API-edge redaction for price-bearing response payloads. This changes only
 * serialized response objects; business calculations and accepted writes are
 * untouched. A null field preserves the established response shape for clients.
 */
export interface PriceVisibility {
  sale: boolean;
  purchase: boolean;
}

const SALE_KEYS = new Set([
  'salePrice', 'sellingPrice', 'salesValue', 'invoiceDiscountAmount',
]);
const PURCHASE_KEYS = new Set([
  'purchasePrice', 'unitCost', 'averageCost', 'costOfGoods', 'costTotal',
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
    const hiddenProfit = PROFIT_KEYS.has(key) && (!visibility.sale || !visibility.purchase);
    const hidden = hiddenProfit ||
      (!visibility.sale && (SALE_KEYS.has(key) || (amountSide === 'sale' && (SALE_AMOUNT_KEYS.has(key) || key === 'unitPrice' || key === 'netUnitPrice' || key === 'lineTotal' || key === 'grossLineTotal' || key === 'taxAmount')))) ||
      (!visibility.purchase && (PURCHASE_KEYS.has(key) || (amountSide === 'purchase' && (PURCHASE_AMOUNT_KEYS.has(key) || key === 'unitPrice' || key === 'netUnitPrice' || key === 'lineTotal' || key === 'grossLineTotal'))));
    result[key] = hidden ? null : redactPriceFields(child, visibility, amountSide);
  }
  return result as T;
}
