import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanySettingsService } from '../../common/settings/company-settings.module';
import { isValidEan13, randomInternalBarcode } from './barcode';

const MONEY_SCALE = 4;

/**
 * Inventory reporting, and the item catalogue that feeds it.
 *
 * Every figure here is read from the stock ledger and the balances kept in
 * step with it, or from the cost recorded on the documents - never from a
 * price list someone typed once. A valuation report that agreed with a price
 * list rather than with the purchases would be worse than no report at all.
 */
@Injectable()
export class InventoryReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: CompanySettingsService,
  ) {}

  // ------------------------------------------------------------ categories

  async listCategories(companyId: string, includeInactive = false) {
    const items = await this.prisma.itemCategory.findMany({
      where: { companyId, deletedAt: null, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { code: 'asc' },
    });
    return { items, total: items.length };
  }

  async createCategory(companyId: string, userId: string, dto: Record<string, unknown>) {
    const code = String(dto.code ?? '').trim();
    const nameEn = String(dto.nameEn ?? '').trim();
    const nameAr = String(dto.nameAr ?? '').trim();
    if (!code || !nameEn || !nameAr) {
      throw new BadRequestException('code, nameEn and nameAr are required');
    }
    const existing = await this.prisma.itemCategory.findFirst({
      where: { companyId, code },
      select: { id: true, deletedAt: true },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException(`Category code ${code} is already used`);
    }
    const created = await this.prisma.itemCategory.create({
      data: { companyId, code, nameEn, nameAr, createdBy: userId, updatedBy: userId },
    });
    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'item_categories',
      entityId: created.id,
      after: { code, nameEn },
    });
    return created;
  }

  // ------------------------------------------------------------ item units

  async listUnits(companyId: string, itemId: string, mayReadCost = true) {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, companyId, deletedAt: null },
      select: { id: true, code: true, unit: true },
    });
    if (!item) throw new NotFoundException('Item not found');

    const units = await this.prisma.itemUnit.findMany({
      where: { itemId },
      orderBy: { factor: 'asc' },
    });
    return {
      item,
      items: units.map((unit) => ({
        id: unit.id,
        unit: unit.unit,
        factor: unit.factor.toFixed(6),
        barcode: unit.barcode,
        salePrice: unit.salePrice?.toFixed(MONEY_SCALE) ?? null,
        // Unit purchase prices are costs: redact for callers without cost.read.
        purchasePrice: mayReadCost
          ? unit.purchasePrice?.toFixed(MONEY_SCALE) ?? null
          : null,
        isBase: unit.unit === item.unit,
        // Multi-unit: inactive units stay readable on old documents but are
        // refused on new ones (resolveUnitSelection enforces that).
        isActive: unit.isActive,
        createdAt: unit.createdAt.toISOString(),
      })),
    };
  }

  /// Changes a unit's name, factor, prices or barcode.
  ///
  /// The base unit's factor stays 1: stock is kept in base units, and a base
  /// unit whose factor changed would silently re-value everything already on
  /// the shelf. A unit that is not the base unit can be re-factored, which is
  /// an honest correction of the conversion the item was set up with - it does
  /// not rewrite history, because past documents recorded their quantities in
  /// base units.
  async updateUnit(
    companyId: string,
    userId: string,
    itemId: string,
    unitId: string,
    dto: Record<string, unknown>,
    mayReadCost = true,
  ) {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, companyId, deletedAt: null },
      select: { id: true, code: true, unit: true },
    });
    if (!item) throw new NotFoundException('Item not found');

    const unit = await this.prisma.itemUnit.findFirst({
      where: { id: unitId, itemId },
    });
    if (!unit) throw new NotFoundException('Unit not found');
    const isBase = unit.unit === item.unit;

    const data: Record<string, unknown> = {};
    if (dto.unit !== undefined) {
      const name = String(dto.unit ?? '').trim();
      if (!name) throw new BadRequestException('unit is required');
      if (isBase && name !== item.unit) {
        throw new BadRequestException(
          'The base unit of an item cannot be renamed; add the new name as another unit instead.',
        );
      }
      const clash = await this.prisma.itemUnit.findFirst({
        where: { itemId, unit: name, id: { not: unitId } },
        select: { id: true },
      });
      if (clash) throw new ConflictException(`Item ${item.code} already has a unit called ${name}`);
      data.unit = name;
    }

    if (dto.factor !== undefined) {
      const factor = this.parseFactor(dto.factor);
      if (isBase && !factor.equals(1)) {
        throw new BadRequestException(`factor must be 1 for the base unit of ${item.code}`);
      }
      data.factor = factor;
    }

    if (dto.barcode !== undefined) {
      const barcode = String(dto.barcode ?? '').trim() || null;
      if (barcode) await this.assertBarcodeFree(companyId, barcode, itemId, unitId);
      data.barcode = barcode;
    }

    for (const key of ['salePrice', 'purchasePrice'] as const) {
      if (dto[key] === undefined) continue;
      if (dto[key] === null || dto[key] === '') {
        data[key] = null;
        continue;
      }
      try {
        const value = new Prisma.Decimal(String(dto[key])).toDecimalPlaces(MONEY_SCALE);
        if (value.isNegative()) throw new Error('negative');
        data[key] = value;
      } catch {
        throw new BadRequestException(`${key} is not a valid amount`);
      }
    }

    const updated = await this.prisma.itemUnit.update({ where: { id: unitId }, data });
    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'item_units',
      entityId: unitId,
      before: { item: item.code, unit: unit.unit, factor: unit.factor.toFixed(6), barcode: unit.barcode },
      after: {
        item: item.code,
        unit: updated.unit,
        factor: updated.factor.toFixed(6),
        barcode: updated.barcode,
      },
    });
    return this.listUnits(companyId, itemId, mayReadCost);
  }

  /// Removes a unit.
  ///
  /// The base unit is not removable: it is what the stock ledger counts in.
  /// A unit that a saved document already names (its frozen snapshot stores
  /// the label) is never hard-deleted - it is deactivated instead, so old
  /// documents still name a unit that exists while new documents refuse it.
  /// Only a unit referenced by no document is actually deleted.
  async removeUnit(
    companyId: string,
    userId: string,
    itemId: string,
    unitId: string,
    mayReadCost = true,
  ) {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, companyId, deletedAt: null },
      select: { id: true, code: true, unit: true },
    });
    if (!item) throw new NotFoundException('Item not found');

    const unit = await this.prisma.itemUnit.findFirst({ where: { id: unitId, itemId } });
    if (!unit) throw new NotFoundException('Unit not found');
    if (unit.unit === item.unit || unit.factor.equals(1)) {
      throw new BadRequestException(
        'The base unit cannot be removed; it is the unit stock is counted in.',
      );
    }

    if (await this.unitIsReferenced(itemId, unit.unit)) {
      const updated = await this.prisma.itemUnit.update({
        where: { id: unitId },
        data: { isActive: false },
      });
      await this.audit.record({
        companyId,
        userId,
        action: 'DEACTIVATE',
        entity: 'item_units',
        entityId: unitId,
        before: { item: item.code, unit: unit.unit, isActive: true },
        after: { item: item.code, unit: updated.unit, isActive: false },
      });
      return { ...(await this.listUnits(companyId, itemId, mayReadCost)), deactivated: true };
    }

    await this.prisma.itemUnit.delete({ where: { id: unitId } });
    await this.audit.record({
      companyId,
      userId,
      action: 'DELETE',
      entity: 'item_units',
      entityId: unitId,
      before: { item: item.code, unit: unit.unit, factor: unit.factor.toFixed(6) },
    });
    return { ...(await this.listUnits(companyId, itemId, mayReadCost)), deactivated: false };
  }

  /// Deactivates a unit without deleting it. The factor-1 base unit is always
  /// active because stock itself is counted in it.
  async deactivateUnit(
    companyId: string,
    userId: string,
    itemId: string,
    unitId: string,
    mayReadCost = true,
  ) {
    const { item, unit } = await this.requireOwnedUnit(companyId, itemId, unitId);
    if (unit.factor.equals(1) || unit.unit === item.unit) {
      throw new BadRequestException('The base unit cannot be deactivated.');
    }
    if (!unit.isActive) return this.listUnits(companyId, itemId, mayReadCost);
    await this.prisma.itemUnit.update({ where: { id: unitId }, data: { isActive: false } });
    await this.audit.record({
      companyId,
      userId,
      action: 'DEACTIVATE',
      entity: 'item_units',
      entityId: unitId,
      before: { item: item.code, unit: unit.unit, isActive: true },
      after: { item: item.code, unit: unit.unit, isActive: false },
    });
    return this.listUnits(companyId, itemId, mayReadCost);
  }

  /// Reactivates a previously deactivated unit so it can be chosen again.
  async reactivateUnit(
    companyId: string,
    userId: string,
    itemId: string,
    unitId: string,
    mayReadCost = true,
  ) {
    const { item, unit } = await this.requireOwnedUnit(companyId, itemId, unitId);
    await this.prisma.itemUnit.update({ where: { id: unitId }, data: { isActive: true } });
    await this.audit.record({
      companyId,
      userId,
      action: 'REACTIVATE',
      entity: 'item_units',
      entityId: unitId,
      before: { item: item.code, unit: unit.unit, isActive: unit.isActive },
      after: { item: item.code, unit: unit.unit, isActive: true },
    });
    return this.listUnits(companyId, itemId, mayReadCost);
  }

  private async requireOwnedUnit(companyId: string, itemId: string, unitId: string) {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, companyId, deletedAt: null },
      select: { id: true, code: true, unit: true },
    });
    if (!item) throw new NotFoundException('Item not found');
    const unit = await this.prisma.itemUnit.findFirst({ where: { id: unitId, itemId } });
    if (!unit) throw new NotFoundException('Unit not found');
    return { item, unit };
  }

  /// True once any saved document line names this unit. Document lines keep a
  /// frozen unitName snapshot rather than a foreign key, so usage is checked
  /// by label across every document kind that carries unit snapshots.
  private async unitIsReferenced(itemId: string, unitName: string): Promise<boolean> {
    const common = { where: { itemId, unitName } };
    const [sales, purchases, stock, purchaseOrders, salesOrders] = await Promise.all([
      this.prisma.salesInvoiceLine.count(common),
      this.prisma.purchaseInvoiceLine.count(common),
      this.prisma.stockDocumentLine.count(common),
      this.prisma.purchaseOrderLine.count(common),
      this.prisma.salesOrderLine.count(common),
    ]);
    return sales + purchases + stock + purchaseOrders + salesOrders > 0;
  }

  /// A code for this unit alone, generated or supplied, unique in the company.
  async assignUnitBarcode(
    companyId: string,
    userId: string,
    itemId: string,
    unitId: string,
    requested: string | null | undefined,
    mayReadCost = true,
  ) {
    const unit = await this.prisma.itemUnit.findFirst({
      where: { id: unitId, item: { id: itemId, companyId, deletedAt: null } },
      include: { item: { select: { code: true } } },
    });
    if (!unit) throw new NotFoundException('Unit not found');

    let barcode = String(requested ?? '').trim();
    if (barcode) {
      if (barcode.length > 60) throw new BadRequestException('barcode cannot be longer than 60 characters');
      await this.assertBarcodeFree(companyId, barcode, itemId, unitId);
    } else {
      for (let attempt = 0; attempt < 20 && !barcode; attempt += 1) {
        const candidate = randomInternalBarcode();
        if (!isValidEan13(candidate)) continue;
        const taken = await this.barcodeTaken(companyId, candidate, itemId, unitId);
        if (!taken) barcode = candidate;
      }
      if (!barcode) {
        throw new ConflictException('Could not generate a free internal barcode; enter one by hand');
      }
    }

    await this.prisma.itemUnit.update({ where: { id: unitId }, data: { barcode } });
    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'item_units',
      entityId: unitId,
      before: { item: unit.item.code, unit: unit.unit, barcode: unit.barcode },
      after: { item: unit.item.code, unit: unit.unit, barcode },
    });
    return this.listUnits(companyId, itemId, mayReadCost);
  }

  private parseFactor(value: unknown): Prisma.Decimal {
    let factor: Prisma.Decimal;
    try {
      factor = new Prisma.Decimal(String(value ?? '0')).toDecimalPlaces(6);
    } catch {
      throw new BadRequestException('factor is not a valid number');
    }
    if (factor.lessThanOrEqualTo(0)) {
      throw new BadRequestException('factor must be greater than zero');
    }
    return factor;
  }

  private async barcodeTaken(
    companyId: string,
    barcode: string,
    itemId: string | null,
    unitId: string | null,
  ) {
    const [item, unit] = await Promise.all([
      this.prisma.item.findFirst({
        where: { companyId, barcode, deletedAt: null, ...(itemId ? { id: { not: itemId } } : {}) },
        select: { id: true },
      }),
      this.prisma.itemUnit.findFirst({
        where: {
          barcode,
          ...(unitId ? { id: { not: unitId } } : {}),
          item: { companyId, deletedAt: null, ...(itemId ? { id: { not: itemId } } : {}) },
        },
        select: { id: true },
      }),
    ]);
    return Boolean(item || unit);
  }

  private async assertBarcodeFree(
    companyId: string,
    barcode: string,
    itemId: string | null,
    unitId: string | null,
  ) {
    const [item, unit] = await Promise.all([
      this.prisma.item.findFirst({
        where: { companyId, barcode, deletedAt: null, ...(itemId ? { id: { not: itemId } } : {}) },
        select: { code: true },
      }),
      this.prisma.itemUnit.findFirst({
        where: {
          barcode,
          ...(unitId ? { id: { not: unitId } } : {}),
          item: { companyId, deletedAt: null, ...(itemId ? { id: { not: itemId } } : {}) },
        },
        include: { item: { select: { code: true } } },
      }),
    ]);
    if (item) throw new ConflictException(`Barcode ${barcode} is already assigned to item ${item.code}`);
    if (unit) {
      throw new ConflictException(
        `Barcode ${barcode} is already assigned to unit ${unit.unit} of item ${unit.item.code}`,
      );
    }
  }

  /// Adds a unit and the factor that converts it to the item's base unit.
  /// The base unit itself is always 1 - a conversion that contradicts that
  /// would make the stock ledger ambiguous.
  async addUnit(
    companyId: string,
    userId: string,
    itemId: string,
    dto: Record<string, unknown>,
    mayReadCost = true,
  ) {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, companyId, deletedAt: null },
      select: { id: true, unit: true, code: true },
    });
    if (!item) throw new NotFoundException('Item not found');

    const unit = String(dto.unit ?? '').trim();
    if (!unit) throw new BadRequestException('unit is required');

    let factor: Prisma.Decimal;
    try {
      factor = new Prisma.Decimal(String(dto.factor ?? '0')).toDecimalPlaces(6);
    } catch {
      throw new BadRequestException('factor is not a valid number');
    }
    if (factor.lessThanOrEqualTo(0)) {
      throw new BadRequestException('factor must be greater than zero');
    }
    if (unit === item.unit && !factor.equals(1)) {
      throw new BadRequestException(
        `factor must be 1 for the base unit of ${item.code}`,
      );
    }

    const barcode = String(dto.barcode ?? '').trim() || null;
    if (barcode) {
      const [itemBarcode, unitBarcode] = await Promise.all([
        this.prisma.item.findFirst({
          where: { companyId, barcode, deletedAt: null },
          select: { id: true, code: true },
        }),
        this.prisma.itemUnit.findFirst({
          where: { barcode, item: { companyId, deletedAt: null } },
          include: { item: { select: { code: true } } },
        }),
      ]);
      if (itemBarcode) {
        throw new ConflictException(`Barcode ${barcode} is already assigned to item ${itemBarcode.code}`);
      }
      if (unitBarcode) {
        throw new ConflictException(`Barcode ${barcode} is already assigned to unit ${unitBarcode.unit} of item ${unitBarcode.item.code}`);
      }
    }

    const existing = await this.prisma.itemUnit.findFirst({ where: { itemId, unit } });
    if (existing) throw new ConflictException(`Item ${item.code} already has a unit called ${unit}`);

    const created = await this.prisma.itemUnit.create({
      data: {
        itemId,
        unit,
        factor,
        barcode,
        isActive: true,
        salePrice: dto.salePrice === undefined ? null : new Prisma.Decimal(String(dto.salePrice)),
        purchasePrice:
          dto.purchasePrice === undefined ? null : new Prisma.Decimal(String(dto.purchasePrice)),
      },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'item_units',
      entityId: created.id,
      after: { item: item.code, unit, factor: factor.toFixed(6) },
    });

    return this.listUnits(companyId, itemId, mayReadCost);
  }

  // -------------------------------------------------------------- reports

  /// What the stock is worth, per item and branch, at the weighted average
  /// cost the ledger carries. This is the same number the inventory account
  /// holds - and the totals row says so.
  async valuation(
    companyId: string,
    filters: { branchId?: string; categoryId?: string } = {},
    mayReadCost = true,
  ) {
    const settings = await this.settings.get(companyId);

    const balances = await this.prisma.stockBalance.findMany({
      where: {
        companyId,
        ...(filters.branchId ? { branchId: filters.branchId } : {}),
        ...(filters.categoryId ? { item: { categoryId: filters.categoryId } } : {}),
      },
      include: {
        item: { select: { code: true, nameEn: true, nameAr: true, unit: true } },
        branch: { select: { code: true, nameEn: true } },
      },
      orderBy: { itemId: 'asc' },
    });

    const rows = balances
      .filter((balance) => !balance.quantity.isZero() || !balance.value.isZero())
      .map((balance) => ({
        itemId: balance.itemId,
        itemCode: balance.item.code,
        itemNameEn: balance.item.nameEn,
        itemNameAr: balance.item.nameAr,
        unit: balance.item.unit,
        branchCode: balance.branch.code,
        branchNameEn: balance.branch.nameEn,
        quantity: balance.quantity.toFixed(MONEY_SCALE),
        // Cost fields: kept as Decimals until the totals are computed, then
        // serialized (or redacted) in the final mapping below.
        value: balance.value,
        averageCost: balance.quantity.isZero()
          ? new Prisma.Decimal(0)
          : balance.value.div(balance.quantity),
      }));

    const totalValue = rows.reduce(
      (sum, row) => sum.plus(row.value),
      new Prisma.Decimal(0),
    );

    // The ledger's own balance for the inventory account, so the report can
    // say whether the two agree instead of assuming it.
    const ledgerRows = await this.prisma.$queryRaw<Array<{ net: Prisma.Decimal }>>(Prisma.sql`
      SELECT COALESCE(SUM(l.debit - l.credit), 0) AS net
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l."journalEntryId"
        JOIN accounts a ON a.id = l."accountId"
       WHERE e."companyId" = ${companyId}::uuid
         AND e.status IN ('POSTED', 'REVERSED')
         AND a.code = '1104'
    `);
    const ledgerValue = new Prisma.Decimal(ledgerRows[0]?.net ?? 0);

    return {
      valuationMethod: settings.inventoryValuation,
      rows: rows.map((row) => ({
        ...row,
        value: mayReadCost ? row.value.toFixed(MONEY_SCALE) : null,
        averageCost: mayReadCost ? row.averageCost.toFixed(MONEY_SCALE) : null,
      })),
      totals: {
        value: mayReadCost ? totalValue.toFixed(MONEY_SCALE) : null,
        // The ledger comparison is itself a cost reconciliation: withhold the
        // whole block from callers who may not read costs.
        ledgerValue: mayReadCost ? ledgerValue.toFixed(MONEY_SCALE) : null,
        difference: mayReadCost
          ? totalValue.minus(ledgerValue).toFixed(MONEY_SCALE)
          : null,
      },
    };
  }

  /// Items nobody has bought for a while, with what they tie up in cash.
  async slowMoving(
    companyId: string,
    filters: { days?: number; branchId?: string } = {},
    mayReadCost = true,
  ) {
    const days = Math.max(filters.days ?? 90, 1);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const balances = await this.prisma.stockBalance.findMany({
      where: {
        companyId,
        quantity: { gt: 0 },
        ...(filters.branchId ? { branchId: filters.branchId } : {}),
      },
      include: { item: { select: { code: true, nameEn: true, nameAr: true, unit: true } } },
    });

    const lastOut = await this.prisma.stockMovement.groupBy({
      by: ['itemId'],
      where: { companyId, direction: 'OUT' },
      _max: { movementDate: true },
    });
    const lastOutByItem = new Map(lastOut.map((row) => [row.itemId, row._max.movementDate]));

    const rows = balances
      .map((balance) => {
        const last = lastOutByItem.get(balance.itemId) ?? null;
        const idle = last ? Math.floor((Date.now() - last.getTime()) / (24 * 60 * 60 * 1000)) : null;
        return {
          itemId: balance.itemId,
          itemCode: balance.item.code,
          itemNameEn: balance.item.nameEn,
          itemNameAr: balance.item.nameAr,
          unit: balance.item.unit,
          quantity: balance.quantity.toFixed(MONEY_SCALE),
          value: balance.value,
          lastIssuedOn: last ? last.toISOString().slice(0, 10) : null,
          daysSinceLastIssue: idle,
        };
      })
      .filter((row) => row.lastIssuedOn === null || new Date(row.lastIssuedOn as string) <= since)
      .sort((a, b) => {
        const idleA = a.daysSinceLastIssue ?? Number.MAX_SAFE_INTEGER;
        const idleB = b.daysSinceLastIssue ?? Number.MAX_SAFE_INTEGER;
        return idleB - idleA;
      });

    const totalValue = rows.reduce(
      (sum, row) => sum.plus(row.value),
      new Prisma.Decimal(0),
    );

    return {
      days,
      rows: rows.map((row) => ({
        ...row,
        value: mayReadCost ? row.value.toFixed(MONEY_SCALE) : null,
      })),
      totals: {
        value: mayReadCost ? totalValue.toFixed(MONEY_SCALE) : null,
        items: rows.length,
      },
    };
  }

  /// What needs ordering: on hand at or below the reorder level.
  async reorder(
    companyId: string,
    filters: { branchId?: string } = {},
    mayReadCost = true,
  ) {
    const items = await this.prisma.item.findMany({
      where: { companyId, deletedAt: null, isActive: true, isStockTracked: true },
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameAr: true,
        unit: true,
        reorderLevel: true,
        purchasePrice: true,
        category: { select: { code: true, nameEn: true } },
        stockBalances: {
          where: filters.branchId ? { branchId: filters.branchId } : {},
          select: { quantity: true, value: true, branch: { select: { code: true } } },
        },
      },
    });

    const rows = items
      .map((item) => {
        const onHand = item.stockBalances.reduce(
          (sum, balance) => sum.plus(balance.quantity),
          new Prisma.Decimal(0),
        );
        const value = item.stockBalances.reduce(
          (sum, balance) => sum.plus(balance.value),
          new Prisma.Decimal(0),
        );
        const shortfall = item.reorderLevel.minus(onHand);
        return {
          itemId: item.id,
          itemCode: item.code,
          itemNameEn: item.nameEn,
          itemNameAr: item.nameAr,
          unit: item.unit,
          category: item.category?.code ?? null,
          categoryNameEn: item.category?.nameEn ?? null,
          onHand: onHand.toFixed(MONEY_SCALE),
          // Cost figures stay Decimal until the redaction step at the end.
          value,
          reorderLevel: item.reorderLevel.toFixed(MONEY_SCALE),
          shortfall: shortfall.greaterThan(0) ? shortfall.toFixed(MONEY_SCALE) : '0.0000',
          averageCost: onHand.isZero() ? new Prisma.Decimal(0) : value.div(onHand),
          estimatedOrderCost: shortfall
            .greaterThan(0)
            ? shortfall.mul(item.purchasePrice)
            : new Prisma.Decimal(0),
          branches: item.stockBalances.map((balance) => ({
            branchCode: balance.branch.code,
            quantity: balance.quantity.toFixed(MONEY_SCALE),
          })),
        };
      })
      // "At or below the level" is the rule; an item with no level set is not
      // reported at all rather than flooding the list with every item.
      .filter(
        (row) =>
          !new Prisma.Decimal(row.reorderLevel).isZero() &&
          new Prisma.Decimal(row.onHand).lessThanOrEqualTo(row.reorderLevel),
      )
      .sort((a, b) => new Prisma.Decimal(b.shortfall).minus(a.shortfall).toNumber());

    const totalEstimatedCost = rows.reduce(
      (sum, row) => sum.plus(row.estimatedOrderCost),
      new Prisma.Decimal(0),
    );

    return {
      rows: rows.map((row) => ({
        ...row,
        value: mayReadCost ? row.value.toFixed(MONEY_SCALE) : null,
        averageCost: mayReadCost ? row.averageCost.toFixed(MONEY_SCALE) : null,
        estimatedOrderCost: mayReadCost
          ? row.estimatedOrderCost.toFixed(MONEY_SCALE)
          : null,
      })),
      totals: {
        items: rows.length,
        estimatedOrderCost: mayReadCost
          ? totalEstimatedCost.toFixed(MONEY_SCALE)
          : null,
      },
    };
  }
}
