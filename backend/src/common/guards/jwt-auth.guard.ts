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
      branchId: string | null;
      isSuperAdmin: boolean;
      tokenVersion?: number;
      permissions: string[];
    };
    try {
      payload = await this.jwt.verifyAsync<typeof payload>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
    } catch {
      // Never echo the underlying JWT error: it leaks library internals.
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Access tokens are short-lived, but account deactivation and deletion must
    // take effect immediately rather than leaving a 15-minute access window.
    const principal = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        companyId: true,
        isActive: true,
        deletedAt: true,
        tokenVersion: true,
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

    request.user = {
      userId: payload.sub,
      username: payload.username,
      companyId: payload.companyId,
      branchId: payload.branchId,
      isSuperAdmin: payload.isSuperAdmin,
      permissions: payload.permissions ?? [],
    };
    return true;
  }
}
