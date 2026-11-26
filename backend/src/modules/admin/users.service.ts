import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LicensingService } from '../licensing/licensing.service';
import { Prisma } from '@prisma/client';
import {
  CreateUserDto,
  ListUsersDto,
  PreviewUserPermissionsDto,
  UpdateUserDto,
} from './dto/user.dto';
import { resolveEffectivePermissions } from '../../common/rbac/effective-permissions';
import { permissionWarnings, warningsForSet } from '../../common/rbac/permission-warnings';

/// Who may be changed, and by whom.
const SYSTEM_USERNAME = 'admin';

/// A username and an email address are each unique across the whole
/// installation (every company), so a clash can be with an account of another
/// company. The message says what to do and never says whose account it is or
/// which company it belongs to.
export function uniqueAccountClash(error: unknown): ConflictException | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return null;
  const where = `${JSON.stringify(error.meta ?? {})} ${error.message}`.toLowerCase();
  if (where.includes('email')) {
    return new ConflictException(
      'That email address is already used by another account. Enter a different email address, or leave it empty.',
    );
  }
  if (where.includes('username')) {
    return new ConflictException('That username is already taken. Choose a different username.');
  }
  return null;
}

type UserResponseRecord = Prisma.UserGetPayload<{
  include: {
    userRoles: {
      include: {
        role: {
          select: {
            id: true;
            code: true;
            nameEn: true;
            nameAr: true;
            isActive: true;
          };
        };
      };
    };
    branches: { include: { branch: true } };
    userPermissions: { include: { permission: { select: { code: true } } } };
  };
}>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly licensing: LicensingService,
  ) {}

  async list(companyId: string, query: ListUsersDto) {
    const where: Prisma.UserWhereInput = { companyId, deletedAt: null };
    if (!query.includeInactive) where.isActive = true;
    if (query.q?.trim()) {
      const needle = query.q.trim();
      where.OR = [
        { username: { contains: needle, mode: 'insensitive' } },
        { fullNameEn: { contains: needle, mode: 'insensitive' } },
        { fullNameAr: { contains: needle } },
      ];
    }
    const users = await this.prisma.user.findMany({
      where,
      orderBy: { username: 'asc' },
      include: {
        userRoles: {
          include: {
            role: {
              select: {
                id: true,
                code: true,
                nameEn: true,
                nameAr: true,
                isActive: true,
                category: true,
              },
            },
          },
        },
        branches: { include: { branch: true } },
        userPermissions: {
          include: { permission: { select: { code: true } } },
        },
      },
    });
    return { items: users.map((u) => this.toResponse(u)) };
  }

  async findOne(companyId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        userRoles: {
          include: {
            role: {
              select: {
                id: true,
                code: true,
                nameEn: true,
                nameAr: true,
                isActive: true,
                category: true,
              },
            },
          },
        },
        branches: { include: { branch: true } },
        userPermissions: {
          include: { permission: { select: { code: true } } },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.toResponse(user);
  }

  async create(
    companyId: string,
    actorId: string,
    dto: CreateUserDto,
    actorPermissions: string[],
    isSuperAdmin: boolean,
    idempotencyKey?: string,
  ) {
    const username = dto.username.trim().toLowerCase();
    if (username === SYSTEM_USERNAME) {
      throw new ConflictException('That username is reserved');
    }
    const existing = await this.prisma.user.findUnique({ where: { username } });
    if (existing) throw new ConflictException('That username is already taken. Choose a different username.');

    await this.assertRolesAssignable(
      companyId,
      dto.roleIds,
      actorPermissions,
      isSuperAdmin,
    );
    await this.assertBranchesBelongToCompany(companyId, dto.branchIds);
    const extraPermissions = await this.normalizeExtraPermissions(
      dto.extraPermissions,
      actorPermissions,
      isSuperAdmin,
    );
    // A deny hands nothing out, so it needs no "do you hold it" check - only
    // that the code exists.
    const deniedPermissions = await this.normalizeDeniedPermissions(dto.deniedPermissions);

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          companyId,
          username,
          email: dto.email?.trim() || null,
          fullNameEn: dto.fullNameEn.trim(),
          fullNameAr: dto.fullNameAr.trim(),
          passwordHash,
          // Only an existing super admin can mint another one.
          isSuperAdmin: false,
          createdBy: actorId,
        },
      }).catch((error: unknown) => {
        throw uniqueAccountClash(error) ?? error;
      });
      // The licence seat is reserved inside the same transaction as the
      // account: a refusal rolls the account back, and a failure anywhere
      // after this point gives the seat back with it. See LicensingService
      // for the lock that makes simultaneous creations safe.
      await this.licensing.reserveSeat(tx, {
        userId: user.id,
        username,
        reason: 'USER_CREATE',
        idempotencyKey: idempotencyKey ?? `user:${companyId}:${username}`,
      });
      await this.replaceRoles(tx, companyId, user.id, dto.roleIds);
      await this.replaceBranches(tx, user.id, dto.branchIds);
      await this.replaceOverrides(tx, user.id, {
        grants: extraPermissions,
        denies: deniedPermissions,
      });
      return user;
    });

    await this.audit.record({
      companyId,
      userId: actorId,
      action: 'user.create',
      entity: 'users',
      entityId: created.id,
      after: { username, roles: dto.roleIds ?? [] },
    });
    return this.findOne(companyId, created.id);
  }

  async update(
    companyId: string,
    actorId: string,
    id: string,
    dto: UpdateUserDto,
    actorPermissions: string[],
    isSuperAdmin: boolean,
  ) {
    if (dto.extraPermissions !== undefined && !Array.isArray(dto.extraPermissions)) {
      throw new BadRequestException('Extra permissions must be an array when supplied.');
    }
    if (dto.deniedPermissions !== undefined && !Array.isArray(dto.deniedPermissions)) {
      throw new BadRequestException('Denied permissions must be an array when supplied.');
    }
    if ((dto.expectedRoleIds !== undefined && !Array.isArray(dto.roleIds)) ||
        (dto.expectedExtraPermissions !== undefined && !Array.isArray(dto.extraPermissions)) ||
        (dto.expectedDeniedPermissions !== undefined && !Array.isArray(dto.deniedPermissions))) {
      throw new BadRequestException('An expected permission set requires its corresponding replacement.');
    }
    const before = await this.prisma.user.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('User not found');
    if (before.isSuperAdmin && !isSuperAdmin) {
      throw new ForbiddenException('Only a super administrator can modify a super administrator account');
    }
    if (before.username === SYSTEM_USERNAME && dto.isActive === false) {
      throw new BadRequestException('The system administrator cannot be deactivated');
    }

    await this.assertRolesAssignable(
      companyId,
      dto.roleIds,
      actorPermissions,
      isSuperAdmin,
    );
    await this.assertBranchesBelongToCompany(companyId, dto.branchIds);
    const extraPermissions =
      dto.extraPermissions === undefined
        ? undefined
        : await this.normalizeExtraPermissions(
            dto.extraPermissions,
            actorPermissions,
            isSuperAdmin,
          );
    const deniedPermissions =
      dto.deniedPermissions === undefined
        ? undefined
        : await this.normalizeDeniedPermissions(dto.deniedPermissions);

    await this.prisma.$transaction(async (tx) => {
      // Serialize all application-mediated updates to this user before
      // checking snapshots, and recheck the protected identity under lock.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL FOR UPDATE`;
      const lockedBefore = await tx.user.findFirst({where:{id,companyId,deletedAt:null}});
      if (!lockedBefore) throw new NotFoundException('User not found');
      if (lockedBefore.isSuperAdmin && !isSuperAdmin) {
        throw new ForbiddenException('Only a super administrator can modify a super administrator account');
      }
      if (lockedBefore.username === SYSTEM_USERNAME && dto.isActive === false) {
        throw new BadRequestException('The system administrator cannot be deactivated');
      }
      // The sets are read after prior updates of this user commit. A conflict
      // must abort the whole transaction, including identity field updates.
      const matches = (actual: string[], expected: string[]) => {
        const sortedActual = [...actual].sort(), sortedExpected = [...expected].sort();
        return sortedActual.length === sortedExpected.length &&
          sortedActual.every((value, index) => value === sortedExpected[index]);
      };
      if (dto.expectedRoleIds !== undefined) {
        const current = await tx.userRole.findMany({where:{userId:id,companyId},select:{roleId:true}});
        if (!matches(current.map((row) => row.roleId), dto.expectedRoleIds)) {
          throw new ConflictException('User roles changed since they were loaded. Refresh and review them before saving.');
        }
      }
      if (dto.expectedExtraPermissions !== undefined) {
        const current = await tx.userPermission.findMany({where:{userId:id},include:{permission:true}});
        const grants = current.filter((row) => !row.isDenied).map((row) => row.permission.code);
        if (!matches(grants, dto.expectedExtraPermissions)) {
          throw new ConflictException('User permissions changed since they were loaded. Refresh and review them before saving.');
        }
      }
      if (dto.expectedDeniedPermissions !== undefined) {
        const current = await tx.userPermission.findMany({where:{userId:id},include:{permission:true}});
        const denies = current.filter((row) => row.isDenied).map((row) => row.permission.code);
        if (!matches(denies, dto.expectedDeniedPermissions)) {
          throw new ConflictException('User permissions changed since they were loaded. Refresh and review them before saving.');
        }
      }
      await tx.user.update({
        where: { id },
        data: {
          fullNameEn: dto.fullNameEn?.trim(),
          fullNameAr: dto.fullNameAr?.trim(),
          email: dto.email === undefined ? undefined : dto.email.trim() || null,
          isActive: dto.isActive,
          updatedBy: actorId,
        },
      }).catch((error: unknown) => {
        throw uniqueAccountClash(error) ?? error;
      });
      if (dto.roleIds) await this.replaceRoles(tx, companyId, id, dto.roleIds);
      if (dto.branchIds) await this.replaceBranches(tx, id, dto.branchIds);
      if (extraPermissions !== undefined || deniedPermissions !== undefined) {
        await this.replaceOverrides(tx, id, {
          grants: extraPermissions,
          denies: deniedPermissions,
        });
      }
      if (dto.isActive === false) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.recordRequired({
        companyId,
        userId: actorId,
        action: 'user.update',
        entity: 'users',
        entityId: id,
        before: { fullNameEn: lockedBefore.fullNameEn, isActive: lockedBefore.isActive },
        after: {
          fullNameEn: dto.fullNameEn,
          isActive: dto.isActive,
          extraPermissions,
          deniedPermissions,
        },
      }, tx);
    });
    return this.findOne(companyId, id);
  }

  /// Changes a password and revokes every existing session for that user.
  ///
  /// A password change that leaves old refresh tokens alive keeps an attacker
  /// signed in, so the sessions are cut here.
  async changePassword(
    companyId: string,
    actorId: string,
    id: string,
    password: string,
    actorIsSuperAdmin: boolean,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.isSuperAdmin && !actorIsSuperAdmin) {
      throw new ForbiddenException('Only a super administrator can reset a super administrator password');
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          passwordHash,
          // JWTs already issued before the reset must stop working as well as
          // refresh tokens; the guard checks this version on every request.
          tokenVersion: { increment: 1 },
          // A new password also clears a lockout: whoever was guessing no
          // longer has a target, and the real user is not stuck.
          failedLoginCount: 0,
          lockedUntil: null,
          updatedBy: actorId,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      companyId,
      userId: actorId,
      action: 'user.password_changed',
      entity: 'users',
      entityId: id,
    });
    return { id, sessionsRevoked: true };
  }

  async deactivate(
    companyId: string,
    actorId: string,
    id: string,
    actorIsSuperAdmin: boolean,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.id === actorId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    if (user.isSuperAdmin && !actorIsSuperAdmin) {
      throw new ForbiddenException('Only a super administrator can deactivate a super administrator account');
    }
    if (user.username === SYSTEM_USERNAME) {
      throw new BadRequestException('The system administrator cannot be deactivated');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { isActive: false, updatedBy: actorId },
      }),
      // Deactivation must end the user's sessions immediately, not at the
      // next token expiry.
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      companyId,
      userId: actorId,
      action: 'user.deactivate',
      entity: 'users',
      entityId: id,
    });
    return { id, isActive: false };
  }

  // ---------------------------------------------------------------- helpers

  private async replaceRoles(
    tx: Prisma.TransactionClient,
    companyId: string,
    userId: string,
    roleIds?: string[],
  ) {
    if (!roleIds) return;
    await tx.userRole.deleteMany({ where: { userId, companyId } });
    for (const roleId of roleIds) {
      await tx.userRole.create({ data: { userId, roleId, companyId } });
    }
  }

  private async replaceBranches(
    tx: Prisma.TransactionClient,
    userId: string,
    branchIds?: string[],
  ) {
    if (!branchIds) return;
    await tx.userBranch.deleteMany({ where: { userId } });
    for (const branchId of branchIds) {
      await tx.userBranch.create({ data: { userId, branchId } });
    }
  }

  /// Prevents a user administrator from assigning a role with permissions
  /// they do not personally hold. System super-admins may assign any role.
  private async assertRolesAssignable(
    companyId: string,
    roleIds: string[] | undefined,
    actorPermissions: string[],
    isSuperAdmin: boolean,
  ) {
    if (!roleIds?.length) return;
    const roles = await this.prisma.role.findMany({
      where: {
        id: { in: roleIds },
        deletedAt: null,
        OR: [{ companyId }, { companyId: null }],
      },
      include: {
        rolePermissions: { include: { permission: { select: { code: true } } } },
      },
    });
    if (roles.length !== roleIds.length) {
      throw new BadRequestException('One of the roles does not exist in this company');
    }
    if (isSuperAdmin) return;

    const forbidden = [
      ...new Set(
        roles.flatMap((role) =>
          role.rolePermissions
            .map((rp) => rp.permission.code)
            .filter((code) => !actorPermissions.includes(code)),
        ),
      ),
    ];
    if (forbidden.length) {
      throw new ForbiddenException(
        `You cannot assign permissions you do not hold: ${forbidden.join(', ')}`,
      );
    }
  }

  /// Checks that every extra code exists and that the actor is not handing
  /// out a permission they do not hold themselves. A super administrator is
  /// the only account allowed to grant beyond its own set.
  private async normalizeExtraPermissions(
    codes: string[] | undefined,
    actorPermissions: string[],
    isSuperAdmin: boolean,
  ): Promise<string[]> {
    if (!codes?.length) return [];
    const unique = [...new Set(codes.map((code) => code.trim()).filter(Boolean))];
    if (!unique.length) return [];

    const found = await this.prisma.permission.findMany({
      where: { code: { in: unique } },
      select: { code: true },
    });
    const known = new Set(found.map((permission) => permission.code));
    const unknown = unique.filter((code) => !known.has(code));
    if (unknown.length) {
      throw new BadRequestException(
        `Unknown permission code(s): ${unknown.join(', ')}`,
      );
    }
    if (!isSuperAdmin) {
      const forbidden = unique.filter((code) => !actorPermissions.includes(code));
      if (forbidden.length) {
        throw new ForbiddenException(
          `You cannot grant permissions you do not hold: ${forbidden.join(', ')}`,
        );
      }
    }
    return unique.sort();
  }

  /// Checks that every denied code exists. Denying a permission nobody holds
  /// is harmless and allowed: it is a standing instruction for the future.
  private async normalizeDeniedPermissions(codes: string[] | undefined): Promise<string[]> {
    if (!codes?.length) return [];
    const unique = [...new Set(codes.map((code) => code.trim()).filter(Boolean))];
    if (!unique.length) return [];
    const found = await this.prisma.permission.findMany({
      where: { code: { in: unique } },
      select: { code: true },
    });
    const known = new Set(found.map((permission) => permission.code));
    const unknown = unique.filter((code) => !known.has(code));
    if (unknown.length) {
      throw new BadRequestException(`Unknown permission code(s): ${unknown.join(', ')}`);
    }
    return unique.sort();
  }

  /// Writes the per-user exceptions: grants and denies, in one table.
  ///
  /// Either half may be omitted, and the omitted half is kept as it is — the
  /// form sends both, a small client that only knows about grants does not
  /// wipe a deny by accident. A code cannot be both: it is written once, and
  /// deny wins.
  private async replaceOverrides(
    tx: Prisma.TransactionClient,
    userId: string,
    next: { grants?: string[]; denies?: string[] },
  ) {
    const current = await tx.userPermission.findMany({
      where: { userId },
      include: { permission: { select: { code: true } } },
    });
    const grants =
      next.grants ?? current.filter((row) => !row.isDenied).map((row) => row.permission.code);
    const denies =
      next.denies ?? current.filter((row) => row.isDenied).map((row) => row.permission.code);
    const denySet = new Set(denies);
    const codes = [...new Set([...grants.filter((code) => !denySet.has(code)), ...denies])];

    await tx.userPermission.deleteMany({ where: { userId } });
    if (!codes.length) return;
    const permissions = await tx.permission.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true },
    });
    if (permissions.length !== codes.length) {
      throw new BadRequestException('One of the permissions no longer exists');
    }
    await tx.userPermission.createMany({
      data: permissions.map((permission) => ({
        userId,
        permissionId: permission.id,
        isDenied: denySet.has(permission.code),
      })),
    });
  }

  /// What this user can actually do today, after roles, grants and denies.
  async effectivePermissions(companyId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId, deletedAt: null },
      include: {
        userRoles: {
          include: {
            role: {
              include: { rolePermissions: { include: { permission: { select: { code: true } } } } },
            },
          },
        },
        userPermissions: { include: { permission: { select: { code: true } } } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const effective = resolveEffectivePermissions(
      user.userRoles,
      user.userPermissions,
      companyId,
    );
    return { userId, ...effective, warnings: permissionWarnings(effective.permissions) };
  }

  /// The preview the user form asks for before anyone is saved: same arithmetic
  /// as a real sign-in, done on the values currently on the screen.
  ///
  /// It reads the roles from the database (never trusts the client for what a
  /// role contains) and computes the union, the grants and the denies exactly
  /// as `auth.service` would after saving.
  async previewPermissions(companyId: string, dto: PreviewUserPermissionsDto) {
    let roleIds = dto.roleIds;
    let grants = dto.extraPermissions;
    let denies = dto.deniedPermissions;

    // Editing an existing user: the form may send only what the person
    // changed, so the untouched half comes from the stored row.
    if ((roleIds === undefined || grants === undefined || denies === undefined) && dto.userId) {
      const stored = await this.prisma.user.findFirst({
        where: { id: dto.userId, companyId, deletedAt: null },
        include: {
          userRoles: { select: { roleId: true } },
          userPermissions: { include: { permission: { select: { code: true } } } },
        },
      });
      if (!stored) throw new NotFoundException('User not found');
      roleIds ??= stored.userRoles.map((row) => row.roleId);
      grants ??= stored.userPermissions
        .filter((row) => !row.isDenied)
        .map((row) => row.permission.code);
      denies ??= stored.userPermissions
        .filter((row) => row.isDenied)
        .map((row) => row.permission.code);
    }

    const roles = roleIds?.length
      ? await this.prisma.role.findMany({
          where: {
            id: { in: roleIds },
            deletedAt: null,
            OR: [{ companyId }, { companyId: null }],
          },
          include: {
            rolePermissions: { include: { permission: { select: { code: true } } } },
          },
          orderBy: { code: 'asc' },
        })
      : [];

    const overrides: Array<{ isDenied: boolean; permission: { code: string } }> = [
      ...(grants ?? []).map((code) => ({ isDenied: false, permission: { code } })),
      ...(denies ?? []).map((code) => ({ isDenied: true, permission: { code } })),
    ];

    const effective = resolveEffectivePermissions(
      roles.map((role) => ({ companyId, deletedAt: null, isActive: role.isActive, role })),
      overrides,
      companyId,
    );
    const warnings = permissionWarnings(effective.permissions);
    const disabledRoles = roles.filter((role) => role.isActive === false).map((role) => role.code);
    if (disabledRoles.length) {
      warnings.unshift({
        code: 'role.disabled',
        severity: 'WARNING',
        messageEn: `Disabled role(s) grant nothing: ${disabledRoles.join(', ')}.`,
        messageAr: `أدوار معطّلة لا تمنح شيئًا: ${disabledRoles.join('، ')}.`,
      });
    }
    if (effective.deniedFromRoles.length) {
      warnings.push({
        code: 'deny.overrides',
        severity: 'INFO',
        messageEn: `Denied permissions remove ${effective.deniedFromRoles.length} allowance(s) the roles would have given.`,
        messageAr: `الصلاحيات المرفوضة تلغي ${effective.deniedFromRoles.length} صلاحية كانت الأدوار ستمنحها.`,
      });
    }
    if (effective.permissions.length === 0) {
      warnings.push(...warningsForSet([]));
    }
    return {
      ...effective,
      permissionsCount: effective.permissions.length,
      warnings,
    };
  }

  private async assertBranchesBelongToCompany(companyId: string, branchIds?: string[]) {
    if (!branchIds?.length) return;
    const found = await this.prisma.branch.count({
      where: { id: { in: branchIds }, companyId, deletedAt: null },
    });
    if (found !== branchIds.length) {
      throw new BadRequestException('One of the branches does not exist in this company');
    }
  }

  /// Deliberately never returns the password hash or the failed-login counter.
  private toResponse(user: UserResponseRecord) {
    return {
      id: user.id,
      companyId: user.companyId,
      username: user.username,
      email: user.email,
      fullNameEn: user.fullNameEn,
      fullNameAr: user.fullNameAr,
      isActive: user.isActive,
      isSuperAdmin: user.isSuperAdmin,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      lockedUntil: user.lockedUntil?.toISOString() ?? null,
      roles: (user.userRoles ?? []).map((ur) => ({
        id: ur.role.id,
        code: ur.role.code,
        nameEn: ur.role.nameEn,
        nameAr: ur.role.nameAr ?? null,
        isActive: ur.role.isActive !== false,
      })),
      // Grants made to this one person on top of their roles, and the codes
      // withheld from them on purpose. Kept apart: they are different
      // decisions and the form shows them in different lists.
      extraPermissions: (user.userPermissions ?? [])
        .filter((grant) => !grant.isDenied)
        .map((grant) => grant.permission.code)
        .sort(),
      deniedPermissions: (user.userPermissions ?? [])
        .filter((grant) => grant.isDenied)
        .map((grant) => grant.permission.code)
        .sort(),
      branches: (user.branches ?? []).map((ub) => ({
        id: ub.branch.id,
        code: ub.branch.code,
        nameEn: ub.branch.nameEn,
        nameAr: ub.branch.nameAr,
      })),
      createdAt: user.createdAt.toISOString(),
    };
  }
}
