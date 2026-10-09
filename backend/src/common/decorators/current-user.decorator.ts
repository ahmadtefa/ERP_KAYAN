import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** The authenticated principal, resolved from the access token. */
export interface AuthUser {
  userId: string;
  username: string;
  companyId: string;
  branchId: string | null;
  isSuperAdmin: boolean;
  permissions: string[];
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    return request.user;
  },
);
