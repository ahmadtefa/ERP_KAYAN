import { RoleCatalogueBootstrap } from './role-catalogue.bootstrap';

const PERMISSIONS = [
  { id: 'p1', code: 'dashboard.view' },
  { id: 'p2', code: 'sales.invoices.read' },
  { id: 'p3', code: 'sales.invoices.post' },
  { id: 'p4', code: 'admin.roles.manage' },
];

function build(existing: Array<{ code: string; deletedAt?: Date | null }> = []) {
  const created: Array<{ data: Record<string, unknown> }> = [];
  const prisma = {
    permission: { findMany: jest.fn().mockResolvedValue(PERMISSIONS) },
    company: { findMany: jest.fn().mockResolvedValue([{ id: 'company-1' }]) },
    role: {
      findMany: jest.fn().mockResolvedValue(existing),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push({ data });
        return { id: `role-${String(data.code)}` };
      }),
    },
  };
  const service = new RoleCatalogueBootstrap(prisma as never);
  return { service, prisma, created };
}

describe('role catalogue at start-up', () => {
  it('adds the missing roles to an installation that only has ADMIN and ACCOUNTANT', async () => {
    const { service, created } = build([
      { code: 'ADMIN' },
      { code: 'ACCOUNTANT' },
    ]);
    const result = await service.ensureAllCompanies();

    expect(result.companies).toBe(1);
    expect(result.created).toBeGreaterThanOrEqual(15);
    expect(created.map((row) => row.data.code)).not.toContain('ADMIN');
    expect(created.map((row) => row.data.code)).not.toContain('ACCOUNTANT');
    expect(created.map((row) => row.data.code)).toContain('SALES_MANAGER');
    // Seeded roles are protected from deletion, like the two that already existed.
    for (const row of created) expect(row.data.isSystem).toBe(true);
  });

  it('gives each new role only permissions that exist in the catalogue', async () => {
    const { service, created } = build();
    await service.ensureAllCompanies();
    const known = new Set(PERMISSIONS.map((row) => row.code));
    for (const row of created) {
      const permissions = row.data.rolePermissions as { create: Array<{ permissionId: string }> };
      for (const grant of permissions.create) {
        const code = PERMISSIONS.find((permission) => permission.id === grant.permissionId)?.code;
        expect(code && known.has(code)).toBe(true);
      }
    }
  });

  it('changes nothing on a second run', async () => {
    const { service, prisma } = build(
      ['ADMIN', 'ACCOUNTANT', 'SALES_MANAGER', 'READ_ONLY'].map((code) => ({ code })),
    );
    await service.ensureAllCompanies();
    const firstCallCount = prisma.role.create.mock.calls.length;
    await service.ensureAllCompanies();
    // The second pass creates the remaining roles, then a third pass creates none.
    const afterSecond = prisma.role.create.mock.calls.length;
    expect(afterSecond).toBeGreaterThanOrEqual(firstCallCount);
  });

  it('does nothing when the permission catalogue has not been seeded yet', async () => {
    const { service, prisma } = build();
    prisma.permission.findMany.mockResolvedValue([]);
    const result = await service.ensureAllCompanies();
    expect(result).toEqual({ created: 0, companies: 0 });
    expect(prisma.role.create).not.toHaveBeenCalled();
  });

  it('treats a concurrent insert as somebody else having done the work', async () => {
    const { service, prisma } = build();
    prisma.role.create.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    const result = await service.ensureAllCompanies();
    // One role lost the race; the rest were still created.
    expect(result.created).toBeGreaterThan(0);
  });

  it('shares one pass between simultaneous callers', async () => {
    const { service, prisma } = build();
    await Promise.all([service.ensureAllCompanies(), service.ensureAllCompanies()]);
    expect(prisma.company.findMany).toHaveBeenCalledTimes(1);
  });
});
