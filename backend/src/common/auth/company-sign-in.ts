/**
 * Whether a person's company stops them from signing in.
 *
 * A suspended company (`isActive = false`) or a retired one (`deletedAt`) closes
 * its people out of sign-in, refresh and every request. There is no exception
 * here. The only way back for a retired company is the first-run setup reset
 * (see `resetResumeAllowsSetupSignIn`), and that is sign-in only.
 */
export interface CompanyState {
  isActive: boolean;
  deletedAt: Date | null;
}

export function companyClosesSignIn(company: CompanyState | null | undefined): boolean {
  return !company || !company.isActive || company.deletedAt !== null;
}

interface ResetClient {
  user: { count(args?: unknown): Promise<number> };
  company: { count(args: { where: { deletedAt: null } }): Promise<number> };
  auditLog: {
    findFirst(args: {
      where: { companyId: string; action: string; entity: string };
      orderBy: { createdAt: 'desc' };
      select: { userId: true };
    }): Promise<{ userId: string | null } | null>;
  };
}

/**
 * Setup-resume sign-in for the preserved administrator of a reset installation.
 *
 * The reset service retires the company row on purpose, keeps exactly one
 * administrator and writes a RESET audit entry naming that administrator. The
 * first-run setup then needs that person to sign in. This is allowed only when
 * all of these hold: the company is retired but NOT suspended, no live company
 * exists, this is the only account in the installation, and the newest RESET
 * audit entry of that company names this very account. A company that was
 * suspended or retired any other way has no such entry and stays closed.
 *
 * It applies to sign-in only. The access token it yields still fails the
 * request guard and refresh, so it opens no business API; setup itself runs on
 * its own unauthenticated route.
 */
export async function resetResumeAllowsSetupSignIn(
  prisma: ResetClient,
  user: { id: string; companyId: string },
  company: CompanyState | null | undefined,
): Promise<boolean> {
  if (!company || !company.isActive || company.deletedAt === null) return false;
  const [users, liveCompanies] = await Promise.all([
    prisma.user.count(),
    prisma.company.count({ where: { deletedAt: null } }),
  ]);
  if (users !== 1 || liveCompanies !== 0) return false;
  const reset = await prisma.auditLog.findFirst({
    where: { companyId: user.companyId, action: 'RESET', entity: 'company_data' },
    orderBy: { createdAt: 'desc' },
    select: { userId: true },
  });
  return reset?.userId === user.id;
}
