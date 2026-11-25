import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, StockDocumentKind } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { STOCKTAKE_PENDING_APPROVAL, dedupeKey } from '../notifications/notification-kinds';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StockLedgerService } from '../../common/warehouse/stock-ledger.service';
import { WarehouseScope, WarehouseService } from '../../common/warehouse/warehouse.service';
import { resolveUnitSelection } from '../../common/units/unit-math';
import { DocumentNumberService } from '../accounting/document-number.service';
import { StockDocumentsService } from './stock-documents.service';

const MONEY_SCALE = 4;

/// A counting session, from "the doors are shut" to "the difference is booked".
///
/// The session exists because counting is not instantaneous: the system figure
/// must stop moving while a person walks the shelves, and the difference must
/// be approved once by somebody who did not count it. Without the session those
/// two facts have nowhere to live, and a count becomes an adjustment typed by
/// whoever holds the keyboard.
@Injectable()
export class StockTakesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly warehouses: WarehouseService,
    private readonly ledger: StockLedgerService,
    private readonly numbers: DocumentNumberService,
    private readonly documents: StockDocumentsService,
    private readonly audit: AuditService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async list(
    companyId: string,
    query: { status?: string; warehouseId?: string; page?: number; pageSize?: number } = {},
    scope: WarehouseScope = null,
    warehouseIds?: string[],
  ) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);
    const where: Prisma.StockTakeSessionWhereInput = {
      companyId,
      ...(scope !== null ? { branchId: { in: scope } } : {}),
      ...(warehouseIds !== undefined || query.warehouseId
        ? {
            warehouseId: {
              in:
                warehouseIds !== undefined
                  ? query.warehouseId
                    ? warehouseIds.filter((id) => id === query.warehouseId)
                    : warehouseIds
                  : [query.warehouseId!],
            },
          }
        : {}),
      ...(query.status ? { status: query.status.toUpperCase() } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.stockTakeSession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          warehouse: { select: { code: true, nameEn: true, nameAr: true } },
          _count: { select: { lines: true } },
        },
      }),
      this.prisma.stockTakeSession.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.toSummary(row)),
      total,
      page,
      pageSize,
    };
  }

  async findOne(companyId: string, id: string, scope: WarehouseScope = null) {
    const session = await this.prisma.stockTakeSession.findFirst({
      where: {
        id,
        companyId,
        ...(scope !== null ? { branchId: { in: scope } } : {}),
      },
      include: {
        warehouse: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        lines: {
          orderBy: { id: 'asc' },
          include: {
            item: { select: { id: true, code: true, nameEn: true, nameAr: true, unit: true } },
            batch: { select: { id: true, batchNumber: true, expiryDate: true } },
          },
        },
      },
    });
    if (!session) throw new NotFoundException('Stock-take session not found');

    const shelfIds = [...new Set(session.lines.map((l) => (l as { storageLocationId?: string | null }).storageLocationId).filter((x): x is string => !!x))];
    const shelves = shelfIds.length
      ? await this.prisma.storageLocation.findMany({ where: { id: { in: shelfIds }, companyId }, select: { id: true, code: true, nameEn: true, nameAr: true } })
      : [];
    const lines = session.lines.map((line) => ({
      id: line.id,
      storageLocationId: (line as { storageLocationId?: string | null }).storageLocationId ?? null,
      storageLocationCode: shelves.find((x) => x.id === (line as { storageLocationId?: string | null }).storageLocationId)?.code ?? null,
      storageLocationNameEn: shelves.find((x) => x.id === (line as { storageLocationId?: string | null }).storageLocationId)?.nameEn ?? null,
      storageLocationNameAr: shelves.find((x) => x.id === (line as { storageLocationId?: string | null }).storageLocationId)?.nameAr ?? null,
      itemId: line.itemId,
      itemCode: line.item.code,
      itemNameEn: line.item.nameEn,
      itemNameAr: line.item.nameAr,
      unit: line.item.unit,
      batchId: line.batchId,
      batchNumber: line.batch?.batchNumber ?? null,
      expiryDate: line.batch?.expiryDate ?? null,
      systemQuantity: line.systemQuantity.toFixed(MONEY_SCALE),
      countedQuantity: line.countedQuantity?.toFixed(MONEY_SCALE) ?? null,
      unitCost: line.unitCost.toFixed(MONEY_SCALE),
      varianceQuantity: line.varianceQuantity.toFixed(MONEY_SCALE),
      varianceValue: line.varianceValue.toFixed(MONEY_SCALE),
      countedAt: line.countedAt,
      notes: line.notes,
    }));
    // A quantity found on a shelf that the unlocated bucket of the same item
    // (and lot) is short by is a stock ASSIGNMENT, not a stock difference: the
    // goods were always there, they only had no shelf. It moves no quantity and
    // no value in total, so it is shown apart from the real variance.
    const neutral = new Map<string, number>();
    const groups = new Map<string, typeof lines>();
    for (const line of lines) {
      const key = `${line.itemId}|${line.batchId ?? ''}`;
      groups.set(key, [...(groups.get(key) ?? []), line]);
    }
    for (const rows of groups.values()) {
      const unlocated = rows.find((r) => r.storageLocationId === null && Number(r.varianceQuantity) < 0);
      if (!unlocated) continue;
      // Value-neutral only when the shelf row and the unlocated row carry the
      // same frozen unit cost. Otherwise moving the quantity would change value,
      // so the pair stays a real variance and nothing is hidden as neutral.
      const found = rows.filter((r) =>
        r.storageLocationId !== null &&
        Number(r.varianceQuantity) > 0 &&
        Math.abs(Number(r.unitCost) - Number(unlocated.unitCost)) < 0.00005);
      const foundTotal = found.reduce((sum, r) => sum + Number(r.varianceQuantity), 0);
      const moved = Math.min(foundTotal, -Number(unlocated.varianceQuantity));
      if (moved <= 0) continue;
      neutral.set(unlocated.id, moved);
      let left = moved;
      for (const r of found) {
        const part = Math.min(left, Number(r.varianceQuantity));
        if (part > 0) neutral.set(r.id, part);
        left -= part;
      }
    }
    const classified = lines.map((line) => {
      const moved = neutral.get(line.id) ?? 0;
      const variance = Number(line.varianceQuantity);
      const real = variance === 0 ? 0 : variance > 0 ? variance - moved : variance + moved;
      return {
        ...line,
        assignmentQuantity: moved.toFixed(MONEY_SCALE),
        realVarianceQuantity: real.toFixed(MONEY_SCALE),
        varianceKind: variance === 0 ? 'MATCH' : moved === 0 ? 'VARIANCE' : real === 0 ? 'ASSIGNMENT' : 'MIXED',
      };
    });
    const netVarianceValue = classified.reduce(
      (sum, line) => sum + Number(line.realVarianceQuantity) * Number(line.unitCost),
      0,
    );
    const variances = lines.filter((line) => Number(line.varianceQuantity) !== 0);
    return {
      ...this.toSummary(session),
      lines: classified,
      assignedQuantity: [...neutral.values()].reduce((a, b) => a + b, 0) / 2,
      realVarianceValue: netVarianceValue.toFixed(MONEY_SCALE),
      varianceCount: variances.length,
      varianceValue: variances
        .reduce((sum, line) => sum + Number(line.varianceValue), 0)
        .toFixed(MONEY_SCALE),
      countedLines: lines.filter((line) => line.countedQuantity !== null).length,
      totalLines: lines.length,
    };
  }

  /// Opens a session and freezes what the system believes, right now.
  ///
  /// The freeze is the whole point: a receipt posted while somebody is counting
  /// must not silently change the target, so the quantities compared against are
  /// the ones written here.
  async start(
    companyId: string,
    userId: string,
    dto: {
      branchId?: string | null;
      warehouseId: string;
      scope?: 'FULL' | 'PARTIAL';
      itemIds?: string[];
      notes?: string;
    },
    scope: WarehouseScope = null,
  ) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.warehouseId, companyId, deletedAt: null, isActive: true },
      select: { id: true, branchId: true },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    if (scope !== null && !scope.includes(warehouse.branchId)) {
      throw new BadRequestException('This warehouse belongs to a branch you cannot access.');
    }

    const partial = (dto.scope ?? 'FULL') === 'PARTIAL';
    const itemIds = (dto.itemIds ?? []).filter(Boolean);
    if (partial && itemIds.length === 0) {
      throw new BadRequestException('A partial count must name the items it covers.');
    }
    if (partial) {
      const uniqueItemIds = [...new Set(itemIds)];
      const eligible = await this.prisma.item.findMany({
        where: {
          id: { in: uniqueItemIds },
          companyId,
          deletedAt: null,
          isStockTracked: true,
        },
        select: { id: true },
      });
      if (eligible.length !== uniqueItemIds.length) {
        throw new BadRequestException('A partial count can include only existing stock-tracked items.');
      }
    }

    // The session is created inside the transaction and read back after it
    // commits. Reading it from inside - which this used to do - asks a
    // connection that cannot yet see the row, so the create answered "session
    // not found" and rolled itself back: no count could ever be opened.
    const sessionId = await this.prisma.$transaction(async (tx) => {
      const code = await this.numbers.next(tx, companyId, 'STOCK_TAKE', 'STK');
      const session = await tx.stockTakeSession.create({
        data: {
          companyId,
          branchId: warehouse.branchId,
          warehouseId: warehouse.id,
          code,
          scope: partial ? 'PARTIAL' : 'FULL',
          status: 'COUNTING',
          frozenAt: new Date(),
          notes: dto.notes?.trim() || null,
          createdBy: userId,
        },
      });

      // Lot-controlled goods freeze per lot; everything else freezes per item
      // from the warehouse's own book.
      const lots = await tx.itemBatch.findMany({
        where: {
          companyId,
          warehouseId: warehouse.id,
          deletedAt: null,
          remainingQuantity: { gt: 0 },
          ...(partial ? { itemId: { in: itemIds } } : {}),
        },
        select: {
          id: true,
          itemId: true,
          remainingQuantity: true,
          unitCost: true,
        },
      });
      const lotItems = new Set(lots.map((lot) => lot.itemId));

      // What each shelf holds, from the movement ledger: one count row per
      // item (and lot) and shelf, and the part no shelf holds as its own row
      // with no location, so a count can say where the rest really is.
      const shelfRows = await tx.$queryRaw<
        Array<{ itemId: string; batchId: string | null; storageLocationId: string; quantity: Prisma.Decimal }>
      >(Prisma.sql`
        SELECT m."itemId" AS "itemId", m."batchId" AS "batchId", m."storageLocationId" AS "storageLocationId",
               SUM(CASE WHEN m."direction" = 'IN' THEN m."quantity" ELSE -m."quantity" END) AS "quantity"
          FROM "stock_movements" m
         WHERE m."companyId" = ${companyId}::uuid
           AND m."warehouseId" = ${warehouse.id}::uuid
           AND m."storageLocationId" IS NOT NULL
           ${partial ? Prisma.sql`AND m."itemId" = ANY(${itemIds}::uuid[])` : Prisma.empty}
         GROUP BY m."itemId", m."batchId", m."storageLocationId"
        HAVING SUM(CASE WHEN m."direction" = 'IN' THEN m."quantity" ELSE -m."quantity" END) > 0
      `);
      const located = (itemId: string, batchId: string | null) =>
        shelfRows.filter((r) => r.itemId === itemId && (r.batchId ?? null) === batchId);
      const sum = (rows: Array<{ quantity: Prisma.Decimal }>) =>
        rows.reduce((t, r) => t.plus(new Prisma.Decimal(r.quantity)), new Prisma.Decimal(0));
      const makeLine = async (itemId: string, batchId: string | null, storageLocationId: string | null, systemQuantity: Prisma.Decimal, unitCost: Prisma.Decimal) => {
        await tx.stockTakeLine.create({
          data: {
            sessionId: session.id,
            itemId,
            ...(batchId ? { batchId } : {}),
            systemQuantity,
            unitCost,
            // new column: written through a cast so this compiles before and after prisma generate
            ...({ storageLocationId } as object),
          },
        });
      };

      for (const lot of lots) {
        const onShelves = located(lot.itemId, lot.id);
        for (const row of onShelves) {
          await makeLine(lot.itemId, lot.id, row.storageLocationId, new Prisma.Decimal(row.quantity), lot.unitCost);
        }
        const rest = lot.remainingQuantity.minus(sum(onShelves));
        if (rest.greaterThan(0) || onShelves.length === 0) {
          await makeLine(lot.itemId, lot.id, null, Prisma.Decimal.max(rest, new Prisma.Decimal(0)), lot.unitCost);
        }
      }

      const balances = await tx.warehouseStockBalance.findMany({
        where: {
          companyId,
          warehouseId: warehouse.id,
          ...(partial ? { itemId: { in: itemIds } } : {}),
        },
        select: { itemId: true, quantity: true, value: true },
      });
      for (const balance of balances) {
        if (lotItems.has(balance.itemId)) continue;
        const unitCost = balance.quantity.isZero()
          ? new Prisma.Decimal(0)
          : balance.value.div(balance.quantity).toDecimalPlaces(MONEY_SCALE);
        const onShelves = located(balance.itemId, null);
        for (const row of onShelves) {
          await makeLine(balance.itemId, null, row.storageLocationId, new Prisma.Decimal(row.quantity), unitCost);
        }
        const rest = balance.quantity.minus(sum(onShelves));
        if (rest.greaterThan(0) || onShelves.length === 0) {
          await makeLine(balance.itemId, null, null, Prisma.Decimal.max(rest, new Prisma.Decimal(0)), unitCost);
        }
      }

      // Every stock-tracked item belongs in a FULL count, including items
      // whose current shelf balance is zero. Otherwise a count cannot record
      // newly found goods for an item the system believes is out of stock.
      // PARTIAL counts use the explicitly selected catalogue entries instead.
      const seen = new Set<string>([
        ...lots.map((lot) => lot.itemId),
        ...balances.map((balance) => balance.itemId),
      ]);
      const missingItemIds = partial
        ? itemIds.filter((itemId) => !seen.has(itemId))
        : (
            await tx.item.findMany({
              where: { companyId, deletedAt: null, isStockTracked: true },
              select: { id: true },
            })
          ).map((item) => item.id).filter((itemId) => !seen.has(itemId));

      for (const itemId of missingItemIds) {
        const item = await tx.item.findFirst({
          where: {
            id: itemId,
            companyId,
            deletedAt: null,
            isStockTracked: true,
          },
          select: { id: true },
        });
        if (!item) throw new BadRequestException('A counted item does not exist');
        await tx.stockTakeLine.create({
          data: { sessionId: session.id, itemId, systemQuantity: 0, unitCost: 0 },
        });
      }

      return { id: session.id, code };
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'stock_take_sessions',
      entityId: sessionId.id,
      after: {
        code: sessionId.code,
        warehouseId: warehouse.id,
        scope: partial ? 'PARTIAL' : 'FULL',
      },
    });

    return this.findOne(companyId, sessionId.id, scope);
  }

  private async lockSession(tx: { $queryRaw: (...a: any[]) => Promise<unknown> }, id: string) {
    await tx.$queryRaw`SELECT id FROM stock_take_sessions WHERE id = ${id}::uuid FOR UPDATE`;
  }

  /// Adds a count row for a shelf the freeze did not list: goods found on a
  /// shelf the system thought empty. The expected quantity is zero, so whatever
  /// is counted there is a surplus on that shelf. When the same item (and lot)
  /// has an unlocated row, counting that row lower by the same amount makes the
  /// pair a neutral assignment (see findOne) instead of a real difference.
  async addLocation(
    companyId: string,
    userId: string,
    id: string,
    dto: { itemId: string; batchId?: string | null; storageLocationId: string },
    scope: WarehouseScope = null,
  ) {
    const session = await this.prisma.stockTakeSession.findFirst({
      where: { id, companyId, ...(scope !== null ? { branchId: { in: scope } } : {}) },
      select: { id: true, warehouseId: true },
    });
    if (!session) throw new NotFoundException('Stock-take session not found');
    if (!dto?.itemId || !dto?.storageLocationId) {
      throw new BadRequestException('اختر الصنف وموقع التخزين. / Choose the item and the storage location.');
    }
    const batchId = dto.batchId ?? null;
    await this.prisma.$transaction(async (tx) => {
      await this.lockSession(tx as never, session.id);
      const fresh = await tx.stockTakeSession.findFirst({ where: { id: session.id, companyId }, select: { status: true } });
      if (!fresh || fresh.status !== 'COUNTING') {
        throw new BadRequestException({
          code: 'STOCK_TAKE_NOT_COUNTING',
          message: `لا يمكن إضافة موقع: الجرد ليس في مرحلة العد (الحالة: ${fresh?.status ?? '-'}). / A location can be added only while the count is open (status: ${fresh?.status ?? '-'}). ما تم إدخاله محفوظ / what was entered is kept.`,
        });
      }
      const siblings = await tx.stockTakeLine.findMany({
        where: { sessionId: session.id, itemId: dto.itemId },
        select: { id: true, batchId: true, storageLocationId: true, unitCost: true },
      } as never) as unknown as Array<{ id: string; batchId: string | null; storageLocationId: string | null; unitCost: Prisma.Decimal }>;
      if (siblings.length === 0) {
        throw new BadRequestException({
          code: 'STOCK_TAKE_ITEM_NOT_IN_SESSION',
          message: 'هذا الصنف ليس ضمن هذا الجرد. أضفه عند فتح جرد جديد أو اختر صنفًا من الجرد. / This item is not part of this count. Choose an item that is in the count, or include it when opening a new count.',
        });
      }
      const shelf = await tx.storageLocation.findFirst({
        where: { id: dto.storageLocationId, companyId, deletedAt: null },
        select: { id: true, code: true, isActive: true, warehouseId: true },
      });
      const fix = 'اختر موقعًا نشطًا من مخزن الجرد؛ ما تم عدّه محفوظ. / Choose an active location of the counted warehouse; what you counted is kept.';
      if (!shelf) throw new BadRequestException({ code: 'STOCK_TAKE_LOCATION_NOT_FOUND', message: `موقع التخزين غير موجود. ${fix}` });
      if (!shelf.isActive) {
        throw new BadRequestException({ code: 'STOCK_TAKE_LOCATION_INACTIVE', message: `الموقع ${shelf.code} غير مفعّل. فعّله أو ${fix}`, errors: { locationCode: shelf.code.slice(0, 64) } });
      }
      if (session.warehouseId && shelf.warehouseId !== session.warehouseId) {
        throw new BadRequestException({ code: 'STOCK_TAKE_LOCATION_WRONG_WAREHOUSE', message: `الموقع ${shelf.code} يتبع مخزنًا آخر غير مخزن الجرد. ${fix}`, errors: { locationCode: shelf.code.slice(0, 64) } });
      }
      const hasLots = siblings.some((l) => l.batchId !== null);
      if (hasLots && !batchId) {
        throw new BadRequestException({ code: 'STOCK_TAKE_LOT_REQUIRED', message: 'هذا الصنف له دفعات: حدّد الدفعة التي وجدتها على الموقع. / This item is lot-tracked: choose the lot you found on the shelf.' });
      }
      if (!hasLots && batchId) {
        throw new BadRequestException({ code: 'STOCK_TAKE_LOT_NOT_IN_SESSION', message: 'هذه الدفعة ليست ضمن هذا الجرد لهذا الصنف. / This lot is not part of this count for the item.' });
      }
      const sameLot = siblings.filter((l) => (l.batchId ?? null) === batchId);
      if (hasLots && sameLot.length === 0) {
        throw new BadRequestException({ code: 'STOCK_TAKE_LOT_NOT_IN_SESSION', message: 'هذه الدفعة ليست ضمن هذا الجرد لهذا الصنف. / This lot is not part of this count for the item.' });
      }
      if (sameLot.some((l) => l.storageLocationId === shelf.id)) {
        throw new ConflictException({
          code: 'STOCK_TAKE_LOCATION_ALREADY_COUNTED',
          message: `الموقع ${shelf.code} موجود بالفعل في هذا الجرد لنفس الصنف؛ سجّل الكمية على سطره. / Location ${shelf.code} is already a row of this count for the item; enter the quantity on that row.`,
          errors: { locationCode: shelf.code.slice(0, 64) },
        });
      }
      // Copy the cost of the unlocated row first (the bucket this surplus is
      // most likely taken from), then any positive sibling cost.
      const unitCost =
        sameLot.find((l) => l.storageLocationId === null)?.unitCost ??
        sameLot.map((l) => l.unitCost).find((c) => c.greaterThan(0)) ??
        new Prisma.Decimal(0);
      await tx.stockTakeLine.create({
        data: {
          sessionId: session.id,
          itemId: dto.itemId,
          batchId,
          systemQuantity: 0,
          unitCost,
          ...({ storageLocationId: shelf.id } as object),
        },
      });
    });
    await this.audit.record({
      companyId, userId, action: 'COUNT', entity: 'stock_take_sessions', entityId: session.id,
      after: { addedLocation: dto.storageLocationId, itemId: dto.itemId },
    });
    return this.findOne(companyId, session.id, scope);
  }

  /// Records what was actually found. Only the counted figure is accepted; the
  /// variance is computed here, from the frozen system quantity, so a client
  /// cannot post its own idea of the difference.
  async record(
    companyId: string,
    userId: string,
    id: string,
    dto: {
      lines: Array<{
        lineId: string;
        countedQuantity: number;
        /// The unit the counted figure was entered in, when the counter counted
        /// cartons instead of pieces. Omitted means the figure already is in
        /// base units, which is what every client written before barcode
        /// counting sent.
        unitName?: string;
        notes?: string;
      }>;
      finish?: boolean;
    },
    scope: WarehouseScope = null,
  ) {
    const session = await this.prisma.stockTakeSession.findFirst({
      where: { id, companyId, ...(scope !== null ? { branchId: { in: scope } } : {}) },
      select: { id: true, status: true, warehouseId: true },
    });
    if (!session) throw new NotFoundException('Stock-take session not found');
    if (session.status !== 'COUNTING') {
      throw new BadRequestException(
        `This session is no longer open for counting (status: ${session.status}).`,
      );
    }
    if (!Array.isArray(dto.lines) || dto.lines.length === 0) {
      throw new BadRequestException('Nothing to record.');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.lockSession(tx as never, session.id);
      // The status was read before this lock. A finish, cancel or approve that
      // committed in between must stop this write, so read it again under the lock.
      const locked = await tx.stockTakeSession.findFirst({ where: { id: session.id, companyId }, select: { status: true } });
      if (!locked || locked.status !== 'COUNTING') {
        throw new BadRequestException(
          `هذا الجرد لم يعد مفتوحًا للعد (الحالة: ${locked?.status ?? '-'}). ما أدخلته لم يُحفظ في الجرد؛ أعد إدخاله بعد إعادة فتح العد أو في جرد جديد. / ` +
            `This count is no longer open for counting (status: ${locked?.status ?? '-'}). Your figures were not saved to it; enter them again once counting is reopened or in a new count.`,
        );
      }
      for (const entry of dto.lines) {
        const line = await tx.stockTakeLine.findFirst({
          where: { id: entry.lineId, sessionId: session.id },
          select: {
            id: true,
            systemQuantity: true,
            unitCost: true,
            item: {
              select: {
                unit: true,
                units: {
                  select: {
                    id: true,
                    unit: true,
                    factor: true,
                    isActive: true,
                  },
                },
              },
            },
          },
        });
        if (!line) {
          throw new BadRequestException(`Line ${entry.lineId} does not belong to this session.`);
        }
        // The shelf count is compared with the frozen system figure, and that
        // figure is in base units. A counter who scanned a carton typed "1",
        // which is one carton and not one piece, so the conversion happens
        // here - once - exactly as an invoice line converts. Multiplying in
        // the screen as well would count 24 cartons of 24 pieces.
        const entered = new Prisma.Decimal(entry.countedQuantity);
        // A count of zero is a real answer - "the shelf is empty" - and it is
        // accepted, but the UNIT STILL HAS TO BE VALID. The old code short-
        // circuited the whole conversion when the figure was zero, which meant
        // a count of `0` on a misspelled or inactive unit was stored silently:
        // the counter believed they had counted a carton, and the session
        // recorded a zero it never checked. Resolving the unit first and then
        // keeping the zero keeps both properties: the answer is still zero, and
        // an unusable unit is still refused.
        //
        // The helper's zero guard exists for a document line that would post
        // nothing; a stock take has no such rule, so it is relaxed here - but
        // ONLY that rule. The unit is still resolved, so an unknown or inactive
        // unit is refused even when the counter typed zero.
        const resolved = resolveUnitSelection({
          lineLabel: `Line ${entry.lineId}`,
          requestedUnitName: entry.unitName ?? null,
          enteredQuantity: entered,
          baseUnitName: line.item?.unit ?? '',
          units: line.item?.units ?? [],
          allowZeroBaseQuantity: true,
        });
        const counted = resolved.baseQuantity.toDecimalPlaces(MONEY_SCALE);
        if (counted.isNegative()) {
          throw new BadRequestException('A counted quantity cannot be negative.');
        }
        const variance = counted.minus(line.systemQuantity);
        await tx.stockTakeLine.update({
          where: { id: line.id },
          data: {
            countedQuantity: counted,
            varianceQuantity: variance,
            varianceValue: variance.mul(line.unitCost).toDecimalPlaces(MONEY_SCALE),
            countedAt: new Date(),
            countedBy: userId,
            notes: entry.notes?.trim() || null,
          },
        });
      }
      if (dto.finish) {
        const uncounted = await tx.stockTakeLine.count({
          where: { sessionId: session.id, countedQuantity: null },
        });
        if (uncounted > 0) {
          throw new BadRequestException(
            `Cannot finish this count: ${uncounted} line(s) have not been counted.`,
          );
        }
        await tx.stockTakeSession.update({
          where: { id: session.id },
          data: { status: 'REVIEW' },
        });
      }
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'COUNT',
      entity: 'stock_take_sessions',
      entityId: session.id,
      after: { lines: dto.lines.length, finished: Boolean(dto.finish) },
    });
    if (dto.finish) await this.announce(companyId, session.id, 'SUBMIT', userId);

    return this.findOne(companyId, session.id, scope);
  }

  /// Keeps the notification centre in step with the count at once. Runs after
  /// the action has committed and never undoes it; the 30-minute scan is the
  /// backstop.
  private async announce(
    companyId: string,
    id: string,
    action: 'SUBMIT' | 'APPROVE' | 'CANCEL',
    userId: string,
    createdBy?: string | null,
  ) {
    if (!this.notifications) return;
    try {
      const session = await this.prisma.stockTakeSession.findFirst({
        where: { id, companyId },
        select: { branchId: true, code: true },
      });
      if (!session) return;
      if (action === 'SUBMIT') {
        await this.notifications.raiseSafely({
          companyId,
          type: STOCKTAKE_PENDING_APPROVAL,
          branchId: session.branchId,
          entityType: 'StockTakeSession',
          entityId: id,
          entityRef: session.code,
          actionPath: `/inventory/stock-takes?session=${id}`,
          titleEn: `Stock count ${session.code} is waiting for approval`,
          titleAr: `الجرد ${session.code} في انتظار اعتماد الفروق`,
          dedupe: dedupeKey({ type: STOCKTAKE_PENDING_APPROVAL, entityId: id }),
        });
        return;
      }
      await this.notifications.clearPending(companyId, 'StockTakeSession', id);
      if (action === 'APPROVE') {
        await this.notifications.tellRequester({
          companyId,
          branchId: session.branchId,
          requesterId: createdBy,
          decidedBy: userId,
          outcome: 'APPROVED',
          entityType: 'StockTakeSession',
          entityId: id,
          entityRef: session.code,
          nameAr: 'الجرد',
          nameEn: 'Stock count',
          actionPath: `/inventory/stock-takes?session=${id}`,
        });
      }
    } catch {
      // The scan reconciles the centre on its next pass.
    }
  }

  /// Approves the difference, once.
  ///
  /// A conditional update is the whole concurrency story: two approvers, two
  /// clicks, one approval, and the second person is told the truth.
  async approve(companyId: string, userId: string, id: string, scope: WarehouseScope = null) {
    const session = await this.prisma.stockTakeSession.findFirst({
      where: { id, companyId, ...(scope !== null ? { branchId: { in: scope } } : {}) },
      select: { id: true, status: true, code: true, createdBy: true },
    });
    if (!session) throw new NotFoundException('Stock-take session not found');
    if (session.status === 'APPROVED' || session.status === 'POSTED') {
      throw new BadRequestException(
        `This count was already approved (status: ${session.status}). / تم اعتماد هذا الجرد مسبقًا.`,
      );
    }
    if (session.status !== 'REVIEW') {
      throw new BadRequestException(
        `A count can be approved only after every line is counted and submitted for review (status: ${session.status}).`,
      );
    }
    if (session.createdBy && session.createdBy === userId) {
      throw new BadRequestException(
        'The person who opened a count cannot approve its differences.',
      );
    }

    const claimed = await this.prisma.stockTakeSession.updateMany({
      where: { id: session.id, companyId, status: 'REVIEW' },
      data: { status: 'APPROVED', approvedAt: new Date(), approvedBy: userId },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('This count was approved by someone else a moment ago.');
    }

    await this.audit.record({
      companyId,
      userId,
      action: 'APPROVE',
      entity: 'stock_take_sessions',
      entityId: session.id,
      after: { code: session.code, approvedBy: userId },
    });
    await this.announce(companyId, session.id, 'APPROVE', userId, session.createdBy);

    return this.findOne(companyId, session.id, scope);
  }

  /// Turns the approved difference into one adjustment document and posts it.
  ///
  /// The claim happens first: a retry after a dropped connection finds the
  /// session already POSTED and is told so, instead of booking the difference
  /// twice.
  async post(companyId: string, userId: string, id: string, scope: WarehouseScope = null) {
    const session = await this.prisma.stockTakeSession.findFirst({
      where: { id, companyId, ...(scope !== null ? { branchId: { in: scope } } : {}) },
      include: { lines: true },
    });
    if (!session) throw new NotFoundException('Stock-take session not found');
    if (session.status !== 'APPROVED') {
      throw new BadRequestException(
        session.status === 'POSTED'
          ? 'This count has already been posted. / تم ترحيل هذا الجرد مسبقًا.'
          : `A count is posted only after it is approved (status: ${session.status}).`,
      );
    }

    const variances = session.lines.filter((line) => !line.varianceQuantity.isZero());
    if (variances.length === 0) {
      await this.prisma.stockTakeSession.update({
        where: { id: session.id },
        data: { status: 'POSTED', postedAt: new Date(), postedBy: userId },
      });
      return this.findOne(companyId, session.id, scope);
    }

    const claimed = await this.prisma.stockTakeSession.updateMany({
      where: { id: session.id, companyId, status: 'APPROVED' },
      data: { status: 'POSTED', postedAt: new Date(), postedBy: userId },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('This count was posted by someone else a moment ago.');
    }

    try {
      const idempotencyKey = `stock-take:${session.id}`;
      const lines = variances.map((line) => ({
        itemId: line.itemId,
        quantity: Number(line.varianceQuantity),
        unitCost: Number(line.unitCost),
        batchId: line.batchId ?? undefined,
        storageLocationId: (line as { storageLocationId?: string | null }).storageLocationId ?? undefined,
        notes: line.notes ?? `Stock-take ${session.code}`,
      }));
      // Reuse the session's own document after an interrupted attempt. The
      // session UUID is a server-generated key; do not rebuild a new request
      // whose date (or other presentation fields) could change on a later day.
      const existing = await this.prisma.stockDocument.findFirst({
        where: { companyId, branchId: session.branchId, idempotencyKey, deletedAt: null },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      let document: { id: string };
      if (existing) {
        const sameLines = existing.lines.length === lines.length && existing.lines.every((saved, index) => {
          const expected = lines[index];
          return saved.itemId === expected.itemId &&
            saved.quantity.equals(expected.quantity) &&
            saved.unitCost.equals(expected.unitCost) &&
            (saved.batchId ?? null) === (expected.batchId ?? null) &&
            ((saved as { storageLocationId?: string | null }).storageLocationId ?? null) === (expected.storageLocationId ?? null);
        });
        if (
          existing.kind !== StockDocumentKind.ADJUSTMENT ||
          existing.toWarehouseId !== (session.warehouseId ?? null) ||
          !['DRAFT', 'POSTED'].includes(existing.status) ||
          (existing.stockTakeSessionId !== null && existing.stockTakeSessionId !== session.id) ||
          !sameLines
        ) {
          throw new ConflictException('The existing stock-take document does not match this approved count.');
        }
        document = { id: existing.id };
      } else {
        document = await this.documents.create(
          companyId,
          session.branchId,
          userId,
          {
            kind: StockDocumentKind.ADJUSTMENT,
            branchId: session.branchId,
            toWarehouseId: session.warehouseId ?? undefined,
            // Freeze the date to the count's snapshot, not the retry's day.
            documentDate: (session.frozenAt ?? session.createdAt).toISOString().slice(0, 10),
            reason: `Stock-take ${session.code}`,
            notes: session.notes ?? undefined,
            lines,
          },
          { idempotencyKey } as never,
        );
      }
      const posted = existing?.status === 'POSTED'
        ? { journalEntryId: existing.journalEntryId }
        : await this.documents.post(companyId, userId, document.id);

      await this.prisma.stockTakeSession.update({
        where: { id: session.id },
        data: {
          documentId: document.id,
          journalEntryId: posted.journalEntryId ?? null,
        },
      });
      // The document carries the link both ways: a reader who opens the
      // adjustment can tell which count produced it.
      await this.prisma.stockDocument.updateMany({
        where: { id: document.id, companyId },
        data: { stockTakeSessionId: session.id },
      });

      await this.audit.record({
        companyId,
        userId,
        action: 'POST',
        entity: 'stock_take_sessions',
        entityId: session.id,
        after: {
          code: session.code,
          documentId: document.id,
          lines: variances.length,
        },
      });
    } catch (error) {
      // Putting the session back is what makes the failure retryable: the
      // difference is still approved, it simply has not been booked yet.
      await this.prisma.stockTakeSession.updateMany({
        where: { id: session.id, companyId, status: 'POSTED', documentId: null },
        data: { status: 'APPROVED', postedAt: null, postedBy: null },
      });
      throw error;
    }

    return this.findOne(companyId, session.id, scope);
  }

  async cancel(companyId: string, userId: string, id: string, reason?: string, scope: WarehouseScope = null) {
    const session = await this.prisma.stockTakeSession.findFirst({
      where: { id, companyId, ...(scope !== null ? { branchId: { in: scope } } : {}) },
      select: { id: true, status: true, code: true },
    });
    if (!session) throw new NotFoundException('Stock-take session not found');
    if (session.status === 'POSTED') {
      throw new BadRequestException('A posted count cannot be cancelled; reverse its document.');
    }
    const claimed = await this.prisma.stockTakeSession.updateMany({
      where: { id: session.id, companyId, status: { in: ['DRAFT', 'COUNTING', 'REVIEW', 'APPROVED'] } },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: userId,
        notes: reason?.trim() || undefined,
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('This count is no longer open.');
    }
    await this.audit.record({
      companyId,
      userId,
      action: 'CANCEL',
      entity: 'stock_take_sessions',
      entityId: session.id,
      after: { code: session.code, reason: reason ?? null },
    });
    await this.announce(companyId, session.id, 'CANCEL', userId, null);
    return this.findOne(companyId, session.id, scope);
  }

  private toSummary(row: {
    id: string;
    code: string;
    branchId: string;
    warehouseId: string | null;
    scope: string;
    status: string;
    frozenAt: Date | null;
    createdBy?: string | null;
    approvedAt: Date | null;
    approvedBy: string | null;
    postedAt: Date | null;
    documentId: string | null;
    journalEntryId: string | null;
    createdAt: Date;
    notes: string | null;
    warehouse?: { code: string; nameEn: string; nameAr: string } | null;
    _count?: { lines: number };
  }) {
    return {
      id: row.id,
      code: row.code,
      branchId: row.branchId,
      warehouseId: row.warehouseId,
      warehouseCode: row.warehouse?.code ?? null,
      warehouseNameEn: row.warehouse?.nameEn ?? null,
      warehouseNameAr: row.warehouse?.nameAr ?? null,
      scope: row.scope,
      status: row.status,
      frozenAt: row.frozenAt,
      // Who opened the count. The approver must not be that person, so the
      // screen has to be able to say so before somebody clicks approve and is
      // told by an error message instead.
      createdBy: row.createdBy ?? null,
      approvedAt: row.approvedAt,
      approvedBy: row.approvedBy,
      postedAt: row.postedAt,
      documentId: row.documentId,
      journalEntryId: row.journalEntryId,
      lineCount: row._count?.lines ?? null,
      notes: row.notes,
      createdAt: row.createdAt,
    };
  }
}
