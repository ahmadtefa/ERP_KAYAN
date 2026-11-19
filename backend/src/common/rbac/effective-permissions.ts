/**
 * Who may do what, in one place.
 *
 * A person's effective permissions are:
 *
 *   union of the active roles they hold in their company
 *   + the permissions granted to them by name
 *   − the permissions denied to them by name
 *
 * Deny wins. That order is deliberate and it is the only order that makes a
 * per-user deny worth having:a role that grants `accounting.journal.post` to
 * everyone in finance must not be able to defeat a decision that one particular
 * person may not post.
 *
 * A disabled role is still assigned but grants nothing, so revoking a role from
 * thirty people is one toggle and not thirty edits — and re-enabling it brings
 * them back exactly as they were.
 */

export interface RoleGrantRow {
  companyId: string | null;
  deletedAt?: Date | null;
  isActive?: boolean | null;
  role: {
    code: string;
    companyId: string | null;
    deletedAt?: Date | null;
    isActive?: boolean | null;
    rolePermissions: Array<{ permission: { code: string } }>;
  };
}

export interface UserOverrideRow {
  isDenied?: boolean | null;
  permission: { code: string };
}

export interface EffectivePermissions {
  /** What the person may actually do, sorted. */
  permissions: string[];
  /** Codes withheld by an explicit deny, even if a role grants them. */
  denied: string[];
  /** Codes a role (or a direct grant) allows but a deny removed. */
  deniedFromRoles: string[];
  /** Codes the person holds only because they were granted by name. */
  grantedDirectly: string[];
  /** Role codes that contributed — disabled and deleted roles are not here. */
  roles: string[];
}

/**
 * `companyId` scopes the roles considered; a role from another company that
 * leaked into the join (a bad row, an old bug) is ignored rather than trusted.
 */
export function resolveEffectivePermissions(
  roles: readonly RoleGrantRow[],
  overrides: readonly UserOverrideRow[] = [],
  companyId?: string,
): EffectivePermissions {
  const usable = roles.filter((assignment) => {
    if (assignment.deletedAt ?? null) return false;
    if (companyId !== undefined && assignment.companyId !== companyId) return false;
    const role = assignment.role;
    if (!role) return false;
    if (role.deletedAt ?? null) return false;
    if (companyId !== undefined && role.companyId !== null && role.companyId !== companyId) {
      return false;
    }
    return true;
  });

  const fromRoles = new Set<string>();
  const roleCodes: string[] = [];
  for (const assignment of usable) {
    if (assignment.role.isActive === false) continue;
    roleCodes.push(assignment.role.code);
    for (const grant of assignment.role.rolePermissions) {
      if (grant?.permission?.code) fromRoles.add(grant.permission.code);
    }
  }

  const direct = new Set<string>();
  const denied = new Set<string>();
  for (const override of overrides) {
    const code = override?.permission?.code;
    if (!code) continue;
    if (override.isDenied) denied.add(code);
    else direct.add(code);
  }

  const allowed = new Set<string>([...fromRoles, ...direct]);
  const permissions = [...allowed].filter((code) => !denied.has(code)).sort();

  return {
    permissions,
    denied: [...denied].sort(),
    deniedFromRoles: [...fromRoles].filter((code) => denied.has(code)).sort(),
    grantedDirectly: [...direct].sort(),
    roles: [...new Set(roleCodes)].sort(),
  };
}

/// The same rule for someone who holds one of the protected permissions:
/// `admin.*` cannot be handed out by somebody who does not hold it.
export function missingFromActor(
  wanted: readonly string[],
  actorPermissions: readonly string[],
  isSuperAdmin = false,
): string[] {
  if (isSuperAdmin) return [];
  const held = new Set(actorPermissions);
  return [...new Set(wanted.filter((code) => !held.has(code)))].sort();
}
