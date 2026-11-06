import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const MONEY_SCALE = 4;

/**
 * The places inside a branch where goods sit.
 *
 * Two jobs live here, and they are deliberately in one place:
 *
 *   1. the master data a person edits (create, rename, deactivate, choose the
 *      branch default);
 *   2. `resolve()`, which every posting path calls to answer "which warehouse
 *      did this actually happen in?". It never invents an answer: it either
 *      uses the warehouse named on the document, or the branch's default, and
 *      it refuses a warehouse that belongs to another company or another
 *      branch, because a movement between the wrong two piles is worse than a
 *      refused posting.
 */
@Injectable()
export class WarehouseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(
    companyId: string,
    query: { branchId?: string; includeInactive?: boolean } = {},
  ) {
    const where: Prisma.WarehouseWhereInput = { companyId, deletedAt: null };
    if (!query.includeInactive) where.isActive = true;
    if (query.branchId) where.branchId = query.branchId;

    const items = await this.prisma.warehouse.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
      include: { branch: { select: { code: true, nameEn: true, nameAr: true } } },
    });

    return { items: items.map((row) => this.toResponse(row)), total: items.length };
  }

  async findOne(companyId: string, id: string) {
    const row = await this.prisma.warehouse.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { branch: { select: { code: true, nameEn: true, nameAr: true } } },
    });
    if (!row) throw new NotFoundException('Warehouse not found');
    return this.toResponse(row);
  }

  async create(companyId: string, userId: string, dto: Record<string, unknown>) {
    const code = this.text(dto.code, 'code');
    const nameEn = this.text(dto.nameEn, 'nameEn');
    const nameAr = this.text(dto.nameAr, 'nameAr');
    const branchId = await this.branch(companyId, this.text(dto.branchId, 'branchId'));

    const existing = await this.prisma.warehouse.findFirst({
      where: { companyId, code },
      select: { id: true, deletedAt: true },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException(`Warehouse code ${code} is already used`);
    }

    // The first warehouse of a branch is its default without being asked:
    // a branch with none would leave documents with nowhere to post.
    const count = await this.prisma.warehouse.count({
      where: { companyId, branchId, deletedAt: null },
    });
    const isDefault = dto.isDefault === true || count === 0;

    const created = await this.prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.warehouse.updateMany({
          where: { companyId, branchId, isDefault: true, deletedAt: null },
          data: { isDefault: false },
        });
      }
      return tx.warehouse.create({
        data: {
          companyId,
          branchId,
          code,
          nameEn,
          nameAr,
          address: (dto.address as string) ?? null,
          isDefault,
          isActive: dto.isActive === false ? false : true,
          createdBy: userId,
        },
      });
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'warehouses',
      entityId: created.id,
      after: { code, nameEn, nameAr, branchId, isDefault },
    });

    return this.findOne(companyId, created.id);
  }

  async update(companyId: string, userId: string, id: string, dto: Record<string, unknown>) {
    const before = await this.prisma.warehouse.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Warehouse not found');

    const data: Prisma.WarehouseUpdateInput = {};
    if (dto.nameEn !== undefined) data.nameEn = this.text(dto.nameEn, 'nameEn');
    if (dto.nameAr !== undefined) data.nameAr = this.text(dto.nameAr, 'nameAr');
    if (dto.address !== undefined) data.address = (dto.address as string) ?? null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive === true;
    if (dto.branchId !== undefined) {
      data.branch = {
        connect: { id: await this.branch(companyId, this.text(dto.branchId, 'branchId')) },
      };
    }

    const makeDefault = dto.isDefault === true;
    if (before.isDefault && dto.isDefault === false) {
      throw new BadRequestException(
        'A branch must keep a default warehouse; name another one instead',
      );
    }
    if (dto.isActive === false && before.isDefault) {
      throw new BadRequestException(
        'The default warehouse of a branch cannot be deactivated; make another one the default first',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.warehouse.updateMany({
          where: {
            companyId,
            branchId: before.branchId,
            isDefault: true,
            deletedAt: null,
            NOT: { id },
          },
          data: { isDefault: false },
        });
        data.isDefault = true;
      }
      return tx.warehouse.update({ where: { id }, data });
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'warehouses',
      entityId: id,
      before: { nameEn: before.nameEn, isActive: before.isActive, isDefault: before.isDefault },
      after: { nameEn: updated.nameEn, isActive: updated.isActive, isDefault: updated.isDefault },
    });

    return this.findOne(companyId, id);
  }

  async deactivate(companyId: string, userId: string, id: string) {
    const before = await this.prisma.warehouse.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Warehouse not found');
    if (before.isDefault) {
      throw new BadRequestException(
        'The default warehouse of a branch cannot be deactivated; make another one the default first',
      );
    }

    await this.prisma.warehouse.update({ where: { id }, data: { isActive: false } });
    await this.audit.record({
      companyId,
      userId,
      action: 'DEACTIVATE',
      entity: 'warehouses',
      entityId: id,
      before: { isActive: true },
      after: { isActive: false },
    });

    return this.findOne(companyId, id);
  }

  /**
   * The warehouse a document happened in.
   *
   * Called inside the posting transaction, so a movement and the claim on the
   * warehouse are written or rolled back together. When the document names
   * none, the branch's default is used - and created on the spot if the branch
   * somehow has none, because refusing to post a sale over a missing master
   * record would be the wrong answer.
   */
  async resolve(
    tx: Prisma.TransactionClient,
    companyId: string,
    branchId: string,
    warehouseId?: string | null,
  ): Promise<string | null> {
    if (warehouseId) {
      const named = await tx.warehouse.findFirst({
        where: { id: warehouseId, companyId, deletedAt: null },
        select: { id: true, branchId: true, isActive: true, code: true },
      });
      if (!named) throw new BadRequestException('The warehouse does not exist in this company');
      if (named.branchId !== branchId) {
        throw new BadRequestException(
          `Warehouse ${named.code} belongs to another branch; a document cannot move goods across branches`,
        );
      }
      if (!named.isActive) {
        throw new BadRequestException(`Warehouse ${named.code} is inactive`);
      }
      return named.id;
    }

    const fallback = await tx.warehouse.findFirst({
      where: { companyId, branchId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
      select: { id: true },
    });
    if (fallback) return fallback.id;

    // A branch with nowhere to put goods cannot be allowed to stop a posting.
    // The customer's delivery has already happened; refusing the invoice over
    // a missing master record would be the wrong answer, so the warehouse is
    // created here, once, and named after the branch.
    const branch = await tx.branch.findFirst({
      where: { id: branchId, companyId, deletedAt: null },
      select: { code: true, nameEn: true, nameAr: true },
    });
    if (!branch) return null;

    const created = await tx.warehouse.create({
      data: {
        companyId,
        branchId,
        code: `${branch.code}-MAIN`,
        nameEn: `${branch.nameEn} main store`,
        nameAr: `${branch.nameAr} - المخزن الرئيسي`,
        isDefault: true,
      },
      select: { id: true },
    });
    return created.id;
  }

  /**
   * Resolves the historical location for an accounting reversal. A warehouse
   * that was used by a posted document may since have been deactivated; that
   * must not make the original movement impossible to reverse. New postings
   * still use `resolve()`, which rejects inactive warehouses.
   */
  async resolveForReversal(
    tx: Prisma.TransactionClient,
    companyId: string,
    branchId: string,
    warehouseId?: string | null,
  ): Promise<string | null> {
    if (!warehouseId) return this.resolve(tx, companyId, branchId);
    const historical = await tx.warehouse.findFirst({
      where: { id: warehouseId, companyId, branchId, deletedAt: null },
      select: { id: true },
    });
    if (!historical) {
      throw new BadRequestException(
        'The warehouse recorded on the original document is no longer available in this company and branch.',
      );
    }
    return historical.id;
  }

  /**
   * Takes a row lock on the warehouse so two postings draining the same
   * warehouse cannot both read the same available quantity. The second
   * transaction blocks here until the first commits, then re-reads the
   * movements and sees the reduced availability.
   */
  async lockForPosting(
    tx: Prisma.TransactionClient,
    companyId: string,
    warehouseId: string,
  ): Promise<void> {
    await tx.$queryRaw(Prisma.sql`
      SELECT id
        FROM warehouses
       WHERE id = ${warehouseId}::uuid
         AND "companyId" = ${companyId}::uuid
         AND "deletedAt" IS NULL
       FOR UPDATE
    `);
  }

  /**
   * Base-unit quantity one warehouse currently holds for an item, derived
   * from stock_movements with exactly the same IN-minus-OUT formula used by
   * `stock()` and the /inventory/stock endpoint. `stock_balances` has no
   * warehouse dimension, so this SUM is the authoritative per-warehouse
   * figure, not the branch-level balance.
   */
  async availableQuantity(
    tx: Prisma.TransactionClient,
    companyId: string,
    warehouseId: string,
    itemId: string,
  ): Promise<Prisma.Decimal> {
    const rows = await tx.$queryRaw<Array<{ quantity: Prisma.Decimal }>>(Prisma.sql`
      SELECT COALESCE(
               SUM(CASE WHEN direction = 'IN' THEN quantity ELSE -quantity END),
               0
             ) AS quantity
        FROM stock_movements
       WHERE "companyId" = ${companyId}::uuid
         AND "warehouseId" = ${warehouseId}::uuid
         AND "itemId" = ${itemId}::uuid
    `);
    return new Prisma.Decimal(rows[0]?.quantity ?? 0);
  }

  /**
   * Business rule enforced at the domain layer (never only in a controller or
   * the Flutter client): when negative stock is disallowed, no OUT operation
   * may push a specific warehouse below zero, even when the branch total or
   * another aggregation level would cover the quantity.
   *
   * Deliberately a no-op when the posting resolves to no warehouse at all
   * (the branch-level guard and the stock_balances nonnegative CHECK remain
   * the backstop), or when the company explicitly permits negative stock.
   */
  async assertWarehouseAvailable(input: {
    tx: Prisma.TransactionClient;
    companyId: string;
    warehouseId: string | null | undefined;
    itemId: string;
    quantity: Prisma.Decimal;
    allowNegative: boolean;
    reference: string;
  }): Promise<void> {
    const { tx, companyId, warehouseId, itemId, quantity, allowNegative, reference } = input;
    if (allowNegative || !warehouseId) return;
    await this.lockForPosting(tx, companyId, warehouseId);
    const available = await this.availableQuantity(tx, companyId, warehouseId, itemId);
    if (available.lessThan(quantity)) {
      throw new BadRequestException(
        `Not enough stock in the selected warehouse: ${available.toFixed(MONEY_SCALE)} available, ` +
          `${quantity.toFixed(MONEY_SCALE)} requested in ${reference}.`,
      );
    }
  }

  /** What one warehouse holds, read from the movements that put it there. */
  async stock(
    companyId: string,
    warehouseId: string,
    query: { asOf?: string; itemId?: string } = {},
  ) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, companyId, deletedAt: null },
      include: { branch: { select: { code: true, nameEn: true, nameAr: true } } },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    const asOf = query.asOf ? new Date(`${query.asOf.slice(0, 10)}T23:59:59.999Z`) : new Date();
    const rows = await this.prisma.$queryRaw<
      Array<{
        itemId: string;
        code: string;
        nameEn: string;
        nameAr: string;
        unit: string;
        quantity: Prisma.Decimal;
        value: Prisma.Decimal;
      }>
    >(Prisma.sql`
      SELECT i.id AS "itemId", i.code, i."nameEn", i."nameAr", i.unit,
             COALESCE(SUM(CASE WHEN m.direction = 'IN' THEN m.quantity ELSE -m.quantity END), 0) AS quantity,
             COALESCE(SUM(CASE WHEN m.direction = 'IN' THEN m."totalCost" ELSE -m."totalCost" END), 0) AS value
        FROM stock_movements m
        JOIN items i ON i.id = m."itemId"
       WHERE m."companyId" = ${companyId}::uuid
         AND m."warehouseId" = ${warehouseId}::uuid
         AND m."movementDate" <= ${asOf}::date
         ${query.itemId ? Prisma.sql`AND m."itemId" = ${query.itemId}::uuid` : Prisma.empty}
       GROUP BY i.id, i.code, i."nameEn", i."nameAr", i.unit
      HAVING COALESCE(SUM(CASE WHEN m.direction = 'IN' THEN m.quantity ELSE -m.quantity END), 0) <> 0
          OR COALESCE(SUM(CASE WHEN m.direction = 'IN' THEN m."totalCost" ELSE -m."totalCost" END), 0) <> 0
       ORDER BY i.code
    `);

    return {
      warehouse: this.toResponse(warehouse),
      asOf: asOf.toISOString().slice(0, 10),
      rows: rows.map((row) => ({
        itemId: row.itemId,
        code: row.code,
        nameEn: row.nameEn,
        nameAr: row.nameAr,
        unit: row.unit,
        quantity: new Prisma.Decimal(row.quantity).toFixed(MONEY_SCALE),
        value: new Prisma.Decimal(row.value).toFixed(MONEY_SCALE),
      })),
      totals: {
        value: rows
          .reduce((sum, row) => sum.plus(new Prisma.Decimal(row.value)), new Prisma.Decimal(0))
          .toFixed(MONEY_SCALE),
      },
    };
  }

  // --- Storage Locations (الأرفف والمواقع الداخلية) ---

  async findLocations(companyId: string, warehouseId: string) {
    await this.findOne(companyId, warehouseId);
    const locations = await (this.prisma as any).storageLocation.findMany({
      where: { companyId, warehouseId, deletedAt: null },
      orderBy: [{ code: 'asc' }],
      include: { parent: { select: { code: true, nameEn: true, nameAr: true } } },
    });
    return {
      items: locations.map((loc: any) => ({
        id: loc.id,
        warehouseId: loc.warehouseId,
        code: loc.code,
        nameEn: loc.nameEn,
        nameAr: loc.nameAr,
        kind: loc.kind,
        parentId: loc.parentId,
        parentCode: loc.parent?.code ?? null,
        barcode: loc.barcode,
        isActive: loc.isActive,
      })),
      total: locations.length,
    };
  }

  async createLocation(
    companyId: string,
    userId: string,
    warehouseId: string,
    dto: Record<string, unknown>,
  ) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, companyId, deletedAt: null },
      select: { id: true, branchId: true },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    const code = this.text(dto.code, 'code').toUpperCase();
    const nameEn = this.text(dto.nameEn, 'nameEn');
    const nameAr = this.text(dto.nameAr, 'nameAr');
    const kind = String(dto.kind ?? 'BIN').toUpperCase();

    const existing = await (this.prisma as any).storageLocation.findFirst({
      where: { warehouseId, code, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException(`Location code ${code} already exists in this warehouse`);
    }

    let parentId: string | null = null;
    if (dto.parentId) {
      const parent = await (this.prisma as any).storageLocation.findFirst({
        where: { id: String(dto.parentId), warehouseId, companyId, deletedAt: null },
      });
      if (!parent) throw new BadRequestException('Parent location does not exist in this warehouse');
      parentId = parent.id;
    }

    const created = await (this.prisma as any).storageLocation.create({
      data: {
        companyId,
        branchId: warehouse.branchId,
        warehouseId,
        code,
        nameEn,
        nameAr,
        kind,
        parentId,
        barcode: dto.barcode ? String(dto.barcode).trim() : null,
        isActive: dto.isActive !== false,
        createdBy: userId,
      },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'storage_locations',
      entityId: created.id,
      after: { code, nameEn, nameAr, kind, warehouseId },
    });

    return created;
  }

  async updateLocation(
    companyId: string,
    userId: string,
    warehouseId: string,
    locationId: string,
    dto: Record<string, unknown>,
  ) {
    const location = await (this.prisma as any).storageLocation.findFirst({
      where: { id: locationId, warehouseId, companyId, deletedAt: null },
    });
    if (!location) throw new NotFoundException('Storage location not found');

    const data: any = {};
    if (dto.nameEn !== undefined) data.nameEn = this.text(dto.nameEn, 'nameEn');
    if (dto.nameAr !== undefined) data.nameAr = this.text(dto.nameAr, 'nameAr');
    if (dto.kind !== undefined) data.kind = String(dto.kind).toUpperCase();
    if (dto.barcode !== undefined) data.barcode = dto.barcode ? String(dto.barcode).trim() : null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive === true;
    if (dto.parentId !== undefined) {
      if (dto.parentId === null) {
        data.parentId = null;
      } else {
        if (dto.parentId === locationId) {
          throw new BadRequestException('A location cannot be its own parent');
        }
        const parent = await (this.prisma as any).storageLocation.findFirst({
          where: { id: String(dto.parentId), warehouseId, companyId, deletedAt: null },
        });
        if (!parent) throw new BadRequestException('Parent location not found');
        data.parentId = parent.id;
      }
    }

    const updated = await (this.prisma as any).storageLocation.update({
      where: { id: locationId },
      data,
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'storage_locations',
      entityId: locationId,
      before: { nameEn: location.nameEn, isActive: location.isActive },
      after: { nameEn: updated.nameEn, isActive: updated.isActive },
    });

    return updated;
  }

  async deleteLocation(
    companyId: string,
    userId: string,
    warehouseId: string,
    locationId: string,
  ) {
    const location = await (this.prisma as any).storageLocation.findFirst({
      where: { id: locationId, warehouseId, companyId, deletedAt: null },
    });
    if (!location) throw new NotFoundException('Storage location not found');

    // Cannot delete location if it has active movements or batches
    const hasMovements = await (this.prisma as any).stockMovement.count({
      where: { storageLocationId: locationId },
    });
    if (hasMovements > 0) {
      throw new BadRequestException('Cannot delete location with movement history; deactivate it instead');
    }

    await (this.prisma as any).storageLocation.update({
      where: { id: locationId },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'DELETE',
      entity: 'storage_locations',
      entityId: locationId,
    });

    return { success: true };
  }

  // --- Item Warehouse Settings (حدود المخزون الأدنى وإعادة الطلب والأقصى) ---

  async getItemSettings(companyId: string, warehouseId: string, itemId?: string) {
    await this.findOne(companyId, warehouseId);
    const where: any = { companyId, warehouseId };
    if (itemId) where.itemId = itemId;

    const items = await (this.prisma as any).itemWarehouseSetting.findMany({
      where,
      include: {
        item: { select: { id: true, code: true, nameEn: true, nameAr: true, unit: true } },
      },
    });

    return {
      items: items.map((s: any) => ({
        id: s.id,
        warehouseId: s.warehouseId,
        itemId: s.itemId,
        itemCode: s.item?.code,
        itemNameEn: s.item?.nameEn,
        itemNameAr: s.item?.nameAr,
        unit: s.item?.unit,
        minQuantity: new Prisma.Decimal(s.minQuantity).toFixed(MONEY_SCALE),
        reorderQuantity: new Prisma.Decimal(s.reorderQuantity).toFixed(MONEY_SCALE),
        maxQuantity: new Prisma.Decimal(s.maxQuantity).toFixed(MONEY_SCALE),
      })),
      total: items.length,
    };
  }

  async upsertItemSetting(
    companyId: string,
    userId: string,
    warehouseId: string,
    itemId: string,
    dto: Record<string, unknown>,
  ) {
    await this.findOne(companyId, warehouseId);
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, companyId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Item not found');

    const minQuantity = new Prisma.Decimal(String(dto.minQuantity ?? 0));
    const reorderQuantity = new Prisma.Decimal(String(dto.reorderQuantity ?? 0));
    const maxQuantity = new Prisma.Decimal(String(dto.maxQuantity ?? 0));

    if (minQuantity.isNegative() || reorderQuantity.isNegative() || maxQuantity.isNegative()) {
      throw new BadRequestException('Quantities cannot be negative');
    }

    const upserted = await (this.prisma as any).itemWarehouseSetting.upsert({
      where: { warehouseId_itemId: { warehouseId, itemId } },
      create: {
        companyId,
        warehouseId,
        itemId,
        minQuantity,
        reorderQuantity,
        maxQuantity,
        updatedBy: userId,
      },
      update: {
        minQuantity,
        reorderQuantity,
        maxQuantity,
        updatedBy: userId,
      },
    });

    return {
      id: upserted.id,
      warehouseId,
      itemId,
      minQuantity: minQuantity.toFixed(MONEY_SCALE),
      reorderQuantity: reorderQuantity.toFixed(MONEY_SCALE),
      maxQuantity: maxQuantity.toFixed(MONEY_SCALE),
    };
  }

  // --- User Warehouse Access (صلاحيات المستخدمين على المخازن) ---

  async getUserAccess(companyId: string, warehouseId: string) {
    await this.findOne(companyId, warehouseId);
    const accesses = await (this.prisma as any).userWarehouseAccess.findMany({
      where: { companyId, warehouseId },
      include: {
        user: { select: { id: true, username: true, fullName: true, email: true } },
      },
    });

    return {
      items: accesses.map((acc: any) => ({
        id: acc.id,
        warehouseId: acc.warehouseId,
        userId: acc.userId,
        username: acc.user?.username,
        fullName: acc.user?.fullName,
        canView: acc.canView,
        canReceive: acc.canReceive,
        canIssue: acc.canIssue,
        canTransfer: acc.canTransfer,
        canCount: acc.canCount,
        canApprove: acc.canApprove,
        canSeeCost: acc.canSeeCost,
      })),
      total: accesses.length,
    };
  }

  async setUserAccess(
    companyId: string,
    currentUserId: string,
    warehouseId: string,
    targetUserId: string,
    dto: Record<string, unknown>,
  ) {
    await this.findOne(companyId, warehouseId);
    const user = await this.prisma.user.findFirst({
      where: { id: targetUserId, companyId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');

    const upserted = await (this.prisma as any).userWarehouseAccess.upsert({
      where: { userId_warehouseId: { userId: targetUserId, warehouseId } },
      create: {
        companyId,
        warehouseId,
        userId: targetUserId,
        canView: dto.canView !== false,
        canReceive: dto.canReceive === true,
        canIssue: dto.canIssue === true,
        canTransfer: dto.canTransfer === true,
        canCount: dto.canCount === true,
        canApprove: dto.canApprove === true,
        canSeeCost: dto.canSeeCost === true,
        createdBy: currentUserId,
        updatedBy: currentUserId,
      },
      update: {
        canView: dto.canView !== undefined ? dto.canView === true : undefined,
        canReceive: dto.canReceive !== undefined ? dto.canReceive === true : undefined,
        canIssue: dto.canIssue !== undefined ? dto.canIssue === true : undefined,
        canTransfer: dto.canTransfer !== undefined ? dto.canTransfer === true : undefined,
        canCount: dto.canCount !== undefined ? dto.canCount === true : undefined,
        canApprove: dto.canApprove !== undefined ? dto.canApprove === true : undefined,
        canSeeCost: dto.canSeeCost !== undefined ? dto.canSeeCost === true : undefined,
        updatedBy: currentUserId,
      },
    });

    return upserted;
  }

  async assertUserAccess(
    companyId: string,
    userId: string,
    warehouseId: string,
    op: 'view' | 'receive' | 'issue' | 'transfer' | 'count' | 'approve' | 'seeCost',
  ): Promise<void> {
    const access = await (this.prisma as any).userWarehouseAccess.findUnique({
      where: { userId_warehouseId: { userId, warehouseId } },
    });
    if (!access) {
      // If no specific grant exists, default user warehouse access follows company defaults
      return;
    }

    const fieldMap: Record<string, string> = {
      view: 'canView',
      receive: 'canReceive',
      issue: 'canIssue',
      transfer: 'canTransfer',
      count: 'canCount',
      approve: 'canApprove',
      seeCost: 'canSeeCost',
    };
    const prop = fieldMap[op];
    if (prop && access[prop] === false) {
      throw new BadRequestException(`User does not have ${op} permission on the selected warehouse`);
    }
  }

  private async branch(companyId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new BadRequestException('The branch does not exist in this company');
    return branch.id;
  }

  private text(value: unknown, field: string): string {
    const text = String(value ?? '').trim();
    if (!text) throw new BadRequestException(`${field} is required`);
    return text;
  }

  private toResponse(row: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
    address?: string | null;
    isDefault: boolean;
    isActive: boolean;
    branchId: string;
    branch?: { code: string; nameEn: string; nameAr: string } | null;
  }) {
    return {
      id: row.id,
      code: row.code,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      address: row.address ?? null,
      isDefault: row.isDefault,
      isActive: row.isActive,
      branchId: row.branchId,
      branchCode: row.branch?.code ?? null,
      branchNameEn: row.branch?.nameEn ?? null,
      branchNameAr: row.branch?.nameAr ?? null,
    };
  }
}
