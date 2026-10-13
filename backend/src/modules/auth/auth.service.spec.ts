import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';

describe('refresh session security', () => {
  it('increments failed-login counters atomically and locks at the threshold', async () => {
    const verify = jest.spyOn(argon2, 'verify').mockResolvedValue(false);
    const update = jest.fn()
      .mockResolvedValueOnce({ failedLoginCount: 5 })
      .mockResolvedValueOnce({});
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          username: 'employee',
          passwordHash: 'hash',
          companyId: 'company-1',
          isActive: true,
          deletedAt: null,
          lockedUntil: null,
          failedLoginCount: 4,
          userRoles: [],
        }),
        update,
      },
    };
    const service = new AuthService(
      prisma as any,
      { signAsync: jest.fn() } as any,
      { record: jest.fn() } as any,
    );

    try {
      await expect(
        service.login('employee', 'wrong-password', '127.0.0.1', 'test-agent'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(update).toHaveBeenNthCalledWith(1, {
        where: { id: 'user-1' },
        data: { failedLoginCount: { increment: 1 } },
        select: { failedLoginCount: true },
      });
      expect(update).toHaveBeenNthCalledWith(2, {
        where: { id: 'user-1' },
        data: { lockedUntil: expect.any(Date) },
      });
    } finally {
      verify.mockRestore();
    }
  });

  it('rejects a refresh token that another concurrent request already rotated', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'refresh-id',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          user: {
            id: 'active-user',
            deletedAt: null,
            isActive: true,
            userRoles: [],
            branches: [],
          },
        }),
        updateMany,
        update: jest.fn(),
        create: jest.fn(),
      },
    };
    const jwt = { signAsync: jest.fn() };
    const service = new AuthService(
      prisma as any,
      jwt as any,
      { record: jest.fn() } as any,
    );

    await expect(service.refresh('presented-refresh-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'refresh-id', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('revokes sessions and rejects refresh when the account is inactive', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const prisma = {
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'refresh-id',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          user: {
            id: 'inactive-user',
            deletedAt: null,
            isActive: false,
          },
        }),
        updateMany,
        update: jest.fn(),
      },
    };
    const jwt = { signAsync: jest.fn() };
    const service = new AuthService(
      prisma as any,
      jwt as any,
      { record: jest.fn() } as any,
    );

    await expect(service.refresh('presented-refresh-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'inactive-user', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
});
