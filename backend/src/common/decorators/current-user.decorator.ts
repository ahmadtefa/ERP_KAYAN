import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** The authenticated principal, resolved from the access token. */
export interface AuthUser {
  userId: string;
  username: string;
  companyId: string;
  /// The branch this session is working in. Every posting lands here.
  branchId: string | null;
  /// Every branch the account is assigned to. Warehouses are read and
  /// managed inside these, so an operator in one branch is not shown - or
  /// allowed to rename - the shelves of another. Empty (or absent) on a
  /// company-wide account, which sees the whole company.
  branchIds?: string[];
  isSuperAdmin: boolean;
  permissions: string[];
  /// Role codes held by the account (owner, storekeeper, accountant...). Used
  /// by the notification centre to address an alert to a role rather than to
  /// every person who happens to hold the permission.
  roles?: string[];
  /// What this person may do on each shelf. Empty means "not configured",
  /// which keeps every warehouse of their branches available, exactly as
  /// before this table existed.
  warehouseAccess?: Array<{
    warehouseId: string;
    canView: boolean;
    canReceive: boolean;
    canIssue: boolean;
    canTransfer: boolean;
    canCount: boolean;
    canApprove: boolean;
    canSeeCost: boolean;
  }>;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    return request.user;
  },
);
