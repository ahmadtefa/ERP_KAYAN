import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CreateUserDto, ListUsersDto, UpdateUserDto } from './dto/user.dto';

/// Who may be changed, and by whom.
const SYSTEM_USERNAME = 'admin';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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
          include: { role: { select: { id: true, code: true, nameEn: true } } },
        },
        branches: { include: { branch: true } },
      },
    });
    return { items: users.map((u) => this.toResponse(u)) };
  }

  async findOne(companyId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        userRoles: {
          include: { role: { select: { id: true, code: true, nameEn: true } } },
        },
        branches: { include: { branch: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.toResponse(user);
  }

  async create(companyId: string, actorId: string, dto: CreateUserDto) {
    const username = dto.username.trim().toLowerCase();
    if (username === SYSTEM_USERNAME) {
      throw new ConflictException('That username is reserved');
    }
    const existing = await this.prisma.user.findUnique({ where: { username } });
    if (existing) throw new ConflictException('That username is already taken');

    await this.assertRolesBelongToCompany(companyId, dto.roleIds);
    await this.assertBranchesBelongToCompany(companyId, dto.branchIds);

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
      });
      await this.replaceRoles(tx, companyId, user.id, dto.roleIds);
      await this.replaceBranches(tx, user.id, dto.branchIds);
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

  async update(companyId: string, actorId: string, id: string, dto: UpdateUserDto) {
    const before = await this.prisma.user.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('User not found');
    if (before.username === SYSTEM_USERNAME && dto.isActive === false) {
      throw new BadRequestException('The system administrator cannot be deactivated');
    }

    await this.assertRolesBelongToCompany(companyId, dto.roleIds);
    await this.assertBranchesBelongToCompany(companyId, dto.branchIds);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          fullNameEn: dto.fullNameEn?.trim(),
          fullNameAr: dto.fullNameAr?.trim(),
          email: dto.email === undefined ? undefined : dto.email.trim() || null,
          isActive: dto.isActive,
          updatedBy: actorId,
        },
      });
      if (dto.roleIds) await this.replaceRoles(tx, companyId, id, dto.roleIds);
      if (dto.branchIds) await this.replaceBranches(tx, id, dto.branchIds);
    });

    await this.audit.record({
      companyId,
      userId: actorId,
      action: 'user.update',
      entity: 'users',
      entityId: id,
      before: { fullNameEn: before.fullNameEn, isActive: before.isActive },
      after: { fullNameEn: dto.fullNameEn, isActive: dto.isActive },
    });
    return this.findOne(companyId, id);
  }

  /// Changes a password and revokes every existing session for that user.
  ///
  /// A password change that leaves old refresh tokens alive keeps an attacker
  /// signed in, so the sessions are cut here.
  async changePassword(companyId: string, actorId: string, id: string, password: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          passwordHash,
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

  async deactivate(companyId: string, actorId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.id === actorId) {
      throw new BadRequestException('You cannot deactivate your own account');
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

  /// A company must never be able to grant a role that belongs to another
  /// company, so the ids are checked rather than trusted.
  private async assertRolesBelongToCompany(companyId: string, roleIds?: string[]) {
    if (!roleIds?.length) return;
    const found = await this.prisma.role.count({
      where: {
        id: { in: roleIds },
        deletedAt: null,
        OR: [{ companyId }, { companyId: null }],
      },
    });
    if (found !== roleIds.length) {
      throw new BadRequestException('One of the roles does not exist in this company');
    }
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
  private toResponse(user: any) {
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
      roles: (user.userRoles ?? []).map((ur: any) => ({
        id: ur.role.id,
        code: ur.role.code,
        nameEn: ur.role.nameEn,
      })),
      branches: (user.branches ?? []).map((ub: any) => ({
        id: ub.branch.id,
        code: ub.branch.code,
        nameEn: ub.branch.nameEn,
      })),
      createdAt: user.createdAt.toISOString(),
    };
  }
}
