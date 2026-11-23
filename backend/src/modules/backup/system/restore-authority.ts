import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { AuthUser } from '../../../common/decorators/current-user.decorator';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { resolveEffectivePermissions } from '../../../common/rbac/effective-permissions';

/** HTTP guards run before restore ownership is acquired. Re-read the session
 * and permissions under that lock, so a waiting request cannot use authority
 * invalidated by an earlier restore or a concurrent administrator action.
 */
export async function assertRestoreAuthority(prisma: PrismaService, actor: AuthUser, superAdminOnly: boolean): Promise<void> {
  if (!actor.sessionHash || !/^[a-f0-9]{64}$/.test(actor.sessionHash)) {
    throw new UnauthorizedException('Session is unavailable; sign in again');
  }
  const session = await prisma.refreshToken.findFirst({
    where: { userId: actor.userId, tokenHash: actor.sessionHash }, select: { id: true },
  });
  if (!session) throw new UnauthorizedException('Session changed while waiting to restore; sign in again');
  const user = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: { companyId: true, isActive: true, deletedAt: true, isSuperAdmin: true,
      userRoles: { where: { companyId: actor.companyId }, include: {
        role: { include: { rolePermissions: { include: { permission: { select: { code: true } } } } } },
      } },
      userPermissions: { select: { isDenied: true, permission: { select: { code: true } } } },
    },
  });
  if (!user || !user.isActive || user.deletedAt || user.companyId !== actor.companyId) {
    throw new UnauthorizedException('Account is inactive or unavailable');
  }
  if (user.isSuperAdmin) return;
  if (superAdminOnly || !resolveEffectivePermissions(user.userRoles, user.userPermissions, user.companyId)
    .permissions.includes('admin.backup')) {
    throw new ForbiddenException('Restore permission changed while waiting. No data was changed.');
  }
}
