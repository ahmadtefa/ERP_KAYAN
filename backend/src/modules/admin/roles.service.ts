import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  PERMISSION_WARNING_RULES,
  permissionWarnings,
  warningsForSet,
} from '../../common/rbac/permission-warnings';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

/// The groups the roles screen draws. Text rather than a database enum: an
/// existing installation gains the column without a type to migrate, and a
/// future group is a line here, not a migration.
export const ROLE_CATEGORIES = [
  'MANAGEMENT',
  'FINANCE',
  'SALES',
  'PURCHASING',
  'INVENTORY',
  'CASH',
  'AUDIT',
  'CUSTOM',
] as const;

function normalizeCategory(value: string | undefined, fallback = 'CUSTOM'): string {
  if (!value) return fallback;
  const upper = value.trim().toUpperCase();
  return (ROLE_CATEGORIES as readonly string[]).includes(upper) ? upper : 'CUSTOM';
}

/// Roles group permissions. A role that belongs to no company (`companyId`
/// null) is a system role and cannot be edited or removed — the seeded ADMIN
/// and ACCOUNTANT roles are the ones the system relies on.
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(companyId: string) {
    const roles = await this.prisma.role.findMany({
      where: { deletedAt: null, OR: [{ companyId }, { companyId: null }] },
      orderBy: [{ isSystem: 'desc' }, { category: 'asc' }, { code: 'asc' }],
      include: {
        rolePermissions: { include: { permission: true } },
        // Only people who still exist count as holders: a deleted account is
        // not a reason to keep a role alive or to block its removal.
        _count: { select: { userRoles: { where: { user: { deletedAt: null } } } } },
      },
    });
    return {
      items: roles.map((role) => ({
        ...this.toResponse(role),
        userCount: role._count.userRoles,
      })),
    };
  }

  async findOne(companyId: string, id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, deletedAt: null, OR: [{ companyId }, { companyId: null }] },
      include: {
        rolePermissions: { include: { permission: true } },
        _count: { select: { userRoles: { where: { user: { deletedAt: null } } } } },
      },
    });
    if (!role) throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'Role not found' });
    return { ...this.toResponse(role), userCount: role._count.userRoles };
  }

  /// Every permission the system knows about, grouped for a checkbox list.
  async permissions() {
    const permissions = await this.prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { code: 'asc' }],
    });
    const byModule = new Map<string, typeof permissions>();
    for (const permission of permissions) {
      const bucket = byModule.get(permission.module) ?? [];
      bucket.push(permission);
      byModule.set(permission.module, bucket);
    }
    return {
      // The rules that decide which grants deserve a second look, published
      // with the catalogue so the screen can warn while somebody ticks instead
      // of asking again on save. One list, read by the server and the screen.
      warnings: PERMISSION_WARNING_RULES,
      items: permissions.map((p) => ({
        code: p.code,
        nameEn: p.nameEn,
        nameAr: p.nameAr,
        module: p.module,
      })),
      modules: [...byModule.entries()].map(([module, list]) => ({
        module,
        permissions: list.map((p) => ({ code: p.code, nameEn: p.nameEn, nameAr: p.nameAr })),
      })),
    };
  }

  async create(
    companyId: string,
    actorId: string,
    dto: CreateRoleDto,
    actorPermissions: string[],
    isSuperAdmin: boolean,
  ) {
    const code = dto.code.trim().toUpperCase();
    // Letters, digits, underscore and hyphen. A hyphen is what companies put
    // in a code ("WHREAD-2026"), and a code that already exists in a database
    // must never be rejected by a rule invented later; spaces and punctuation
    // are still refused because they make a code impossible to type or search.
    if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code)) {
      throw new BadRequestException({ code: 'ROLE_CODE_FORMAT', message: 'A role code is 2-40 letters, digits, underscores or hyphens' });
    }
    if (code === 'ADMIN') {
      throw new ConflictException({ code: 'ROLE_CODE_RESERVED', message: 'That role code is reserved' });
    }
    const existing = await this.prisma.role.findFirst({
      where: { companyId, code, deletedAt: null },
    });
    if (existing) throw new ConflictException({ code: 'ROLE_CODE_DUPLICATE', message: 'A role with that code already exists' });

    // "Copy role": the new role starts from another role's permissions, which
    // the caller may only do if it could grant that set in the first place.
    let sourcePermissions: string[] | undefined;
    if (dto.copyFromRoleId) {
      const source = await this.prisma.role.findFirst({
        where: {
          id: dto.copyFromRoleId,
          deletedAt: null,
          OR: [{ companyId }, { companyId: null }],
        },
        include: { rolePermissions: { include: { permission: true } } },
      });
      if (!source) throw new NotFoundException({ code: 'ROLE_COPY_MISSING', message: 'The role to copy was not found' });
      sourcePermissions = source.rolePermissions.map((rp) => rp.permission.code);
      this.assertCanGrantPermissionCodes(sourcePermissions, actorPermissions, isSuperAdmin);
    }
    // An explicit list always wins over the copied one.
    const wanted = dto.permissions ?? sourcePermissions ?? [];
    this.assertCanGrantPermissionCodes(wanted, actorPermissions, isSuperAdmin);
    const permissionIds = await this.resolvePermissions(wanted);

    const created = await this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          companyId,
          code,
          nameEn: dto.nameEn.trim(),
          nameAr: dto.nameAr.trim(),
          descriptionEn: dto.descriptionEn?.trim() || null,
          descriptionAr: dto.descriptionAr?.trim() || null,
          category: normalizeCategory(dto.category),
          // A role a company creates is theirs to change; a system role is not.
          isSystem: false,
        },
      });
      for (const permissionId of permissionIds) {
        await tx.rolePermission.create({ data: { roleId: role.id, permissionId } });
      }
      return role;
    });

    await this.audit.record({
      companyId,
      userId: actorId,
      action: 'role.create',
      entity: 'roles',
      entityId: created.id,
      after: { code, permissions: wanted, copiedFrom: dto.copyFromRoleId ?? null },
    });
    return this.findOne(companyId, created.id);
  }

  async update(companyId: string, actorId: string, id: string, dto: UpdateRoleDto) {
    const role = await this.prisma.role.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!role) throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'Role not found' });
    if (role.isSystem && (dto.nameEn || dto.nameAr)) {
      throw new BadRequestException({ code: 'ROLE_SYSTEM_RENAME', message: 'A system role cannot be renamed' });
    }
    // The administrator's own role is the one the product relies on: it can be
    // described differently, but not switched off.
    if (role.code === 'ADMIN' && dto.isActive === false) {
      throw new BadRequestException({ code: 'ROLE_ADMIN_DISABLE', message: 'The system administrator role cannot be disabled' });
    }

    await this.prisma.role.update({
      where: { id },
      data: {
        nameEn: role.isSystem ? undefined : dto.nameEn?.trim(),
        nameAr: role.isSystem ? undefined : dto.nameAr?.trim(),
        descriptionEn: dto.descriptionEn === undefined ? undefined : dto.descriptionEn.trim() || null,
        descriptionAr: dto.descriptionAr === undefined ? undefined : dto.descriptionAr.trim() || null,
        category: dto.category === undefined ? undefined : normalizeCategory(dto.category, role.category ?? 'CUSTOM'),
        isActive: dto.isActive,
      },
    });
    await this.audit.record({
      companyId,
      userId: actorId,
      action: 'role.update',
      entity: 'roles',
      entityId: id,
      before: {
        nameEn: role.nameEn,
        nameAr: role.nameAr,
        isActive: role.isActive,
        category: role.category,
      },
      after: {
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        isActive: dto.isActive,
        category: dto.category,
      },
    });
    return this.findOne(companyId, id);
  }

  /// The roles screen's preview: what this set contains, grouped by module,
  /// and what deserves a second look before it is saved.
  async previewPermissions(codes: string[]) {
    const unique = [...new Set(codes)].sort();
    const known = await this.prisma.permission.findMany({
      where: { code: { in: unique } },
      select: { code: true, module: true },
    });
    const knownCodes = new Set(known.map((row) => row.code));
    const unknown = unique.filter((code) => !knownCodes.has(code));
    if (unknown.length) {
      throw new BadRequestException({ code: 'PERMISSION_UNKNOWN', message: `Unknown permission(s): ${unknown.join(', ')}` });
    }
    const byModule = new Map<string, number>();
    for (const row of known) {
      byModule.set(row.module, (byModule.get(row.module) ?? 0) + 1);
    }
    return {
      permissions: unique,
      count: unique.length,
      modules: [...byModule.entries()]
        .map(([module, count]) => ({ module, count }))
        .sort((a, b) => a.module.localeCompare(b.module)),
      warnings: warningsForSet(unique),
      strongest: permissionWarnings(unique).length
        ? permissionWarnings(unique)[0].severity
        : null,
    };
  }

  /// Replaces the whole permission set of a role.
  ///
  /// System roles are included: an administrator must be able to fine-tune
  /// what ACCOUNTANT may do without forking the role.
  async setPermissions(
    companyId: string,
    actorId: string,
    id: string,
    codes: string[],
    actorPermissions: string[],
    isSuperAdmin: boolean,
    expectedPermissions?: string[],
  ) {
    const role = await this.prisma.role.findFirst({
      where: { id, deletedAt: null, OR: [{ companyId }, { companyId: null }] },
    });
    if (!role) throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'Role not found' });
    // A role that belongs to no company is shared by every tenant: letting one
    // company's role manager edit it would change permissions for the others.
    // A company's own seeded roles are theirs to tune - the escalation check
    // below still stops them granting anything they do not hold themselves.
    if (role.companyId === null && !isSuperAdmin) {
      throw new ForbiddenException(
        'Only a super administrator can change permissions on a global system role',
      );
    }

    this.assertCanGrantPermissionCodes(codes, actorPermissions, isSuperAdmin);
    const permissionIds = await this.resolvePermissions(codes);
    await this.prisma.$transaction(async (tx) => {
      // Serialize permission replacements even for legacy clients that do not
      // supply an expected set. No migration of the role table is required.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM roles WHERE id = ${id}::uuid FOR UPDATE`);
      const lockedRole = await tx.role.findFirst({
        where: { id, deletedAt: null, OR: [{ companyId }, { companyId: null }] },
      });
      if (!lockedRole) throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'Role not found' });
      if (lockedRole.companyId === null && !isSuperAdmin) {
        throw new ForbiddenException('Only a super administrator can change permissions on a global system role');
      }
      const before = await tx.rolePermission.findMany({
        where: { roleId: id }, include: { permission: true },
      });
      const previous = before.map((rp) => rp.permission.code).sort();
      if (expectedPermissions !== undefined) {
        const expected = [...expectedPermissions].sort();
        if (expected.length !== previous.length || expected.some((code, index) => code !== previous[index])) {
          throw new ConflictException({ code: 'ROLE_PERMS_CHANGED', message: 'Role permissions changed since they were loaded. Refresh and review them before saving.' });
        }
      }
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      for (const permissionId of permissionIds) {
        await tx.rolePermission.create({ data: { roleId: id, permissionId } });
      }
      await this.audit.recordRequired({
        companyId, userId: actorId, action: 'role.permissions_set', entity: 'roles', entityId: id,
        before: { permissions: previous }, after: { permissions: codes },
      }, tx);
    });
    return this.findOne(companyId, id);
  }

  async remove(companyId: string, actorId: string, id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { _count: { select: { userRoles: { where: { user: { deletedAt: null } } } } } },
    });
    if (!role) throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'Role not found' });
    if (role.isSystem) throw new BadRequestException({ code: 'ROLE_SYSTEM_REMOVE', message: 'A system role cannot be removed' });
    if (role._count.userRoles > 0) {
      throw new BadRequestException({ code: 'ROLE_IN_USE', message: `${role._count.userRoles} user(s) still hold this role. Move them to another role first.` });
    }

    await this.prisma.role.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      companyId,
      userId: actorId,
      action: 'role.remove',
      entity: 'roles',
      entityId: id,
      before: { code: role.code },
    });
    return { id, removed: true };
  }

  /// Only a super-admin may grant permissions the actor does not already hold.
  /// This blocks role-management access from becoming a privilege-escalation path.
  private assertCanGrantPermissionCodes(
    codes: string[] | undefined,
    actorPermissions: string[],
    isSuperAdmin: boolean,
  ) {
    if (isSuperAdmin || !codes?.length) return;
    const forbidden = [...new Set(codes.filter((code) => !actorPermissions.includes(code)))];
    if (forbidden.length) {
      throw new ForbiddenException(
        `You cannot grant permissions you do not hold: ${forbidden.join(', ')}`,
      );
    }
  }

  // ---------------------------------------------------------------- helpers

  /// Unknown permission codes are an error, never silently dropped: a role
  /// that quietly grants less than it appears to is worse than a failure.
  private async resolvePermissions(codes?: string[]): Promise<string[]> {
    if (!codes?.length) return [];
    const found = await this.prisma.permission.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true },
    });
    if (found.length !== codes.length) {
      const known = new Set(found.map((p) => p.code));
      const missing = codes.filter((code) => !known.has(code));
      throw new BadRequestException({ code: 'PERMISSION_UNKNOWN', message: `Unknown permission(s): ${missing.join(', ')}` });
    }
    return found.map((p) => p.id);
  }

  private toResponse(role: any) {
    return {
      id: role.id,
      companyId: role.companyId,
      code: role.code,
      nameEn: role.nameEn,
      nameAr: role.nameAr,
      isSystem: role.isSystem,
      isActive: role.isActive !== false,
      category: role.category ?? 'CUSTOM',
      descriptionEn: role.descriptionEn ?? null,
      descriptionAr: role.descriptionAr ?? null,
      permissions: (role.rolePermissions ?? []).map((rp: any) => rp.permission.code),
    };
  }
}
