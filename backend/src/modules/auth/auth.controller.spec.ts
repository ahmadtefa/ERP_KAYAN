import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AuthController } from './auth.controller';

/// The principal `/auth/me` returns.
///
/// The role/permission half is the original assertion, kept as it was. The
/// photo half is new, and it exists because the first version of this feature
/// shipped with `record.avatarUpdatedAt !== null`: a row that did not carry the
/// column at all (`undefined`) was reported as "this person has a photo", so
/// every account without one asked the API for an image that was not there.
/// Absent, null and "has a photo" are therefore three separate cases here.
describe('AuthController current principal', () => {
  const user: AuthUser = {
    userId: 'user-1',
    username: 'employee',
    companyId: 'company-1',
    branchId: 'branch-current',
    isSuperAdmin: false,
    permissions: ['reports.read'],
  };

  /// The row Prisma returns, with only what the test wants to change.
  function row(extra: Record<string, unknown> = {}) {
    return {
      id: 'user-1',
      fullNameEn: 'Employee',
      isActive: true,
      userRoles: [{ role: { code: 'COMPANY_ACCOUNTANT' } }],
      ...extra,
    };
  }

  function controllerReturning(record: Record<string, unknown>) {
    const findUniqueOrThrow = jest.fn().mockResolvedValue(record);
    const controller = new AuthController(
      {} as any,
      { user: { findUniqueOrThrow } } as any,
    );
    return { controller, findUniqueOrThrow };
  }

  it('returns tenant-scoped role labels and the authorized live permissions', async () => {
    const { controller, findUniqueOrThrow } = controllerReturning(
      row({ avatarUpdatedAt: null }),
    );

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
        // No timestamp, so no photo - and the client is told so, once, in the
        // same answer that names the roles.
        hasAvatar: false,
        avatarUrl: null,
      },
    });
    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: {
        id: true,
        fullNameEn: true,
        isActive: true,
        avatarUpdatedAt: true,
        userRoles: {
          where: {
            companyId: 'company-1',
            role: {
              deletedAt: null,
              OR: [{ companyId: 'company-1' }, { companyId: null }],
            },
          },
          select: { role: { select: { code: true } } },
        },
      },
    });
  });

  describe('whether the person has a photo', () => {
    it('says yes, and gives the path, when a timestamp says there is one', async () => {
      const { controller } = controllerReturning(
        row({ avatarUpdatedAt: new Date('2026-10-30T09:15:00.000Z') }),
      );

      const result = await controller.me(user);
      expect(result.user.hasAvatar).toBe(true);
      expect(result.user.avatarUrl).toBe('/users/user-1/avatar');
    });

    it('says no when the column is present and null (deleted photo)', async () => {
      const { controller } = controllerReturning(row({ avatarUpdatedAt: null }));

      const result = await controller.me(user);
      expect(result.user.hasAvatar).toBe(false);
      expect(result.user.avatarUrl).toBeNull();
    });

    it('says no when the column is absent from the row entirely', async () => {
      // This is the regression: `undefined` is not a photo. The row here has
      // no `avatarUpdatedAt` key at all, exactly like a narrower select or an
      // older client's expectation.
      const { controller } = controllerReturning(row());

      const result = await controller.me(user);
      expect(result.user.hasAvatar).toBe(false);
      expect(result.user.avatarUrl).toBeNull();
    });

    it('never returns the image bytes, only whether one exists', async () => {
      const { controller } = controllerReturning(
        row({ avatarUpdatedAt: new Date('2026-11-01T00:00:00.000Z') }),
      );

      const result = await controller.me(user);
      // A session answer carrying pixels would make every request megabytes
      // and would put a face in every log that prints a body.
      expect(JSON.stringify(result)).not.toContain('avatarData');
      expect(Object.keys(result.user)).not.toContain('avatarData');
      expect(Object.keys(result.user)).not.toContain('avatarMime');
    });
  });
});
