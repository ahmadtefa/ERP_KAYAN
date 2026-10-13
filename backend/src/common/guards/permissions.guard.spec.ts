import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser } from '../decorators/current-user.decorator';
import { PermissionsGuard } from './permissions.guard';

function makeContext(user?: Partial<AuthUser>) {
  const request = { user };
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function makeGuard(required: string[] | undefined) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
  return new PermissionsGuard(reflector);
}

const baseUser: AuthUser = {
  userId: 'user-1',
  username: 'employee',
  companyId: 'company-1',
  branchId: null,
  isSuperAdmin: false,
  permissions: [],
};

describe('PermissionsGuard', () => {
  it('allows routes without permission metadata', () => {
    expect(makeGuard(undefined).canActivate(makeContext())).toBe(true);
  });

  it('rejects a missing principal when permissions are required', () => {
    expect(() => makeGuard(['reports.read']).canActivate(makeContext())).toThrow(
      ForbiddenException,
    );
  });

  it('rejects a principal missing the required permission', () => {
    expect(() =>
      makeGuard(['reports.read']).canActivate(makeContext(baseUser)),
    ).toThrow(ForbiddenException);
  });

  it('allows a principal with every required permission', () => {
    const user = { ...baseUser, permissions: ['reports.read', 'reports.export'] };
    expect(
      makeGuard(['reports.read', 'reports.export']).canActivate(makeContext(user)),
    ).toBe(true);
  });

  it('allows the designated super administrator', () => {
    const user = { ...baseUser, isSuperAdmin: true };
    expect(
      makeGuard(['reports.read']).canActivate(makeContext(user)),
    ).toBe(true);
  });
});
