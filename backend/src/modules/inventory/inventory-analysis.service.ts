import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { WarehouseScope } from '../../common/warehouse/warehouse.service';

const MONEY_SCALE = 4;

export interface ReportFilter {
  from?: string;
  to?: string;
  warehouseId?: string;
  branchId?: string;
  itemId?: string;
  categoryId?: string;
  days?: number;
  limit?: number;
}

/// The reports a warehouse manager asks for, answered from the books.
///
/// Every one of them reads the same two sources - the movements and the
/// per-warehouse balance - so a figure on the item card and the same figure on
/// the valuation report are the same number, not two calculations that happen
/// to agree today.
@Injectable()
export class InventoryAnalysisService {
  constructor(private readonly prisma: PrismaService) {}

  /// The list the screen offers, with the filters each report understands.
  catalogue() {
    return {
      reports: [
        { slug: 'item-card', titleEn: 'Item card', titleAr: 'بطاقة الصنف', filters: ['itemId', 'warehouseId', 'from', 'to'] },
        { slug: 'item-movement', titleEn: 'Item movement', titleAr: 'حركة الصنف', filters: ['itemId', 'warehouseId', 'from', 'to'] },
        { slug: 'balance-by-warehouse', titleEn: 'Balance by warehouse', titleAr: 'الرصيد حسب المخزن', filters: ['warehouseId', 'itemId', 'categoryId'] },
        { slug: 'balance-by-branch', titleEn: 'Balance by branch', titleAr: 'الرصيد حسب الفرع', filters: ['branchId', 'itemId'] },
        { slug: 'valuation-by-warehouse', titleEn: 'Valuation by warehouse', titleAr: 'تقييم المخزون لكل مخزن', filters: ['warehouseId'] },
        { slug: 'below-minimum', titleEn: 'Below minimum', titleAr: 'تحت الحد الأدنى', filters: ['warehouseId'] },
        { slug: 'above-maximum', titleEn: 'Above maximum', titleAr: 'فوق الحد الأقصى', filters: ['warehouseId'] },
        { slug: 'slow-moving', titleEn: 'Slow moving', titleAr: 'بطيئة الحركة', filters: ['days', 'warehouseId'] },
        { slug: 'dead-stock', titleEn: 'Dead stock', titleAr: 'راكدة', filters: ['days', 'warehouseId'] },
        { slug: 'zero-stock', titleEn: 'Zero balance', titleAr: 'أصناف بصفر رصيد', filters: ['warehouseId'] },
        { slug: 'lots', titleEn: 'Lots', titleAr: 'تقرير الدفعات', filters: ['itemId', 'warehouseId', 'from', 'to'] },
        { slug: 'expiring', titleEn: 'Expiring soon', titleAr: 'قرب انتهاء الصلاحية', filters: ['days', 'warehouseId'] },
        { slug: 'expired', titleEn: 'Expired', titleAr: 'منتهي الصلاحية', filters: ['warehouseId'] },
        { slug: 'value-at-risk', titleEn: 'Value at risk', titleAr: 'القيمة المعرضة للخطر', filters: ['days', 'warehouseId'] },
        { slug: 'write-offs', titleEn: 'Write-offs and scrap', titleAr: 'الهالك والإعدام', filters: ['from', 'to', 'warehouseId'] },
        { slug: 'transfers', titleEn: 'Transfers', titleAr: 'التحويلات', filters: ['from', 'to', 'warehouseId'] },
        { slug: 'count-variances', titleEn: 'Count variances', titleAr: 'فروق الجرد', filters: ['from', 'to', 'warehouseId'] },
        { slug: 'cost-by-warehouse', titleEn: 'Warehouse cost report', titleAr: 'تقرير تكلفة المخزون', filters: ['warehouseId'] },
        { slug: 'reconciliation', titleEn: 'Stock against the ledger', titleAr: 'مطابقة المخزون مع الحسابات', filters: ['branchId'] },
        { slug: 'audit-trail', titleEn: 'Inventory audit trail', titleAr: 'سجل تدقيق المخزون', filters: ['from', 'to'] },
      ],
    };
  }

  async run(slug: string, companyId: string, filter: ReportFilter, scope: WarehouseScope = null) {
    switch (slug) {
      case 'item-card':
        return this.itemCard(companyId, filter, scope);
      case 'item-movement':
        return this.itemMovement(companyId, filter, scope);
      case 'balance-by-warehouse':
        return this.balanceByWarehouse(companyId, filter, scope);
      case 'balance-by-branch':
        return this.balanceByBranch(companyId, filter, scope);
      case 'valuation-by-warehouse':
        return this.valuationByWarehouse(companyId, filter, scope);
      case 'below-minimum':
        return this.thresholds(companyId, filter, scope, 'below');
      case 'above-maximum':
        return this.thresholds(companyId, filter, scope, 'above');
      case 'slow-moving':
        return this.idle(companyId, filter, scope, false);
      case 'dead-stock':
        return this.idle(companyId, filter, scope, true);
      case 'zero-stock':
        return this.zeroStock(companyId, filter, scope);
      case 'lots':
        return this.lots(companyId, filter, scope, null);
      case 'expiring':
        return this.lots(companyId, filter, scope, 'EXPIRING');
      case 'expired':
        return this.lots(companyId, filter, scope, 'EXPIRED');
      case 'value-at-risk':
        return this.lots(companyId, filter, scope, 'EXPIRING', true);
      case 'write-offs':
        return this.documents(companyId, filter, scope, 'WRITE_OFF');
      case 'transfers':
        return this.documents(companyId, filter, scope, 'TRANSFER');
      case 'count-variances':
        return this.documents(companyId, filter, scope, 'COUNT');
      case 'cost-by-warehouse':
        return this.costByWarehouse(companyId, filter, scope);
      case 'reconciliation':
        return this.reconciliation(companyId, filter, scope);
      case 'audit-trail':
        return this.auditTrail(companyId, filter);
      default:
        throw new BadRequestException(`Unknown report: ${slug}`);
    }
  }

  // ────────────────────────────────────────────────────────────── readings

  private async itemCard(companyId: string, filter: ReportFilter, scope: WarehouseScope) {
    if (!filter.itemId) throw new BadRequestException('The item card needs an item.');
    const from = this.date(filter.from) ?? new Date('2000-01-01T00:00:00.000Z');
    const to = this.date(filter.to) ?? new Date();
    const rows = await this.prisma.stockMovement.findMany({
      where: {
        companyId,
        itemId: filter.itemId,
        movementDate: { gte: from, lte: to },
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...(scope !== null ? { branchId: { in: scope } } : {}),
      },
      orderBy: [{ movementDate: 'asc' }, { createdAt: 'asc' }],
      take: Math.min(filter.limit ?? 1000, 5000),
      include: { warehouse: { select: { code: true } }, batch: { select: { batchNumber: true } } },
    });

    // The opening balance is everything before the first day of the window,
    // so the running card starts where the period starts rather than at zero.
    const opening = await this.prisma.$queryRaw<
      Array<{ quantity: Prisma.Decimal; value: Prisma.Decimal }>
    >(Prisma.sql`
      SELECT COALESCE(SUM(CASE WHEN "direction" = 'IN' THEN "quantity" ELSE -"quantity" END), 0) AS "quantity",
             COALESCE(SUM(CASE WHEN "direction" = 'IN' THEN "totalCost" ELSE -"totalCost" END), 0) AS "value"
        FROM "stock_movements"
       WHERE "companyId" = ${companyId}::uuid
         AND "itemId" = ${filter.itemId}::uuid
         AND "movementDate" < ${from.toISOString().slice(0, 10)}::date
         ${filter.warehouseId ? Prisma.sql`AND "warehouseId" = ${filter.warehouseId}::uuid` : Prisma.empty}
    `);
    let runningQuantity = new Prisma.Decimal(opening[0]?.quantity ?? 0);
    let runningValue = new Prisma.Decimal(opening[0]?.value ?? 0);

    const lines = rows.map((row) => {
      const signed = row.direction === 'IN' ? row.quantity : row.quantity.negated();
      const signedValue = row.direction === 'IN' ? row.totalCost : row.totalCost.negated();
      runningQuantity = runningQuantity.plus(signed);
      runningValue = runningValue.plus(signedValue);
      return {
        date: row.movementDate,
        reference: row.referenceNumber,
        type: row.referenceType,
        direction: row.direction,
        warehouse: row.warehouse?.code ?? null,
        batchNumber: row.batch?.batchNumber ?? null,
        quantityIn: row.direction === 'IN' ? row.quantity.toFixed(MONEY_SCALE) : null,
        quantityOut: row.direction === 'OUT' ? row.quantity.toFixed(MONEY_SCALE) : null,
        unitCost: row.unitCost.toFixed(MONEY_SCALE),
        value: signedValue.toFixed(MONEY_SCALE),
        balanceQuantity: runningQuantity.toFixed(MONEY_SCALE),
        balanceValue: runningValue.toFixed(MONEY_SCALE),
      };
    });

    return {
      slug: 'item-card',
      opening: {
        quantity: new Prisma.Decimal(opening[0]?.quantity ?? 0).toFixed(MONEY_SCALE),
        value: new Prisma.Decimal(opening[0]?.value ?? 0).toFixed(MONEY_SCALE),
      },
      closing: {
        quantity: runningQuantity.toFixed(MONEY_SCALE),
        value: runningValue.toFixed(MONEY_SCALE),
      },
      rows: lines,
      rowCount: lines.length,
    };
  }

  private async itemMovement(companyId: string, filter: ReportFilter, scope: WarehouseScope) {
    const rows = await this.prisma.stockMovement.findMany({
      where: {
        companyId,
        ...(filter.itemId ? { itemId: filter.itemId } : {}),
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...(scope !== null ? { branchId: { in: scope } } : {}),
        ...this.rangeWhere(filter),
      },
      orderBy: [{ movementDate: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(filter.limit ?? 500, 2000),
      include: {
        item: { select: { code: true, nameEn: true, nameAr: true } },
        warehouse: { select: { code: true } },
      },
    });
    return {
      slug: 'item-movement',
      rows: rows.map((row) => ({
        date: row.movementDate,
        itemCode: row.item.code,
        itemNameEn: row.item.nameEn,
        itemNameAr: row.item.nameAr,
        warehouse: row.warehouse?.code ?? null,
        direction: row.direction,
        quantity: row.quantity.toFixed(MONEY_SCALE),
        unitCost: row.unitCost.toFixed(MONEY_SCALE),
        value: row.totalCost.toFixed(MONEY_SCALE),
        reference: row.referenceNumber,
        type: row.referenceType,
      })),
      rowCount: rows.length,
    };
  }

  private async balanceByWarehouse(companyId: string, filter: ReportFilter, scope: WarehouseScope) {
    const rows = await this.prisma.warehouseStockBalance.findMany({
      where: {
        companyId,
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...(filter.itemId ? { itemId: filter.itemId } : {}),
        ...(filter.categoryId ? { item: { categoryId: filter.categoryId } } : {}),
        ...(scope !== null ? { branchId: { in: scope } } : {}),
        quantity: { not: 0 },
      },
      orderBy: [{ warehouseId: 'asc' }, { itemId: 'asc' }],
      take: 5000,
      include: {
        item: { select: { code: true, nameEn: true, nameAr: true, unit: true } },
        warehouse: { select: { code: true, nameEn: true, nameAr: true } },
      },
    });
    return {
      slug: 'balance-by-warehouse',
      rows: rows.map((row) => ({
        warehouseCode: row.warehouse.code,
        warehouseNameEn: row.warehouse.nameEn,
        warehouseNameAr: row.warehouse.nameAr,
        itemCode: row.item.code,
        itemNameEn: row.item.nameEn,
        itemNameAr: row.item.nameAr,
        unit: row.item.unit,
        quantity: row.quantity.toFixed(MONEY_SCALE),
        averageCost: row.quantity.isZero()
          ? '0.0000'
          : row.value.div(row.quantity).toFixed(MONEY_SCALE),
        value: row.value.toFixed(MONEY_SCALE),
      })),
      totals: { value: this.sum(rows.map((row) => row.value)).toFixed(MONEY_SCALE) },
      rowCount: rows.length,
    };
  }

  private async balanceByBranch(companyId: string, filter: ReportFilter, scope: WarehouseScope) {
    const rows = await this.prisma.stockBalance.findMany({
      where: {
        companyId,
        ...(filter.branchId ? { branchId: filter.branchId } : {}),
        ...(filter.itemId ? { itemId: filter.itemId } : {}),
        ...(scope !== null ? { branchId: { in: scope } } : {}),
        quantity: { not: 0 },
      },
      take: 5000,
      include: {
        item: { select: { code: true, nameEn: true, nameAr: true, unit: true } },
        branch: { select: { code: true, nameEn: true } },
      },
    });
    return {
      slug: 'balance-by-branch',
      rows: rows.map((row) => ({
        branchCode: row.branch.code,
        branchNameEn: row.branch.nameEn,
        itemCode: row.item.code,
        itemNameEn: row.item.nameEn,
        itemNameAr: row.item.nameAr,
        quantity: row.quantity.toFixed(MONEY_SCALE),
        value: row.value.toFixed(MONEY_SCALE),
      })),
      totals: { value: this.sum(rows.map((row) => row.value)).toFixed(MONEY_SCALE) },
      rowCount: rows.length,
    };
  }

  /// The report the whole per-warehouse cost book exists to make possible.
  private async valuationByWarehouse(companyId: string, filter: ReportFilter, scope: WarehouseScope) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        warehouseId: string;
        warehouseCode: string;
        warehouseNameEn: string;
        warehouseNameAr: string;
        lines: bigint;
        quantity: Prisma.Decimal;
        value: Prisma.Decimal;
      }>
    >(Prisma.sql`
      SELECT w."id" AS "warehouseId", w."code" AS "warehouseCode",
             w."nameEn" AS "warehouseNameEn", w."nameAr" AS "warehouseNameAr",
             COUNT(*) AS "lines",
             SUM(b."quantity") AS "quantity",
             SUM(b."value") AS "value"
        FROM "warehouse_stock_balances" b
        JOIN "warehouses" w ON w."id" = b."warehouseId"
       WHERE b."companyId" = ${companyId}::uuid
         AND w."deletedAt" IS NULL
         ${filter.warehouseId ? Prisma.sql`AND b."warehouseId" = ${filter.warehouseId}::uuid` : Prisma.empty}
         ${scope !== null ? Prisma.sql`AND b."branchId" = ANY(${scope}::uuid[])` : Prisma.empty}
       GROUP BY w."id", w."code", w."nameEn", w."nameAr"
       ORDER BY w."code"
    `);
    return {
      slug: 'valuation-by-warehouse',
      rows: rows.map((row) => ({
        warehouseId: row.warehouseId,
        warehouseCode: row.warehouseCode,
        warehouseNameEn: row.warehouseNameEn,
        warehouseNameAr: row.warehouseNameAr,
        itemCount: Number(row.lines),
        quantity: new Prisma.Decimal(row.quantity).toFixed(MONEY_SCALE),
        value: new Prisma.Decimal(row.value).toFixed(MONEY_SCALE),
      })),
      totals: {
        value: this.sum(rows.map((row) => new Prisma.Decimal(row.value))).toFixed(MONEY_SCALE),
      },
      rowCount: rows.length,
    };
  }

  private async thresholds(
    companyId: string,
    filter: ReportFilter,
    scope: WarehouseScope,
    side: 'below' | 'above',
  ) {
    const settings = await this.prisma.itemWarehouseSetting.findMany({
      where: {
        companyId,
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...(scope !== null ? { warehouse: { branchId: { in: scope } } } : {}),
        OR: [{ minQuantity: { gt: 0 } }, { maxQuantity: { gt: 0 } }],
      },
      take: 5000,
      include: {
        item: { select: { code: true, nameEn: true, nameAr: true, unit: true } },
        warehouse: { select: { code: true } },
      },
    });
    const balances = await this.prisma.warehouseStockBalance.findMany({
      where: { companyId, warehouseId: { in: [...new Set(settings.map((row) => row.warehouseId))] } },
      select: { warehouseId: true, itemId: true, quantity: true },
    });
    const at = new Map(
      balances.map((row) => [`${row.warehouseId}:${row.itemId}`, new Prisma.Decimal(row.quantity)]),
    );
    type Row = { setting: (typeof settings)[number]; onHand: Prisma.Decimal };
    const rows = settings
      .map<Row>((setting) => {
        const onHand = at.get(`${setting.warehouseId}:${setting.itemId}`) ?? new Prisma.Decimal(0);
        return { setting, onHand };
      })
      .filter(({ setting, onHand }: Row) =>
        side === 'below'
          ? setting.minQuantity.greaterThan(0) && onHand.lessThanOrEqualTo(setting.minQuantity)
          : setting.maxQuantity.greaterThan(0) && onHand.greaterThan(setting.maxQuantity),
      )
      .map(({ setting, onHand }) => ({
        warehouseCode: setting.warehouse.code,
        itemCode: setting.item.code,
        itemNameEn: setting.item.nameEn,
        itemNameAr: setting.item.nameAr,
        unit: setting.item.unit,
        onHand: onHand.toFixed(MONEY_SCALE),
        minimum: setting.minQuantity.toFixed(MONEY_SCALE),
        reorder: setting.reorderQuantity.toFixed(MONEY_SCALE),
        maximum: setting.maxQuantity.toFixed(MONEY_SCALE),
        shortage: side === 'below'
          ? setting.reorderQuantity.minus(onHand).toFixed(MONEY_SCALE)
          : '0.0000',
      }));
    return {
      slug: side === 'below' ? 'below-minimum' : 'above-maximum',
      rows,
      rowCount: rows.length,
    };
  }

  /// Stock that has not moved for `days`. Dead stock is the same question with
  /// a longer window, so it is the same query with a bigger number.
  private async idle(
    companyId: string,
    filter: ReportFilter,
    scope: WarehouseScope,
    dead: boolean,
  ) {
    const days = Math.max(filter.days ?? (dead ? 180 : 90), 1);
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.$queryRaw<
      Array<{
        warehouseCode: string;
        itemCode: string;
        nameEn: string;
        nameAr: string;
        quantity: Prisma.Decimal;
        value: Prisma.Decimal;
        lastMovement: Date | null;
      }>
    >(Prisma.sql`
      SELECT w."code" AS "warehouseCode", i."code" AS "itemCode",
             i."nameEn", i."nameAr", b."quantity", b."value",
             (SELECT MAX(m."movementDate") FROM "stock_movements" m
               WHERE m."companyId" = b."companyId"
                 AND m."warehouseId" = b."warehouseId"
                 AND m."itemId" = b."itemId") AS "lastMovement"
        FROM "warehouse_stock_balances" b
        JOIN "warehouses" w ON w."id" = b."warehouseId"
        JOIN "items" i ON i."id" = b."itemId"
       WHERE b."companyId" = ${companyId}::uuid
         AND b."quantity" > 0
         ${filter.warehouseId ? Prisma.sql`AND b."warehouseId" = ${filter.warehouseId}::uuid` : Prisma.empty}
         ${scope !== null ? Prisma.sql`AND b."branchId" = ANY(${scope}::uuid[])` : Prisma.empty}
         AND NOT EXISTS (
           SELECT 1 FROM "stock_movements" m2
            WHERE m2."companyId" = b."companyId"
              AND m2."warehouseId" = b."warehouseId"
              AND m2."itemId" = b."itemId"
              AND m2."movementDate" >= ${cutoff.toISOString().slice(0, 10)}::date
         )
       ORDER BY b."value" DESC
       LIMIT 2000
    `);
    return {
      slug: dead ? 'dead-stock' : 'slow-moving',
      filters: { days, since: cutoff.toISOString().slice(0, 10) },
      rows: rows.map((row) => ({
        warehouseCode: row.warehouseCode,
        itemCode: row.itemCode,
        itemNameEn: row.nameEn,
        itemNameAr: row.nameAr,
        quantity: new Prisma.Decimal(row.quantity).toFixed(MONEY_SCALE),
        value: new Prisma.Decimal(row.value).toFixed(MONEY_SCALE),
        lastMovement: row.lastMovement,
      })),
      totals: {
        value: this.sum(rows.map((row) => new Prisma.Decimal(row.value))).toFixed(MONEY_SCALE),
      },
      rowCount: rows.length,
    };
  }

  private async zeroStock(companyId: string, filter: ReportFilter, scope: WarehouseScope) {
    const items = await this.prisma.item.findMany({
      where: {
        companyId,
        deletedAt: null,
        isActive: true,
        isStockTracked: true,
        ...(scope !== null ? {} : {}),
      },
      take: 5000,
      select: { id: true, code: true, nameEn: true, nameAr: true, unit: true },
    });
    const rows = await this.prisma.stockBalance.findMany({
      where: { companyId, quantity: { not: 0 }, ...(scope !== null ? { branchId: { in: scope } } : {}) },
      select: { itemId: true },
    });
    const held = new Set(rows.map((row) => row.itemId));
    const empty = items.filter((item) => !held.has(item.id));
    return {
      slug: 'zero-stock',
      rows: empty.map((item) => ({
        itemCode: item.code,
        itemNameEn: item.nameEn,
        itemNameAr: item.nameAr,
        unit: item.unit,
      })),
      rowCount: empty.length,
    };
  }

  private async lots(
    companyId: string,
    filter: ReportFilter,
    scope: WarehouseScope,
    mode: 'EXPIRING' | 'EXPIRED' | null,
    valueOnly = false,
  ) {
    const days = Math.max(filter.days ?? 90, 1);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const horizon = new Date(today.getTime() + days * 86_400_000);
    const lots = await this.prisma.itemBatch.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(filter.itemId ? { itemId: filter.itemId } : {}),
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...(scope !== null ? { warehouse: { branchId: { in: scope } } } : {}),
        remainingQuantity: { gt: 0 },
        ...(mode === 'EXPIRED'
          ? { expiryDate: { lt: today } }
          : mode === 'EXPIRING'
            ? { expiryDate: { gte: today, lte: horizon } }
            : {}),
      },
      take: 5000,
      orderBy: { expiryDate: 'asc' },
      include: {
        item: { select: { code: true, nameEn: true, nameAr: true } },
        warehouse: { select: { code: true } },
      },
    });
    const rows = lots.map((lot) => {
      const value = lot.remainingQuantity.mul(lot.unitCost);
      const daysLeft = lot.expiryDate
        ? Math.floor((lot.expiryDate.getTime() - today.getTime()) / 86_400_000)
        : null;
      return {
        batchNumber: lot.batchNumber,
        itemCode: lot.item.code,
        itemNameEn: lot.item.nameEn,
        itemNameAr: lot.item.nameAr,
        warehouseCode: lot.warehouse.code,
        productionDate: lot.productionDate,
        expiryDate: lot.expiryDate,
        daysLeft,
        remainingQuantity: lot.remainingQuantity.toFixed(MONEY_SCALE),
        unitCost: lot.unitCost.toFixed(MONEY_SCALE),
        value: value.toFixed(MONEY_SCALE),
        status: lot.status,
      };
    });
    if (valueOnly) {
      const total = this.sum(lots.map((lot) => lot.remainingQuantity.mul(lot.unitCost)));
      return {
        slug: 'value-at-risk',
        filters: { days, horizon: horizon.toISOString().slice(0, 10) },
        rows,
        totals: { value: total.toFixed(MONEY_SCALE), lots: rows.length },
        rowCount: rows.length,
      };
    }
    return {
      slug: mode === 'EXPIRED' ? 'expired' : mode === 'EXPIRING' ? 'expiring' : 'lots',
      rows,
      totals: {
        value: this.sum(lots.map((lot) => lot.remainingQuantity.mul(lot.unitCost))).toFixed(
          MONEY_SCALE,
        ),
      },
      rowCount: rows.length,
    };
  }

  private async documents(
    companyId: string,
    filter: ReportFilter,
    scope: WarehouseScope,
    kind: 'WRITE_OFF' | 'TRANSFER' | 'COUNT',
  ) {
    const documents = await this.prisma.stockDocument.findMany({
      where: {
        companyId,
        kind: kind as never,
        deletedAt: null,
        ...(scope !== null ? { branchId: { in: scope } } : {}),
        ...this.rangeWhere(filter),
      },
      orderBy: { documentDate: 'desc' },
      take: 2000,
      include: {
        lines: {
          include: {
            item: { select: { code: true, nameEn: true } },
            batch: { select: { batchNumber: true, expiryDate: true } },
          },
        },
        fromWarehouse: { select: { code: true } },
        toWarehouse: { select: { code: true } },
      },
    });
    return {
      slug: kind === 'WRITE_OFF' ? 'write-offs' : kind === 'TRANSFER' ? 'transfers' : 'count-variances',
      rows: documents.map((document) => ({
        documentNumber: document.documentNumber,
        documentDate: document.documentDate,
        status: document.status,
        reason: document.reason,
        fromWarehouse: document.fromWarehouse?.code ?? null,
        toWarehouse: document.toWarehouse?.code ?? null,
        approvedBy: document.approvedBy,
        approvedAt: document.approvedAt,
        journalEntryId: document.journalEntryId,
        lines: document.lines.map((line) => ({
          itemCode: line.item.code,
          itemNameEn: line.item.nameEn,
          quantity: line.quantity.toFixed(MONEY_SCALE),
          unitCost: line.unitCost.toFixed(MONEY_SCALE),
          totalCost: line.totalCost.toFixed(MONEY_SCALE),
          batchNumber: line.batch?.batchNumber ?? null,
          countedQuantity: line.countedQuantity?.toFixed(MONEY_SCALE) ?? null,
        })),
        value: this.sum(document.lines.map((line) => line.totalCost)).toFixed(MONEY_SCALE),
      })),
      rowCount: documents.length,
    };
  }

  /// The average each shelf actually carries, with the value behind it.
  private async costByWarehouse(companyId: string, filter: ReportFilter, scope: WarehouseScope) {
    const rows = await this.prisma.warehouseStockBalance.findMany({
      where: {
        companyId,
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...(scope !== null ? { branchId: { in: scope } } : {}),
        quantity: { not: 0 },
      },
      take: 5000,
      include: {
        item: { select: { code: true, nameEn: true, nameAr: true, unit: true } },
        warehouse: { select: { code: true } },
      },
    });
    return {
      slug: 'cost-by-warehouse',
      rows: rows.map((row) => ({
        warehouseCode: row.warehouse.code,
        itemCode: row.item.code,
        itemNameEn: row.item.nameEn,
        itemNameAr: row.item.nameAr,
        unit: row.item.unit,
        quantity: row.quantity.toFixed(MONEY_SCALE),
        averageCost: row.value.div(row.quantity).toFixed(MONEY_SCALE),
        value: row.value.toFixed(MONEY_SCALE),
      })),
      totals: { value: this.sum(rows.map((row) => row.value)).toFixed(MONEY_SCALE) },
      rowCount: rows.length,
    };
  }

  /// Stock value against the inventory account in the general ledger.
  ///
  /// The point is not that the two totals are equal - VAT, landed cost and a
  /// period cut can make them differ by design - but that the difference is a
  /// number somebody can explain, branch by branch, instead of a surprise at
  /// year end.
  async reconciliation(companyId: string, filter: ReportFilter, scope: WarehouseScope) {
    const rows = await this.prisma.$queryRaw<
      Array<{ branchId: string; code: string; nameEn: string; nameAr: string; stock: Prisma.Decimal }>
    >(Prisma.sql`
      SELECT br."id" AS "branchId", br."code", br."nameEn", br."nameAr",
             COALESCE(SUM(b."value"), 0) AS "stock"
        FROM "branches" br
        LEFT JOIN "stock_balances" b
          ON b."branchId" = br."id" AND b."companyId" = br."companyId"
       WHERE br."companyId" = ${companyId}::uuid
         AND br."deletedAt" IS NULL
         ${filter.branchId ? Prisma.sql`AND br."id" = ${filter.branchId}::uuid` : Prisma.empty}
         ${scope !== null ? Prisma.sql`AND br."id" = ANY(${scope}::uuid[])` : Prisma.empty}
       GROUP BY br."id", br."code", br."nameEn", br."nameAr"
       ORDER BY br."code"
    `);

    const ledger = await this.prisma.$queryRaw<
      Array<{ branchId: string; balance: Prisma.Decimal }>
    >(Prisma.sql`
      SELECT jl."branchId",
             COALESCE(SUM(jl."debit" - jl."credit"), 0) AS "balance"
        FROM "journal_lines" jl
        JOIN "journal_entries" je ON je."id" = jl."journalEntryId"
        JOIN "accounts" a ON a."id" = jl."accountId"
       WHERE je."companyId" = ${companyId}::uuid
         AND je."status" <> 'DRAFT'
         AND a."code" = '1104'
       GROUP BY jl."branchId"
    `);
    const byBranch = new Map(ledger.map((row) => [row.branchId, new Prisma.Decimal(row.balance)]));

    const lines = rows.map((row) => {
      const stock = new Prisma.Decimal(row.stock);
      const book = byBranch.get(row.branchId) ?? new Prisma.Decimal(0);
      return {
        branchId: row.branchId,
        branchCode: row.code,
        branchNameEn: row.nameEn,
        branchNameAr: row.nameAr,
        stockValue: stock.toFixed(MONEY_SCALE),
        ledgerValue: book.toFixed(MONEY_SCALE),
        difference: stock.minus(book).toFixed(MONEY_SCALE),
        matched: stock.minus(book).abs().lessThan(new Prisma.Decimal('0.01')),
      };
    });
    return {
      slug: 'reconciliation',
      rows: lines,
      totals: {
        stockValue: this.sum(lines.map((line) => new Prisma.Decimal(line.stockValue))).toFixed(MONEY_SCALE),
        ledgerValue: this.sum(lines.map((line) => new Prisma.Decimal(line.ledgerValue))).toFixed(MONEY_SCALE),
      },
      rowCount: lines.length,
    };
  }

  private async auditTrail(companyId: string, filter: ReportFilter) {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        companyId,
        entity: {
          in: [
            'stock_documents',
            'item_batches',
            'stock_take_sessions',
            'user_warehouse_access',
            'items',
          ],
        },
        ...this.rangeWhere(filter),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(filter.limit ?? 500, 2000),
      include: { user: { select: { username: true } } },
    });
    return {
      slug: 'audit-trail',
      rows: logs.map((log) => ({
        at: log.createdAt,
        user: log.user?.username ?? null,
        action: log.action,
        entity: log.entity,
        entityId: log.entityId,
        details: log.afterJson ?? null,
      })),
      rowCount: logs.length,
    };
  }

  // ─────────────────────────────────────────────────────────────── helpers

  private rangeWhere(filter: ReportFilter) {
    const from = this.date(filter.from);
    const to = this.date(filter.to);
    const range: { gte?: Date; lte?: Date } = {};
    if (from) range.gte = from;
    if (to) {
      const end = new Date(to);
      end.setUTCHours(23, 59, 59, 999);
      range.lte = end;
    }
    return Object.keys(range).length > 0 ? { createdAt: range } : {};
  }

  private date(value?: string): Date | null {
    if (!value) return null;
    const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private sum(values: Prisma.Decimal[]): Prisma.Decimal {
    return values.reduce((total, value) => total.plus(value), new Prisma.Decimal(0));
  }
}
