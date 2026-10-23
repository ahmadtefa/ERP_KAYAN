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
                rolePermissions: {
                  select: { permission: { select: { code: true } } },
                },
              },
            },
          },
        },
        userPermissions: {
          select: { permission: { select: { code: true } } },
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
      },
    });
    if (
      !principal ||
      !principal.isActive ||
      principal.deletedAt !== null ||
      principal.companyId !== payload.companyId ||
      principal.tokenVersion !== (payload.tokenVersion ?? 0)
    ) {
      throw new UnauthorizedException('Account is inactive or unavailable');
    }

    const permissions = [
      ...new Set([
        ...principal.userRoles.flatMap((userRole) =>
          userRole.role.rolePermissions.map(
            (rolePermission) => rolePermission.permission.code,
          ),
        ),
        ...principal.userPermissions.map(
          (grant) => grant.permission.code,
        ),
      ]),
    ];
    const branchId =
      principal.branches.find((branch) => branch.branchId === payload.branchId)
        ?.branchId ??
      principal.branches[0]?.branchId ??
      null;

    request.user = {
      userId: principal.id,
      username: principal.username,
      companyId: principal.companyId,
      branchId,
      isSuperAdmin: principal.isSuperAdmin,
      permissions,
    };
    return true;
  }
}
