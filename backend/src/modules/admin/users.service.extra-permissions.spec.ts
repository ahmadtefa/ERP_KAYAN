import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { UsersService } from './users.service';

function build(known: string[]) {
  const prisma = {
    permission: {
      findMany: jest.fn().mockResolvedValue(known.map((code) => ({ code }))),
    },
  };
  const service = new UsersService(
    prisma as any,
    { record: jest.fn() } as any,
  );
  return { service, prisma };
}

describe('UsersService extra permissions', () => {
  it('stores the codes an administrator is allowed to grant', async () => {
    const { service } = build(['cash.vouchers.create', 'reports.read']);

    await expect(
      (service as any).normalizeExtraPermissions(
        ['cash.vouchers.create'],
        ['admin.users.manage', 'cash.vouchers.create'],
        false,
      ),
    ).resolves.toEqual(['cash.vouchers.create']);
  });

  it('refuses codes that are not in the permission catalogue', async () => {
    const { service } = build(['reports.read']);

    await expect(
      (service as any).normalizeExtraPermissions(
        ['made.up.permission'],
        ['reports.read'],
        true,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a non-super-admin granting a permission they do not hold', async () => {
    const { service } = build(['admin.backup']);

    await expect(
      (service as any).normalizeExtraPermissions(
        ['admin.backup'],
        ['reports.read'],
        false,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a super administrator grant any known code', async () => {
    const { service } = build(['admin.backup']);

    await expect(
      (service as any).normalizeExtraPermissions(
        ['admin.backup'],
        [],
        true,
      ),
    ).resolves.toEqual(['admin.backup']);
  });
});
