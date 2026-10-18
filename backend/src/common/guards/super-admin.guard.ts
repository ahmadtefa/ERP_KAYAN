import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthUser } from '../decorators/current-user.decorator';

/** Machine-wide operations must not be delegated through a tenant role. */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!user?.isSuperAdmin) {
      throw new ForbiddenException('Only a super administrator can access full-database backups');
    }
    return true;
  }
}
