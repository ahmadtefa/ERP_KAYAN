import { resolveEffectivePermissions } from './effective-permissions';

const COMPANY = 'company-a';

function role(
  code: string,
  permissions: string[],
  extra: { isActive?: boolean; companyId?: string | null; deletedAt?: Date | null } = {},
) {
  return {
    companyId: COMPANY,
    deletedAt: null,
    role: {
      code,
      companyId: extra.companyId === undefined ? COMPANY : extra.companyId,
      deletedAt: extra.deletedAt ?? null,
      isActive: extra.isActive ?? true,
      rolePermissions: permissions.map((permission) => ({ permission: { code: permission } })),
    },
  };
}

describe('effective permissions', () => {
  it('unions several roles into one set', () => {
    const result = resolveEffectivePermissions(
      [role('SALES_CLERK', ['sales.invoices.read', 'sales.invoices.create']), role('TREASURER', ['cash.vouchers.read'])],
      [],
      COMPANY,
    );
    expect(result.permissions).toEqual([
      'cash.vouchers.read',
      'sales.invoices.create',
      'sales.invoices.read',
    ]);
    expect(result.roles).toEqual(['SALES_CLERK', 'TREASURER']);
  });

  it('lets an explicit deny beat every role that grants the code', () => {
    const result = resolveEffectivePermissions(
      [role('ACCOUNTANT', ['accounting.journal.read', 'accounting.journal.post'])],
      [{ isDenied: true, permission: { code: 'accounting.journal.post' } }],
      COMPANY,
    );
    expect(result.permissions).toEqual(['accounting.journal.read']);
    expect(result.denied).toEqual(['accounting.journal.post']);
    expect(result.deniedFromRoles).toEqual(['accounting.journal.post']);
  });

  it('applies a direct grant on top of roles, and a deny on top of the grant', () => {
    const granted = resolveEffectivePermissions(
      [role('READ_ONLY', ['reports.read'])],
      [{ isDenied: false, permission: { code: 'inventory.items.read' } }],
      COMPANY,
    );
    expect(granted.permissions).toContain('inventory.items.read');
    expect(granted.grantedDirectly).toEqual(['inventory.items.read']);

    const denied = resolveEffectivePermissions(
      [role('READ_ONLY', ['reports.read'])],
      [
        { isDenied: false, permission: { code: 'inventory.items.read' } },
        { isDenied: true, permission: { code: 'inventory.items.read' } },
      ],
      COMPANY,
    );
    expect(denied.permissions).not.toContain('inventory.items.read');
  });

  it('never throws away a permission two roles share because one of them is disabled', () => {
    const result = resolveEffectivePermissions(
      [role('FINANCE_MANAGER', ['reports.read'], { isActive: false }), role('ACCOUNTANT', ['reports.read'])],
      [],
      COMPANY,
    );
    expect(result.permissions).toEqual(['reports.read']);
    expect(result.roles).toEqual(['ACCOUNTANT']);
  });

  it('ignores deleted roles, deleted assignments and other companies', () => {
    const result = resolveEffectivePermissions(
      [
        role('DELETED_ROLE', ['admin.reset'], { deletedAt: new Date() }),
        role('OTHER_COMPANY_ROLE', ['admin.backup'], { companyId: 'company-b' }),
        { ...role('CANCELLED_ASSIGNMENT', ['admin.audit.read']), deletedAt: new Date() },
        role('ADMIN', ['admin.users.manage']),
      ],
      [],
      COMPANY,
    );
    expect(result.permissions).toEqual(['admin.users.manage']);
    expect(result.roles).toEqual(['ADMIN']);
  });

  it('grants nothing to a person with no roles and no grants', () => {
    const result = resolveEffectivePermissions([], [], COMPANY);
    expect(result.permissions).toEqual([]);
    expect(result.roles).toEqual([]);
  });
});
