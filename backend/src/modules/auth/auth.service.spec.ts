import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('refresh session security', () => {
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
