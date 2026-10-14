import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, Prisma, StockDirection, StockDocumentKind } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanySettingsService } from '../../common/settings/company-settings.module';
import { WarehouseService } from '../../common/warehouse/warehouse.service';
import { AccountMapService } from '../accounting/account-map.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { PostingService } from '../accounting/posting.service';

const MONEY_SCALE = 4;

export interface StockDocumentLineInput {
  itemId: string;
  /** Adjustment: signed change. Count: ignored (countedQuantity is used). */
  quantity?: string | number;
  countedQuantity?: string | number;
  unitCost?: string | number;
  notes?: string;
}

/**
 * Stock changes that are not an invoice: adjustments, transfers and counts.
 *
 * Each one writes stock movements and - where the value of the stock changes -
 * a journal entry, in a single transaction. The rule is the same one the
 * invoices follow, which is what keeps the stock ledger and the general ledger
 * from ever telling two different stories.
 *
 * Valuation is the weighted average: an issue leaves at the average cost of
 * what is on hand, an addition brings in exactly what it cost.
 */
@Injectable()
export class StockDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: DocumentNumberService,
    private readonly posting: PostingService,
    private readonly accounts: AccountMapService,
    private readonly audit: AuditService,
    private readonly settings: CompanySettingsService,
    private readonly warehouses: WarehouseService,
  ) {}

  async findAll(
    companyId: string,
    query: { kind?: string; branchId?: string; from?: string; to?: string; page?: number; pageSize?: number } = {},
  ) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);

    const where: Prisma.StockDocumentWhereInput = { companyId, deletedAt: null };
    if (query.kind) {
      const kind = query.kind.toUpperCase();
      if (!Object.values(StockDocumentKind).includes(kind as StockDocumentKind)) {
        throw new BadRequestException(`Unknown stock document kind: ${query.kind}`);
      }
      where.kind = kind as StockDocumentKind;
    }
    if (query.branchId) where.branchId = query.branchId;
    if (query.from || query.to) {
      where.documentDate = {};
      if (query.from) (where.documentDate as Prisma.DateTimeFilter).gte = new Date(query.from);
      if (query.to) (where.documentDate as Prisma.DateTimeFilter).lte = new Date(query.to);
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.stockDocument.findMany({
        where,
        orderBy: [{ documentDate: 'desc' }, { documentNumber: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { lines: true, branch: { select: { code: true, nameEn: true, nameAr: true } } },
      }),
      this.prisma.stockDocument.count({ where }),
    ]);

    return {
      items: items.map((document) => ({
        ...this.toSummary(document),
        lineCount: document.lines.length,
        totalQuantity: document.lines
          .reduce((sum, line) => sum.plus(line.quantity), new Prisma.Decimal(0))
          .toFixed(MONEY_SCALE),
      })),
      total,
      page,
      pageSize,
    };
  }

  async findOne(companyId: string, id: string) {
    const document = await this.prisma.stockDocument.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        branch: { select: { code: true, nameEn: true, nameAr: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: { item: { select: { code: true, nameEn: true, nameAr: true, unit: true } } },
        },
      },
    });
    if (!document) throw new NotFoundException('Stock document not found');

    return {
      ...this.toSummary(document),
      lines: document.lines.map((line) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        itemId: line.itemId,
        itemCode: line.item.code,
        itemNameEn: line.item.nameEn,
        itemNameAr: line.item.nameAr,
        unit: line.item.unit,
        quantity: line.quantity.toFixed(MONEY_SCALE),
        unitCost: line.unitCost.toFixed(MONEY_SCALE),
        countedQuantity: line.countedQuantity?.toFixed(MONEY_SCALE) ?? null,
        notes: line.notes,
      })),
    };
  }

  async create(
    companyId: string,
    branchId: string | null,
    userId: string,
    dto: {
      kind: string;
      branchId?: string;
      fromBranchId?: string;
      toBranchId?: string;

      /// A transfer may name the warehouse the goods leave and the one they
      /// arrive at instead of two branches.
      fromWarehouseId?: string;
      toWarehouseId?: string;
      documentDate: string;
      reason?: string;
      notes?: string;
      lines: StockDocumentLineInput[];
    },
  ) {
    const kind = String(dto.kind ?? '').toUpperCase() as StockDocumentKind;
    if (!Object.values(StockDocumentKind).includes(kind)) {
      throw new BadRequestException('kind must be ADJUSTMENT, TRANSFER, COUNT or OPENING');
    }
    if (kind === StockDocumentKind.OPENING) {
      throw new BadRequestException(
        'Use an opening balance document for opening stock: it posts the accounting and the stock together.',
      );
    }

    if (!Array.isArray(dto.lines) || dto.lines.length === 0) {
      throw new BadRequestException('A stock document needs at least one line');
    }

    const targetBranch = dto.branchId ?? dto.toBranchId ?? branchId;
    if (!targetBranch) {
      throw new BadRequestException('The signed-in user is not assigned to a branch');
    }
    const date = this.date(dto.documentDate, 'documentDate');

    const lines: Array<{
      itemId: string;
      quantity: Prisma.Decimal;
      countedQuantity: Prisma.Decimal | null;
      unitCost: Prisma.Decimal;
      notes: string | null;
    }> = [];
    for (const [index, raw] of dto.lines.entries()) {
      const item = await this.prisma.item.findFirst({
        where: { id: raw.itemId, companyId, deletedAt: null },
        select: { id: true, isStockTracked: true, code: true },
      });
      if (!item) throw new BadRequestException(`Line ${index + 1}: the item does not exist`);
      if (!item.isStockTracked) {
        throw new BadRequestException(`Line ${index + 1}: item ${item.code} is not stock-tracked`);
      }

      const quantity =
        raw.quantity === undefined
          ? new Prisma.Decimal(0)
          : this.decimal(raw.quantity, `Line ${index + 1} quantity`);
      const countedQuantity =
        raw.countedQuantity === undefined
          ? null
          : this.decimal(raw.countedQuantity, `Line ${index + 1} counted quantity`);
      const unitCost =
        raw.unitCost === undefined
          ? new Prisma.Decimal(0)
          : this.decimal(raw.unitCost, `Line ${index + 1} unit cost`);

      if (kind !== StockDocumentKind.COUNT && quantity.isZero()) {
        throw new BadRequestException(`Line ${index + 1}: a quantity is required`);
      }
      if (kind === StockDocumentKind.COUNT && (!countedQuantity || countedQuantity.isNegative())) {
        throw new BadRequestException(
          `Line ${index + 1}: a count needs the quantity that was actually counted`,
        );
      }
      if (unitCost.isNegative()) {
        throw new BadRequestException(`Line ${index + 1}: the unit cost cannot be negative`);
      }

      lines.push({
        itemId: item.id,
        quantity,
        countedQuantity,
        unitCost,
        notes: raw.notes ?? null,
      });
    }

    const fromWarehouseId = dto.fromWarehouseId ? String(dto.fromWarehouseId) : null;
    const toWarehouseId = dto.toWarehouseId ? String(dto.toWarehouseId) : null;

    // A transfer moves stock between two places. They may be two warehouses of
    // the same branch, or two branches - and when two branches are named, the
    // warehouses on each side are optional.
    const movesBetweenBranches = Boolean(dto.fromBranchId) && String(dto.fromBranchId) !== targetBranch;
    const movesBetweenWarehouses =
      Boolean(fromWarehouseId) && Boolean(toWarehouseId) && fromWarehouseId !== toWarehouseId;

    let fromBranchId =
      kind === StockDocumentKind.TRANSFER ? (dto.fromBranchId ? String(dto.fromBranchId) : null) : null;
    if (kind === StockDocumentKind.TRANSFER) {
      if (!fromBranchId && movesBetweenWarehouses) fromBranchId = targetBranch;
      if (!fromBranchId) {
        throw new BadRequestException('A transfer needs the branch the stock leaves');
      }
      if (fromBranchId === targetBranch && !movesBetweenWarehouses) {
        throw new BadRequestException(
          'A transfer needs two different branches, or two different warehouses of the same branch',
        );
      }
      if (movesBetweenWarehouses && fromWarehouseId === toWarehouseId) {
        throw new BadRequestException('A transfer needs two different warehouses');
      }
      void movesBetweenBranches;
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const prefix =
        kind === StockDocumentKind.TRANSFER
          ? 'ST'
          : kind === StockDocumentKind.COUNT
            ? 'SC'
            : 'SA';
      const documentNumber = await this.numbers.next(tx, companyId, `STOCK_${kind}`, prefix);
      return tx.stockDocument.create({
        data: {
          companyId,
          branchId: targetBranch,
          kind,
          documentNumber,
          documentDate: date,
          fromBranchId,
          toBranchId: kind === StockDocumentKind.TRANSFER ? targetBranch : null,
          fromWarehouseId: kind === StockDocumentKind.TRANSFER ? fromWarehouseId : null,
          toWarehouseId: kind === StockDocumentKind.TRANSFER ? toWarehouseId : toWarehouseId,
          reason: dto.reason?.trim() || null,
          notes: dto.notes?.trim() || null,
          status: InvoiceStatus.DRAFT,
          createdBy: userId,
          lines: {
            create: lines.map((line, index) => ({
              lineNumber: index + 1,
              itemId: line.itemId,
              quantity: line.quantity,
              unitCost: line.unitCost,
              countedQuantity: line.countedQuantity,
              notes: line.notes,
            })),
          },
        },
      });
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'stock_documents',
      entityId: created.id,
      after: { documentNumber: created.documentNumber, kind, lines: lines.length },
    });

    return this.findOne(companyId, created.id);
  }

  /**
   * Posts the document: movements, stock balances and - when value changes -
   * one journal entry.
   */
  async post(companyId: string, userId: string, id: string) {
    const document = await this.prisma.stockDocument.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!document) throw new NotFoundException('Stock document not found');
    if (document.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException(
        `Only a draft stock document can be posted (current status: ${document.status})`,
      );
    }

    const settings = await this.settings.get(companyId);

    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.stockDocument.updateMany({
        where: { id: document.id, status: InvoiceStatus.DRAFT, deletedAt: null },
        data: { status: InvoiceStatus.POSTED, postedAt: new Date(), postedBy: userId },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('This document has just been posted by someone else.');
      }

      // Where the goods are: named on the document, or the branch's default
      // for a document that names none. Resolved here so a transfer between
      // two piles cannot be half-recorded.
      const toWarehouseId = await this.warehouses.resolve(
        tx,
        companyId,
        document.branchId,
        document.toWarehouseId,
      );
      const fromWarehouseId = document.fromBranchId
        ? await this.warehouses.resolve(
            tx,
            companyId,
            document.fromBranchId,
            document.fromWarehouseId,
          )
        : toWarehouseId;

      const journalLines: Array<{
        accountId: string;
        debit?: Prisma.Decimal;
        credit?: Prisma.Decimal;
        description: string;
      }> = [];
      let valueChange = new Prisma.Decimal(0);

      for (const line of document.lines) {
        if (document.kind === StockDocumentKind.TRANSFER) {
          // Out of the source branch, into the destination, at the cost the
          // stock actually carries. No value is created or destroyed, so no
          // journal entry is needed: it is the same company's inventory.
          const fromBalance = await this.balance(tx, companyId, document.fromBranchId as string, line.itemId);
          const availableQty = fromBalance?.quantity ?? new Prisma.Decimal(0);
          const availableValue = fromBalance?.value ?? new Prisma.Decimal(0);
          if (availableQty.lessThan(line.quantity) && !settings.allowNegativeStock) {
            throw new BadRequestException(
              `Not enough stock to transfer: ${availableQty.toFixed(MONEY_SCALE)} on hand, ` +
                `${line.quantity.toFixed(MONEY_SCALE)} requested.`,
            );
          }
          const unitCost = availableQty.isZero()
            ? line.unitCost
            : availableValue.div(availableQty).toDecimalPlaces(MONEY_SCALE);
          const totalCost = unitCost.mul(line.quantity).toDecimalPlaces(MONEY_SCALE);

          await this.move(tx, {
            companyId,
            branchId: document.fromBranchId as string,
            itemId: line.itemId,
            date: document.documentDate,
            direction: StockDirection.OUT,
            quantity: line.quantity,
            unitCost,
            totalCost,
            referenceType: 'STOCK_TRANSFER_OUT',
            referenceId: document.id,
            referenceNumber: document.documentNumber,
            userId,
            requireStock: !settings.allowNegativeStock,
            warehouseId: fromWarehouseId,
          });
          await this.move(tx, {
            companyId,
            branchId: document.branchId,
            itemId: line.itemId,
            date: document.documentDate,
            direction: StockDirection.IN,
            quantity: line.quantity,
            unitCost,
            totalCost,
            referenceType: 'STOCK_TRANSFER_IN',
            referenceId: document.id,
            referenceNumber: document.documentNumber,
            userId,
            requireStock: false,
            warehouseId: toWarehouseId,
          });
          continue;
        }

        // ADJUSTMENT and COUNT both come down to "this many units move".
        let quantity = line.quantity;
        let unitCost = line.unitCost;
        const balance = await this.balance(tx, companyId, document.branchId, line.itemId);
        const onHand = balance?.quantity ?? new Prisma.Decimal(0);
        const onHandValue = balance?.value ?? new Prisma.Decimal(0);
        const averageCost = onHand.isZero()
          ? new Prisma.Decimal(0)
          : onHandValue.div(onHand).toDecimalPlaces(MONEY_SCALE);

        if (document.kind === StockDocumentKind.COUNT) {
          const counted = line.countedQuantity ?? new Prisma.Decimal(0);
          quantity = counted.minus(onHand);
          if (unitCost.isZero()) unitCost = averageCost;
          await tx.stockDocumentLine.update({
            where: { id: line.id },
            data: { quantity, unitCost },
          });
        } else if (quantity.lessThan(0) && unitCost.isZero()) {
          // A write-off leaves at what the stock costs, unless the person
          // who wrote it off said otherwise.
          unitCost = averageCost;
        }

        if (quantity.isZero()) continue;

        const direction = quantity.greaterThan(0) ? StockDirection.IN : StockDirection.OUT;
        const absoluteQuantity = quantity.abs();
        const totalCost = unitCost.mul(absoluteQuantity).toDecimalPlaces(MONEY_SCALE);

        await this.move(tx, {
          companyId,
          branchId: document.branchId,
          itemId: line.itemId,
          date: document.documentDate,
          direction,
          quantity: absoluteQuantity,
          unitCost,
          totalCost,
          referenceType:
            document.kind === StockDocumentKind.COUNT ? 'STOCK_COUNT' : 'STOCK_ADJUSTMENT',
          referenceId: document.id,
          referenceNumber: document.documentNumber,
          userId,
          requireStock: direction === StockDirection.OUT && !settings.allowNegativeStock,
          warehouseId: toWarehouseId,
        });

        valueChange = valueChange.plus(
          direction === StockDirection.IN ? totalCost : totalCost.negated(),
        );
      }

      // The inventory account follows the stock. A shortfall is a cost; a
      // surplus reduces it - both land on the inventory-difference account so
      // the reason can be argued about without touching the stock figure.
      let journal: { id: string; entryNumber: string } | null = null;
      if (!valueChange.isZero()) {
        const accounts = await this.accounts.resolve(tx, companyId, [
          'inventory',
          'inventoryDifference',
        ]);
        journalLines.push(
          valueChange.greaterThan(0)
            ? {
                accountId: accounts.inventory,
                debit: valueChange,
                description: 'Stock increase',
              }
            : {
                accountId: accounts.inventory,
                credit: valueChange.negated(),
                description: 'Stock decrease',
              },
        );
        journalLines.push(
          valueChange.greaterThan(0)
            ? {
                accountId: accounts.inventoryDifference,
                credit: valueChange,
                description: document.reason ?? 'Inventory difference',
              }
            : {
                accountId: accounts.inventoryDifference,
                debit: valueChange.negated(),
                description: document.reason ?? 'Inventory difference',
              },
        );

        journal = await this.posting.post(tx, {
          companyId,
          branchId: document.branchId,
          userId,
          entryDate: document.documentDate,
          description:
            document.kind === StockDocumentKind.COUNT
              ? 'Stock count difference'
              : 'Stock adjustment',
          sourceType: 'STOCK_DOCUMENT',
          sourceId: document.id,
          sourceNumber: document.documentNumber,
          lines: journalLines,
        });

        await tx.stockDocument.update({
          where: { id: document.id },
          data: { journalEntryId: journal.id },
        });
      }

      return { journal, valueChange };
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'POST',
      entity: 'stock_documents',
      entityId: id,
      after: {
        documentNumber: document.documentNumber,
        kind: document.kind,
        journalNumber: result.journal?.entryNumber ?? null,
        valueChange: result.valueChange.toFixed(MONEY_SCALE),
      },
    });

    return this.findOne(companyId, id);
  }

  /** Reverses a posted document: opposite movements, and the entry mirror. */
  async reverse(companyId: string, userId: string, id: string) {
    const document = await this.prisma.stockDocument.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!document) throw new NotFoundException('Stock document not found');
    if (document.status !== InvoiceStatus.POSTED) {
      throw new BadRequestException('Only a posted stock document can be reversed');
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.stockDocument.updateMany({
        where: { id, status: InvoiceStatus.POSTED },
        data: { status: InvoiceStatus.REVERSED },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('This document has just been changed by someone else.');
      }

      const reversalToWarehouseId = await this.warehouses.resolve(
        tx,
        companyId,
        document.branchId,
        document.toWarehouseId,
      );
      const reversalFromWarehouseId = document.fromBranchId
        ? await this.warehouses.resolve(
            tx,
            companyId,
            document.fromBranchId,
            document.fromWarehouseId,
          )
        : reversalToWarehouseId;

      for (const line of document.lines) {
        const targets =
          document.kind === StockDocumentKind.TRANSFER
            ? [
                { branchId: document.fromBranchId as string, warehouseId: reversalFromWarehouseId },
                { branchId: document.branchId, warehouseId: reversalToWarehouseId },
              ]
            : [{ branchId: document.branchId, warehouseId: reversalToWarehouseId }];

        for (const [index, target] of targets.entries()) {
          const branchId = target.branchId;
          if (line.quantity.isZero()) continue;
          // The original movement's direction, flipped.
          const wasOut =
            document.kind === StockDocumentKind.TRANSFER
              ? index === 0
              : line.quantity.lessThan(0);
          await this.move(tx, {
            companyId,
            branchId,
            itemId: line.itemId,
            date: new Date(),
            direction: wasOut ? StockDirection.IN : StockDirection.OUT,
            quantity: line.quantity.abs(),
            unitCost: line.unitCost,
            totalCost: line.unitCost.mul(line.quantity.abs()).toDecimalPlaces(MONEY_SCALE),
            referenceType: 'STOCK_DOCUMENT_REVERSAL',
            referenceId: document.id,
            referenceNumber: document.documentNumber,
            userId,
            requireStock: false,
            warehouseId: target.warehouseId,
          });
        }
      }

      if (document.journalEntryId) {
        await this.posting.reverse(
          tx,
          companyId,
          userId,
          document.journalEntryId,
          `Reversal of stock document ${document.documentNumber}`,
        );
      }
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'REVERSE',
      entity: 'stock_documents',
      entityId: id,
    });

    return this.findOne(companyId, id);
  }

  // ------------------------------------------------------------------ helpers

  private async balance(
    tx: Prisma.TransactionClient,
    companyId: string,
    branchId: string,
    itemId: string,
  ) {
    const rows = await tx.$queryRaw<
      Array<{ quantity: Prisma.Decimal; value: Prisma.Decimal }>
    >(Prisma.sql`
      SELECT "quantity", "value"
        FROM "stock_balances"
       WHERE "companyId" = ${companyId}::uuid
         AND "branchId" = ${branchId}::uuid
         AND "itemId" = ${itemId}::uuid
       FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async move(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      branchId: string;
      itemId: string;
      date: Date;
      direction: StockDirection;
      quantity: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      totalCost: Prisma.Decimal;
      referenceType: string;
      referenceId: string;
      referenceNumber: string;
      userId: string;
      requireStock: boolean;
      /// Which pile the goods sat in, or moved to. Null only when the company
      /// has no warehouse for the branch at all.
      warehouseId?: string | null;
    },
  ) {
    const balance = await this.balance(tx, input.companyId, input.branchId, input.itemId);
    const onHand = balance?.quantity ?? new Prisma.Decimal(0);

    // The database deliberately enforces nonnegative stock balances.
    // Even paths that do not request an extra business-level check must not
    // attempt an OUT upsert that inserts a negative row.
    if (
      input.direction === StockDirection.OUT &&
      onHand.lessThan(input.quantity)
    ) {
      throw new BadRequestException(
        `Not enough stock: ${onHand.toFixed(MONEY_SCALE)} on hand, ` +
          `${input.quantity.toFixed(MONEY_SCALE)} requested in ${input.referenceNumber}.`,
      );
    }

    await tx.stockMovement.create({
      data: {
        companyId: input.companyId,
        branchId: input.branchId,
        warehouseId: input.warehouseId ?? null,
        itemId: input.itemId,
        movementDate: input.date,
        direction: input.direction,
        quantity: input.quantity,
        unitCost: input.unitCost,
        totalCost: input.totalCost,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        referenceNumber: input.referenceNumber,
        createdBy: input.userId,
      },
    });

    const where = {
      companyId_branchId_itemId: {
        companyId: input.companyId,
        branchId: input.branchId,
        itemId: input.itemId,
      },
    };
    if (input.direction === StockDirection.IN) {
      await tx.stockBalance.upsert({
        where,
        create: {
          companyId: input.companyId,
          branchId: input.branchId,
          itemId: input.itemId,
          quantity: input.quantity,
          value: input.totalCost,
        },
        update: {
          quantity: { increment: input.quantity },
          value: { increment: input.totalCost },
        },
      });
    } else {
      if (!balance) {
        throw new BadRequestException(
          `No stock balance exists for ${input.referenceNumber}; an OUT movement cannot create negative stock.`,
        );
      }
      await tx.stockBalance.update({
        where,
        data: {
          quantity: { decrement: input.quantity },
          value: { decrement: input.totalCost },
        },
      });
    }
  }

  private decimal(value: unknown, field: string): Prisma.Decimal {
    try {
      return new Prisma.Decimal(String(value)).toDecimalPlaces(MONEY_SCALE);
    } catch {
      throw new BadRequestException(`${field} is not a valid number`);
    }
  }

  private date(value: string, field: string): Date {
    const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${field} is not a valid date`);
    return parsed;
  }

  private toSummary(document: {
    id: string;
    documentNumber: string;
    kind: StockDocumentKind;
    documentDate: Date;
    status: InvoiceStatus;
    reason: string | null;
    notes: string | null;
    journalEntryId: string | null;
    postedAt: Date | null;
    createdAt: Date;
    branch?: { code: string; nameEn: string; nameAr: string };
  }) {
    return {
      id: document.id,
      documentNumber: document.documentNumber,
      kind: document.kind.toLowerCase(),
      documentDate: document.documentDate.toISOString().slice(0, 10),
      status: document.status.toLowerCase(),
      reason: document.reason,
      notes: document.notes,
      branch: document.branch,
      journalEntryId: document.journalEntryId,
      postedAt: document.postedAt?.toISOString() ?? null,
      createdAt: document.createdAt.toISOString(),
    };
  }
}
