/**
 * Cost/purchase-price visibility, enforced at the API edge.
 *
 * The catalogue treats reading a cost as its own privilege
 * (`inventory.cost.read`): a sales or warehouse role may run its whole job
 * without ever seeing what the goods cost the company. Every HTTP-facing
 * serializer that carries a cost-like field must call {@link canReadCost} for
 * the caller and emit `null` for those fields when it returns false. Internal
 * service-to-service calls and ledger math never go through an HTTP
 * serializer, so redaction here cannot change the accounting - only what
 * leaves the process.
 */
export const COST_READ_PERMISSION = 'inventory.cost.read';
export const PURCHASE_PRICE_READ_PERMISSION = 'purchases.price.read';
export const SALES_PRICE_READ_PERMISSION = 'sales.price.read';

export interface CostVisibilityCaller {
  isSuperAdmin: boolean;
  permissions: string[];
}

/** Whether this principal may receive purchase-list prices. */
export function canReadPurchasePrice(user: CostVisibilityCaller): boolean {
  // The old inventory.cost.read code is deliberately not an alias here.
  // Deployments retain its original cost visibility, while purchase prices
  // require the independently granted purchases.price.read permission.
  return user.isSuperAdmin || user.permissions.includes(PURCHASE_PRICE_READ_PERMISSION);
}

/** Whether this principal may receive selling prices. */
export function canReadSalePrice(user: CostVisibilityCaller): boolean {
  return user.isSuperAdmin || user.permissions.includes(SALES_PRICE_READ_PERMISSION);
}

/** Whether this principal may receive inventory valuation/cost fields. */
export function canReadCost(user: CostVisibilityCaller): boolean {
  return user.isSuperAdmin || user.permissions.includes(COST_READ_PERMISSION);
}

/** A cost value as a fixed-scale string for allowed callers, `null` otherwise. */
export function redactMoney(
  value: { toFixed(scale?: number): string },
  mayReadCost: boolean,
  scale = 4,
): string | null {
  return mayReadCost ? value.toFixed(scale) : null;
}
