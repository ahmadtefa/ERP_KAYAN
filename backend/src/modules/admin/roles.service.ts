import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

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
      orderBy: [{ isSystem: 'desc' }, { code: 'asc' }],
      include: {
        rolePermissions: { include: { permission: true } },
        _count: { select: { userRoles: true } },
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
        _count: { select: { userRoles: true } },
      },
    });
    if (!role) throw new NotFoundException('Role not found');
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

  async create(companyId: string, actorId: string, dto: CreateRoleDto) {
    const code = dto.code.trim().toUpperCase();
    const existing = await this.prisma.role.findFirst({
      where: { companyId, code, deletedAt: null },
    });
    if (existing) throw new ConflictException('A role with that code already exists');

    const permissionIds = await this.resolvePermissions(dto.permissions);

    const created = await this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          companyId,
          code,
          nameEn: dto.nameEn.trim(),
          nameAr: dto.nameAr.trim(),
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
      after: { code, permissions: dto.permissions ?? [] },
    });
    return this.findOne(companyId, created.id);
  }

  async update(companyId: string, actorId: string, id: string, dto: UpdateRoleDto) {
    const role = await this.prisma.role.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) {
      throw new BadRequestException('A system role cannot be renamed');
    }

    await this.prisma.role.update({
      where: { id },
      data: { nameEn: dto.nameEn?.trim(), nameAr: dto.nameAr?.trim() },
    });
    await this.audit.record({
      companyId,
      userId: actorId,
      action: 'role.update',
      entity: 'roles',
      entityId: id,
      before: { nameEn: role.nameEn, nameAr: role.nameAr },
      after: { nameEn: dto.nameEn, nameAr: dto.nameAr },
    });
    return this.findOne(companyId, id);
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
  ) {
    const role = await this.prisma.role.findFirst({
      where: { id, deletedAt: null, OR: [{ companyId }, { companyId: null }] },
    });
    if (!role) throw new NotFoundException('Role not found');

    const permissionIds = await this.resolvePermissions(codes);
    const before = await this.prisma.rolePermission.findMany({
      where: { roleId: id },
      include: { permission: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      for (const permissionId of permissionIds) {
        await tx.rolePermission.create({ data: { roleId: id, permissionId } });
      }
    });

    await this.audit.record({
      companyId,
      userId: actorId,
      action: 'role.permissions_set',
      entity: 'roles',
      entityId: id,
      before: { permissions: before.map((rp) => rp.permission.code) },
      after: { permissions: codes },
    });
    return this.findOne(companyId, id);
  }

  async remove(companyId: string, actorId: string, id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { _count: { select: { userRoles: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) throw new BadRequestException('A system role cannot be removed');
    if (role._count.userRoles > 0) {
      throw new BadRequestException(
        `${role._count.userRoles} user(s) still hold this role. Move them to another role first.`,
      );
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
      throw new BadRequestException(
        `Unknown permission(s): ${missing.join(', ')}`,
      );
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
      permissions: (role.rolePermissions ?? []).map((rp: any) => rp.permission.code),
    };
  }
}
