/**
 * Whether a person's company stops them from signing in.
 *
 * A suspended company (`isActive = false`) or a retired one (`deletedAt`) closes
 * its people out. One state is allowed through on purpose: the first-run setup
 * reset keeps the company row retired and keeps exactly one administrator, who
 * must sign in to finish setup on that row (see SetupService). That is the only
 * account in the installation and no live company exists.
 */
export interface CompanyState {
  isActive: boolean;
  deletedAt: Date | null;
}

interface CountsClient {
  user: { count(args?: unknown): Promise<number> };
  company: { count(args: { where: { deletedAt: null } }): Promise<number> };
}

export async function companyClosesSignIn(
  prisma: CountsClient,
  company: CompanyState | null | undefined,
): Promise<boolean> {
  if (!company || !company.isActive) return true;
  if (company.deletedAt === null) return false;
  const [users, liveCompanies] = await Promise.all([
    prisma.user.count(),
    prisma.company.count({ where: { deletedAt: null } }),
  ]);
  return !(users === 1 && liveCompanies === 0);
}
