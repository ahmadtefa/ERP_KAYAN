import { ConflictException, NotFoundException } from '@nestjs/common';

import { UsersService } from './users.service';

const companyId = 'company-1';
const actorId = 'actor-1';

const permissionRows = [
  { id: 'perm-post', code: 'cash.vouchers.post' },
  { id: 'perm-create', code: 'cash.vouchers.create' },
  { id: 'perm-roles', code: 'admin.roles.manage' },
];

const targetUser = {
  id: 'target',
  companyId,
  username: 'target',
  email: null,
  fullNameEn: 'Target',
  fullNameAr: 'مستخدم',
  isActive: true,
  isSuperAdmin: false,
  lastLoginAt: null,
  lockedUntil: null,
  createdAt: new Date(),
  userRoles: [],
  branches: [],
  userPermissions: [],
  deletedAt: null,
};

/// A transaction that holds the stored exceptions the way the database would.
function buildService(stored: Array<{ code: string; isDenied: boolean }> = []) {
  const current = stored.map((row) => ({
    isDenied: row.isDenied,
    permission: { code: row.code },
  }));
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'target' }]),
    user: { findFirst: jest.fn().mockResolvedValue(targetUser), update: jest.fn().mockResolvedValue({}) },
    userPermission: {
      findMany: jest.fn().mockResolvedValue(current),
      deleteMany: jest.fn().mockResolvedValue({ count: current.length }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    role: { findMany: jest.fn().mockResolvedValue([]) },
    permission: {
      findMany: jest.fn(async ({ where }: { where: { code: { in: string[] } } }) =>
        permissionRows.filter((row) => where.code.in.includes(row.code)),
      ),
    },
  };
  const prisma = {
    user: { findFirst: jest.fn().mockResolvedValue({ ...targetUser, userPermissions: current }) },
    permission: {
      findMany: jest.fn(async ({ where }: { where: { code: { in: string[] } } }) =>
        permissionRows.filter((row) => where.code.in.includes(row.code)),
      ),
    },
    role: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(tx)),
  };
  const audit = { record: jest.fn(), recordRequired: jest.fn() };
  const service = new UsersService(prisma as never, audit as never, {} as never);
  return { service, prisma, tx, audit };
}

describe('per-user deny', () => {
  it('writes a deny as its own row and keeps the existing grant', async () => {
    const { service, tx } = buildService([{ code: 'cash.vouchers.create', isDenied: false }]);

    await service.update(
      companyId,
      actorId,
      'target',
      { deniedPermissions: ['cash.vouchers.post'] } as never,
      ['admin.users.manage', 'cash.vouchers.post'],
      false,
    );

    const written = tx.userPermission.createMany.mock.calls[0][0].data;
    expect(written).toEqual(
      expect.arrayContaining([
        { userId: 'target', permissionId: 'perm-post', isDenied: true },
        // The grant was not touched: the form only changed the deny list.
        { userId: 'target', permissionId: 'perm-create', isDenied: false },
      ]),
    );
    expect(written).toHaveLength(2);
  });

  it('lets a deny remove a code the same request also grants', async () => {
    const { service, tx } = buildService([]);

    await service.update(
      companyId,
      actorId,
      'target',
      { extraPermissions: ['cash.vouchers.post'], deniedPermissions: ['cash.vouchers.post'] } as never,
      ['admin.users.manage', 'cash.vouchers.post'],
      false,
    );

    const written = tx.userPermission.createMany.mock.calls[0][0].data;
    expect(written).toEqual([{ userId: 'target', permissionId: 'perm-post', isDenied: true }]);
  });

  it('refuses a stale deny list under the user lock and writes nothing', async () => {
    const { service, tx } = buildService([{ code: 'cash.vouchers.create', isDenied: true }]);

    await expect(
      service.update(
        companyId,
        actorId,
        'target',
        { deniedPermissions: [], expectedDeniedPermissions: ['cash.vouchers.post'] } as never,
        ['admin.users.manage'],
        false,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.userPermission.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a denied code that does not exist', async () => {
    const { service } = buildService([]);
    await expect(
      service.update(
        companyId,
        actorId,
        'target',
        { deniedPermissions: ['sales.magic'] } as never,
        ['admin.users.manage'],
        false,
      ),
    ).rejects.toThrow(/Unknown permission/);
  });

  it('does not let a deny be used to escalate: it still needs no grant of the code', async () => {
    // Denying is not handing out, so an actor without the code may deny it.
    const { service, tx } = buildService([]);
    await service.update(
      companyId,
      actorId,
      'target',
      { deniedPermissions: ['admin.roles.manage'] } as never,
      ['admin.users.manage'],
      false,
    );
    expect(tx.userPermission.createMany.mock.calls[0][0].data).toEqual([
      { userId: 'target', permissionId: 'perm-roles', isDenied: true },
    ]);
  });
});

describe('permission preview', () => {
  function roleRow(code: string, permissions: string[], isActive = true) {
    return {
      id: `role-${code}`,
      code,
      isActive,
      companyId,
      deletedAt: null,
      rolePermissions: permissions.map((permission) => ({ permission: { code: permission } })),
    };
  }

  it('shows the union minus the denies, with warnings for the sensitive ones', async () => {
    const prisma = {
      role: {
        findMany: jest
          .fn()
          .mockResolvedValue([roleRow('ACCOUNTANT', ['accounting.journal.post', 'reports.read'])]),
      },
      user: { findFirst: jest.fn() },
      permission: { findMany: jest.fn() },
    };
    const service = new UsersService(prisma as never, {} as never, {} as never);

    const preview = await service.previewPermissions(companyId, {
      roleIds: ['role-ACCOUNTANT'],
      extraPermissions: ['inventory.cost.read'],
      deniedPermissions: ['accounting.journal.post'],
    });

    expect(preview.permissions).toEqual(['inventory.cost.read', 'reports.read']);
    expect(preview.denied).toEqual(['accounting.journal.post']);
    expect(preview.deniedFromRoles).toEqual(['accounting.journal.post']);
    expect(preview.grantedDirectly).toEqual(['inventory.cost.read']);
    expect(preview.warnings.map((warning) => warning.code)).toContain('inventory.cost.read');
    expect(preview.permissionsCount).toBe(2);
  });

  it('warns when the set allows nothing at all', async () => {
    const prisma = { role: { findMany: jest.fn().mockResolvedValue([]) }, user: {}, permission: {} };
    const service = new UsersService(prisma as never, {} as never, {} as never);
    const preview = await service.previewPermissions(companyId, { roleIds: [] });
    expect(preview.permissions).toEqual([]);
    expect(preview.warnings.some((warning) => warning.code === 'none')).toBe(true);
  });

  it('fills the untouched half from the stored user when editing', async () => {
    const prisma = {
      role: { findMany: jest.fn().mockResolvedValue([roleRow('TREASURER', ['cash.vouchers.read'])]) },
      user: {
        findFirst: jest.fn().mockResolvedValue({
          userRoles: [{ roleId: 'role-TREASURER' }],
          userPermissions: [
            { isDenied: false, permission: { code: 'cash.vouchers.create' } },
            { isDenied: true, permission: { code: 'cash.vouchers.read' } },
          ],
        }),
      },
      permission: {},
    };
    const service = new UsersService(prisma as never, {} as never, {} as never);
    const preview = await service.previewPermissions(companyId, { userId: 'target' });
    expect(preview.permissions).toEqual(['cash.vouchers.create']);
    expect(preview.denied).toEqual(['cash.vouchers.read']);
  });

  it('reports a missing user rather than guessing', async () => {
    const prisma = { role: { findMany: jest.fn() }, user: { findFirst: jest.fn().mockResolvedValue(null) }, permission: {} };
    const service = new UsersService(prisma as never, {} as never, {} as never);
    await expect(service.previewPermissions(companyId, { userId: 'ghost' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
