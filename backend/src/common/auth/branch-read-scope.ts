/// Which branches a caller may READ business documents from.
///
/// Policy (user answer on WhatsApp, 24 Nov 2026: "his branch only"): an employee assigned to a branch sees
/// that branch's documents only. A super administrator, and an account with no
/// branch assignment at all, is company-wide.
///
/// Returns `null` for "no restriction", otherwise the allowed branch ids.
export function branchReadScope(user: {
  isSuperAdmin?: boolean;
  branchId?: string | null;
  branchIds?: string[] | null;
}): string[] | null {
  if (user.isSuperAdmin) return null;
  const assigned = (user.branchIds ?? []).filter(
    (id): id is string => typeof id === 'string' && id !== '',
  );
  if (assigned.length > 0) return assigned;
  return user.branchId ? [user.branchId] : null;
}

/// A Prisma `where` fragment for the scope: `{}` when unrestricted.
export function branchWhere(scope: string[] | null | undefined): { branchId?: { in: string[] } } {
  return scope ? { branchId: { in: scope } } : {};
}

/// True when every requested branch is inside the caller's scope. A caller
/// with no restriction (null) may assign any branch of their company.
export function branchesWithinScope(
  scope: string[] | null,
  requested: readonly string[] | undefined,
): boolean {
  if (!requested || scope === null) return true;
  return requested.every((id) => scope.includes(id));
}
