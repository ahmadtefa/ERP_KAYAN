import 'reflect-metadata';

import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { OpeningBalancesController } from './opening-balances.controller';

/**
 * Reading the opening balances is a smaller privilege than changing them:
 * the figures the books start with are sensitive, but seeing them is not the
 * same as being able to post or reverse them. The read endpoints therefore
 * carry their own permission, and these tests keep the two apart.
 */
describe('opening balances permissions', () => {
  const proto = OpeningBalancesController.prototype as any;

  function declared(handler: string): string[] | undefined {
    return Reflect.getMetadata(PERMISSIONS_KEY, proto[handler]);
  }

  it('guards reads with the opening-balances read permission', () => {
    expect(declared('findAll')).toEqual(['accounting.openingbalances.read']);
    expect(declared('findOne')).toEqual(['accounting.openingbalances.read']);
  });

  it('guards writes with the opening-balances manage permission', () => {
    expect(declared('create')).toEqual(['accounting.openingbalances.manage']);
    expect(declared('post')).toEqual(['accounting.openingbalances.manage']);
    expect(declared('reverse')).toEqual(['accounting.openingbalances.manage']);
  });

  function contextFor(handler: string, permissions: string[]) {
    const user: AuthUser = {
      userId: 'user-1',
      username: 'viewer',
      companyId: 'company-1',
      branchId: 'branch-1',
      isSuperAdmin: false,
      permissions,
    };
    return {
      getHandler: () => proto[handler],
      getClass: () => OpeningBalancesController,
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as any;
  }

  it('lets a read-only user view but not post opening balances', () => {
    const guard = new PermissionsGuard(new Reflector());
    const reader = ['accounting.openingbalances.read'];

    expect(guard.canActivate(contextFor('findAll', reader))).toBe(true);
    expect(() => guard.canActivate(contextFor('post', reader))).toThrow(
      ForbiddenException,
    );
  });

  it('does not let the manage permission substitute for read access', () => {
    const guard = new PermissionsGuard(new Reflector());
    expect(() =>
      guard.canActivate(contextFor('findAll', ['accounting.openingbalances.manage'])),
    ).toThrow(ForbiddenException);
  });
});
