import { reconcileRestoredAccess } from './restore-access';

/// The repair that runs after every restore. Its one promise: a company
/// that comes back without a super administrator does not stay that way,
/// because the screens that only a super administrator may open — program
/// reset and the full-database backup — have no other way back in.
describe('reconcileRestoredAccess', () => {
  const companyId = 'company-1';

  function fakeClient(overrides: {
    superAdmins: number;
    adminLink?: { user: { id: string; username: string } } | null;
  }) {
    const updates: Array<{ where: unknown; data: unknown }> = [];
    const grants: Array<{ roleId: string; permissionId: string }> = [];
    const client = {
      permission: {
        findMany: jest.fn(async () => [
          { id: 'p1', code: 'admin.backup', module: 'admin' },
          { id: 'p2', code: 'sales.invoices.read', module: 'sales' },
          { id: 'p3', code: 'accounting.journal.read', module: 'accounting' },
        ]),
      },
      role: {
        findMany: jest.fn(async () => [
          { id: 'role-admin', code: 'ADMIN' },
          { id: 'role-acct', code: 'ACCOUNTANT' },
        ]),
      },
      rolePermission: {
        createMany: jest.fn(
          async (args: { data: Array<{ roleId: string; permissionId: string }> }) => {
            grants.push(...args.data);
            return { count: args.data.length };
          },
        ),
      },
      user: {
        count: jest.fn(async () => overrides.superAdmins),
        update: jest.fn(async (args: { where: unknown; data: unknown }) => {
          updates.push(args);
          return {};
        }),
      },
      userRole: {
        findFirst: jest.fn(async () =>
          overrides.adminLink === undefined
            ? { user: { id: 'user-owner', username: 'owner' } }
            : overrides.adminLink,
        ),
      },
    };
    return { client: client as never, updates, grants };
  }

  it('promotes the ADMIN-role holder when the company has no super administrator', async () => {
    const { client, updates } = fakeClient({ superAdmins: 0 });
    const result = await reconcileRestoredAccess(client, companyId);
    expect(result.superAdminPromoted).toBe('owner');
    expect(updates).toEqual([
      { where: { id: 'user-owner' }, data: { isSuperAdmin: true } },
    ]);
  });

  it('promotes nobody when a super administrator already exists', async () => {
    const { client, updates } = fakeClient({ superAdmins: 1 });
    const result = await reconcileRestoredAccess(client, companyId);
    expect(result.superAdminPromoted).toBeNull();
    expect(updates).toEqual([]);
  });

  it('tops up the ADMIN role to the whole permission catalogue', async () => {
    const { client, grants } = fakeClient({ superAdmins: 1 });
    const result = await reconcileRestoredAccess(client, companyId);
    const adminGrants = grants.filter((g) => g.roleId === 'role-admin');
    expect(adminGrants.map((g) => g.permissionId).sort()).toEqual([
      'p1',
      'p2',
      'p3',
    ]);
    expect(result.grantsAdded).toBe(grants.length);
  });

  it('leaves the company untouched when there is nobody to promote', async () => {
    const { client, updates } = fakeClient({
      superAdmins: 0,
      adminLink: null,
    });
    const result = await reconcileRestoredAccess(client, companyId);
    expect(result.superAdminPromoted).toBeNull();
    expect(updates).toEqual([]);
  });
});
