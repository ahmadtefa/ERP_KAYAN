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

export interface CostVisibilityCaller {
  isSuperAdmin: boolean;
  permissions: string[];
}

/** Whether this principal is allowed to receive cost/purchase-price fields. */
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
