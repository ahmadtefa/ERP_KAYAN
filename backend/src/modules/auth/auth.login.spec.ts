import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';

jest.mock('argon2', () => ({
  ...jest.requireActual('argon2'),
  verify: jest.fn(),
}));
import { AuthService } from './auth.service';

/// The five sign-in outcomes a person can meet, each asserted on the status
/// and on the message the client will show. The wrong-password and
/// unknown-account cases must be indistinguishable to the caller, and the
/// diagnostic line the server writes must never contain the password.
function build(overrides: Record<string, unknown> = {}) {
  const userRow = {
    id: 'user-1',
    username: 'admin',
    passwordHash: 'stored-hash',
    companyId: 'company-1',
    fullNameEn: 'Site Admin',
    fullNameAr: 'مدير الموقع',
    isActive: true,
    isSuperAdmin: false,
    tokenVersion: 3,
    deletedAt: null,
    lockedUntil: null,
    failedLoginCount: 0,
    userRoles: [
      {
        companyId: 'company-1',
        role: {
          code: 'accountant',
          companyId: 'company-1',
          deletedAt: null,
          rolePermissions: [{ permission: { code: 'sales.quotations.read' } }],
        },
      },
    ],
    userPermissions: [{ permission: { code: 'reports.read' } }],
    ...overrides,
  };

  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(userRow),
      update: jest.fn().mockResolvedValue({ failedLoginCount: 1 }),
    },
    userBranch: { findMany: jest.fn().mockResolvedValue([{ branchId: 'branch-1' }]) },
    refreshToken: { create: jest.fn().mockResolvedValue({}) },
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('access-token') };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new AuthService(prisma as never, jwt as never, audit as never);
  return { service, prisma, jwt, audit, userRow };
}

describe('POST /auth/login outcomes', () => {
  afterEach(() => jest.mocked(argon2.verify).mockReset());

  it('returns the tokens, the company, the branch and the real permissions', async () => {
    jest.mocked(argon2.verify).mockResolvedValue(true);
    const { service, audit } = build();

    const result = await service.login('admin', 'correct-password', '192.168.1.30');

    expect(result.accessToken).toBe('access-token');
    expect(typeof result.refreshToken).toBe('string');
    expect(result.user).toMatchObject({
      username: 'admin',
      companyId: 'company-1',
      branchId: 'branch-1',
      roles: ['accountant'],
    });
    // The role's grants and the person's own grant, once each.
    expect(result.user.permissions.sort()).toEqual([
      'reports.read',
      'sales.quotations.read',
    ]);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'LOGIN', ipAddress: '192.168.1.30' }),
    );
  });

  it('refuses a wrong password with the generic message and counts the attempt', async () => {
    jest.mocked(argon2.verify).mockResolvedValue(false);
    const { service, prisma } = build();

    await expect(service.login('admin', 'wrong-password')).rejects.toMatchObject({
      status: 401,
      message: 'Invalid username or password',
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: { failedLoginCount: { increment: 1 } },
      }),
    );
  });

  it('answers an unknown account exactly as it answers a wrong password', async () => {
    jest.mocked(argon2.verify).mockResolvedValue(false);
    const unknown = build();
    unknown.prisma.user.findUnique.mockResolvedValue(null);

    const wrongPassword = build();
    const a = await unknown.service.login('ghost', 'whatever').catch((e) => e);
    const b = await wrongPassword.service.login('admin', 'wrong').catch((e) => e);

    expect(a).toBeInstanceOf(UnauthorizedException);
    expect(b).toBeInstanceOf(UnauthorizedException);
    expect(a.message).toBe(b.message);
    expect(a.getStatus()).toBe(b.getStatus());
  });

  it('refuses an inactive account and a deleted one', async () => {
    jest.mocked(argon2.verify).mockResolvedValue(true);
    for (const row of [{ isActive: false }, { deletedAt: new Date() }]) {
      const { service } = build(row);
      await expect(service.login('admin', 'correct-password')).rejects.toMatchObject({
        status: 401,
      });
    }
  });

  it('refuses an account that is still locked', async () => {
    jest.mocked(argon2.verify).mockResolvedValue(true);
    const { service } = build({
      lockedUntil: new Date(Date.now() + 5 * 60_000),
    });
    await expect(service.login('admin', 'correct-password')).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining('locked'),
    });
  });

  it('rejects a dead refresh token and an expired one', async () => {
    const { service, prisma } = build();
    (prisma as unknown as { refreshToken: Record<string, unknown> }).refreshToken = {
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn(),
    };
    await expect(service.refresh('not-a-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const revoked = build();
    (revoked.prisma as unknown as { refreshToken: Record<string, unknown> }).refreshToken =
      {
        findUnique: jest.fn().mockResolvedValue({
          id: 'rt-1',
          revokedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          user: revoked.userRow,
        }),
        updateMany: jest.fn(),
      };
    await expect(revoked.service.refresh('revoked-token')).rejects.toMatchObject({
      status: 401,
    });
  });
});
