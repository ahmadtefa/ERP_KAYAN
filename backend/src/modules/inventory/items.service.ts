import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, Prisma, StockDirection } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { movementUnitSnapshot } from '../../common/units/unit-math';
import { parseUnitRows, planUnitChanges, ParsedUnitRow } from './unit-input';
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
        include: { units: { orderBy: [{ factor: 'asc' }, { createdAt: 'asc' }] } },
      }),
      this.prisma.item.count({ where }),
    ]);

    return { items: items.map((i) => this.toResponse(i, mayReadCost)), total, page, pageSize };
  }

  async findOne(companyId: string, id: string, mayReadCost = true) {
    const item = await this.prisma.item.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { units: { orderBy: [{ factor: 'asc' }, { createdAt: 'asc' }] } },
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
        units: item.units.map((unit) =>
          this.unitResponse(unit, item.unit, mayReadCost),
        ),
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
      units: owner.units.map((row) =>
        this.unitResponse(row, owner.unit, mayReadCost),
      ),
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
    mayReadCost = true,
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
    return this.toResponse(updated, mayReadCost);
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
    mayReadCost = true,
  ) {
    return {
      id: unit.id,
      unit: unit.unit,
      factor: unit.factor.toFixed(6),
      barcode: unit.barcode,
      salePrice: unit.salePrice?.toFixed(MONEY_SCALE) ?? null,
      // A unit's own purchase price is a cost, exactly like the item-level
      // one: absent from the response when the caller lacks cost.read.
      purchasePrice: mayReadCost
        ? unit.purchasePrice?.toFixed(MONEY_SCALE) ?? null
        : null,
      isBase: unit.unit === baseUnit,
    };
  }

  async create(
    companyId: string,
    userId: string,
    body: object,
    branchId: string | null = null,
    mayReadCost = true,
    mayManageBarcodes = true,
  ) {
    const dto = body as Record<string, any>;
    const code = String(dto.code ?? '').trim();
    if (!code) throw new BadRequestException('code is required');

    // The form sends the base unit and every packing unit together. They are
    // validated before anything is written, so a bad factor cannot leave an
    // item behind with half a catalogue.
    //
    // When the caller names no base unit but the units list carries exactly
    // one factor-1 row, that row *is* the base unit: the person said "عبوة = 1"
    // and meant it, and inventing a second base called "unit" would be wrong.
    let baseUnit = String(dto.unit ?? '').trim();
    if (baseUnit === '' && Array.isArray(dto.units)) {
      const factorOne = dto.units.filter(
        (row: Record<string, unknown>) => String(row?.factor ?? '').trim() === '1',
      );
      if (factorOne.length === 1) {
        baseUnit = String((factorOne[0] as Record<string, unknown>).unit ?? '').trim();
      }
    }
    if (baseUnit === '') baseUnit = 'unit';
    const unitRows = parseUnitRows(dto.units, baseUnit);

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
          unit: baseUnit,
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

      // Every item has exactly one factor-1 row anchoring its base unit, so
      // document resolution always has a base to convert against. Created
      // inside the same transaction as the item itself.
      //
      // When the form carried the packing table, the planner owns the whole
      // catalogue instead - it knows the base row must exist *once*, and two
      // paths writing it is how an item ends up with two base units.
      if (unitRows === null) {
        await tx.itemUnit.create({
          data: {
            itemId: item.id,
            unit: item.unit,
            factor: new Prisma.Decimal(1),
            isActive: true,
          },
        });
      } else {
        await this.applyUnitRows(tx, {
          companyId,
          itemId: item.id,
          baseUnit: item.unit,
          rows: unitRows,
          mayManageBarcodes,
        });
      }

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
            // Opening stock is counted in the item's base unit, which is the
            // unit the create form asks for; say so on the movement.
            ...movementUnitSnapshot({
              baseUnitName: item.unit,
              baseQuantity: openingQuantity!,
            }),
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

    return this.toResponse(created, mayReadCost);
  }

  async update(
    companyId: string,
    userId: string,
    id: string,
    body: object,
    mayReadCost = true,
    mayManageBarcodes = true,
  ) {
    const dto = body as Record<string, any>;
    const before = await this.prisma.item.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Item not found');

    // Which unit the item will be based on after this save. The units table
    // can rename the base row in place, so the answer is not just `dto.unit`:
    // it is whichever row the form kept as the factor-1 row.
    const existingUnits = await this.prisma.itemUnit.findMany({
      where: { itemId: id },
      select: { id: true, unit: true, factor: true, isActive: true, barcode: true },
    });
    const currentBaseRow =
      existingUnits.find((row) => row.factor.equals(1)) ?? null;
    const nextBaseUnit = this.resolveBaseUnitName({
      requested: dto.unit,
      rows: Array.isArray(dto.units) ? dto.units : undefined,
      currentBase: before.unit,
      currentBaseRowId: currentBaseRow?.id ?? null,
    });

    // Renaming the base unit changes what every stored quantity means: 5 was
    // five cartons, now it would read as five bottles. Refused once the item
    // has any history, with a message that says so and offers the way out.
    const changingBaseUnit = nextBaseUnit !== before.unit;
    if (changingBaseUnit) {
      await this.assertBaseUnitMayChange(companyId, id, before.unit, nextBaseUnit);
    }

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
    for (const key of ['nameEn', 'nameAr', 'barcode', 'notes', 'isActive', 'isStockTracked'] as const) {
      if (dto[key] !== undefined) (data as any)[key] = dto[key];
    }
    if (nextBaseUnit !== before.unit) data.unit = nextBaseUnit;
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

    // One transaction for the item and its whole unit catalogue: a save that
    // adds a carton and fails on a bad barcode must leave neither behind.
    const unitRows = parseUnitRows(dto.units, nextBaseUnit);
    const updated = await this.prisma.$transaction(async (tx) => {
      const item = await tx.item.update({ where: { id }, data });
      if (unitRows !== null) {
        await this.applyUnitRows(tx, {
          companyId,
          itemId: id,
          baseUnit: nextBaseUnit,
          rows: unitRows,
          mayManageBarcodes,
        });
      } else if (item.unit !== before.unit) {
        // The client changed the base unit name without sending the unit
        // list: keep the factor-1 row's label aligned either way. The row is
        // the one already read above, so this can never add a second base.
        if (currentBaseRow) {
          await tx.itemUnit.update({
            where: { id: currentBaseRow.id },
            data: { unit: item.unit },
          });
        } else {
          await tx.itemUnit.create({
            data: { itemId: id, unit: item.unit, factor: new Prisma.Decimal(1), isActive: true },
          });
        }
      }
      return item;
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'items',
      entityId: id,
      before: { nameEn: before.nameEn, salePrice: before.salePrice.toFixed(MONEY_SCALE) },
      after: { nameEn: updated.nameEn, salePrice: updated.salePrice.toFixed(MONEY_SCALE) },
    });

    return this.toResponse(updated, mayReadCost);
  }

  /** An item that has moved through stock is never deleted, only deactivated. */
  async deactivate(
    companyId: string,
    userId: string,
    id: string,
    mayReadCost = true,
  ) {
    const item = await this.prisma.item.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { stockBalances: true },
    });
    if (!item) throw new NotFoundException('Item not found');
    if (!item.isActive) return this.toResponse(item, mayReadCost);

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

    return this.toResponse(updated, mayReadCost);
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
    units?: Array<{
      id: string;
      unit: string;
      factor: Prisma.Decimal;
      barcode: string | null;
      salePrice: Prisma.Decimal | null;
      purchasePrice: Prisma.Decimal | null;
      isActive?: boolean;
      createdAt?: Date | null;
    }>;
    // False for callers without `inventory.cost.read`: prices that reveal cost
    // are redacted in the response (from the barcode/cost-permission work).
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
      // Present whenever the query included units (findOne/findAll).
      units: Array.isArray(item.units)
        ? item.units.map((unit) => this.unitToResponse(unit, mayReadCost))
        : undefined,
    };
  }


  /**
   * Refuses a base-unit rename that would re-interpret stock already recorded.
   *
   * The stored quantity has no unit of its own: it is "how many base units".
   * Renaming the base turns the same 5 into five of something else, in every
   * document and every report, without touching a single number. So it is
   * refused as soon as the item has any history - a movement, a non-zero
   * balance, or a saved document line - and the message names the way out:
   * add a packing unit instead, or correct the stock through a counted
   * adjustment that the ledger can be read against.
   */
  private async assertBaseUnitMayChange(
    companyId: string,
    itemId: string,
    fromUnit: string,
    toUnit: string,
  ) {
    const zero = new Prisma.Decimal(0);
    const [movements, balance, stockLines, salesLines, purchaseLines] =
      await Promise.all([
        this.prisma.stockMovement.count({ where: { companyId, itemId } }),
        this.prisma.stockBalance.findFirst({
          where: {
            companyId,
            itemId,
            OR: [{ quantity: { not: zero } }, { value: { not: zero } }],
          },
          // stock_balances is keyed by (company, branch, item): there is no
          // surrogate id, and finding the row at all is the answer.
          select: { quantity: true },
        }),
        this.prisma.stockDocumentLine.count({ where: { itemId } }),
        this.prisma.salesInvoiceLine.count({ where: { itemId } }),
        this.prisma.purchaseInvoiceLine.count({ where: { itemId } }),
      ]);

    const history =
      movements + (balance ? 1 : 0) + stockLines + salesLines + purchaseLines;
    if (history === 0) return;

    throw new BadRequestException(
      `لا يمكن تغيير وحدة الأساس للصنف من "${fromUnit}" إلى "${toUnit}" لأنه مسجّل عليه ` +
        `${movements} حركة مخزنية و${stockLines + salesLines + purchaseLines} سطرًا في مستندات` +
        `${balance ? ' ورصيد قائم' : ''}. تغيير الوحدة سيعيد تفسير الكميات القديمة دون أن تتغيّر أرقامها. ` +
        'أضف وحدة تعبئة جديدة بدلًا من ذلك، أو صحّح الكميات بتسوية جرد مرحّلة. / ' +
        'The base unit of an item with recorded stock cannot be renamed: it would re-read existing ' +
        'quantities in a different unit. Add a packing unit instead, or correct the stock with a posted count.',
    );
  }

  /**
   * Which unit the item will be based on after this save.
   *
   * The item form edits the base row inside the units table, so the base name
   * can arrive as `unit` (old clients, quick edit) or as a row (the new form).
   * Reading the row keeps the two paths saying the same thing instead of
   * letting `item.unit` and the factor-1 row drift apart.
   */
  private resolveBaseUnitName(options: {
    requested: unknown;
    rows: Array<Record<string, unknown>> | undefined;
    currentBase: string;
    currentBaseRowId: string | null;
  }): string {
    const text = (value: unknown) => String(value ?? '').trim();
    const requested = text(options.requested);
    if (requested !== '') return requested;

    const rows = options.rows;
    if (!rows || rows.length === 0) return options.currentBase;

    const currentKey = options.currentBase.trim().toLowerCase();

    // The row carrying the stored base row's id is that row, even when it was
    // renamed - the form edits it in place rather than adding a twin.
    if (options.currentBaseRowId) {
      const byId = rows.find(
        (row) => text(row.id) === options.currentBaseRowId,
      );
      if (byId && text(byId.unit) !== '') return text(byId.unit);
    }

    const byName = rows.find((row) => text(row.unit).toLowerCase() === currentKey);
    if (byName) return text(byName.unit);

    // A single row that declares itself the base by its factor of 1.
    const factorOne = rows.filter((row) => {
      const raw = text(row.factor);
      if (raw === '') return false;
      try {
        return new Prisma.Decimal(raw).equals(1);
      } catch {
        return false;
      }
    });
    if (factorOne.length === 1 && text(factorOne[0].unit) !== '') {
      return text(factorOne[0].unit);
    }

    // No row claims the base: the item keeps the one it had, and the planner
    // adds or renames the factor-1 row to match.
    return options.currentBase;
  }

  /**
   * Writes the unit catalogue a form sent: new rows, edited rows, and the rows
   * that disappeared switched off (never deleted, so old documents keep a unit
   * that exists). Runs inside the caller's transaction.
   */
  private async applyUnitRows(
    tx: Prisma.TransactionClient,
    options: {
      companyId: string;
      itemId: string;
      baseUnit: string;
      rows: ParsedUnitRow[];
      mayManageBarcodes: boolean;
    },
  ) {
    const existing = await tx.itemUnit.findMany({
      where: { itemId: options.itemId },
      select: {
        id: true,
        unit: true,
        factor: true,
        isActive: true,
        barcode: true,
      },
    });
    const plan = planUnitChanges({
      baseUnit: options.baseUnit,
      rows: options.rows,
      existing,
    });
    if (!plan) return;

    const storedBarcode = new Map(
      existing.map((row) => [row.id, (row.barcode ?? '').trim()]),
    );
    if (options.mayManageBarcodes) {
      await this.assertUnitBarcodesFree(tx, options.companyId, options.itemId, [
        ...plan.creates,
        ...plan.updates.map((entry) => entry.row),
      ]);
    } else {
      // Without the barcode grant the form may still be saved, as long as it
      // leaves the codes where they are: silently dropping a new code would
      // look saved and scan as nothing.
      const repointed = [
        ...plan.creates.filter((row) => (row.barcode ?? '').trim() !== ''),
        ...plan.updates.filter(
          (entry) =>
            (entry.row.barcode ?? '').trim() !== (storedBarcode.get(entry.id) ?? ''),
        ),
      ];
      if (repointed.length > 0) {
        throw new ForbiddenException(
          'ليس لديك صلاحية تعديل أكواد باركود الوحدات. / Missing permission: inventory.barcodes.manage',
        );
      }
    }

    for (const entry of plan.updates) {
      await tx.itemUnit.update({
        where: { id: entry.id },
        data: this.unitWriteData(entry.row, options.mayManageBarcodes, false),
      });
    }
    for (const row of plan.creates) {
      await tx.itemUnit.create({
        data: {
          itemId: options.itemId,
          ...this.unitWriteData(row, options.mayManageBarcodes, true),
        },
      });
    }
    // A rename carries the row's barcode and prices with it: only the label
    // changes, because those describe the same physical pack.
    if (plan.baseRename) {
      await tx.itemUnit.update({
        where: { id: plan.baseRename.id },
        data: { unit: plan.baseRename.unit },
      });
    }
    if (plan.createBase) {
      await tx.itemUnit.create({
        data: {
          itemId: options.itemId,
          unit: options.baseUnit,
          factor: new Prisma.Decimal(1),
          isActive: true,
        },
      });
    }
    if (plan.deactivateIds.length > 0) {
      await tx.itemUnit.updateMany({
        where: { id: { in: plan.deactivateIds } },
        data: { isActive: false },
      });
    }
  }

  /// The columns to write for one unit row.
  ///
  /// A field the caller did not send is left as it is: a role shown no
  /// purchase prices would otherwise erase them on every save. A new row gets
  /// every column, because there is nothing there to preserve.
  private unitWriteData(
    row: ParsedUnitRow,
    mayManageBarcodes: boolean,
    isCreate: boolean,
  ) {
    const write = (provided: boolean) => isCreate || provided;
    return {
      unit: row.unit,
      factor: row.factor,
      ...(write(row.abbreviationProvided) ? { abbreviation: row.abbreviation } : {}),
      // A role without the barcode grant edits units but never repoints a
      // code that labels are printed from and scanners read.
      ...(mayManageBarcodes && write(row.barcodeProvided)
        ? { barcode: row.barcode }
        : {}),
      ...(write(row.salePriceProvided) ? { salePrice: row.salePrice } : {}),
      ...(write(row.purchasePriceProvided)
        ? { purchasePrice: row.purchasePrice }
        : {}),
      ...(write(row.allowFractionProvided)
        ? { allowFraction: row.allowFraction }
        : {}),
      ...(write(row.usageProvided)
        ? { usedInSales: row.usedInSales, usedInPurchases: row.usedInPurchases }
        : {}),
      ...(write(row.sortOrderProvided) ? { sortOrder: row.sortOrder } : {}),
      isActive: true,
    };
  }

  /**
   * A barcode identifies one thing in the company. A code already used by
   * another item, or by another unit of this item, is refused before writing.
   */
  private async assertUnitBarcodesFree(
    tx: Prisma.TransactionClient,
    companyId: string,
    itemId: string,
    rows: ParsedUnitRow[],
  ) {
    const codes = rows
      .map((row) => row.barcode)
      .filter((code): code is string => typeof code === 'string' && code !== '');
    if (codes.length === 0) return;

    const seen = new Set<string>();
    for (const code of codes) {
      if (seen.has(code)) {
        throw new ConflictException(
          `الباركود ${code} مكرر داخل الصنف. / Barcode ${code} is used twice on this item.`,
        );
      }
      seen.add(code);
    }

    const [unitClash, itemClash] = await Promise.all([
      tx.itemUnit.findFirst({
        where: {
          barcode: { in: codes },
          itemId: { not: itemId },
          item: { companyId },
        },
        include: { item: { select: { code: true } } },
      }),
      tx.item.findFirst({
        where: { companyId, barcode: { in: codes }, id: { not: itemId } },
        select: { code: true, barcode: true },
      }),
    ]);
    if (unitClash) {
      throw new ConflictException(
        `الباركود ${unitClash.barcode} مستخدم في وحدة "${unitClash.unit}" بالصنف ${unitClash.item.code}. / ` +
          `Barcode ${unitClash.barcode} is already assigned to unit ${unitClash.unit} of item ${unitClash.item.code}`,
      );
    }
    if (itemClash) {
      throw new ConflictException(
        `الباركود ${itemClash.barcode} مستخدم في الصنف ${itemClash.code}. / ` +
          `Barcode ${itemClash.barcode} is already assigned to item ${itemClash.code}`,
      );
    }
  }

  /**
   * Guarantees the factor-1 base row exists. Items created before multi-unit
   * have no ItemUnit rows; this backfills the base unit the first time it is
   * needed without touching any document data.
   */
  async ensureBaseUnit(item: { id: string; unit: string }) {
    const existing = await this.prisma.itemUnit.findFirst({
      where: { itemId: item.id, factor: 1 },
      select: { id: true },
    });
    if (existing) return;
    await this.prisma.itemUnit.create({
      data: {
        itemId: item.id,
        unit: item.unit,
        factor: new Prisma.Decimal(1),
        isActive: true,
      },
    });
  }

  private unitToResponse(
    unit: {
      id: string;
      itemId?: string;
      unit: string;
      factor: Prisma.Decimal;
      barcode: string | null;
      salePrice: Prisma.Decimal | null;
      purchasePrice: Prisma.Decimal | null;
      isActive?: boolean;
      createdAt?: Date | null;
      abbreviation?: string | null;
      allowFraction?: boolean;
      usedInSales?: boolean;
      usedInPurchases?: boolean;
      sortOrder?: number;
    },
    mayReadCost = true,
  ) {
    return {
      id: unit.id,
      itemId: unit.itemId,
      unit: unit.unit,
      factor: unit.factor.toFixed(6),
      barcode: unit.barcode,
      salePrice: unit.salePrice === null || unit.salePrice === undefined
        ? null
        : unit.salePrice.toFixed(MONEY_SCALE),
      purchasePrice:
        mayReadCost &&
        unit.purchasePrice !== null &&
        unit.purchasePrice !== undefined
          ? unit.purchasePrice.toFixed(MONEY_SCALE)
          : null,
      // Pre-multi-unit rows carry no active flag; treat them as active rather
      // than hiding a unit the catalogue always offered.
      isActive: unit.isActive ?? true,
      isBase: unit.factor.equals(1),
      // The rest of what a unit now carries. Defaults repeat the column
      // defaults so a row read before this migration cannot turn a unit off.
      abbreviation: unit.abbreviation ?? null,
      allowFraction: unit.allowFraction ?? true,
      usedInSales: unit.usedInSales ?? true,
      usedInPurchases: unit.usedInPurchases ?? true,
      sortOrder: unit.sortOrder ?? 0,
      createdAt: unit.createdAt ? unit.createdAt.toISOString() : null,
    };
  }
}
