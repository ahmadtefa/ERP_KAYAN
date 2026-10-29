import { Prisma } from '@prisma/client';

/**
 * Access repair after a restore — shared by the company JSON restore and
 * the full PostgreSQL restore.
 *
 * A restored database is a snapshot of the program that wrote it: its role
 * grants predate permissions this version added, and its user rows may
 * carry no super administrator at all. Without the second repair, the
 * installation-level screens that only a super administrator may open —
 * «إعادة تهيئة البرنامج» and the full-database backup — stay unreachable
 * forever, because no screen exists that can grant the flag back: that is
 * exactly the lockout this repair exists to prevent.
 */

/**
 * Brings the restored access rows up to what this version of the program
 * expects, inside the restore transaction.
 *
 * Two repairs, both additive — nothing a backup grants is ever taken away:
 *
 *  1. **System-role grants.** The file's `role_permissions` were written by
 *     the version that made the backup. Permissions introduced later
 *     (opening balances, cash, quotations, …) are absent, so after a
 *     restore the company's own accountant is refused actions the screen
 *     offers — the template download is the reported example. The two
 *     starter roles the program itself defines (ADMIN, ACCOUNTANT) are
 *     topped up to the same policy `prisma/seed.ts` installs on a fresh
 *     company. Custom roles keep exactly what the file gave them.
 *  2. **A super administrator must exist.** User rows are replaced
 *     wholesale and `insertTable` deliberately does not import the
 *     super-admin flag (a file must not mint one). When that leaves the
 *     company with *no* super administrator, installation-level screens
 *     (program reset, full-database backup) become unreachable forever —
 *     there is no screen that can grant the flag back. In that case only,
 *     the earliest active account holding the ADMIN system role — the
 *     backup's own administrator — is promoted, and the promotion is
 *     written into the restore's audit record by the caller.
 */
export async function reconcileRestoredAccess(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<{ grantsAdded: number; superAdminPromoted: string | null }> {
  const catalogue = await tx.permission.findMany({
    select: { id: true, code: true, module: true },
  });
  const roles = await tx.role.findMany({
    where: { companyId, deletedAt: null, isSystem: true },
    select: { id: true, code: true },
  });

  // Mirrors the starter policy in prisma/seed.ts and the first-run setup:
  // the accountant keeps the books, the parties, the stock, the cash and
  // the reports, and reads sales/purchase invoices for reconciliation.
  const accountantModules = [
    'accounting',
    'parties',
    'inventory',
    'cash',
    'reports',
  ];
  const accountantExtra = ['sales.invoices.read', 'purchases.invoices.read'];

  let grantsAdded = 0;
  for (const role of roles) {
    const wanted =
      role.code === 'ADMIN'
        ? catalogue
        : role.code === 'ACCOUNTANT'
          ? catalogue.filter(
              (permission) =>
                accountantModules.includes(permission.module) ||
                accountantExtra.includes(permission.code),
            )
          : [];
    if (wanted.length === 0) continue;
    const created = await tx.rolePermission.createMany({
      data: wanted.map((permission) => ({
        roleId: role.id,
        permissionId: permission.id,
      })),
      skipDuplicates: true,
    });
    grantsAdded += created.count;
  }

  let superAdminPromoted: string | null = null;
  const superAdmins = await tx.user.count({
    where: { companyId, isSuperAdmin: true, isActive: true, deletedAt: null },
  });
  if (superAdmins === 0) {
    const adminRole = roles.find((role) => role.code === 'ADMIN');
    const link = adminRole
      ? await tx.userRole.findFirst({
          where: {
            companyId,
            roleId: adminRole.id,
            user: { isActive: true, deletedAt: null },
          },
          select: { user: { select: { id: true, username: true } } },
          orderBy: { user: { createdAt: 'asc' } },
        })
      : null;
    if (link?.user) {
      await tx.user.update({
        where: { id: link.user.id },
        data: { isSuperAdmin: true },
      });
      superAdminPromoted = link.user.username;
    }
  }

  return { grantsAdded, superAdminPromoted };
}
