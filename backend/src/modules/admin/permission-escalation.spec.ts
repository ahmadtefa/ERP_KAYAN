import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { RolesService } from './roles.service';

// The seat reservation is the only licensing call these specs reach;
// its own behaviour is covered by licensing.service.spec.ts.
const licensingStub = { reserveSeat: jest.fn().mockResolvedValue({ reserved: true }), reconcile: jest.fn().mockResolvedValue(undefined) } as any;

describe('permission escalation protections', () => {
  const companyId = 'company-id';
  const actorId = 'actor-id';
  const elevatedPermission = 'admin.users.manage';

  it('does not let a user manager assign a role with permissions they lack', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      role: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'role-id',
            rolePermissions: [{ permission: { code: 'admin.roles.manage' } }],
          },
        ]),
      },
    };
    const service = new UsersService(prisma as any, { record: jest.fn() } as any, licensingStub);

    await expect(
      service.create(
        companyId,
        actorId,
        {
          username: 'new-user',
          fullNameEn: 'New User',
          fullNameAr: 'مستخدم جديد',
          password: 'a-long-test-password',
          roleIds: ['role-id'],
        } as any,
        ['admin.users.manage'],
        false,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not let a regular user manager reset a super administrator password', async () => {
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'super-admin-id',
          companyId,
          isSuperAdmin: true,
          deletedAt: null,
        }),
      },
    };
    const service = new UsersService(prisma as any, { record: jest.fn() } as any, licensingStub);

    await expect(
      service.changePassword(companyId, actorId, 'super-admin-id', 'new-test-password', false),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not let a role manager create a role with permissions they lack', async () => {
    const prisma = {
      role: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new RolesService(prisma as any, { record: jest.fn() } as any);

    await expect(
      service.create(
        companyId,
        actorId,
        {
          code: 'ESCALATED',
          nameEn: 'Escalated',
          nameAr: 'صلاحيات موسعة',
          permissions: [elevatedPermission],
        },
        ['admin.roles.manage'],
        false,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not let a role manager add permissions they do not hold to an existing role', async () => {
    const prisma = {
      role: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'role-id',
          companyId,
          deletedAt: null,
        }),
      },
    };
    const service = new RolesService(prisma as any, { record: jest.fn() } as any);

    await expect(
      service.setPermissions(
        companyId,
        actorId,
        'role-id',
        [elevatedPermission],
        ['admin.roles.manage'],
        false,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('prevents company role managers from changing global system role permissions', async () => {
    const prisma = {
      role: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'global-accountant',
          companyId: null,
          isSystem: true,
          deletedAt: null,
        }),
      },
    };
    const service = new RolesService(prisma as any, { record: jest.fn() } as any);

    await expect(
      service.setPermissions(
        companyId,
        actorId,
        'global-accountant',
        ['accounting.journals.read'],
        ['admin.roles.manage', 'accounting.journals.read'],
        false,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('revokes all active refresh sessions when a user is disabled through update', async () => {
    const userRecord = {
      id: 'target-user',
      companyId,
      username: 'target',
      email: null,
      fullNameEn: 'Target User',
      fullNameAr: 'مستخدم',
      isActive: true,
      isSuperAdmin: false,
      lastLoginAt: null,
      lockedUntil: null,
      createdAt: new Date(),
      userRoles: [],
      branches: [],
      deletedAt: null,
    };
    const revokeSessions = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      user: { update: jest.fn().mockResolvedValue(userRecord) },
      refreshToken: { updateMany: revokeSessions },
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(userRecord) },
      $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback(tx)),
    };
    const service = new UsersService(prisma as any, { record: jest.fn() } as any, licensingStub);

    await service.update(companyId, actorId, 'target-user', { isActive: false }, [], false);

    expect(revokeSessions).toHaveBeenCalledWith({
      where: { userId: 'target-user', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('prevents a regular user manager from modifying or deactivating a super administrator', async () => {
    const superAdmin = {
      id: 'super-admin-id',
      companyId,
      username: 'privileged-admin',
      isSuperAdmin: true,
      deletedAt: null,
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(superAdmin) },
    };
    const service = new UsersService(prisma as any, { record: jest.fn() } as any, licensingStub);

    await expect(
      service.update(companyId, actorId, superAdmin.id, { fullNameEn: 'Changed' }, [], false),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.deactivate(companyId, actorId, superAdmin.id, false),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

});

describe('direct permission grants', () => {
  const companyId = 'company-id';
  const actorId = 'actor-id';
  const target = {
    id: 'target-user',
    companyId,
    username: 'target',
    email: null,
    fullNameEn: 'Target User',
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

  function buildService(permissionRows: Array<{ id: string; code: string }>) {
    const tx = {
      user: { update: jest.fn().mockResolvedValue(target) },
      permission: {
        findMany: jest.fn().mockResolvedValue(permissionRows),
      },
      userPermission: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: permissionRows.length }),
      },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(target) },
      permission: { findMany: jest.fn().mockResolvedValue(permissionRows) },
      $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback(tx)),
    };
    const service = new UsersService(prisma as any, { record: jest.fn() } as any, licensingStub);
    return { service, prisma, tx };
  }

  it('does not let a user manager directly grant a permission they lack', async () => {
    const { service } = buildService([{ id: 'perm-post', code: 'cash.vouchers.post' }]);

    await expect(
      service.update(
        companyId,
        actorId,
        'target-user',
        { extraPermissions: ['cash.vouchers.post'] } as any,
        ['admin.users.manage'],
        false,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a user manager directly grant a permission they hold', async () => {
    const { service, tx } = buildService([{ id: 'perm-post', code: 'cash.vouchers.post' }]);

    await service.update(
      companyId,
      actorId,
      'target-user',
      { extraPermissions: ['cash.vouchers.post'] } as any,
      ['admin.users.manage', 'cash.vouchers.post'],
      false,
    );

    expect(tx.userPermission.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'target-user', permissionId: 'perm-post' }],
    });
  });

  it('rejects direct grants that name unknown permission codes', async () => {
    const { service } = buildService([]);

    await expect(
      service.update(
        companyId,
        actorId,
        'target-user',
        { extraPermissions: ['no.such.permission'] } as any,
        ['admin.users.manage'],
        true,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('shows direct grants on the user response', async () => {
    const withGrants = {
      ...target,
      userPermissions: [{ permission: { code: 'cash.vouchers.post' } }],
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(withGrants) },
    };
    const service = new UsersService(prisma as any, { record: jest.fn() } as any, licensingStub);

    const response = await service.findOne(companyId, 'target-user');
    expect((response as any).extraPermissions).toEqual(['cash.vouchers.post']);
  });
});
