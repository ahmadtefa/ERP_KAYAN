import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable, ServiceUnavailableException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

/** Sensitive administrative routes: reject and persist an attributable denial. */
@Injectable()
export class AuditedSuperAdminGuard implements CanActivate {
  constructor(private readonly audit: AuditService, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (user?.isSuperAdmin) return true;
    // JWT should have established the caller before this guard. Do not attempt
    // to invent a tenant or write a foreign key when it has not.
    if (!user?.userId || !user.companyId) {
      throw new ForbiddenException('Only the program administrator can do this.');
    }
    try {
      await this.audit.recordRequired({
        companyId: user.companyId,
        userId: user.userId,
        action: 'ACCESS_DENIED',
        entity: 'super_admin_access',
        after: {
          controller: context.getClass().name,
          operation: context.getHandler().name,
        },
      }, this.prisma);
    } catch {
      // Do not allow a mutation simply because its denial cannot be audited.
      throw new ServiceUnavailableException('The access check could not be recorded. No changes were made.');
    }
    throw new ForbiddenException('Only the program administrator can do this.');
  }
}
