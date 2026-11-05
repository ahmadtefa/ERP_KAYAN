import { SetupService } from './setup.service';

// The seat reservation is the only licensing call these specs reach;
// its own behaviour is covered by licensing.service.spec.ts.
const licensingStub = { reserveSeat: jest.fn().mockResolvedValue({ reserved: true }), reconcile: jest.fn().mockResolvedValue(undefined) } as any;

describe('SetupService status', () => {
  it.each([[0, 0], [0, 2]])('allows initial setup when company count is %s and users count is %s', async (companies, users) => {
    const prisma = { company: { count: jest.fn().mockResolvedValue(companies) }, user: { count: jest.fn().mockResolvedValue(users) } };
    const service = new SetupService(prisma as any, {} as any, licensingStub);
    expect(await service.status()).toMatchObject({ needsSetup: true, recoveryRequired: false });
  });

  it('requires recovery if all surviving users belong to an inactive company', async () => {
    const count = jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    const prisma = { company: { count: jest.fn().mockResolvedValue(1) }, user: { count } };
    const service = new SetupService(prisma as any, {} as any, licensingStub);
    expect(await service.status()).toMatchObject({ needsSetup: false, recoveryRequired: true, hasUsers: true });
    expect(count).toHaveBeenCalledWith({ where: { deletedAt: null, isActive: true, company: { deletedAt: null } } });
  });

  it('does not invite first-run setup over a company with no users', async () => {
    const prisma = { company: { count: jest.fn().mockResolvedValue(1) }, user: { count: jest.fn().mockResolvedValue(0) } };
    const service = new SetupService(prisma as any, {} as any, licensingStub);
    expect(await service.status()).toMatchObject({ needsSetup: false, recoveryRequired: true, companyCount: 1, hasUsers: false });
  });
});

describe('SetupService seedRoles', () => {
  it('seeds the company profile permission needed by profile-management routes', async () => {
    const permissionUpsert = jest.fn().mockResolvedValue({});
    const service = new SetupService({} as any, {} as any, licensingStub);

    await (service as any).seedPermissions({
      permission: { upsert: permissionUpsert },
    });

    expect(permissionUpsert).toHaveBeenCalledWith({
      where: { code: 'company.profile.manage' },
      update: {
        nameEn: 'Manage company profile',
        nameAr: 'إدارة بيانات الشركة',
        module: 'admin',
      },
      create: {
        code: 'company.profile.manage',
        nameEn: 'Manage company profile',
        nameAr: 'إدارة بيانات الشركة',
        module: 'admin',
      },
    });
  });

  it('creates the current open fiscal year during first-run setup', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const service = new SetupService({} as any, {} as any, licensingStub);
    const year = new Date().getUTCFullYear();

    await (service as any).seedFiscalPeriod(
      { fiscalPeriod: { upsert } },
      'company-1',
    );

    expect(upsert).toHaveBeenCalledWith({
      where: { companyId_code: { companyId: 'company-1', code: `FY${year}` } },
      update: {},
      create: {
        companyId: 'company-1',
        code: `FY${year}`,
        nameEn: `Fiscal year ${year}`,
        nameAr: `السنة المالية ${year}`,
        startDate: new Date(Date.UTC(year, 0, 1)),
        endDate: new Date(Date.UTC(year, 11, 31)),
      },
    });
  });

  it('grants accountants their working permissions and read-only invoice access', async () => {
    const permissions = [
      { id: 'accounting-read', code: 'accounting.accounts.read', module: 'accounting' },
      { id: 'parties-read', code: 'parties.customers.read', module: 'parties' },
      { id: 'inventory-read', code: 'inventory.items.read', module: 'inventory' },
      { id: 'reports-read', code: 'reports.read', module: 'reports' },
      { id: 'sales-read', code: 'sales.invoices.read', module: 'sales' },
      { id: 'purchases-read', code: 'purchases.invoices.read', module: 'purchases' },
      { id: 'sales-create', code: 'sales.invoices.create', module: 'sales' },
      { id: 'admin-users', code: 'admin.users.manage', module: 'admin' },
    ];
    const rolePermissionUpsert = jest.fn().mockResolvedValue({});
    const tx = {
      role: {
        upsert: jest
          .fn()
          .mockResolvedValueOnce({ id: 'admin-role' })
          .mockResolvedValueOnce({ id: 'accountant-role' }),
      },
      permission: { findMany: jest.fn().mockResolvedValue(permissions) },
      rolePermission: { upsert: rolePermissionUpsert },
    };
    const service = new SetupService({} as any, {} as any, licensingStub);

    await expect((service as any).seedRoles(tx, 'company-1')).resolves.toEqual({
      admin: 'admin-role',
      accountant: 'accountant-role',
    });

    const accountantPermissionIds = rolePermissionUpsert.mock.calls
      .map(([args]) => args.create)
      .filter((create) => create.roleId === 'accountant-role')
      .map((create) => create.permissionId);

    expect(accountantPermissionIds).toEqual([
      'accounting-read',
      'parties-read',
      'inventory-read',
      'reports-read',
      'sales-read',
      'purchases-read',
    ]);
    expect(accountantPermissionIds).not.toContain('sales-create');
    expect(accountantPermissionIds).not.toContain('admin-users');
  });
});
