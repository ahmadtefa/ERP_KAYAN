import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

const MONEY_SCALE = 4;

/**
 * Reads the stock ledger.
 *
 * The balance table is a running total kept in step with the movements inside
 * the posting transaction, so this is a plain read rather than an aggregate
 * over every movement ever recorded.
 */
@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  async balances(
    companyId: string,
    filters: { branchId?: string; itemId?: string; onlyInStock?: boolean },
  ) {
    const where: Prisma.StockBalanceWhereInput = { companyId };
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.itemId) where.itemId = filters.itemId;

    const rows = await this.prisma.stockBalance.findMany({
      where,
      include: {
        item: {
          select: { code: true, nameEn: true, nameAr: true, unit: true },
        },
        branch: { select: { code: true, nameEn: true, nameAr: true } },
      },
      orderBy: { itemId: 'asc' },
    });

    const mapped = rows.map((r) => {
      const quantity = r.quantity;
      const value = r.value;
      // Weighted average: the value on hand divided by the quantity on hand.
      const averageCost = quantity.isZero()
        ? new Prisma.Decimal(0)
        : value.div(quantity).toDecimalPlaces(MONEY_SCALE);

      return {
        itemId: r.itemId,
        itemCode: r.item.code,
        itemNameEn: r.item.nameEn,
        itemNameAr: r.item.nameAr,
        unit: r.item.unit,
        branchId: r.branchId,
        branchCode: r.branch.code,
        quantity: quantity.toFixed(MONEY_SCALE),
        value: value.toFixed(MONEY_SCALE),
        averageCost: averageCost.toFixed(MONEY_SCALE),
      };
    });

    return filters.onlyInStock
      ? mapped.filter((m) => !new Prisma.Decimal(m.quantity).isZero())
      : mapped;
  }

  /// Where each item actually sits, warehouse by warehouse.
  ///
  /// `stock_balances` is kept per branch and item, so it cannot answer "how
  /// much is in the main store". The append-only ledger can: this adds the
  /// signed movements per warehouse. A movement without a warehouse (one
  /// recorded before warehouses existed) is reported under `warehouseId: null`
  /// rather than being attributed to a warehouse it never named.
  async byWarehouse(
    companyId: string,
    filters: { branchId?: string; itemIds?: string[] },
  ) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        warehouseId: string | null;
        itemId: string;
        quantity: unknown;
      }>
    >(Prisma.sql`
      SELECT "warehouseId", "itemId",
             SUM(CASE WHEN "direction" = 'IN' THEN "quantity" ELSE -"quantity" END) AS quantity
        FROM stock_movements
       WHERE "companyId" = ${companyId}::uuid
         AND (${filters.branchId ?? null}::uuid IS NULL OR "branchId" = ${filters.branchId ?? null}::uuid)
         AND (${filters.itemIds && filters.itemIds.length ? filters.itemIds : null}::uuid[] IS NULL
              OR "itemId" = ANY(${filters.itemIds && filters.itemIds.length ? filters.itemIds : null}::uuid[]))
       GROUP BY "warehouseId", "itemId"
       ORDER BY "itemId", "warehouseId"
    `);

    const warehouseIds = [...new Set(rows.map((row) => row.warehouseId).filter((id): id is string => !!id))];
    const warehouses = warehouseIds.length
      ? await this.prisma.warehouse.findMany({
          where: { id: { in: warehouseIds }, companyId },
          select: { id: true, code: true, nameEn: true, nameAr: true },
        })
      : [];
    const nameOf = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));

    const byItem = new Map<
      string,
      Array<{ warehouseId: string | null; code: string | null; nameEn: string | null; nameAr: string | null; quantity: string }>
    >();
    for (const row of rows) {
      const warehouse = row.warehouseId ? nameOf.get(row.warehouseId) : null;
      const entry = {
        warehouseId: row.warehouseId,
        code: warehouse?.code ?? null,
        nameEn: warehouse?.nameEn ?? null,
        nameAr: warehouse?.nameAr ?? null,
        quantity: new Prisma.Decimal(String(row.quantity ?? 0)).toFixed(MONEY_SCALE),
      };
      const list = byItem.get(row.itemId) ?? [];
      list.push(entry);
      byItem.set(row.itemId, list);
    }

    return [...byItem.entries()].map(([itemId, warehousesOfItem]) => ({
      itemId,
      warehouses: warehousesOfItem,
      total: warehousesOfItem
        .reduce((sum, entry) => sum.add(new Prisma.Decimal(entry.quantity)), new Prisma.Decimal(0))
        .toFixed(MONEY_SCALE),
    }));
  }

  async itemLedger(companyId: string, itemId: string) {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, companyId, deletedAt: null },
      select: { id: true, code: true, nameEn: true, nameAr: true, unit: true },
    });
    if (!item) throw new NotFoundException('Item not found');

    const movements = await this.prisma.stockMovement.findMany({
      where: { companyId, itemId },
      orderBy: [{ movementDate: 'asc' }, { createdAt: 'asc' }],
      include: {
        branch: { select: { code: true } },
        warehouse: { select: { code: true, nameEn: true, nameAr: true } },
      },
    });

    let runningQty = new Prisma.Decimal(0);
    let runningValue = new Prisma.Decimal(0);

    return {
      item,
      movements: movements.map((m) => {
        const signedQty = m.direction === 'IN' ? m.quantity : m.quantity.negated();
        const signedValue = m.direction === 'IN' ? m.totalCost : m.totalCost.negated();
        runningQty = runningQty.plus(signedQty);
        runningValue = runningValue.plus(signedValue);

        return {
          id: m.id,
          // `date` is the key consumed by the stock-card screen; keep the
          // explicit name too for clients that use the API directly.
          date: m.movementDate.toISOString().slice(0, 10),
          movementDate: m.movementDate.toISOString().slice(0, 10),
          direction: m.direction.toLowerCase(),
          branchCode: m.branch.code,
          warehouseCode: m.warehouse?.code ?? null,
          warehouseNameEn: m.warehouse?.nameEn ?? null,
          warehouseNameAr: m.warehouse?.nameAr ?? null,
          quantity: m.quantity.toFixed(MONEY_SCALE),
          unitCost: m.unitCost.toFixed(MONEY_SCALE),
          totalCost: m.totalCost.toFixed(MONEY_SCALE),
          referenceType: m.referenceType,
          referenceNumber: m.referenceNumber,
          notes: m.notes,
          runningQuantity: runningQty.toFixed(MONEY_SCALE),
          runningValue: runningValue.toFixed(MONEY_SCALE),
        };
      }),
    };
  }
}
