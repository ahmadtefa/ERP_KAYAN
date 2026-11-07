import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { composeQuantity, trimZeros } from '../units/unit-math';

const MONEY_SCALE = 4;

/// Which branches this caller may see warehouses in.
/// `null` means the account is company-wide: no restriction at all.
export type WarehouseScope = string[] | null;

/**
 * Turns the caller's branch assignment into a scope.
 *
 * A person assigned to branches sees only those branches' shelves; a
 * company-wide account (no assignment at all) sees the company. The rule is
 * in one place so the list, the detail, the balances and the write paths
 * cannot drift apart.
 */
export function warehouseScopeOf(user: {
  branchId?: string | null;
  branchIds?: string[] | null;
}): WarehouseScope {
  const assigned = (user.branchIds ?? []).filter(
    (id): id is string => typeof id === 'string' && id !== '',
  );
  if (assigned.length > 0) return assigned;
  return user.branchId ? [user.branchId] : null;
}

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
    scope: WarehouseScope = null,
  ) {
    const where: Prisma.WarehouseWhereInput = { companyId, deletedAt: null };
    if (!query.includeInactive) where.isActive = true;
    if (query.branchId) where.branchId = query.branchId;
    // Outside a person's branches there is nothing to show, and saying so by
    // returning an empty list is honest: the shelf exists, they do not work
    // there.
    if (scope !== null) where.branchId = { in: scope };

    const items = await this.prisma.warehouse.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
      include: { branch: { select: { code: true, nameEn: true, nameAr: true } } },
    });

    return { items: items.map((row) => this.toResponse(row)), total: items.length };
  }

  async findOne(companyId: string, id: string, scope: WarehouseScope = null) {
    const where: Prisma.WarehouseWhereInput = { id, companyId, deletedAt: null };
    if (scope !== null) where.branchId = { in: scope };
    const row = await this.prisma.warehouse.findFirst({
      where,
      include: { branch: { select: { code: true, nameEn: true, nameAr: true } } },
    });
    // A warehouse outside the caller's branches is reported as missing rather
    // than forbidden: it is not theirs to know about.
    if (!row) throw new NotFoundException('Warehouse not found');
    return this.toResponse(row);
  }

  /// Refuses a branch the caller is not assigned to before writing anything.
  private assertInScope(scope: WarehouseScope, branchId: string) {
    if (scope === null) return;
    if (!scope.includes(branchId)) {
      throw new ForbiddenException(
        'هذا المخزن يخص فرعًا غير مسند إليك. / This warehouse belongs to a branch you are not assigned to.',
      );
    }
  }

  async create(
    companyId: string,
    userId: string,
    dto: Record<string, unknown>,
    scope: WarehouseScope = null,
  ) {
    const code = this.text(dto.code, 'code');
    const nameEn = this.text(dto.nameEn, 'nameEn');
    const nameAr = this.text(dto.nameAr, 'nameAr');
    const branchId = await this.branch(companyId, this.text(dto.branchId, 'branchId'));
    this.assertInScope(scope, branchId);

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

  async update(
    companyId: string,
    userId: string,
    id: string,
    dto: Record<string, unknown>,
    scope: WarehouseScope = null,
  ) {
    const before = await this.prisma.warehouse.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Warehouse not found');
    this.assertInScope(scope, before.branchId);
    if (dto.branchId !== undefined) {
      this.assertInScope(
        scope,
        await this.branch(companyId, this.text(dto.branchId, 'branchId')),
      );
    }

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

  async deactivate(
    companyId: string,
    userId: string,
    id: string,
    scope: WarehouseScope = null,
  ) {
    const before = await this.prisma.warehouse.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Warehouse not found');
    this.assertInScope(scope, before.branchId);
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

  /// Puts a warehouse back into service. Reactivating never changes which
  /// warehouse of the branch is the default: that is a separate, explicit
  /// decision, and silently moving it would change where tomorrow's postings
  /// land.
  async reactivate(
    companyId: string,
    userId: string,
    id: string,
    scope: WarehouseScope = null,
  ) {
    const before = await this.prisma.warehouse.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Warehouse not found');
    this.assertInScope(scope, before.branchId);

    await this.prisma.warehouse.update({ where: { id }, data: { isActive: true } });
    await this.audit.record({
      companyId,
      userId,
      action: 'REACTIVATE',
      entity: 'warehouses',
      entityId: id,
      before: { isActive: before.isActive },
      after: { isActive: true },
    });

    return this.findOne(companyId, id, scope);
  }

  /**
   * What every warehouse holds, item by item, with the packing breakdown.
   *
   * The per-warehouse figure comes from `stock_movements`, the same IN-minus-
   * OUT formula the branch balance uses, so the branch total is the sum of
   * its warehouses by construction rather than by a second, disagreeing
   * query. `stock_balances` has no warehouse dimension and is deliberately not
   * used here.
   *
   * The quantity is the stored base-unit number (correct, and unreadable);
   * `breakdown` beside it is the same number rendered in the item's own units
   * (5 كراتين + 4 عبوات) without changing what is stored.
   */
  async balanceReport(
    companyId: string,
    query: {
      branchId?: string;
      warehouseId?: string;
      itemId?: string;
      q?: string;
      includeZero?: boolean;
      asOf?: string;
    } = {},
    scope: WarehouseScope = null,
    mayReadCost = true,
  ) {
    const asOf = query.asOf
      ? new Date(`${query.asOf.slice(0, 10)}T23:59:59.999Z`)
      : new Date();
    const search = (query.q ?? '').trim();

    const rows = await this.prisma.$queryRaw<
      Array<{
        warehouseId: string;
        warehouseCode: string;
        warehouseNameEn: string;
        warehouseNameAr: string;
        branchId: string;
        branchCode: string;
        branchNameEn: string;
        branchNameAr: string;
        itemId: string;
        itemCode: string;
        itemNameEn: string;
        itemNameAr: string;
        unit: string;
        quantity: Prisma.Decimal;
        value: Prisma.Decimal;
      }>
    >(Prisma.sql`
      SELECT w.id AS "warehouseId", w.code AS "warehouseCode",
             w."nameEn" AS "warehouseNameEn", w."nameAr" AS "warehouseNameAr",
             b.id AS "branchId", b.code AS "branchCode",
             b."nameEn" AS "branchNameEn", b."nameAr" AS "branchNameAr",
             i.id AS "itemId", i.code AS "itemCode",
             i."nameEn" AS "itemNameEn", i."nameAr" AS "itemNameAr",
             i.unit,
             COALESCE(SUM(CASE WHEN m.direction = 'IN' THEN m.quantity ELSE -m.quantity END), 0) AS quantity,
             COALESCE(SUM(CASE WHEN m.direction = 'IN' THEN m."totalCost" ELSE -m."totalCost" END), 0) AS value
        FROM stock_movements m
        JOIN items i ON i.id = m."itemId"
        JOIN warehouses w ON w.id = m."warehouseId"
        JOIN branches b ON b.id = w."branchId"
       WHERE m."companyId" = ${companyId}::uuid
         AND w."deletedAt" IS NULL
         AND m."movementDate" <= ${asOf}::date
         ${query.warehouseId ? Prisma.sql`AND w.id = ${query.warehouseId}::uuid` : Prisma.empty}
         ${query.branchId ? Prisma.sql`AND w."branchId" = ${query.branchId}::uuid` : Prisma.empty}
         ${scope !== null ? Prisma.sql`AND w."branchId" = ANY(${scope}::uuid[])` : Prisma.empty}
         ${query.itemId ? Prisma.sql`AND m."itemId" = ${query.itemId}::uuid` : Prisma.empty}
         ${search ? Prisma.sql`AND (i.code ILIKE ${'%' + search + '%'} OR i."nameAr" ILIKE ${'%' + search + '%'} OR i."nameEn" ILIKE ${'%' + search + '%'})` : Prisma.empty}
       GROUP BY w.id, w.code, w."nameEn", w."nameAr", b.id, b.code, b."nameEn", b."nameAr",
                i.id, i.code, i."nameEn", i."nameAr", i.unit
      HAVING ${query.includeZero ? Prisma.sql`TRUE` : Prisma.sql`
        COALESCE(SUM(CASE WHEN m.direction = 'IN' THEN m.quantity ELSE -m.quantity END), 0) <> 0
        OR COALESCE(SUM(CASE WHEN m.direction = 'IN' THEN m."totalCost" ELSE -m."totalCost" END), 0) <> 0`}
       ORDER BY b.code, w.code, i.code
    `);

    // The units of every item in the page, in one read, so the breakdown in
    // the report is the catalogue the item screen shows - not a guess.
    const itemIds = [...new Set(rows.map((row) => row.itemId))];
    const units = itemIds.length
      ? await this.prisma.itemUnit.findMany({
          where: { itemId: { in: itemIds }, isActive: true },
          select: { id: true, itemId: true, unit: true, factor: true },
        })
      : [];
    const unitsByItem = new Map<
      string,
      Array<{ id: string; unit: string; factor: Prisma.Decimal; isActive: boolean }>
    >();
    for (const row of units) {
      const list = unitsByItem.get(row.itemId) ?? [];
      list.push({
        id: row.id,
        unit: row.unit,
        factor: new Prisma.Decimal(row.factor),
        isActive: true,
      });
      unitsByItem.set(row.itemId, list);
    }

    const items = rows.map((row) => {
      const quantity = new Prisma.Decimal(row.quantity);
      const value = new Prisma.Decimal(row.value);
      const breakdown = composeQuantity(
        quantity,
        unitsByItem.get(row.itemId) ?? [],
        row.unit,
      );
      return {
        warehouseId: row.warehouseId,
        warehouseCode: row.warehouseCode,
        warehouseNameEn: row.warehouseNameEn,
        warehouseNameAr: row.warehouseNameAr,
        branchId: row.branchId,
        branchCode: row.branchCode,
        branchNameEn: row.branchNameEn,
        branchNameAr: row.branchNameAr,
        itemId: row.itemId,
        itemCode: row.itemCode,
        itemNameEn: row.itemNameEn,
        itemNameAr: row.itemNameAr,
        unit: row.unit,
        quantity: quantity.toFixed(MONEY_SCALE),
        quantityText: trimZeros(quantity),
        breakdown,
        // A cost is a cost: absent, not zero, when the caller may not see it.
        value: mayReadCost ? value.toFixed(MONEY_SCALE) : null,
        averageCost: mayReadCost
          ? quantity.isZero()
            ? null
            : value.div(quantity).toFixed(MONEY_SCALE)
          : null,
      };
    });

    // The item's total across the warehouses in this page: the number a
    // branch manager expects to equal the branch balance.
    const byItem = new Map<
      string,
      { itemId: string; quantity: Prisma.Decimal; value: Prisma.Decimal; warehouses: number }
    >();
    for (const row of items) {
      const entry = byItem.get(row.itemId) ?? {
        itemId: row.itemId,
        quantity: new Prisma.Decimal(0),
        value: new Prisma.Decimal(0),
        warehouses: 0,
      };
      entry.quantity = entry.quantity.plus(row.quantity);
      entry.value = entry.value.plus(row.value ?? 0);
      entry.warehouses += 1;
      byItem.set(row.itemId, entry);
    }

    const byWarehouse = new Map<
      string,
      { warehouseId: string; warehouseCode: string; value: Prisma.Decimal; items: number }
    >();
    for (const row of items) {
      const entry = byWarehouse.get(row.warehouseId) ?? {
        warehouseId: row.warehouseId,
        warehouseCode: row.warehouseCode,
        value: new Prisma.Decimal(0),
        items: 0,
      };
      entry.value = entry.value.plus(row.value ?? 0);
      entry.items += 1;
      byWarehouse.set(row.warehouseId, entry);
    }

    return {
      asOf: asOf.toISOString().slice(0, 10),
      rows: items,
      itemTotals: [...byItem.values()].map((entry) => ({
        itemId: entry.itemId,
        quantity: entry.quantity.toFixed(MONEY_SCALE),
        quantityText: trimZeros(entry.quantity),
        value: mayReadCost ? entry.value.toFixed(MONEY_SCALE) : null,
        warehouses: entry.warehouses,
      })),
      warehouseTotals: [...byWarehouse.values()].map((entry) => ({
        warehouseId: entry.warehouseId,
        warehouseCode: entry.warehouseCode,
        value: mayReadCost ? entry.value.toFixed(MONEY_SCALE) : null,
        items: entry.items,
      })),
      totals: {
        value: mayReadCost
          ? items
              .reduce((sum, row) => sum.plus(row.value ?? 0), new Prisma.Decimal(0))
              .toFixed(MONEY_SCALE)
          : null,
        rows: items.length,
      },
    };
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
    // DIAGTMP
    const _raw = await tx.$queryRaw(Prisma.sql`
      SELECT direction::text AS d, quantity::text AS q, "warehouseId"::text AS w
        FROM stock_movements
       WHERE "companyId" = ${companyId}::uuid AND "itemId" = ${itemId}::uuid`);
    console.log('DIAGTMP available wh=', warehouseId, 'sum=', String(rows[0]?.quantity),
      'rows=', JSON.stringify(_raw));
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
    scope: WarehouseScope = null,
  ) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: {
        id: warehouseId,
        companyId,
        deletedAt: null,
        ...(scope !== null ? { branchId: { in: scope } } : {}),
      },
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
