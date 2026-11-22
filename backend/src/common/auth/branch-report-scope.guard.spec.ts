import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';

import { AuthUser } from '../decorators/current-user.decorator';
import { BranchReportScopeGuard } from './branch-report-scope.guard';

function context(
  user: Partial<AuthUser>,
  query: Record<string, unknown> = {},
  params: Record<string, string> = {},
) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, query, params }) }),
  } as ExecutionContext;
}

describe('BranchReportScopeGuard', () => {
  const guard = new BranchReportScopeGuard();

  it('pins a one-branch report request to the assigned branch', () => {
    const request = context({ isSuperAdmin: false, branchId: 'branch-a', branchIds: ['branch-a'] });

    expect(guard.canActivate(request)).toBe(true);
    expect(request.switchToHttp().getRequest().query).toEqual({ branchId: 'branch-a' });
  });

  it('allows an explicitly selected branch within a multi-branch assignment', () => {
    const request = context({ isSuperAdmin: false, branchIds: ['branch-a', 'branch-b'] }, { branchId: 'branch-b' });

    expect(guard.canActivate(request)).toBe(true);
  });

  it('refuses another branch without revealing whether its reports exist', () => {
    const request = context({ isSuperAdmin: false, branchIds: ['branch-a'] }, { branchId: 'branch-outside' });

    expect(() => guard.canActivate(request)).toThrow(NotFoundException);
  });

  it('requires a branch choice rather than returning company-wide data to a multi-branch user', () => {
    const request = context({ isSuperAdmin: false, branchIds: ['branch-a', 'branch-b'] });

    expect(() => guard.canActivate(request)).toThrow(ForbiddenException);
  });

  it('does not require a branch for unrelated company-wide list exports', () => {
    const request = context(
      { isSuperAdmin: false, branchIds: ['branch-a', 'branch-b'] },
      {},
      { list: 'users' },
    );

    expect(guard.canActivate(request)).toBe(true);
    expect(request.switchToHttp().getRequest().query).toEqual({});
  });

  it('leaves company-wide users and super administrators unrestricted', () => {
    expect(guard.canActivate(context({ isSuperAdmin: false, branchIds: [] }))).toBe(true);
    expect(guard.canActivate(context({ isSuperAdmin: true, branchIds: ['branch-a'] }))).toBe(true);
  });
});
