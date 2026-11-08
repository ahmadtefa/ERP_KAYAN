import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockDirection } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WarehouseScope } from '../../common/warehouse/warehouse.service';

const MONEY_SCALE = 4;
const LOCATION_KINDS = ['ZONE', 'AISLE', 'RACK', 'SHELF', 'BIN'] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

/// The order a location may sit at inside another.
///
/// A bin belongs in a shelf or a rack, a rack in an aisle or a zone, an aisle
/// in a zone. A zone may not sit inside a bin, because that is not a place,
/// it is a drawing on a wall - and the label printer would print nonsense.
const PARENT_OF: Record<LocationKind, LocationKind[]> = {
  ZONE: [],
  AISLE: ['ZONE'],
  RACK: ['ZONE', 'AISLE'],
  SHELF: ['AISLE', 'RACK'],
  BIN: ['RACK', 'SHELF'],
};

export interface LocationInput {
  warehouseId: string;
  parentId?: string | null;
  kind?: string;
  code: string;
  nameEn: string;
  nameAr: string;
  isActive?: boolean;
}

/// Zones, aisles, racks, shelves and bins inside one warehouse.
///
/// The tree is what makes "it is in the store" a usable answer: a quantity can
/// be moved from one bin to another without leaving the building, and the
/// shelf label printed on the wall was generated from this table rather than
/// typed twice.
@Injectable()
export class StorageLocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    companyId: string,
    query: { warehouseId?: string; parentId?: string | null } = {},
    scope: WarehouseScope = null,
    warehouseIds?: string[],
  ) {
    const where: Prisma.StorageLocationWhereInput = { companyId, deletedAt: null };
    if (warehouseIds !== undefined || query.warehouseId) {
      where.warehouseId = {
        in: warehouseIds === undefined
          ? [query.warehouseId!]
          : query.warehouseId
            ? warehouseIds.filter((id) => id === query.warehouseId)
            : warehouseIds,
      };
    }
    if (query.parentId === null) where.parentId = null;
    else if (query.parentId) where.parentId = query.parentId;
    if (scope !== null) where.branchId = { in: scope };

    const rows = await this.prisma.storageLocation.findMany({
      where,
      orderBy: [{ kind: 'asc' }, { code: 'asc' }],
      include: { warehouse: { select: { code: true, nameEn: true, nameAr: true } } },
    });

    const counts = await this.stockByLocation(
      companyId,
      rows.map((row) => row.id),
    );
    return {
      items: rows.map((row) => ({
        ...row,
        stock: counts.get(row.id) ?? { items: 0, quantity: '0.0000' },
      })),
      kinds: LOCATION_KINDS,
    };
  }

  /// The whole tree for one warehouse, ready for a picker or a label sheet.
  async tree(
    companyId: string,
    warehouseId: string,
    scope: WarehouseScope = null,
    warehouseIds?: string[],
  ) {
    if (warehouseIds !== undefined && !warehouseIds.includes(warehouseId)) {
      throw new ForbiddenException('You cannot view locations in this warehouse');
    }
    const rows = await this.prisma.storageLocation.findMany({
      where: { companyId, warehouseId, deletedAt: null },
      orderBy: [{ kind: 'asc' }, { code: 'asc' }],
    });
    if (scope !== null && rows.some((row) => !scope.includes(row.branchId))) {
      throw new ForbiddenException('This warehouse belongs to another branch');
    }
    const counts = await this.stockByLocation(
      companyId,
      rows.map((row) => row.id),
    );
    const byParent = new Map<string | null, typeof rows>();
    for (const row of rows) {
      const key = row.parentId ?? null;
      byParent.set(key, [...(byParent.get(key) ?? []), row]);
    }
    const build = (parentId: string | null): unknown[] =>
      (byParent.get(parentId) ?? []).map((row) => ({
        ...row,
        stock: counts.get(row.id) ?? { items: 0, quantity: '0.0000' },
        children: build(row.id),
      }));
    return { warehouseId, items: build(null) };
  }

  async create(
    companyId: string,
    userId: string,
    input: LocationInput,
    scope: WarehouseScope,
    warehouseIds?: string[],
  ) {
    const warehouse = await this.requireWarehouse(companyId, input.warehouseId, scope);
    if (warehouseIds !== undefined && !warehouseIds.includes(warehouse.id)) {
      throw new ForbiddenException('You cannot manage locations in this warehouse');
    }
    const kind = (input.kind ?? 'BIN').toUpperCase() as LocationKind;
    if (!LOCATION_KINDS.includes(kind)) {
      throw new BadRequestException(
        `Unknown location kind ${input.kind}. Use one of ${LOCATION_KINDS.join(', ')}.`,
      );
    }

    let parent: { id: string; kind: string } | null = null;
    if (input.parentId) {
      parent = await this.prisma.storageLocation.findFirst({
        where: { id: input.parentId, companyId, warehouseId: warehouse.id, deletedAt: null },
        select: { id: true, kind: true },
      });
      if (!parent) {
        throw new BadRequestException(
          'الأب غير موجود في هذا المخزن. / The parent location is not in this warehouse.',
        );
      }
      if (!PARENT_OF[kind].includes(parent.kind as LocationKind)) {
        throw new BadRequestException(
          `الموقع من نوع ${kind} لا يمكن أن يوضع داخل ${parent.kind}. / ` +
            `A ${kind} cannot be placed inside a ${parent.kind}.`,
        );
      }
    } else if (PARENT_OF[kind].length > 0) {
      throw new BadRequestException(
        `الموقع من نوع ${kind} يجب أن يكون داخل ${PARENT_OF[kind].join(' أو ')}. / ` +
          `A ${kind} must sit inside a ${PARENT_OF[kind].join(' or ')}.`,
      );
    }

    const duplicate = await this.prisma.storageLocation.findFirst({
      where: { companyId, warehouseId: warehouse.id, code: input.code.trim(), deletedAt: null },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        `الكود ${input.code} مستخدم في هذا المخزن. / Code ${input.code} already exists here.`,
      );
    }

    const created = await this.prisma.storageLocation.create({
      data: {
        companyId,
        branchId: warehouse.branchId,
        warehouseId: warehouse.id,
        parentId: parent?.id ?? null,
        kind,
        code: input.code.trim(),
        nameEn: input.nameEn.trim(),
        nameAr: input.nameAr.trim(),
        isActive: input.isActive ?? true,
        createdBy: userId,
      },
    });
    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'storage_locations',
      entityId: created.id,
      after: { code: created.code, kind: created.kind, warehouseId: warehouse.id },
    });
    return created;
  }

  async update(
    companyId: string,
    userId: string,
    id: string,
    input: Partial<LocationInput>,
    scope: WarehouseScope,
    warehouseIds?: string[],
  ) {
    const existing = await this.prisma.storageLocation.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Storage location not found');
    if (warehouseIds !== undefined && !warehouseIds.includes(existing.warehouseId)) {
      throw new ForbiddenException('You cannot manage locations in this warehouse');
    }
    if (scope !== null && !scope.includes(existing.branchId)) {
      throw new ForbiddenException('This location belongs to another branch');
    }
    if (input.code && input.code.trim() !== existing.code) {
      const duplicate = await this.prisma.storageLocation.findFirst({
        where: {
          companyId,
          warehouseId: existing.warehouseId,
          code: input.code.trim(),
          deletedAt: null,
          id: { not: id },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException(`Code ${input.code} already exists in this warehouse`);
      }
    }
    if (input.parentId !== undefined && input.parentId !== existing.parentId) {
      if (input.parentId === id) {
        throw new BadRequestException('A location cannot contain itself');
      }
      if (input.parentId) {
        const parent = await this.prisma.storageLocation.findFirst({
          where: {
            id: input.parentId,
            companyId,
            warehouseId: existing.warehouseId,
            deletedAt: null,
          },
          select: { kind: true },
        });
        if (!parent) throw new BadRequestException('The parent location does not exist here');
        if (!PARENT_OF[existing.kind as LocationKind].includes(parent.kind as LocationKind)) {
          throw new BadRequestException(
            `A ${existing.kind} cannot be placed inside a ${parent.kind}`,
          );
        }
        // A move that made a shelf its own grandparent would orphan the tree.
        let cursor: string | null = input.parentId;
        const seen = new Set<string>([id]);
        while (cursor) {
          if (seen.has(cursor)) {
            throw new BadRequestException(
              'هذا النقل يجعل الموقع داخل نفسه. / That move would place a location inside itself.',
            );
          }
          seen.add(cursor);
          const next: { parentId: string | null } | null =
            await this.prisma.storageLocation.findFirst({
              where: { id: cursor, companyId },
              select: { parentId: true },
            });
          cursor = next?.parentId ?? null;
        }
      }
    }

    const updated = await this.prisma.storageLocation.update({
      where: { id },
      data: {
        parentId: input.parentId === undefined ? undefined : input.parentId,
        code: input.code?.trim(),
        nameEn: input.nameEn?.trim(),
        nameAr: input.nameAr?.trim(),
        isActive: input.isActive,
      },
    });
    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'storage_locations',
      entityId: id,
      before: { code: existing.code, parentId: existing.parentId },
      after: { code: updated.code, parentId: updated.parentId },
    });
    return updated;
  }

  /// Removes a location only when nothing is in it and nothing hangs off it.
  ///
  /// Deleting a bin that still holds goods would lose the answer to "where is
  /// it?", so the caller is told what is in the way rather than the row being
  /// hidden and the stock becoming unfindable.
  async remove(
    companyId: string,
    userId: string,
    id: string,
    scope: WarehouseScope,
    warehouseIds?: string[],
  ) {
    const existing = await this.prisma.storageLocation.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Storage location not found');
    if (warehouseIds !== undefined && !warehouseIds.includes(existing.warehouseId)) {
      throw new ForbiddenException('You cannot manage locations in this warehouse');
    }
    if (scope !== null && !scope.includes(existing.branchId)) {
      throw new ForbiddenException('This location belongs to another branch');
    }
    const children = await this.prisma.storageLocation.count({
      where: { parentId: id, deletedAt: null },
    });
    if (children > 0) {
      throw new ConflictException(
        `لا يمكن حذف موقع يحتوي على ${children} موقعًا فرعيًا. / ` +
          `This location holds ${children} sub-location(s); move them first.`,
      );
    }
    const inRows = await this.prisma.$queryRaw<Array<{ quantity: Prisma.Decimal | null }>>(
      Prisma.sql`
        SELECT SUM(CASE WHEN "direction" = 'IN' THEN "quantity" ELSE -"quantity" END) AS "quantity"
          FROM "stock_movements"
         WHERE "companyId" = ${companyId}::uuid
           AND "storageLocationId" = ${id}::uuid
      `,
    );
    const balance = inRows[0]?.quantity ?? null;
    if (balance && new Prisma.Decimal(balance).greaterThan(0)) {
      throw new ConflictException(
        `لا يمكن حذف موقع به ${Number(balance).toFixed(4)} رصيد. / ` +
          `This location still holds ${Number(balance).toFixed(4)}; move the stock first.`,
      );
    }
    await this.prisma.storageLocation.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.record({
      companyId,
      userId,
      action: 'DELETE',
      entity: 'storage_locations',
      entityId: id,
      before: { code: existing.code },
    });
    return { id, deleted: true };
  }

  /// Moves stock between two shelves of the same warehouse.
  ///
  /// Nothing is bought or sold, so the branch's quantity and value do not
  /// change; only the answer to "which shelf?" does. The pair of movements
  /// keeps the stock card honest and makes the move visible in the lot's
  /// history, which is the whole point of recording a shelf at all.
  async move(
    companyId: string,
    userId: string,
    input: {
      fromLocationId: string;
      toLocationId: string;
      itemId: string;
      batchId?: string | null;
      quantity: string | number;
      reason?: string | null;
    },
    scope: WarehouseScope,
    warehouseIds?: string[],
    transferWarehouseIds?: string[],
  ) {
    if (input.fromLocationId === input.toLocationId) {
      throw new BadRequestException(
        'الموقعان متطابقان. / The source and destination locations are the same.',
      );
    }
    const quantity = new Prisma.Decimal(input.quantity);
    if (quantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Quantity must be positive');
    }

    const [from, to] = await Promise.all([
      this.prisma.storageLocation.findFirst({
        where: { id: input.fromLocationId, companyId, deletedAt: null },
      }),
      this.prisma.storageLocation.findFirst({
        where: { id: input.toLocationId, companyId, deletedAt: null },
      }),
    ]);
    if (!from || !to) throw new NotFoundException('Storage location not found');
    if (from.warehouseId !== to.warehouseId) {
      throw new BadRequestException(
        'المواقعتين في مخزنين مختلفين؛ استخدم تحويل الدفعات. / ' +
          'The two locations are in different warehouses; use a lot transfer.',
      );
    }
    if (!from.isActive || !to.isActive) {
      throw new BadRequestException('Both locations must be active');
    }
    if (scope !== null && !scope.includes(from.branchId)) {
      throw new ForbiddenException('This location belongs to another branch');
    }
    if (warehouseIds !== undefined && !warehouseIds.includes(from.warehouseId)) {
      throw new ForbiddenException('You cannot move stock in this warehouse');
    }
    if (transferWarehouseIds !== undefined && !transferWarehouseIds.includes(from.warehouseId)) {
      throw new ForbiddenException('You do not have the transfer grant for this warehouse');
    }

    const item = await this.prisma.item.findFirst({
      where: { id: input.itemId, companyId, deletedAt: null },
      select: { id: true, code: true, unit: true },
    });
    if (!item) throw new NotFoundException('Item not found');

    const availableRows = await this.prisma.$queryRaw<Array<{ quantity: Prisma.Decimal | null }>>(
      Prisma.sql`
        SELECT SUM(CASE WHEN "direction" = 'IN' THEN "quantity" ELSE -"quantity" END) AS "quantity"
          FROM "stock_movements"
         WHERE "companyId" = ${companyId}::uuid
           AND "storageLocationId" = ${input.fromLocationId}::uuid
           AND "itemId" = ${input.itemId}::uuid
           ${input.batchId ? Prisma.sql`AND "batchId" = ${input.batchId}::uuid` : Prisma.empty}
      `,
    );
    const available = new Prisma.Decimal(availableRows[0]?.quantity ?? 0);
    if (available.lessThan(quantity)) {
      throw new BadRequestException(
        `الموقع يحوي ${available.toFixed(MONEY_SCALE)} فقط. / ` +
          `That location holds ${available.toFixed(MONEY_SCALE)}, not ${quantity.toFixed(MONEY_SCALE)}.`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // The value travels with the goods at the shelf's average, so a move
      // never invents profit and never loses cost.
      const balance = await tx.$queryRaw<Array<{ quantity: Prisma.Decimal; value: Prisma.Decimal }>>(
        Prisma.sql`
          SELECT "quantity", "value" FROM "stock_balances"
           WHERE "companyId" = ${companyId}::uuid
             AND "branchId" = ${from.branchId}::uuid
             AND "itemId" = ${input.itemId}::uuid
           FOR UPDATE
        `,
      );
      const onHand = balance[0]?.quantity ?? new Prisma.Decimal(0);
      const onHandValue = balance[0]?.value ?? new Prisma.Decimal(0);
      const unitCost = onHand.isZero()
        ? new Prisma.Decimal(0)
        : onHandValue.div(onHand).toDecimalPlaces(MONEY_SCALE);
      const totalCost = unitCost.mul(quantity).toDecimalPlaces(MONEY_SCALE);
      const value = totalCost;
      const today = new Date();

      for (const [location, direction] of [
        [from, StockDirection.OUT],
        [to, StockDirection.IN],
      ] as const) {
        await tx.stockMovement.create({
          data: {
            companyId,
            branchId: from.branchId,
            warehouseId: from.warehouseId,
            itemId: item.id,
            batchId: input.batchId ?? null,
            storageLocationId: location.id,
            movementDate: today,
            direction,
            quantity,
            unitCost,
            totalCost,
            referenceType: direction === StockDirection.OUT ? 'LOCATION_MOVE_OUT' : 'LOCATION_MOVE_IN',
            referenceId: location.id,
            referenceNumber: null,
            notes: input.reason ?? null,
            createdBy: userId,
          },
        });
      }

      // The lot keeps its quantity; only its shelf changed.
      if (input.batchId) {
        await tx.itemBatch.updateMany({
          where: { id: input.batchId, companyId },
          data: { storageLocationId: to.id, updatedBy: userId },
        });
      }

      await this.audit.record({
        companyId,
        userId,
        action: 'MOVE_LOCATION',
        entity: 'storage_locations',
        entityId: from.id,
        after: {
          to: to.id,
          item: item.code,
          batchId: input.batchId ?? null,
          quantity: quantity.toFixed(MONEY_SCALE),
          value: value.toFixed(MONEY_SCALE),
          reason: input.reason ?? null,
        },
      });
      return { quantity: quantity.toFixed(MONEY_SCALE), value: value.toFixed(MONEY_SCALE) };
    });

    return { ...result, from: from.id, to: to.id, totalCost: result.value };
  }

  /// How much of what sits in each of these locations today.
  private async stockByLocation(companyId: string, ids: string[]) {
    const result = new Map<string, { items: number; quantity: string }>();
    if (ids.length === 0) return result;
    const rows = await this.prisma.$queryRaw<
      Array<{ storageLocationId: string; items: bigint; quantity: Prisma.Decimal }>
    >(Prisma.sql`
      SELECT "storageLocationId",
             COUNT(DISTINCT "itemId") AS "items",
             SUM(CASE WHEN "direction" = 'IN' THEN "quantity" ELSE -"quantity" END) AS "quantity"
        FROM "stock_movements"
       WHERE "companyId" = ${companyId}::uuid
         AND "storageLocationId" = ANY(${ids}::uuid[])
       GROUP BY "storageLocationId"
    `);
    for (const row of rows) {
      result.set(row.storageLocationId, {
        items: Number(row.items),
        quantity: new Prisma.Decimal(row.quantity ?? 0).toFixed(MONEY_SCALE),
      });
    }
    return result;
  }

  private async requireWarehouse(companyId: string, warehouseId: string, scope: WarehouseScope) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, companyId, deletedAt: null },
      select: { id: true, branchId: true, code: true },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    if (scope !== null && !scope.includes(warehouse.branchId)) {
      throw new ForbiddenException('This warehouse belongs to another branch');
    }
    return warehouse;
  }
}
