import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, Prisma, StockDocumentKind } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StockLedgerService } from '../../common/warehouse/stock-ledger.service';
import { WarehouseScope, WarehouseService } from '../../common/warehouse/warehouse.service';
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
  ) {}

  async list(
    companyId: string,
    query: { status?: string; warehouseId?: string; page?: number; pageSize?: number } = {},
    scope: WarehouseScope = null,
  ) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);
    const where: Prisma.StockTakeSessionWhereInput = {
      companyId,
      ...(scope !== null ? { branchId: { in: scope } } : {}),
      ...(query.status ? { status: query.status.toUpperCase() } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
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

    const lines = session.lines.map((line) => ({
      id: line.id,
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
    const variances = lines.filter((line) => Number(line.varianceQuantity) !== 0);
    return {
      ...this.toSummary(session),
      lines,
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

      for (const lot of lots) {
        await tx.stockTakeLine.create({
          data: {
            sessionId: session.id,
            itemId: lot.itemId,
            batchId: lot.id,
            systemQuantity: lot.remainingQuantity,
            unitCost: lot.unitCost,
          },
        });
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
        await tx.stockTakeLine.create({
          data: {
            sessionId: session.id,
            itemId: balance.itemId,
            systemQuantity: balance.quantity,
            unitCost,
          },
        });
      }

      // A partial count of an item that is not in stock still needs a line:
      // counting nothing and finding ten boxes is the difference that matters.
      if (partial) {
        const seen = new Set<string>([
          ...lots.map((lot) => lot.itemId),
          ...balances.map((balance) => balance.itemId),
        ]);
        for (const itemId of itemIds) {
          if (seen.has(itemId)) continue;
          const item = await tx.item.findFirst({
            where: { id: itemId, companyId, deletedAt: null },
            select: { id: true },
          });
          if (!item) throw new BadRequestException('A counted item does not exist');
          await tx.stockTakeLine.create({
            data: { sessionId: session.id, itemId, systemQuantity: 0, unitCost: 0 },
          });
        }
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

  /// Records what was actually found. Only the counted figure is accepted; the
  /// variance is computed here, from the frozen system quantity, so a client
  /// cannot post its own idea of the difference.
  async record(
    companyId: string,
    userId: string,
    id: string,
    dto: {
      lines: Array<{ lineId: string; countedQuantity: number; notes?: string }>;
      finish?: boolean;
    },
    scope: WarehouseScope = null,
  ) {
    const session = await this.prisma.stockTakeSession.findFirst({
      where: { id, companyId, ...(scope !== null ? { branchId: { in: scope } } : {}) },
      select: { id: true, status: true, warehouseId: true },
    });
    if (!session) throw new NotFoundException('Stock-take session not found');
    if (!['COUNTING', 'REVIEW'].includes(session.status)) {
      throw new BadRequestException(
        `This session can no longer be counted (status: ${session.status}).`,
      );
    }
    if (!Array.isArray(dto.lines) || dto.lines.length === 0) {
      throw new BadRequestException('Nothing to record.');
    }

    await this.prisma.$transaction(async (tx) => {
      for (const entry of dto.lines) {
        const line = await tx.stockTakeLine.findFirst({
          where: { id: entry.lineId, sessionId: session.id },
          select: { id: true, systemQuantity: true, unitCost: true },
        });
        if (!line) {
          throw new BadRequestException(`Line ${entry.lineId} does not belong to this session.`);
        }
        const counted = new Prisma.Decimal(entry.countedQuantity).toDecimalPlaces(MONEY_SCALE);
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

    return this.findOne(companyId, session.id, scope);
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
    if (!['COUNTING', 'REVIEW'].includes(session.status)) {
      throw new BadRequestException(`This session cannot be approved (status: ${session.status}).`);
    }
    if (session.createdBy && session.createdBy === userId) {
      throw new BadRequestException(
        'The person who opened a count cannot approve its differences.',
      );
    }

    const claimed = await this.prisma.stockTakeSession.updateMany({
      where: { id: session.id, companyId, status: { in: ['COUNTING', 'REVIEW'] } },
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
      const document = await this.documents.create(
        companyId,
        session.branchId,
        userId,
        {
          kind: StockDocumentKind.ADJUSTMENT,
          branchId: session.branchId,
          toWarehouseId: session.warehouseId ?? undefined,
          documentDate: new Date().toISOString().slice(0, 10),
          reason: `Stock-take ${session.code}`,
          notes: session.notes ?? undefined,
          lines: variances.map((line) => ({
            itemId: line.itemId,
            quantity: Number(line.varianceQuantity),
            unitCost: Number(line.unitCost),
            batchId: line.batchId ?? undefined,
            notes: line.notes ?? `Stock-take ${session.code}`,
          })),
        },
        { idempotencyKey: `stock-take:${session.id}` },
      );
      const posted = await this.documents.post(companyId, userId, document.id);

      await this.prisma.stockTakeSession.update({
        where: { id: session.id },
        data: {
          documentId: document.id,
          journalEntryId: (posted as { journalEntryId?: string | null }).journalEntryId ?? null,
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
