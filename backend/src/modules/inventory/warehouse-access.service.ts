import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WarehouseScope } from '../../common/warehouse/warehouse.service';

export interface WarehouseGrantInput {
  warehouseId: string;
  canView?: boolean;
  canReceive?: boolean;
  canIssue?: boolean;
  canTransfer?: boolean;
  canCount?: boolean;
  canApprove?: boolean;
  canSeeCost?: boolean;
}

/// Which shelves a person may work in, per person, per warehouse.
///
/// The screen and the API read the same rows: a warehouse removed here stops
/// answering that person's requests immediately, because the guard loads the
/// grants with the session instead of trusting a cached list.
@Injectable()
export class WarehouseAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async forUser(companyId: string, userId: string, scope: WarehouseScope = null) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId, deletedAt: null },
      select: { id: true, username: true, fullNameEn: true, fullNameAr: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const [grants, warehouses] = await Promise.all([
      this.prisma.userWarehouseAccess.findMany({
        where: { companyId, userId },
        include: {
          warehouse: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        },
        orderBy: { warehouseId: 'asc' },
      }),
      this.prisma.warehouse.findMany({
        where: {
          companyId,
          deletedAt: null,
          ...(scope !== null ? { branchId: { in: scope } } : {}),
        },
        select: { id: true, code: true, nameEn: true, nameAr: true, branchId: true },
        orderBy: { code: 'asc' },
      }),
    ]);

    return {
      user,
      /// Empty means unrestricted: every warehouse of their branches.
      restricted: grants.length > 0,
      grants: grants.map((row) => ({
        warehouseId: row.warehouseId,
        warehouseCode: row.warehouse.code,
        warehouseNameEn: row.warehouse.nameEn,
        warehouseNameAr: row.warehouse.nameAr,
        canView: row.canView,
        canReceive: row.canReceive,
        canIssue: row.canIssue,
        canTransfer: row.canTransfer,
        canCount: row.canCount,
        canApprove: row.canApprove,
        canSeeCost: row.canSeeCost,
      })),
      warehouses,
    };
  }

  /// Replaces a person's grants in one transaction.
  ///
  /// Replacing rather than merging keeps the screen honest: what the admin
  /// saved is what is stored, with no row left behind from an earlier save.
  async setForUser(
    companyId: string,
    actorId: string,
    userId: string,
    grants: WarehouseGrantInput[],
    scope: WarehouseScope = null,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId, deletedAt: null },
      select: { id: true, isSuperAdmin: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const cleaned = grants ?? [];
    for (const grant of cleaned) {
      if (!grant.warehouseId) {
        throw new BadRequestException('Every grant needs a warehouse.');
      }
    }
    const ids = [...new Set(cleaned.map((grant) => grant.warehouseId))];
    if (ids.length !== cleaned.length) {
      throw new BadRequestException('The same warehouse was listed twice.');
    }
    if (ids.length > 0) {
      const known = await this.prisma.warehouse.findMany({
        where: {
          id: { in: ids },
          companyId,
          deletedAt: null,
          ...(scope !== null ? { branchId: { in: scope } } : {}),
        },
        select: { id: true },
      });
      if (known.length !== ids.length) {
        throw new BadRequestException('One of the warehouses is not available to you.');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userWarehouseAccess.deleteMany({ where: { companyId, userId } });
      for (const grant of cleaned) {
        await tx.userWarehouseAccess.create({
          data: {
            companyId,
            userId,
            warehouseId: grant.warehouseId,
            canView: grant.canView ?? true,
            canReceive: grant.canReceive ?? false,
            canIssue: grant.canIssue ?? false,
            canTransfer: grant.canTransfer ?? false,
            canCount: grant.canCount ?? false,
            canApprove: grant.canApprove ?? false,
            canSeeCost: grant.canSeeCost ?? false,
            createdBy: actorId,
            updatedBy: actorId,
          },
        });
      }
    });

    await this.audit.record({
      companyId,
      userId: actorId,
      action: 'SET_WAREHOUSE_ACCESS',
      entity: 'user_warehouse_access',
      entityId: userId,
      after: {
        warehouses: cleaned.length,
        restricted: cleaned.length > 0,
      },
    });

    return this.forUser(companyId, userId, scope);
  }
}
