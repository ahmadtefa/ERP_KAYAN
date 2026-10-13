import { SetupService } from './setup.service';

describe('SetupService seedRoles', () => {
  it('seeds the company profile permission needed by profile-management routes', async () => {
    const permissionUpsert = jest.fn().mockResolvedValue({});
    const service = new SetupService({} as any, {} as any);

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
    const service = new SetupService({} as any, {} as any);

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
