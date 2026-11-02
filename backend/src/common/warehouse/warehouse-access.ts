import { ForbiddenException } from '@nestjs/common';

/// What a person may do on one shelf.
///
/// A branch tells the program which books to write in. It says nothing about
/// which shelves a storekeeper is trusted with: two warehouses in one branch
/// can be a main store and a quarantine cage, and the person who counts the
/// cage must not post a receipt into the store merely because both belong to
/// the same branch. These rows are the answer, and they are enforced here
/// rather than by hiding buttons.
export type WarehouseAction =
  | 'view'
  | 'receive'
  | 'issue'
  | 'transfer'
  | 'count'
  | 'approve'
  | 'cost';

export interface WarehouseGrant {
  warehouseId: string;
  canView: boolean;
  canReceive: boolean;
  canIssue: boolean;
  canTransfer: boolean;
  canCount: boolean;
  canApprove: boolean;
  canSeeCost: boolean;
}

export interface WarehouseAccessUser {
  userId?: string;
  isSuperAdmin?: boolean;
  warehouseAccess?: WarehouseGrant[] | null;
}

const FLAG: Record<WarehouseAction, keyof WarehouseGrant> = {
  view: 'canView',
  receive: 'canReceive',
  issue: 'canIssue',
  transfer: 'canTransfer',
  count: 'canCount',
  approve: 'canApprove',
  cost: 'canSeeCost',
};

/// The grants, or null when the person is unrestricted.
///
/// No rows means "not configured", and it keeps the behaviour every existing
/// installation already has: a user may work in every warehouse of their
/// branches. The moment one row is written, that user is restricted to the
/// warehouses listed - which is the only reading that makes an access screen
/// trustworthy.
export function grantsOf(user: WarehouseAccessUser | null | undefined): WarehouseGrant[] | null {
  if (!user) return null;
  if (user.isSuperAdmin) return null;
  const rows = (user.warehouseAccess ?? []).filter((row) => row && row.warehouseId);
  return rows.length > 0 ? rows : null;
}

/// The warehouse ids a person may see, or null for all of them.
export function warehouseIdsFor(user: WarehouseAccessUser | null | undefined): string[] | null {
  const grants = grantsOf(user);
  if (!grants) return null;
  return grants.filter((grant) => grant.canView).map((grant) => grant.warehouseId);
}

export function may(user: WarehouseAccessUser | null | undefined, warehouseId: string, action: WarehouseAction): boolean {
  const grants = grantsOf(user);
  if (!grants) return true;
  const grant = grants.find((row) => row.warehouseId === warehouseId);
  if (!grant) return false;
  // Every action needs the shelf to be visible; approving a loss on a shelf
  // you cannot see would be a signature on somebody else's work.
  return Boolean(grant[FLAG[action]]) && Boolean(grant.canView);
}

/// Throws instead of hiding. A direct API call must fail the same way a screen
/// would, which is the difference between access control and a hidden button.
export function assertWarehouseAccess(
  user: WarehouseAccessUser | null | undefined,
  warehouseId: string | null | undefined,
  action: WarehouseAction,
): void {
  if (!warehouseId) return;
  if (may(user, warehouseId, action)) return;
  throw new ForbiddenException(
    'You do not have permission to ' +
      `${{ view: 'view', receive: 'receive into', issue: 'issue from', transfer: 'transfer out of', count: 'count', approve: 'approve in', cost: 'see the cost of' }[action]} ` +
      'this warehouse. / لا تملك صلاحية تنفيذ هذا الإجراء في هذا المخزن.',
  );
}

/// The same check for a pair of shelves: a transfer needs to leave one and
/// arrive at the other, and being allowed in only one of them is not enough.
export function assertTransferAccess(
  user: WarehouseAccessUser | null | undefined,
  fromWarehouseId: string | null | undefined,
  toWarehouseId: string | null | undefined,
): void {
  assertWarehouseAccess(user, fromWarehouseId, 'transfer');
  assertWarehouseAccess(user, toWarehouseId, 'view');
}
