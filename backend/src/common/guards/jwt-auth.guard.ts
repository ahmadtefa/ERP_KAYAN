import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
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

    // A browser navigation - a download, or a print page opened in a new tab -
    // cannot send an Authorization header. Those few routes may carry the
    // token in the query string instead, and they opt in one by one.
    if (!token) {
      const allowsQueryToken = this.reflector.getAllAndOverride<boolean>(
        ALLOW_QUERY_TOKEN_KEY,
        [context.getHandler(), context.getClass()],
      );
      const fromQuery = request.query?.token;
      if (allowsQueryToken && typeof fromQuery === 'string' && fromQuery) {
        token = fromQuery;
      }
    }

    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: {
      sub: string;
      username: string;
      companyId: string;
    };
    try {
      payload = await this.jwt.verifyAsync<typeof payload>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
    } catch {
      // Never echo the underlying JWT error: it leaks library internals.
      throw new UnauthorizedException('Invalid or expired token');
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
      principal.companyId !== payload.companyId
    ) {
      throw new UnauthorizedException('Account is inactive or unavailable');
    }

    const permissions = [
      ...new Set(
        principal.userRoles.flatMap((userRole) =>
          userRole.role.rolePermissions.map((rolePermission) =>
            rolePermission.permission.code,
          ),
        ),
      ),
    ];

    request.user = {
      userId: principal.id,
      username: principal.username,
      companyId: principal.companyId,
      branchId: principal.branches[0]?.branchId ?? null,
      isSuperAdmin: principal.isSuperAdmin,
      permissions,
    };
    return true;
  }
}
