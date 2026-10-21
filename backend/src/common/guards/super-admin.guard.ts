import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthUser } from '../decorators/current-user.decorator';

/** Machine-wide operations must not be delegated through a tenant role. */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!user?.isSuperAdmin) {
      throw new ForbiddenException(
        'هذه العملية متاحة لمدير البرنامج فقط (حساب المسؤول الأعلى). ' +
          'سجّل الدخول بحساب مدير البرنامج ثم أعد المحاولة. ' +
          '/ Only the program administrator (super admin) can do this. Sign in with that account and try again.',
      );
    }
    return true;
  }
}
