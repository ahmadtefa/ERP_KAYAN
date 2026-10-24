import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser } from '../decorators/current-user.decorator';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

/**
 * Denies by default: a route protected by @RequirePermissions is reachable
 * only if the token carries every declared permission.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('No principal');
    if (user.isSuperAdmin) return true;

    const missing = required.filter((p) => !user.permissions.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `ليس لديك صلاحية تنفيذ هذا الإجراء (${missing.join(', ')}). ` +
          'اطلب من مدير النظام منح هذه الصلاحية لدورك من شاشة الأدوار والصلاحيات. ' +
          `/ Missing permission: ${missing.join(', ')}. Ask an administrator to grant it to your role.`,
      );
    }
    return true;
  }
}
