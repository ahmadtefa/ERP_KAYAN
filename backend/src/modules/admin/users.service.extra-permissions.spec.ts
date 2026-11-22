import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LicensingService } from '../licensing/licensing.service';
import { UsersService } from './users.service';

// The seat reservation happens inside user creation; its behaviour is covered
// by the licensing specs, so the constructor gets a stand-in here.
const licensingStub = { reserveSeat: jest.fn().mockResolvedValue({}) };

function build(known: string[]) {
  const prisma = {
    permission: {
      findMany: jest.fn().mockResolvedValue(known.map((code) => ({ code }))),
    },
    user: { findFirst: jest.fn() },
  };
  const service = new UsersService(
    prisma as unknown as PrismaService,
    { record: jest.fn() } as unknown as AuditService,
    licensingStub as unknown as LicensingService,
  );
  return { service, prisma };
}

type PermissionNormalizer = {
  normalizeExtraPermissions(
    codes: string[] | undefined,
    actorPermissions: string[],
    isSuperAdmin: boolean,
  ): Promise<string[]>;
};

function normalize(service: UsersService, ...args: Parameters<PermissionNormalizer['normalizeExtraPermissions']>) {
  return (
    service as unknown as PermissionNormalizer
  ).normalizeExtraPermissions(...args);
}

describe('UsersService extra permissions', () => {
  it('stores the codes an administrator is allowed to grant', async () => {
    const { service } = build(['cash.vouchers.create', 'reports.read']);

    await expect(
      normalize(service, ['cash.vouchers.create'], ['admin.users.manage', 'cash.vouchers.create'], false),
    ).resolves.toEqual(['cash.vouchers.create']);
  });

  it('refuses codes that are not in the permission catalogue', async () => {
    const { service } = build(['reports.read']);

    await expect(
      normalize(service, ['made.up.permission'], ['reports.read'], true),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a non-super-admin granting a permission they do not hold', async () => {
    const { service } = build(['admin.backup']);

    await expect(
      normalize(service, ['admin.backup'], ['reports.read'], false),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a super administrator grant any known code', async () => {
    const { service } = build(['admin.backup']);

    await expect(normalize(service, ['admin.backup'], [], true)).resolves.toEqual([
      'admin.backup',
    ]);
  });

  it('returns bilingual names for each assigned branch', async () => {
    const { service, prisma } = build([]);
    const row = {
      id: 'user-1',
      companyId: 'company-1',
      username: 'operator',
      email: null,
      fullNameEn: 'Operator',
      fullNameAr: 'مشغل',
      isActive: true,
      isSuperAdmin: false,
      lastLoginAt: null,
      lockedUntil: null,
      userRoles: [],
      userPermissions: [],
      branches: [
        {
          branch: {
            id: 'branch-1',
            code: 'HQ',
            nameEn: 'Head office',
            nameAr: 'المركز الرئيسي',
          },
        },
      ],
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    prisma.user.findFirst.mockResolvedValue(row);

    const response = await service.findOne('company-1', 'user-1');

    expect(response.branches).toEqual([
      {
        id: 'branch-1',
        code: 'HQ',
        nameEn: 'Head office',
        nameAr: 'المركز الرئيسي',
      },
    ]);
  });
});
