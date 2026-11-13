import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WarehouseScope } from '../../common/warehouse/warehouse.service';

const MONEY_SCALE = 4;

export interface ThresholdInput {
  minQuantity?: string | number;
  reorderQuantity?: string | number;
  maxQuantity?: string | number;
}

/// Minimum, reorder point and maximum, per item per warehouse.
///
/// The item's own `reorderLevel` is a company-wide figure kept for the older
/// reports. A shop with a main store, a cold room and a branch shelf does not
/// want the same minimum in all three, so the real rule lives here: it is what
/// the notification centre reads at night and what the reorder report prints.
@Injectable()
export class ItemWarehouseSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    companyId: string,
    query: { warehouseId?: string; itemId?: string; belowMinimum?: string } = {},
    scope: WarehouseScope = null,
    warehouseIds?: string[],
  ) {
    const where: Prisma.ItemWarehouseSettingWhereInput = { companyId };
    if (warehouseIds !== undefined || query.warehouseId) {
      where.warehouseId = {
        in: warehouseIds === undefined
          ? [query.warehouseId!]
          : query.warehouseId
            ? warehouseIds.filter((id) => id === query.warehouseId)
            : warehouseIds,
      };
    }
    if (query.itemId) where.itemId = query.itemId;
    if (scope !== null) where.warehouse = { branchId: { in: scope } };

    const rows = await this.prisma.itemWarehouseSetting.findMany({
      where,
      orderBy: [{ warehouseId: 'asc' }, { itemId: 'asc' }],
      take: 5000,
      include: {
        item: { select: { code: true, nameEn: true, nameAr: true, unit: true } },
        warehouse: { select: { code: true, nameEn: true, nameAr: true } },
      },
    });

    // On-hand per warehouse read once, grouped, rather than per row.
    const onHand = await this.prisma.$queryRaw<
      Array<{ warehouseId: string; itemId: string; quantity: Prisma.Decimal }>
    >(Prisma.sql`
      SELECT "warehouseId", "itemId",
             SUM(CASE WHEN "direction" = 'IN' THEN "quantity" ELSE -"quantity" END) AS "quantity"
        FROM "stock_movements"
       WHERE "companyId" = ${companyId}::uuid
         AND "warehouseId" = ANY(${rows.map((row) => row.warehouseId)}::uuid[])
       GROUP BY "warehouseId", "itemId"
    `);
    const at = new Map(
      onHand.map((row) => [
        `${row.warehouseId}:${row.itemId}`,
        new Prisma.Decimal(row.quantity ?? 0),
      ]),
    );

    const items = rows.map((row) => {
      const quantity = at.get(`${row.warehouseId}:${row.itemId}`) ?? new Prisma.Decimal(0);
      const reorderPoint = row.reorderQuantity.greaterThan(0) ? row.reorderQuantity : row.minQuantity;
      return {
        id: row.id,
        warehouseId: row.warehouseId,
        itemId: row.itemId,
        item: row.item,
        warehouse: row.warehouse,
        minQuantity: row.minQuantity.toFixed(MONEY_SCALE),
        reorderQuantity: row.reorderQuantity.toFixed(MONEY_SCALE),
        maxQuantity: row.maxQuantity.toFixed(MONEY_SCALE),
        onHand: quantity.toFixed(MONEY_SCALE),
        // What to order today: enough to reach the reorder quantity, and no
        // further. A maximum of zero means "no ceiling", not "order nothing".
        suggestedOrder: quantity.lessThanOrEqualTo(reorderPoint) && reorderPoint.greaterThan(0)
          ? row.maxQuantity.greaterThan(quantity)
            ? row.maxQuantity.minus(quantity).toFixed(MONEY_SCALE)
            : reorderPoint.minus(quantity).toFixed(MONEY_SCALE)
          : '0.0000',
        isBelowMinimum: row.minQuantity.greaterThan(0) && quantity.lessThanOrEqualTo(row.minQuantity),
        isAboveMaximum: row.maxQuantity.greaterThan(0) && quantity.greaterThan(row.maxQuantity),
      };
    });

    const filtered =
      String(query.belowMinimum ?? '') === 'true' || String(query.belowMinimum) === '1'
        ? items.filter((row) => row.isBelowMinimum)
        : items;
    return { items: filtered, total: filtered.length };
  }

  async upsert(
    companyId: string,
    userId: string,
    warehouseId: string,
    itemId: string,
    input: ThresholdInput,
    scope: WarehouseScope = null,
  ) {
    const [warehouse, item] = await Promise.all([
      this.prisma.warehouse.findFirst({
        where: { id: warehouseId, companyId, deletedAt: null },
        select: { id: true, branchId: true },
      }),
      this.prisma.item.findFirst({
        where: { id: itemId, companyId, deletedAt: null },
        select: { id: true, code: true },
      }),
    ]);
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    if (!item) throw new NotFoundException('Item not found');
    if (scope !== null && !scope.includes(warehouse.branchId)) {
      throw new NotFoundException('Warehouse not found');
    }

    const min = new Prisma.Decimal(input.minQuantity ?? 0);
    const reorder = new Prisma.Decimal(input.reorderQuantity ?? 0);
    const max = new Prisma.Decimal(input.maxQuantity ?? 0);
    for (const [label, value] of [
      ['minimum', min],
      ['reorder', reorder],
      ['maximum', max],
    ] as const) {
      if (value.lessThan(0)) {
        throw new BadRequestException(
          `الحد ${label} لا يكون سالبًا. / The ${label} cannot be negative.`,
        );
      }
    }
    if (max.greaterThan(0) && max.lessThan(min)) {
      throw new BadRequestException(
        'الحد الأقصى أقل من الحد الأدنى. / The maximum is below the minimum.',
      );
    }
    if (max.greaterThan(0) && reorder.greaterThan(max)) {
      throw new BadRequestException(
        'نقطة إعادة الطلب أعلى من الحد الأقصى. / The reorder point is above the maximum.',
      );
    }

    const data = {
      minQuantity: min,
      reorderQuantity: reorder,
      maxQuantity: max,
      updatedBy: userId,
    };
    const saved = await this.prisma.itemWarehouseSetting.upsert({
      where: { warehouseId_itemId: { warehouseId: warehouse.id, itemId: item.id } },
      create: { companyId, warehouseId: warehouse.id, itemId: item.id, ...data },
      update: data,
    });
    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'item_warehouse_settings',
      entityId: saved.id,
      after: {
        warehouseId: warehouse.id,
        item: item.code,
        min: min.toFixed(MONEY_SCALE),
        reorder: reorder.toFixed(MONEY_SCALE),
        max: max.toFixed(MONEY_SCALE),
      },
    });
    return {
      id: saved.id,
      warehouseId: saved.warehouseId,
      itemId: saved.itemId,
      minQuantity: saved.minQuantity.toFixed(MONEY_SCALE),
      reorderQuantity: saved.reorderQuantity.toFixed(MONEY_SCALE),
      maxQuantity: saved.maxQuantity.toFixed(MONEY_SCALE),
    };
  }
}
