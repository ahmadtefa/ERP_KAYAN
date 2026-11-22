import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { resolveEffectivePermissions } from '../../common/rbac/effective-permissions';
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
      this.logger.warn(
        `Sign-in refused for "${username}": ${
          user === null
            ? 'no such account'
            : user.deletedAt !== null
              ? 'account deleted'
              : 'account inactive'
        }`,
      );
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
      this.logger.warn(
        `Sign-in refused for "${username}": locked until ${user.lockedUntil.toISOString()}`,
      );
      throw new UnauthorizedException(
        'Account temporarily locked after repeated failed sign-ins',
      );
    }

    const passwordOk = await argon2.verify(user.passwordHash, password);
    if (!passwordOk) {
      this.logger.warn(`Sign-in refused for "${username}": wrong password`);
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
    // system roles are allowed, but deleted, disabled and cross-company roles
    // are ignored, and a per-user deny removes what a role would have given.
    const effective = resolveEffectivePermissions(
      user.userRoles,
      user.userPermissions,
      user.companyId,
    );
    const permissions = effective.permissions;
    const roles = effective.roles;

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

    this.logger.log(
      `Signed in "${user.username}" (company ${user.companyId}, ${roles.length} role(s), ` +
        `${permissions.length} permission(s)) from ${ip ?? 'an unknown address'}`,
    );
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

  /** Change a password before sign-in without revealing whether an account exists. */
  async changeOwnPassword(
    username: string,
    companyCode: string,
    currentPassword: string,
    newPassword: string,
    confirmPassword: string,
    ip?: string,
    userAgent?: string,
  ): Promise<{ success: true }> {
    const invalid = new UnauthorizedException('Invalid username or current password');
    if (newPassword !== confirmPassword) {
      throw new BadRequestException('New password confirmation does not match');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        username: username.trim(),
        deletedAt: null,
        isActive: true,
        company: { code: companyCode.trim().toUpperCase(), isActive: true },
      },
    });
    if (!user || (user.lockedUntil && user.lockedUntil > new Date())) throw invalid;

    let passwordMatches = false;
    try {
      passwordMatches = await argon2.verify(user.passwordHash, currentPassword);
    } catch {
      // A malformed stored hash must fail closed with the same public result.
    }
    if (!passwordMatches) {
      const updated = await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: { increment: 1 } },
        select: { failedLoginCount: true },
      });
      if (updated.failedLoginCount >= MAX_FAILED_ATTEMPTS) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) },
        });
      }
      await this.audit.record({
        companyId: user.companyId,
        userId: user.id,
        action: 'PASSWORD_CHANGE_FAILED',
        entity: 'users',
        entityId: user.id,
        ipAddress: ip ?? null,
        userAgent: userAgent ?? null,
      });
      throw invalid;
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException('New password must differ from the current password');
    }
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction(async (tx) => {
      // Verification happened before hashing, so the account may have been
      // disabled, locked or had its password changed in the meantime. Only
      // the request that still matches the verified hash may update it.
      const updated = await tx.user.updateMany({
        where: {
          id: user.id,
          passwordHash: user.passwordHash,
          isActive: true,
          deletedAt: null,
          company: { isActive: true },
          OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }],
        },
        data: {
          passwordHash,
          tokenVersion: { increment: 1 },
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      if (updated.count !== 1) throw invalid;
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.recordRequired({
        companyId: user.companyId,
        userId: user.id,
        action: 'user.password_changed_self',
        entity: 'users',
        entityId: user.id,
        ipAddress: ip ?? null,
        userAgent: userAgent ?? null,
      }, tx);
    });

    return { success: true };
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
    const effective = resolveEffectivePermissions(
      user.userRoles,
      user.userPermissions,
      user.companyId,
    );
    const permissions = effective.permissions;
    const roles = effective.roles;
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
