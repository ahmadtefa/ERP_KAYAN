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
      {} as any,
      { user: { findUniqueOrThrow } } as any,
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
