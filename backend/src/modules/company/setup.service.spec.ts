import { SetupService } from './setup.service';

// The seat reservation is the only licensing call these specs reach;
// its own behaviour is covered by licensing.service.spec.ts.
const licensingStub = { reserveSeat: jest.fn().mockResolvedValue({ reserved: true }), reconcile: jest.fn().mockResolvedValue(undefined) } as any;

describe('SetupService status and public setup boundary', () => {
  /// `companyRows` counts live companies. `retired` says whether a reset left
  /// a company row behind, which is the one thing that tells a reset apart
  /// from a damaged database holding user rows with no company at all.
  const makeService = (
    companyRows: number,
    userRows: number,
    activeUsers = 0,
    retired = false,
  ) => {
    const prisma = {
      company: {
        count: jest.fn().mockResolvedValue(companyRows),
        findFirst: jest.fn().mockResolvedValue(retired ? { id: 'retired-company' } : null),
      },
      user: {
        count: jest.fn()
          .mockResolvedValueOnce(userRows)
          .mockResolvedValueOnce(activeUsers),
      },
      $transaction: jest.fn(),
    };
    return { service: new SetupService(prisma as any, {} as any, licensingStub), prisma };
  };

  it('allows first-run setup only on a truly empty database', async () => {
    const { service } = makeService(0, 0, 0);
    expect(await service.status()).toMatchObject({
      needsSetup: true, recoveryRequired: false, companyCount: 0, hasUsers: false,
    });
  });

  it('treats a company retired by a reset as setup again, not recovery', async () => {
    // The settings screen tells the operator the program "will ask to be set
    // up again". The reset keeps the row for exactly that, so this state must
    // open setup - while a live company without a usable account stays the
    // recovery case below.
    const { service } = makeService(0, 1, 0, true);
    expect(await service.status()).toMatchObject({
      needsSetup: true, recoveryRequired: false, companyCount: 0, hasUsers: true,
    });
  });

  it('classifies a live company with no usable account as recovery', async () => {
    const { service } = makeService(1, 0, 0);
    expect(await service.status()).toMatchObject({
      needsSetup: false, recoveryRequired: true, companyCount: 1,
    });
  });

  it('classifies orphaned users as recovery, never first-run setup', async () => {
    const { service } = makeService(0, 2, 0);
    expect(await service.status()).toMatchObject({
      needsSetup: false, recoveryRequired: true, companyCount: 0, hasUsers: true,
    });
  });

  it('does not require recovery when an active company user can sign in', async () => {
    const { service } = makeService(1, 1, 1);
    expect(await service.status()).toMatchObject({
      needsSetup: false, recoveryRequired: false, companyCount: 1, hasUsers: true,
    });
  });

  it.each([
    ['soft-deleted company data', 1, 0],
    ['orphaned user data', 0, 1],
    ['active company data', 1, 1],
  ])('rejects public initial setup over %s before opening a transaction', async (_case, companies, users) => {
    const prisma = {
      company: { count: jest.fn().mockResolvedValue(companies) },
      user: { count: jest.fn().mockResolvedValue(users) },
      $transaction: jest.fn(),
    };
    const service = new SetupService(prisma as any, {} as any, licensingStub);

    await expect(service.initialSetup({} as any)).rejects.toThrow(
      'This installation already contains company or user data',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rechecks company and user rows after taking the transaction lock', async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const tx = {
      $executeRaw: executeRaw,
      company: {
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      user: { count: jest.fn().mockResolvedValue(0) },
    };
    const prisma = {
      company: { count: jest.fn().mockResolvedValue(0) },
      user: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(async (callback: (transaction: unknown) => unknown) =>
        callback(tx),
      ),
    };
    const service = new SetupService(prisma as any, {} as any, licensingStub);

    await expect(
      service.initialSetup({ adminPassword: 'safe-test-password' } as any),
    ).rejects.toThrow(
      'This installation already contains company or user data',
    );
    expect(executeRaw).toHaveBeenCalledTimes(1);
    // The authoritative check counts live companies only: a company retired
    // by a reset is allowed through so setup can complete against its row.
    expect(tx.company.count).toHaveBeenCalledWith({ where: { deletedAt: null } });
    expect(tx.user.count).toHaveBeenCalledWith();
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
