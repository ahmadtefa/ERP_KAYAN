import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, Prisma, StockDirection } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WarehouseService } from '../../common/warehouse/warehouse.service';
import { AccountMapService } from '../accounting/account-map.service';
import { PostingService } from '../accounting/posting.service';
import { isValidEan13, randomInternalBarcode, toBaseQuantity } from './barcode';

const MONEY_SCALE = 4;
const RATE_SCALE = 4;

@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly accounts: AccountMapService,
    private readonly posting: PostingService,
    private readonly warehouses: WarehouseService,
  ) {}

  async findAll(
    companyId: string,
    query: { q?: string; includeInactive?: boolean; page?: number; pageSize?: number },
    /// False for a caller without `inventory.cost.read`: the cost column is
    /// left out of the answer rather than blanked out on screen, so a
    /// hand-written request cannot read what a list was not allowed to show.
    mayReadCost = true,
  ) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);

    const where: Prisma.ItemWhereInput = { companyId, deletedAt: null };
    if (!query.includeInactive) where.isActive = true;
    if (query.q?.trim()) {
      const q = query.q.trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { nameEn: { contains: q, mode: 'insensitive' } },
        { nameAr: { contains: q } },
        { barcode: { contains: q } },
        { units: { some: { barcode: { contains: q } } } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.item.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.item.count({ where }),
    ]);

    return { items: items.map((i) => this.toResponse(i, mayReadCost)), total, page, pageSize };
  }

  async findOne(companyId: string, id: string, mayReadCost = true) {
    const item = await this.prisma.item.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Item not found');
    return this.toResponse(item, mayReadCost);
  }

  /// What a scanned code means.
  ///
  /// A barcode can belong to the item itself or to one of its units, and the
  /// difference decides what the scanner means: scanning a carton code must
  /// bring in one carton, not one piece. The answer therefore says which unit
  /// matched, its factor, and how many base units one scan stands for, so the
  /// screen never has to guess.
  async findByBarcode(companyId: string, code: string, mayReadCost = true) {
    const barcode = String(code ?? '').trim();
    if (!barcode) throw new BadRequestException('barcode is required');

    const item = await this.prisma.item.findFirst({
      where: { companyId, barcode, deletedAt: null },
      include: { units: { orderBy: { factor: 'asc' } } },
    });
    if (item) {
      return {
        matched: 'item' as const,
        unit: item.unit,
        factor: '1.000000',
        quantityPerScan: '1.0000',
        salePrice: item.salePrice.toFixed(MONEY_SCALE),
        purchasePrice: mayReadCost ? item.purchasePrice.toFixed(MONEY_SCALE) : null,
        item: this.toResponse(item, mayReadCost),
        units: item.units.map((unit) => this.unitResponse(unit, item.unit)),
      };
    }

    const unit = await this.prisma.itemUnit.findFirst({
      where: { barcode, item: { companyId, deletedAt: null } },
      include: { item: { include: { units: { orderBy: { factor: 'asc' } } } } },
    });
    if (!unit) {
      throw new NotFoundException(`No item or unit carries the barcode ${barcode}`);
    }

    const owner = unit.item;
    return {
      matched: 'unit' as const,
      unit: unit.unit,
      factor: unit.factor.toFixed(6),
      // A scan of a unit barcode is one of that unit, expressed in the base
      // unit the stock ledger keeps.
      quantityPerScan: toBaseQuantity(1, unit.factor).toFixed(MONEY_SCALE),
      salePrice:
        unit.salePrice?.toFixed(MONEY_SCALE) ?? owner.salePrice.toFixed(MONEY_SCALE),
      purchasePrice: mayReadCost
        ? unit.purchasePrice?.toFixed(MONEY_SCALE) ?? owner.purchasePrice.toFixed(MONEY_SCALE)
        : null,
      item: this.toResponse(owner, mayReadCost),
      units: owner.units.map((row) => this.unitResponse(row, owner.unit)),
    };
  }

  /// Gives an item a code that no other item or unit in this company uses.
  ///
  /// The generated code is an EAN-13 with the reserved internal prefix and a
  /// real check digit, so it can be printed and read. Collisions are checked
  /// against the database rather than assumed away, and a manual code is
  /// accepted only when it is free as well.
  async assignBarcode(
    companyId: string,
    userId: string,
    itemId: string,
    requested: string | null | undefined,
  ) {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, companyId, deletedAt: null },
      select: { id: true, code: true, barcode: true },
    });
    if (!item) throw new NotFoundException('Item not found');

    let barcode = String(requested ?? '').trim();
    if (barcode) {
      if (barcode.length > 60) {
        throw new BadRequestException('barcode cannot be longer than 60 characters');
      }
      await this.assertBarcodeFree(companyId, barcode, itemId);
    } else {
      for (let attempt = 0; attempt < 20 && !barcode; attempt += 1) {
        const candidate = randomInternalBarcode();
        if (!isValidEan13(candidate)) continue;
        const taken = await this.barcodeTaken(companyId, candidate, itemId);
        if (!taken) barcode = candidate;
      }
      if (!barcode) {
        throw new ConflictException(
          'Could not generate a free internal barcode; try again or enter one by hand',
        );
      }
    }

    const updated = await this.prisma.item.update({
      where: { id: itemId },
      data: { barcode, updatedBy: userId },
    });
    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'items',
      entityId: itemId,
      before: { barcode: item.barcode },
      after: { barcode },
    });
    return this.toResponse(updated);
  }

  private async barcodeTaken(companyId: string, barcode: string, ignoreItemId: string | null) {
    const [item, unit] = await Promise.all([
      this.prisma.item.findFirst({
        where: {
          companyId,
          barcode,
          deletedAt: null,
          ...(ignoreItemId ? { id: { not: ignoreItemId } } : {}),
        },
        select: { id: true },
      }),
      this.prisma.itemUnit.findFirst({
        where: {
          barcode,
          item: { companyId, deletedAt: null, ...(ignoreItemId ? { id: { not: ignoreItemId } } : {}) },
        },
        select: { id: true },
      }),
    ]);
    return Boolean(item || unit);
  }

  private async assertBarcodeFree(companyId: string, barcode: string, ignoreItemId: string | null) {
    const [item, unit] = await Promise.all([
      this.prisma.item.findFirst({
        where: {
          companyId,
          barcode,
          deletedAt: null,
          ...(ignoreItemId ? { id: { not: ignoreItemId } } : {}),
        },
        select: { code: true },
      }),
      this.prisma.itemUnit.findFirst({
        where: {
          barcode,
          item: { companyId, deletedAt: null, ...(ignoreItemId ? { id: { not: ignoreItemId } } : {}) },
        },
        include: { item: { select: { code: true } } },
      }),
    ]);
    if (item) {
      throw new ConflictException(`Barcode ${barcode} is already assigned to item ${item.code}`);
    }
    if (unit) {
      throw new ConflictException(
        `Barcode ${barcode} is already assigned to unit ${unit.unit} of item ${unit.item.code}`,
      );
    }
  }

  private unitResponse(
    unit: { id: string; unit: string; factor: Prisma.Decimal; barcode: string | null; salePrice: Prisma.Decimal | null; purchasePrice: Prisma.Decimal | null },
    baseUnit: string,
  ) {
    return {
      id: unit.id,
      unit: unit.unit,
      factor: unit.factor.toFixed(6),
      barcode: unit.barcode,
      salePrice: unit.salePrice?.toFixed(MONEY_SCALE) ?? null,
      purchasePrice: unit.purchasePrice?.toFixed(MONEY_SCALE) ?? null,
      isBase: unit.unit === baseUnit,
    };
  }

  async create(
    companyId: string,
    userId: string,
    body: object,
    branchId: string | null = null,
  ) {
    const dto = body as Record<string, any>;
    const code = String(dto.code ?? '').trim();
    if (!code) throw new BadRequestException('code is required');

    const existing = await this.prisma.item.findFirst({
      where: { companyId, code },
      select: { id: true, deletedAt: true },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException(`Item code ${code} is already used`);
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
      if (itemBarcode) throw new ConflictException(`Barcode ${barcode} is already assigned to item ${itemBarcode.code}`);
      if (unitBarcode) throw new ConflictException(`Barcode ${barcode} is already assigned to unit ${unitBarcode.unit} of item ${unitBarcode.item.code}`);
    }

    const isStockTracked = (dto.isStockTracked as boolean) ?? true;
    const openingQuantity = this.optionalMoney(dto.openingQuantity, 'openingQuantity');
    const openingUnitCost = this.optionalMoney(dto.openingUnitCost, 'openingUnitCost');
    const wantsOpeningStock =
      openingQuantity !== null || openingUnitCost !== null;
    if (wantsOpeningStock) {
      if (!isStockTracked) {
        throw new BadRequestException(
          'Opening stock cannot be set on an item that is not stock-tracked',
        );
      }
      if (openingQuantity === null || openingUnitCost === null) {
        throw new BadRequestException(
          'openingQuantity and openingUnitCost must be given together',
        );
      }
      if (!openingQuantity.greaterThan(0)) {
        throw new BadRequestException('openingQuantity must be greater than zero');
      }
      if (!branchId) {
        throw new BadRequestException(
          'Select a branch before adding opening stock',
        );
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      if (wantsOpeningStock) {
        // An opening-balance document already owns this branch's starting
        // figures; adding a second opening entry for one item would count the
        // same stock twice. Refuse rather than guess.
        const existingOpening = await tx.openingBalance.findFirst({
          where: {
            companyId,
            branchId: branchId!,
            deletedAt: null,
            status: { in: [InvoiceStatus.DRAFT, InvoiceStatus.POSTED] },
          },
          select: { documentNumber: true },
        });
        if (existingOpening) {
          throw new BadRequestException(
            `This branch already has an opening balance (${existingOpening.documentNumber}). ` +
              'Add the item there instead of giving it opening stock here.',
          );
        }
      }

      const item = await tx.item.create({
        data: {
          companyId,
          code,
          nameEn: dto.nameEn as string,
          nameAr: dto.nameAr as string,
          unit: (dto.unit as string) ?? 'unit',
          barcode,
          salePrice: this.money(dto.salePrice, 'salePrice'),
          purchasePrice: this.money(dto.purchasePrice, 'purchasePrice'),
          reorderLevel: this.money(dto.reorderLevel, 'reorderLevel'),
          taxRate: dto.taxRate === undefined ? null : this.rate(dto.taxRate, 'taxRate'),
          isStockTracked,
          categoryId: (dto.categoryId as string) ?? null,
          countryOfOrigin: (dto.countryOfOrigin as string | undefined)?.trim() || null,
          notes: (dto.notes as string) ?? null,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      if (wantsOpeningStock) {
        const total = openingQuantity!
          .mul(openingUnitCost!)
          .toDecimalPlaces(MONEY_SCALE);
        const accounts = await this.accounts.resolve(tx, companyId, [
          'inventory',
          'openingBalanceEquity',
        ]);
        const warehouseId = await this.warehouses.resolve(
          tx,
          companyId,
          branchId!,
        );
        const asOf = new Date(new Date().toISOString().slice(0, 10));

        await tx.stockMovement.create({
          data: {
            companyId,
            branchId: branchId!,
            warehouseId,
            itemId: item.id,
            movementDate: asOf,
            direction: StockDirection.IN,
            quantity: openingQuantity!,
            unitCost: openingUnitCost!,
            totalCost: total,
            referenceType: 'ITEM_OPENING_STOCK',
            referenceId: item.id,
            referenceNumber: item.code,
            notes: 'Opening stock entered with the item',
            createdBy: userId,
          },
        });
        await tx.stockBalance.upsert({
          where: {
            companyId_branchId_itemId: {
              companyId,
              branchId: branchId!,
              itemId: item.id,
            },
          },
          create: {
            companyId,
            branchId: branchId!,
            itemId: item.id,
            quantity: openingQuantity!,
            value: total,
          },
          update: {
            quantity: { increment: openingQuantity! },
            value: { increment: total },
          },
        });

        await this.posting.post(tx, {
          companyId,
          branchId: branchId!,
          userId,
          entryDate: asOf,
          description: `Opening stock for ${item.code}`,
          sourceType: 'OPENING_BALANCE',
          sourceId: item.id,
          sourceNumber: item.code,
          lines: [
            {
              accountId: accounts.inventory,
              debit: total,
              description: `Opening stock ${item.code}`,
            },
            {
              accountId: accounts.openingBalanceEquity,
              credit: total,
              description: `Opening stock ${item.code}`,
            },
          ],
        });
      }

      return item;
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'items',
      entityId: created.id,
      after: {
        code: created.code,
        nameEn: created.nameEn,
        openingQuantity: openingQuantity?.toFixed(MONEY_SCALE),
        openingUnitCost: openingUnitCost?.toFixed(MONEY_SCALE),
      },
    });

    return this.toResponse(created);
  }

  async update(
    companyId: string,
    userId: string,
    id: string,
    body: object,
  ) {
    const dto = body as Record<string, any>;
    const before = await this.prisma.item.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Item not found');

    if (dto.barcode !== undefined) {
      const barcode = String(dto.barcode ?? '').trim() || null;
      if (barcode) {
        const [itemBarcode, unitBarcode] = await Promise.all([
          this.prisma.item.findFirst({
            where: { companyId, barcode, id: { not: id }, deletedAt: null },
            select: { code: true },
          }),
          this.prisma.itemUnit.findFirst({
            where: { barcode, item: { companyId, id: { not: id }, deletedAt: null } },
            include: { item: { select: { code: true } } },
          }),
        ]);
        if (itemBarcode) throw new ConflictException(`Barcode ${barcode} is already assigned to item ${itemBarcode.code}`);
        if (unitBarcode) throw new ConflictException(`Barcode ${barcode} is already assigned to unit ${unitBarcode.unit} of item ${unitBarcode.item.code}`);
      }
      dto.barcode = barcode;
    }

    const data: Prisma.ItemUpdateInput = { updatedBy: userId };
    for (const key of ['nameEn', 'nameAr', 'unit', 'barcode', 'notes', 'isActive', 'isStockTracked'] as const) {
      if (dto[key] !== undefined) (data as any)[key] = dto[key];
    }
    if (dto.countryOfOrigin !== undefined) {
      data.countryOfOrigin = String(dto.countryOfOrigin).trim() || null;
    }
    if (dto.salePrice !== undefined) data.salePrice = this.money(dto.salePrice, 'salePrice');
    if (dto.purchasePrice !== undefined) data.purchasePrice = this.money(dto.purchasePrice, 'purchasePrice');
    if (dto.reorderLevel !== undefined) data.reorderLevel = this.money(dto.reorderLevel, 'reorderLevel');
    if (dto.taxRate !== undefined) {
      data.taxRate = dto.taxRate === null || dto.taxRate === '' ? null : this.rate(dto.taxRate, 'taxRate');
    }
    if (dto.categoryId !== undefined) {
      data.category = dto.categoryId ? { connect: { id: String(dto.categoryId) } } : { disconnect: true };
    }

    const updated = await this.prisma.item.update({ where: { id }, data });

    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'items',
      entityId: id,
      before: { nameEn: before.nameEn, salePrice: before.salePrice.toFixed(MONEY_SCALE) },
      after: { nameEn: updated.nameEn, salePrice: updated.salePrice.toFixed(MONEY_SCALE) },
    });

    return this.toResponse(updated);
  }

  /** An item that has moved through stock is never deleted, only deactivated. */
  async deactivate(companyId: string, userId: string, id: string) {
    const item = await this.prisma.item.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { stockBalances: true },
    });
    if (!item) throw new NotFoundException('Item not found');
    if (!item.isActive) return this.toResponse(item);

    const onHand = item.stockBalances.reduce(
      (sum, b) => sum.plus(b.quantity),
      new Prisma.Decimal(0),
    );
    if (!onHand.isZero()) {
      throw new BadRequestException(
        `This item still has ${onHand.toFixed(MONEY_SCALE)} in stock. ` +
          'Move it out before deactivating the item.',
      );
    }

    const updated = await this.prisma.item.update({
      where: { id },
      data: { isActive: false, updatedBy: userId },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'DEACTIVATE',
      entity: 'items',
      entityId: id,
      before: { isActive: true },
      after: { isActive: false },
    });

    return this.toResponse(updated);
  }

  /// Like `money`, but an absent/blank field means "not supplied" rather
  /// than zero. Opening stock of zero is not an opening entry.
  private optionalMoney(
    value: unknown,
    field: string,
  ): Prisma.Decimal | null {
    if (value === undefined || value === null || String(value).trim() === '') {
      return null;
    }
    return this.money(value, field);
  }

  private money(value: unknown, field: string): Prisma.Decimal {
    if (value === undefined || value === null || value === '') {
      return new Prisma.Decimal(0);
    }
    try {
      const d = new Prisma.Decimal(String(value)).toDecimalPlaces(MONEY_SCALE);
      if (d.isNegative()) throw new BadRequestException(`${field} cannot be negative`);
      return d;
    } catch {
      throw new BadRequestException(`${field} is not a valid amount`);
    }
  }

  private rate(value: unknown, field: string): Prisma.Decimal {
    if (value === undefined || value === null || value === '') {
      return new Prisma.Decimal(0);
    }
    try {
      const d = new Prisma.Decimal(String(value)).toDecimalPlaces(RATE_SCALE);
      if (d.isNegative()) throw new BadRequestException(`${field} cannot be negative`);
      if (d.greaterThan(100)) throw new BadRequestException(`${field} cannot exceed 100`);
      return d;
    } catch {
      throw new BadRequestException(`${field} is not a valid percentage`);
    }
  }

  private toResponse(item: {
    id: string;
    companyId: string;
    code: string;
    nameEn: string;
    nameAr: string;
    unit: string;
    barcode: string | null;
    salePrice: Prisma.Decimal;
    purchasePrice: Prisma.Decimal;
    reorderLevel: Prisma.Decimal;
    taxRate: Prisma.Decimal | null;
    isStockTracked: boolean;
    isActive: boolean;
    categoryId: string | null;
    countryOfOrigin?: string | null;
    notes: string | null;
    createdAt: Date;
  }, mayReadCost = true) {
    return {
      id: item.id,
      companyId: item.companyId,
      code: item.code,
      nameEn: item.nameEn,
      nameAr: item.nameAr,
      unit: item.unit,
      barcode: item.barcode,
      salePrice: item.salePrice.toFixed(MONEY_SCALE),
      purchasePrice: mayReadCost ? item.purchasePrice.toFixed(MONEY_SCALE) : null,
      reorderLevel: item.reorderLevel.toFixed(MONEY_SCALE),
      // Null here means "follow the company default", which is different
      // from the string "0" meaning exempt.
      taxRate: item.taxRate === null ? null : item.taxRate.toFixed(RATE_SCALE),
      isStockTracked: item.isStockTracked,
      isActive: item.isActive,
      categoryId: item.categoryId,
      countryOfOrigin: item.countryOfOrigin ?? null,
      notes: item.notes,
      createdAt: item.createdAt.toISOString(),
    };
  }
}
