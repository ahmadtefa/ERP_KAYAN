import { ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { RolesService } from './roles.service';

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
    const service = new UsersService(prisma as any, { record: jest.fn() } as any);

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

});
