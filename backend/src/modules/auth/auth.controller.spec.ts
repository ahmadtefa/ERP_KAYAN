import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AuthController } from './auth.controller';

describe('AuthController current principal', () => {
  it('returns tenant-scoped role labels and the authorized live permissions', async () => {
    const findUniqueOrThrow = jest.fn().mockResolvedValue({
      id: 'user-1',
      fullNameEn: 'Employee',
      isActive: true,
      userRoles: [{ role: { code: 'DISABLED_MANAGER' } }],
    });
    const controller = new AuthController(
      {} as never,
      { user: { findUniqueOrThrow } } as never,
    );
    const user: AuthUser = {
      userId: 'user-1',
      username: 'employee',
      companyId: 'company-1',
      branchId: 'branch-current',
      isSuperAdmin: false,
      roles: ['COMPANY_ACCOUNTANT'],
      permissions: ['reports.read'],
    };

    await expect(controller.me(user)).resolves.toEqual({
      user: {
        id: 'user-1',
        username: 'employee',
        fullName: 'Employee',
        companyId: 'company-1',
        branchId: 'branch-current',
        roles: ['COMPANY_ACCOUNTANT'],
        permissions: ['reports.read'],
        isActive: true,
        isSuperAdmin: false,
      },
    });
    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: {
        id: true,
        fullNameEn: true,
        isActive: true,
      },
    });
  });
});

describe('AuthController sign-out', () => {
  function controllerWith(logout: jest.Mock) {
    return new AuthController(
      { logout } as never,
      {} as never,
    );
  }
  const user = { userId: 'user-1', companyId: 'company-1', permissions: [] } as unknown as AuthUser;

  it('ends only the session named by the request body', async () => {
    const logout = jest.fn().mockResolvedValue(undefined);
    await controllerWith(logout).logout(user, { refreshToken: 'body-token' });
    expect(logout).toHaveBeenCalledWith('user-1', 'body-token');
  });

  it('still accepts the older header, and prefers the body when both are present', async () => {
    const headerOnly = jest.fn().mockResolvedValue(undefined);
    await controllerWith(headerOnly).logout(user, undefined, 'header-token');
    expect(headerOnly).toHaveBeenCalledWith('user-1', 'header-token');

    const both = jest.fn().mockResolvedValue(undefined);
    await controllerWith(both).logout(user, { refreshToken: 'body-token' }, 'header-token');
    expect(both).toHaveBeenCalledWith('user-1', 'body-token');
  });

  it('treats a missing, blank or non-string token as "no particular session"', async () => {
    for (const body of [undefined, {}, { refreshToken: '   ' }, { refreshToken: 42 }]) {
      const logout = jest.fn().mockResolvedValue(undefined);
      await controllerWith(logout).logout(user, body as never, '  ');
      expect(logout).toHaveBeenCalledWith('user-1', undefined);
    }
  });
});
