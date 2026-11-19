import { BadRequestException } from '@nestjs/common';

import { RolesService } from './roles.service';

function build() {
  const tx = {
    role: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'role-1', ...data })) },
    rolePermission: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    role: {
      // create() looks for a clash first (null), then findOne() reads it back.
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({
          id: 'role-1',
          companyId: 'company-1',
          code: 'WHREAD-2026',
          nameEn: 'Warehouse reader',
          nameAr: 'قارئ مخازن',
          isSystem: false,
          isActive: true,
          category: 'CUSTOM',
          descriptionEn: null,
          descriptionAr: null,
          rolePermissions: [],
          _count: { userRoles: 0 },
        }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    permission: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(tx)),
  };
  const audit = { record: jest.fn(), recordRequired: jest.fn() };
  return { service: new RolesService(prisma as never, audit as never), tx };
}

describe('a role code', () => {
  it('accepts the hyphen a company actually types', async () => {
    const { service, tx } = build();
    const created = await service.create(
      'company-1',
      'actor',
      { code: 'WHREAD-2026', nameEn: 'Warehouse reader', nameAr: 'قارئ مخازن' } as never,
      ['admin.roles.manage'],
      false,
    );
    expect(tx.role.create).toHaveBeenCalled();
    expect(created.code).toBe('WHREAD-2026');
  });

  it('refuses a code with a space or leading punctuation', async () => {
    for (const code of ['BAD CODE', '-LEADING', 'a', 'x'.repeat(41)]) {
      const { service } = build();
      await expect(
        service.create(
          'company-1',
          'actor',
          { code, nameEn: 'x', nameAr: 'س' } as never,
          ['admin.roles.manage'],
          false,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('still refuses the administrator code', async () => {
    const { service } = build();
    await expect(
      service.create(
        'company-1',
        'actor',
        { code: 'admin', nameEn: 'x', nameAr: 'س' } as never,
        ['admin.roles.manage'],
        false,
      ),
    ).rejects.toThrow(/reserved/i);
  });
});
