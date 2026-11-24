/// Which branches a caller may READ business documents from.
///
/// Policy (owner decision, 24 Nov 2026): an employee assigned to a branch sees
/// that branch's documents only. A super administrator, and an holder of a company-wide role
/// (ADMIN, general/finance manager, internal auditor) with no branch is
/// company-wide; any other account with no branch sees nothing.
///
/// Returns `null` for "no restriction", otherwise the allowed branch ids.
export function branchReadScope(user: {
  isSuperAdmin?: boolean;
  branchId?: string | null;
  branchIds?: string[] | null;
  roles?: string[] | null;
}): string[] | null {
  if (user.isSuperAdmin) return null;
  const assigned = (user.branchIds ?? []).filter(
    (id): id is string => typeof id === 'string' && id !== '',
  );
  if (assigned.length > 0) return assigned;
  if (user.branchId) return [user.branchId];
  // No branch assignment: only deliberately company-wide roles keep the whole
  // company. Ordinary staff with a missing assignment fail closed (no branch).
  const roles = new Set((user.roles ?? []).map((r) => r.trim().toUpperCase()));
  for (const code of COMPANY_WIDE_ROLES) if (roles.has(code)) return null;
  return [];
}

const COMPANY_WIDE_ROLES = ['ADMIN', 'GENERAL_MANAGER', 'FINANCE_MANAGER', 'INTERNAL_AUDITOR'];

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
