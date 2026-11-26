import { companyClosesSignIn } from '../auth/company-sign-in';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { DOWNLOAD_TICKET_TYPE } from '../download-ticket';
import { ALLOW_QUERY_TOKEN_KEY } from '../decorators/allow-query-token.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthUser } from '../decorators/current-user.decorator';
import { resolveEffectivePermissions } from '../rbac/effective-permissions';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
      query?: Record<string, unknown>;
      user?: AuthUser;
    }>();

    const header = request.headers['authorization'] ?? '';
    const [scheme, headerToken] = header.split(' ');

    let token: string | null =
      scheme?.toLowerCase() === 'bearer' && headerToken ? headerToken : null;
    let fromQueryCredential = false;

    // A browser navigation - a download, or a print page opened in a new tab -
    // cannot send an Authorization header. Those few routes may carry a
    // one-minute download ticket in the query string instead, and they opt in
    // one by one. A full access token is deliberately not accepted here: an
    // address ends up in history and logs, and a ticket buys only one file.
    if (!token) {
      const allowsQueryToken = this.reflector.getAllAndOverride<boolean>(
        ALLOW_QUERY_TOKEN_KEY,
        [context.getHandler(), context.getClass()],
      );
      const fromQuery = request.query?.ticket;
      if (allowsQueryToken && typeof fromQuery === 'string' && fromQuery) {
        token = fromQuery;
        fromQueryCredential = true;
      }
    }

    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: {
      sub: string;
      username?: string;
      companyId: string;
      branchId?: string | null;
      tokenVersion?: number;
      sessionHash?: string;
      typ?: string;
    };
    try {
      payload = await this.jwt.verifyAsync<typeof payload>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
    } catch {
      // Never echo the underlying JWT error: it leaks library internals.
      throw new UnauthorizedException('Invalid or expired token');
    }

    // A download ticket is a navigation credential, not a session: it may be
    // used only where the route opted in, and never as a bearer token.
    if (fromQueryCredential && payload.typ !== DOWNLOAD_TICKET_TYPE) {
      throw new UnauthorizedException('A ticket is required for this address');
    }
    if (!fromQueryCredential && payload.typ === DOWNLOAD_TICKET_TYPE) {
      throw new UnauthorizedException('A download ticket cannot be used as a bearer token');
    }

    // Legacy access tokens without a session anchor are refreshed by the
    // client. Requiring a surviving row prevents deleted/restored users from
    // reviving previously issued access credentials with the same version.
    if (typeof payload.sessionHash !== 'string' || !/^[a-f0-9]{64}$/.test(payload.sessionHash)) {
      throw new UnauthorizedException('Session is unavailable; sign in again');
    }
    // The row must still be live. Sign-out and refresh rotation revoke it by
    // setting `revokedAt`; without this condition the access token minted
    // alongside it kept working for its full lifetime after sign-out, which
    // made "sign out" a client-side gesture only.
    const session = await this.prisma.refreshToken.findFirst({
      where: {
        tokenHash: payload.sessionHash,
        userId: payload.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!session) throw new UnauthorizedException('Session is unavailable; sign in again');

    // Authorization data is loaded from the database on every request so
    // revocations and account/branch changes take effect immediately.
    const principal = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        username: true,
        companyId: true,
        isActive: true,
        isSuperAdmin: true,
        deletedAt: true,
        tokenVersion: true,
        // A suspended or retired company stops all of its people at once.
        company: { select: { isActive: true, deletedAt: true } },
        userRoles: {
          where: {
            companyId: payload.companyId,
            role: {
              deletedAt: null,
              OR: [{ companyId: payload.companyId }, { companyId: null }],
            },
          },
          select: {
            role: {
              select: {
                code: true,
                isActive: true,
                rolePermissions: {
                  select: { permission: { select: { code: true } } },
                },
              },
            },
          },
        },
        userPermissions: {
          select: { isDenied: true, permission: { select: { code: true } } },
        },
        // Do not let a stale/malformed assignment expose another tenant's
        // branch or a branch that is inactive or soft-deleted.
        branches: {
          where: {
            branch: {
              companyId: payload.companyId,
              isActive: true,
              deletedAt: null,
            },
          },
          select: { branchId: true },
          orderBy: { branchId: 'asc' },
        },
        // Which shelves this person is trusted with, loaded with the session
        // so a request never has to ask twice - and so a screen that hides a
        // warehouse and the API that refuses it agree on the same rows.
        warehouseAccess: {
          where: { warehouse: { companyId: payload.companyId, deletedAt: null } },
          select: {
            warehouseId: true,
            canView: true,
            canReceive: true,
            canIssue: true,
            canTransfer: true,
            canCount: true,
            canApprove: true,
            canSeeCost: true,
          },
        },
      },
    });
    if (
      !principal ||
      !principal.isActive ||
      principal.deletedAt !== null ||
      principal.companyId !== payload.companyId ||
      (await companyClosesSignIn(this.prisma, principal.company)) ||
      principal.tokenVersion !== (payload.tokenVersion ?? 0)
    ) {
      throw new UnauthorizedException('Account is inactive or unavailable');
    }

    // The same arithmetic as sign-in: active roles, plus direct grants, minus
    // explicit denies. Loading it here is what makes a revoked permission stop
    // working on the very next request rather than when a token expires.
    const effective = resolveEffectivePermissions(
      principal.userRoles.map((assignment) => ({
        companyId: payload.companyId,
        role: {
          code: assignment.role.code,
          companyId: payload.companyId,
          isActive: assignment.role.isActive,
          rolePermissions: assignment.role.rolePermissions,
        },
      })),
      principal.userPermissions,
      payload.companyId,
    );
    const permissions = effective.permissions;
    const branchId =
      principal.branches.find((branch) => branch.branchId === payload.branchId)
        ?.branchId ??
      principal.branches[0]?.branchId ??
      null;
    // The role codes, so an alert addressed to a role can find the people who
    // hold it without a second query per notification.
    const roles = [
      ...new Set(
        principal.userRoles
          .filter((userRole) => (userRole.role as { isActive?: boolean }).isActive === true)
          .map((userRole) => (userRole.role as { code?: string }).code)
          .filter((code): code is string => typeof code === 'string' && code.length > 0),
      ),
    ];

    request.user = {
      userId: principal.id,
      username: principal.username,
      companyId: principal.companyId,
      branchId,
      sessionHash: payload.sessionHash,
      // The full assignment list, so a screen can show every branch the
      // person actually works in without a second round trip.
      branchIds: principal.branches.map((branch) => branch.branchId),
      roles,
      warehouseAccess: (principal as { warehouseAccess?: unknown[] }).warehouseAccess
        ? ((principal as { warehouseAccess?: unknown[] }).warehouseAccess as never)
        : [],
      isSuperAdmin: principal.isSuperAdmin,
      permissions,
    };
    return true;
  }
}
