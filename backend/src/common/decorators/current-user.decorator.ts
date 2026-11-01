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
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    return request.user;
  },
);
