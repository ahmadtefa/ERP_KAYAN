import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  DOWNLOAD_TICKET_TYPE,
  downloadTicketTtl,
} from '../../common/download-ticket';
import { PrismaService } from '../../common/prisma/prisma.service';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  companyId: string;
  branchId: string | null;
  roles: string[];
  permissions: string[];
  isActive: boolean;
  isSuperAdmin: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(
    username: string,
    password: string,
    ip?: string,
    userAgent?: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: {
        userRoles: {
          include: {
            role: { include: { rolePermissions: { include: { permission: true } } } },
          },
        },
        userPermissions: { include: { permission: true } },
      },
    });

    // A single generic message for every failure mode: revealing whether the
    // username exists would let an attacker enumerate accounts.
    const invalid = new UnauthorizedException('Invalid username or password');

    if (!user || user.deletedAt !== null || !user.isActive) {
      await this.audit.record({
        action: 'LOGIN_FAILED',
        entity: 'users',
        entityId: username,
        ipAddress: ip ?? null,
        userAgent: userAgent ?? null,
      });
      throw invalid;
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(
        'Account temporarily locked after repeated failed sign-ins',
      );
    }

    const passwordOk = await argon2.verify(user.passwordHash, password);
    if (!passwordOk) {
      // Increment in the database so simultaneous failed logins cannot
      // overwrite one another's counters with the same stale value.
      const updated = await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: { increment: 1 } },
        select: { failedLoginCount: true },
      });
      if (updated.failedLoginCount >= MAX_FAILED_ATTEMPTS) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000),
          },
        });
      }
      await this.audit.record({
        companyId: user.companyId,
        userId: user.id,
        action: 'LOGIN_FAILED',
        entity: 'users',
        entityId: user.id,
        ipAddress: ip ?? null,
        userAgent: userAgent ?? null,
      });
      throw invalid;
    }

    // A user may only receive grants assigned in their own company. Shared
    // system roles are allowed, but deleted or cross-company roles are ignored.
    const currentUserRoles = user.userRoles.filter(
      (ur) =>
        ur.companyId === user.companyId &&
        ur.role.deletedAt === null &&
        (ur.role.companyId === user.companyId || ur.role.companyId === null),
    );
    const permissions = [
      ...new Set([
        ...currentUserRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => rp.permission.code),
        ),
        // Grants made to this one person on top of their roles.
        ...user.userPermissions.map((grant) => grant.permission.code),
      ]),
    ];
    const roles = [...new Set(currentUserRoles.map((ur) => ur.role.code))];

    const branches = await this.prisma.userBranch.findMany({
      where: {
        userId: user.id,
        branch: {
          companyId: user.companyId,
          isActive: true,
          deletedAt: null,
        },
      },
      select: { branchId: true },
      orderBy: { branchId: 'asc' },
    });
    const branchId = branches[0]?.branchId ?? null;

    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        username: user.username,
        companyId: user.companyId,
        branchId,
        isSuperAdmin: user.isSuperAdmin,
        tokenVersion: user.tokenVersion,
        permissions,
      },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: Number(process.env.JWT_ACCESS_TTL ?? 900),
      },
    );

    const refreshToken = await this.issueRefreshToken(user.id);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    await this.audit.record({
      companyId: user.companyId,
      userId: user.id,
      action: 'LOGIN',
      entity: 'users',
      entityId: user.id,
      ipAddress: ip ?? null,
      userAgent: userAgent ?? null,
    });

    return {
      accessToken,
      refreshToken,
      user: this.toSessionUser(user, roles, permissions, branchId),
    };
  }

  async refresh(token: string) {
    const hash = this.hashToken(token);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
      include: {
        user: {
          include: {
            userRoles: {
              include: {
                role: {
                  include: { rolePermissions: { include: { permission: true } } },
                },
              },
            },
            branches: {
              include: {
                branch: {
                  select: { companyId: true, isActive: true, deletedAt: true },
                },
              },
            },
            userPermissions: {
              include: { permission: true },
            },
          },
        },
      },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = stored.user;
    if (user.deletedAt !== null || !user.isActive) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Account is inactive');
    }

    // Rotation: the presented token is revoked and a new one issued, so a
    // stolen token is usable at most once.
    // Compare-and-set the token's revocation state. Two simultaneous refresh
    // requests may both have read the same live token; only one may rotate it.
    const rotation = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (rotation.count !== 1) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const currentUserRoles = user.userRoles.filter(
      (ur) =>
        ur.companyId === user.companyId &&
        ur.role.deletedAt === null &&
        (ur.role.companyId === user.companyId || ur.role.companyId === null),
    );
    const permissions = [
      ...new Set([
        ...currentUserRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => rp.permission.code),
        ),
        ...user.userPermissions.map((grant) => grant.permission.code),
      ]),
    ];
    const roles = [...new Set(currentUserRoles.map((ur) => ur.role.code))];
    const branchId =
      user.branches
        .filter(
          (ub) =>
            ub.branch.companyId === user.companyId &&
            ub.branch.isActive &&
            ub.branch.deletedAt === null,
        )
        .map((ub) => ub.branchId)
        .sort()[0] ?? null;

    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        username: user.username,
        companyId: user.companyId,
        branchId,
        isSuperAdmin: user.isSuperAdmin,
        tokenVersion: user.tokenVersion,
        permissions,
      },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: Number(process.env.JWT_ACCESS_TTL ?? 900),
      },
    );

    return {
      accessToken,
      refreshToken: await this.issueRefreshToken(user.id),
      user: this.toSessionUser(user, roles, permissions, branchId),
    };
  }

  /// Mints the one-minute credential a browser navigation may carry.
  ///
  /// A download opens a tab and a tab cannot send an Authorization header.
  /// Handing the tab the sign-in token would put a quarter-hour credential
  /// into browser history; this ticket is scoped to navigation, expires in a
  /// minute, and is signed with the same secret so there is one less secret to
  /// rotate.
  async issueDownloadTicket(
    user: AuthUser,
  ): Promise<{ ticket: string; expiresIn: number }> {
    const record = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { tokenVersion: true, isActive: true, deletedAt: true },
    });
    if (!record || !record.isActive || record.deletedAt !== null) {
      throw new UnauthorizedException('Account is inactive or unavailable');
    }
    const expiresIn = downloadTicketTtl();
    const ticket = await this.jwt.signAsync(
      {
        sub: user.userId,
        companyId: user.companyId,
        branchId: user.branchId,
        tokenVersion: record.tokenVersion,
        typ: DOWNLOAD_TICKET_TYPE,
      },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn,
      },
    );
    return { ticket, expiresIn };
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: { userId, tokenHash: this.hashToken(refreshToken) },
        data: { revokedAt: new Date() },
      });
    } else {
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await this.audit.record({
      userId,
      action: 'LOGOUT',
      entity: 'users',
      entityId: userId,
    });
  }

  private async issueRefreshToken(userId: string): Promise<string> {
    const token = randomBytes(48).toString('base64url');
    const ttl = Number(process.env.JWT_REFRESH_TTL ?? 604800);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(token),
        expiresAt: new Date(Date.now() + ttl * 1000),
      },
    });
    return token;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toSessionUser(
    user: {
      id: string;
      username: string;
      fullNameEn: string;
      fullNameAr: string;
      companyId: string;
      isActive: boolean;
      isSuperAdmin: boolean;
    },
    roles: string[],
    permissions: string[],
    branchId: string | null,
  ): SessionUser {
    return {
      id: user.id,
      username: user.username,
      fullName: user.fullNameEn,
      companyId: user.companyId,
      branchId,
      roles,
      permissions,
      isActive: user.isActive,
      isSuperAdmin: user.isSuperAdmin,
    };
  }
}
