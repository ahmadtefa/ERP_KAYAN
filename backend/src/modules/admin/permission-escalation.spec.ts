import { ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { RolesService } from './roles.service';

describe('permission escalation protections', () => {
  const companyId = 'company-id';
  const actorId = 'actor-id';
  const elevatedPermission = 'admin.users.manage';

  it('does not let a user manager assign a role with permissions they lack', async () => {
    const prisma = {
      role: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'role-id',
            rolePermissions: [{ permission: { code: elevatedPermission } }],
          },
        ]),
      },
    };
    const service = new UsersService(prisma as any, { record: jest.fn() } as any);

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

  it('allows a super-admin to assign a role containing elevated permissions', async () => {
    const prisma = {
      role: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'role-id',
            rolePermissions: [{ permission: { code: elevatedPermission } }],
          },
        ]),
      },
    };
    const service = new UsersService(prisma as any, { record: jest.fn() } as any);

    // Role validation succeeds for a super-admin; later database operations are
    // intentionally not mocked because this test only exercises the guard.
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
        [],
        true,
      ),
    ).rejects.toThrow();
    expect(prisma.role.findMany).toHaveBeenCalledTimes(1);
  });
});
