import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockDirection } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  batchPolicyOf,
  dayOnly,
  daysUntil,
  expiryBand,
  issueAtAverage,
  movingAverage,
  normalizeExpiryDays,
  receiptProblems,
  selectLotsFefo,
} from '../../common/warehouse/batch-policy';
import { movementUnitSnapshot } from '../../common/units/unit-math';
import { StockLedgerService } from '../../common/warehouse/stock-ledger.service';
import { WarehouseScope, WarehouseService } from '../../common/warehouse/warehouse.service';
import { AccountMapService } from '../accounting/account-map.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { PostingService } from '../accounting/posting.service';

const MONEY_SCALE = 4;

/// What a lot needs to know about its item.
///
/// Structural rather than "the whole Item row", so a caller that already has
/// its own select (sales loads the item inside the posting transaction) can
/// pass what it has without a second read.
export interface BatchPolicyItem {
  id: string;
  code: string;
  unit: string;
  requiresBatch?: boolean | null;
  requiresProductionDate?: boolean | null;
  requiresExpiryDate?: boolean | null;
  useFefo?: boolean | null;
  allowExpiredIssue?: boolean | null;
  expiredIssueNeedsApproval?: boolean | null;
}

export interface ReceiveLotInput {
  branchId: string;
  warehouseId: string;
  itemId: string;
  batchNumber?: string | null;
  productionDate?: string | null;
  expiryDate?: string | null;
  /** In base units, like every other stock figure in the program. */
  quantity: QuantityInput;
  unitCost: QuantityInput;
  storageLocationId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceNumber?: string | null;
  notes?: string | null;
  documentDate?: string | null;
}

export interface IssueInput {
  branchId: string;
  /// Null only when the branch has no warehouse defined at all; the sale then
  /// issues the way it did before warehouses existed.
  warehouseId: string | null;
  itemId: string;
  quantity: QuantityInput;
  /** Chosen lot. Omitted means FEFO chooses, which is the normal case. */
  batchId?: string | null;
  /**
   * Lets this one issue *consider* expired lots, overriding an item policy
   * that forbids it.
   *
   * Only a caller that has already proved it may approve an expired issue - by
   * checking `inventory.batches.expired.issue` and stamping who did it - passes
   * `true` here. It is never taken straight from a request body: the boolean
   * travels on `IssueInput`, which is constructed by a service, not bound from
   * JSON.
   *
   * Opening this gate does not approve anything by itself. Whoever sets it must
   * also pass `expiredApproval`; the issue is refused otherwise, whatever the
   * item's `expiredIssueNeedsApproval` says.
   */
  allowExpired?: boolean;
  /// Who approved selling expired goods, and why. Required on every issue that
  /// actually takes expired stock - every one, with no setting that waives it -
  /// and written to the audit log with the lots and quantities that left.
  expiredApproval?: { userId: string; reason: string };
  reason?: string | null;
  storageLocationId?: string | null;
  referenceType?: string;
  referenceId?: string | null;
  referenceNumber?: string | null;
  documentDate?: string | null;
  /// How the line was typed. A sale of "1 reel of 500 m" still issues 500 m;
  /// the shape it was entered in belongs on the movement so the stock card can
  /// show it after the invoice is long closed.
  movementUnits?: {
    enteredUnit?: string | null;
    enteredQuantity?: Prisma.Decimal | null;
    unitFactor?: Prisma.Decimal | null;
    baseUnitName?: string | null;
  };
}

export interface WriteOffInput {
  branchId: string;
  warehouseId: string;
  itemId: string;
  batchId: string;
  quantity: QuantityInput;
  /** Required: a write-off without a reason is how stock disappears. */
  reason: string;
  documentDate?: string | null;
}

export interface TransferInput {
  branchId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  itemId: string;
  batchId: string;
  quantity: QuantityInput;
  reason?: string | null;
  documentDate?: string | null;
}

export type QuantityInput = string | number | Prisma.Decimal;

const toDecimal = (value: QuantityInput): Prisma.Decimal =>
  value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);

/// Lots: receiving them, issuing from them, moving them, and destroying them.
///
/// The rules themselves - which lot FEFO picks, what an issue costs, which
/// band a lot is in - live in `batch-policy.ts` and are unit tested there.
/// This service is the part that has to touch the database: it locks the
/// balances, writes the movements, keeps the lot's remaining quantity honest
/// and posts the accounting, all in one transaction, so a lot can never hold
/// more than it received and a shelf can never disagree with its own card.
@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly warehouses: WarehouseService,
    private readonly posting: PostingService,
    private readonly accounts: AccountMapService,
    private readonly numbers: DocumentNumberService,
    private readonly audit: AuditService,
    /// The per-warehouse cost book. Appended, never inserted: the specs build
    /// this service positionally.
    private readonly ledger: StockLedgerService,
  ) {}

  // ─────────────────────────────────────────────────────────────── reading

  async list(
    companyId: string,
    query: {
      itemId?: string;
      warehouseId?: string;
      status?: string;
      expiringInDays?: number;
      includeEmpty?: boolean;
      page?: number;
      pageSize?: number;
    } = {},
    scope: WarehouseScope = null,
    grants: Array<{ warehouseId: string; canView: boolean }> | null = null,
  ) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);
    const where: Prisma.ItemBatchWhereInput = { companyId, deletedAt: null };
    if (query.itemId) where.itemId = query.itemId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.status) where.status = query.status.toUpperCase();
    if (!query.includeEmpty) where.remainingQuantity = { gt: 0 };
    if (query.expiringInDays !== undefined) {
      const today = dayOnly(new Date());
      where.expiryDate = {
        not: null,
        lte: new Date(today.getTime() + query.expiringInDays * 86_400_000),
      };
    }
    if (scope !== null) {
      where.warehouse = { branchId: { in: scope } };
    }
    // Configuration, not decoration: a user with warehouse grants is shown the
    // lots of those warehouses and told nothing about the rest.
    if (grants) {
      const visible = grants.filter((grant) => grant.canView).map((grant) => grant.warehouseId);
      where.warehouseId = query.warehouseId
        ? visible.includes(query.warehouseId)
          ? query.warehouseId
          : '__none__'
        : { in: visible };
    }

    const [rows, total] = await Promise.all([
      this.prisma.itemBatch.findMany({
        where,
        orderBy: [{ expiryDate: 'asc' }, { batchNumber: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          item: { select: { code: true, nameEn: true, nameAr: true, unit: true } },
          warehouse: { select: { code: true, nameEn: true, nameAr: true } },
        },
      }),
      this.prisma.itemBatch.count({ where }),
    ]);

    const today = new Date();
    return {
      items: rows.map((row) => ({
        ...row,
        receivedQuantity: row.receivedQuantity.toFixed(MONEY_SCALE),
        remainingQuantity: row.remainingQuantity.toFixed(MONEY_SCALE),
        unitCost: row.unitCost.toFixed(MONEY_SCALE),
        value: row.remainingQuantity.mul(row.unitCost).toFixed(MONEY_SCALE),
        daysToExpiry: row.expiryDate ? daysUntil(row.expiryDate, today) : null,
        band: expiryBand(row.expiryDate, today),
      })),
      total,
      page,
      pageSize,
    };
  }

  async findOne(
    companyId: string,
    id: string,
    scope: WarehouseScope = null,
    grants: Array<{ warehouseId: string; canView: boolean }> | null = null,
  ) {
    const visibleWarehouseIds = grants
      ?.filter((grant) => grant.canView)
      .map((grant) => grant.warehouseId);
    const row = await this.prisma.itemBatch.findFirst({
      where: {
        id,
        companyId,
        deletedAt: null,
        ...(scope !== null ? { warehouse: { branchId: { in: scope } } } : {}),
        ...(visibleWarehouseIds !== undefined
          ? { warehouseId: { in: visibleWarehouseIds } }
          : {}),
      },
      include: {
        item: { select: { id: true, code: true, nameEn: true, nameAr: true, unit: true } },
        warehouse: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        movements: {
          where: {
            ...(scope !== null ? { branchId: { in: scope } } : {}),
            ...(visibleWarehouseIds !== undefined
              ? { warehouseId: { in: visibleWarehouseIds } }
              : {}),
          },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            warehouseId: true,
            movementDate: true,
            direction: true,
            quantity: true,
            unitCost: true,
            totalCost: true,
            referenceType: true,
            referenceNumber: true,
            createdAt: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Batch not found');
    return row;
  }

  /// The whole story of one lot: purchase, receipt, moves, issues, returns.
  ///
  /// Reading the movements is what makes an audit possible in one screen: the
  /// purchase that brought the lot in, every shelf it sat on, every document
  /// that took some out, and - through the reference ids - the customer it
  /// went to.
  async trace(
    companyId: string,
    id: string,
    scope: WarehouseScope = null,
    grants: Array<{ warehouseId: string; canView: boolean }> | null = null,
  ) {
    const lot = await this.findOne(companyId, id, scope, grants);
    const movements = lot.movements;
    const references = movements
      .filter((row) => row.referenceType)
      .map((row) => ({ type: row.referenceType, number: row.referenceNumber }));

    const customers: Array<{ invoiceNumber: string; customerName: string | null }> = [];
    const salesIds = movements
      .filter((row) => (row.referenceType ?? '').startsWith('SALES'))
      .map((row) => row.referenceNumber)
      .filter((value): value is string => Boolean(value));
    if (salesIds.length > 0) {
      const invoices = await this.prisma.salesInvoice.findMany({
        where: { companyId, invoiceNumber: { in: salesIds } },
        select: {
          invoiceNumber: true,
          customer: { select: { nameEn: true, nameAr: true } },
        },
      });
      for (const invoice of invoices) {
        customers.push({
          invoiceNumber: invoice.invoiceNumber,
          customerName: invoice.customer?.nameAr || invoice.customer?.nameEn || null,
        });
      }
    }

    return {
      batch: {
        id: lot.id,
        batchNumber: lot.batchNumber,
        status: lot.status,
        productionDate: lot.productionDate,
        expiryDate: lot.expiryDate,
        receivedQuantity: lot.receivedQuantity.toFixed(MONEY_SCALE),
        remainingQuantity: lot.remainingQuantity.toFixed(MONEY_SCALE),
        unitCost: lot.unitCost.toFixed(MONEY_SCALE),
        sourceType: lot.sourceType,
        sourceNumber: lot.sourceNumber,
        item: lot.item,
        warehouse: lot.warehouse,
      },
      movements,
      references,
      customers,
      band: expiryBand(lot.expiryDate, new Date()),
    };
  }

  // ────────────────────────────────────────────────────────────── receiving

  /// Records a lot that arrived, and adds its value to the shelf's average.
  async receive(
    companyId: string,
    userId: string,
    input: ReceiveLotInput,
    scope: WarehouseScope = null,
  ) {
    const quantity = toDecimal(input.quantity);
    if (quantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        'الكمية يجب أن تكون أكبر من صفر. / The received quantity must be greater than zero.',
      );
    }
    const unitCost = toDecimal(input.unitCost);
    if (unitCost.lessThan(0)) {
      throw new BadRequestException('التكلفة لا تكون سالبة. / The unit cost cannot be negative.');
    }

    const warehouse = await this.requireWarehouse(companyId, input.warehouseId, scope);
    const item = await this.requireItem(companyId, input.itemId);
    const policy = batchPolicyOf(item);

    const problems = receiptProblems(
      {
        batchNumber: input.batchNumber,
        productionDate: input.productionDate,
        expiryDate: input.expiryDate,
      },
      policy,
    );
    if (problems.length > 0) {
      throw new BadRequestException(problems.join(' '));
    }
    if (input.storageLocationId) {
      await this.requireLocation(companyId, warehouse.id, input.storageLocationId);
    }

    const date = input.documentDate ? dayOnly(input.documentDate) : dayOnly(new Date());

    return this.prisma.$transaction(async (tx) => {
      const { batchId, batchNumber } = await this.recordLotInTx(tx, {
        companyId,
        userId,
        warehouse,
        item,
        batchNumber: input.batchNumber,
        productionDate: input.productionDate,
        expiryDate: input.expiryDate,
        quantity,
        unitCost,
        storageLocationId: input.storageLocationId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceNumber: input.sourceNumber,
        notes: input.notes,
        date,
      });
      return this.applyReceipt(tx, {
        companyId,
        userId,
        warehouse,
        item,
        batchId,
        batchNumber,
        quantity,
        unitCost,
        date,
        input,
      });
    });
  }

  /// Records a lot inside a caller's transaction, without moving any stock.
  ///
  /// A purchase invoice already writes its own movement and balance row; what
  /// it lacks is the lot those goods belong to. Recording the lot here, rather
  /// than making purchases write movements twice, keeps one stock movement per
  /// receipt - which is what the stock card and every report expect.
  async recordLotInTx(
    tx: Prisma.TransactionClient,
    lot: {
      companyId: string;
      userId: string;
      warehouse: { id: string; branchId: string };
      item: BatchPolicyItem;
      batchNumber?: string | null;
      productionDate?: string | null;
      expiryDate?: string | null;
      quantity: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      storageLocationId?: string | null;
      sourceType?: string | null;
      sourceId?: string | null;
      sourceNumber?: string | null;
      notes?: string | null;
      date: Date;
    },
  ): Promise<{ batchId: string; batchNumber: string }> {
    const policy = batchPolicyOf(lot.item);
    const problems = receiptProblems(
      {
        batchNumber: lot.batchNumber,
        productionDate: lot.productionDate,
        expiryDate: lot.expiryDate,
      },
      policy,
    );
    if (problems.length > 0) {
      throw new BadRequestException(problems.join(' '));
    }

    const batchNumber = (lot.batchNumber ?? '').trim();
    const existing = batchNumber
      ? await tx.itemBatch.findFirst({
          where: {
            companyId: lot.companyId,
            warehouseId: lot.warehouse.id,
            itemId: lot.item.id,
            batchNumber,
            deletedAt: null,
          },
        })
      : null;

    if (existing) {
      if (lot.expiryDate && existing.expiryDate) {
        const before = dayOnly(existing.expiryDate).getTime();
        const after = dayOnly(lot.expiryDate).getTime();
        if (before !== after) {
          throw new ConflictException(
            `الدفعة ${batchNumber} مسجلة بتاريخ صلاحية ${existing.expiryDate
              .toISOString()
              .slice(0, 10)} ولا يمكن تغييره. / Lot ${batchNumber} is already recorded with ` +
              `expiry ${existing.expiryDate.toISOString().slice(0, 10)}, which cannot be changed.`,
          );
        }
      }
      await tx.itemBatch.update({
        where: { id: existing.id },
        data: {
          receivedQuantity: { increment: lot.quantity },
          remainingQuantity: { increment: lot.quantity },
          // The lot keeps the average of what it actually cost.
          unitCost: movingAverage(
            {
              quantity: existing.receivedQuantity,
              value: existing.receivedQuantity.mul(existing.unitCost),
            },
            { quantity: lot.quantity, value: lot.quantity.mul(lot.unitCost) },
          ).unitCost.toDecimalPlaces(MONEY_SCALE),
          updatedBy: lot.userId,
          status: 'OPEN',
        },
      });
      return { batchId: existing.id, batchNumber };
    }

    const created = await tx.itemBatch.create({
      data: {
        companyId: lot.companyId,
        branchId: lot.warehouse.branchId,
        warehouseId: lot.warehouse.id,
        itemId: lot.item.id,
        batchNumber:
          batchNumber || `${lot.date.toISOString().slice(0, 10)}-${lot.userId.slice(0, 4)}`,
        productionDate: lot.productionDate ? dayOnly(lot.productionDate) : null,
        expiryDate: lot.expiryDate ? dayOnly(lot.expiryDate) : null,
        receivedQuantity: lot.quantity,
        remainingQuantity: lot.quantity,
        unitCost: lot.unitCost,
        status: 'OPEN',
        storageLocationId: lot.storageLocationId ?? null,
        sourceType: lot.sourceType ?? 'STOCK_RECEIPT',
        sourceId: lot.sourceId ?? null,
        sourceNumber: lot.sourceNumber ?? null,
        notes: lot.notes ?? null,
        createdBy: lot.userId,
      },
    });
    return { batchId: created.id, batchNumber: created.batchNumber };
  }

  /// The movement, the average and the history of one receipt.
  private async applyReceipt(
    tx: Prisma.TransactionClient,
    receipt: {
      companyId: string;
      userId: string;
      warehouse: { id: string; branchId: string };
      item: { id: string; code: string };
      batchId: string;
      batchNumber: string;
      quantity: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      date: Date;
      input: ReceiveLotInput;
    },
  ) {
    const { companyId, userId, warehouse, item, batchId, batchNumber, quantity, unitCost, date, input } =
      receipt;
      const shelf = await this.shelf(tx, companyId, warehouse, item.id);
      const onHand = shelf.quantity;
      const onHandValue = shelf.value;
      const totalCost = quantity.mul(unitCost).toDecimalPlaces(MONEY_SCALE);
      const after = movingAverage(
        { quantity: onHand, value: onHandValue },
        { quantity, value: totalCost },
      );

      await tx.stockMovement.create({
        data: {
          companyId,
          branchId: warehouse.branchId,
          warehouseId: warehouse.id,
          itemId: item.id,
          batchId,
          storageLocationId: input.storageLocationId ?? null,
          movementDate: date,
          direction: StockDirection.IN,
          quantity,
          unitCost,
          totalCost,
          referenceType: input.sourceType ?? 'STOCK_RECEIPT',
          referenceId: input.sourceId ?? batchId,
          referenceNumber: input.sourceNumber ?? batchNumber ?? null,
          notes: input.notes ?? null,
          createdBy: userId,
        },
      });

      // The shelf re-averages on its own terms: a warehouse that bought at 30
      // is not diluted by a different warehouse that bought at 15.
      await this.ledger.post(tx, {
        companyId,
        branchId: warehouse.branchId,
        warehouseId: warehouse.id,
        itemId: item.id,
        quantity,
        value: totalCost,
      });

      await tx.itemCostHistory.create({
        data: {
          companyId,
          branchId: warehouse.branchId,
          warehouseId: warehouse.id,
          itemId: item.id,
          occurredAt: date,
          quantityIn: quantity,
          valueIn: totalCost,
          quantityAfter: after.quantity,
          valueAfter: after.value,
          unitCostAfter: after.unitCost,
          sourceType: input.sourceType ?? 'STOCK_RECEIPT',
          sourceId: input.sourceId ?? batchId,
          createdBy: userId,
        },
      });

      await this.audit.record({
        companyId,
        userId,
        action: 'RECEIVE_BATCH',
        entity: 'stock_movements',
        entityId: batchId,
        after: {
          batchNumber,
          quantity: quantity.toFixed(MONEY_SCALE),
          unitCost: unitCost.toFixed(MONEY_SCALE),
          averageAfter: after.unitCost.toFixed(4),
        },
      });

      return {
        batchId,
        quantity: quantity.toFixed(MONEY_SCALE),
        unitCost: unitCost.toFixed(MONEY_SCALE),
        averageCost: after.unitCost.toFixed(4),
        balanceQuantity: after.quantity.toFixed(MONEY_SCALE),
      };
  }

  // ──────────────────────────────────────────────────────────────── issuing

  /// Takes stock out of the soonest-expiring lots, at the shelf's average.
  ///
  /// The cost is the warehouse's moving average, not the lot's own cost: an
  /// issue answers "what did this sale cost us out of this shelf?", and the
  /// lot keeps its own figure for the write-off report. When the whole shelf
  /// leaves, the whole value leaves with it, so an empty shelf is worth zero.
  async issue(
    companyId: string,
    userId: string,
    input: IssueInput,
    scope: WarehouseScope = null,
  ) {
    const quantity = toDecimal(input.quantity);
    if (quantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        'الكمية يجب أن تكون أكبر من صفر. / The issued quantity must be greater than zero.',
      );
    }
    if (!input.warehouseId) {
      throw new BadRequestException(
        'اسم المخزن مطلوب للصرف. / A warehouse is required to issue stock.',
      );
    }
    const warehouse = await this.requireWarehouse(companyId, input.warehouseId, scope);
    const item = await this.requireItem(companyId, input.itemId);

    return this.prisma.$transaction((tx) =>
      this.issueTx(
        tx,
        companyId,
        userId,
        { warehouse, branchId: warehouse.branchId, item },
        input,
        quantity,
      ),
    );
  }

  /// The issuing half of a sale, callable from inside somebody else's
  /// transaction.
  ///
  /// A sales invoice must record the movement, the cost and the journal in one
  /// transaction; if the lot engine opened its own, a failure between the two
  /// would leave goods issued that no invoice ever claimed. The caller resolves
  /// the warehouse and item (it has already checked its own permissions on
  /// them) and passes them in.
  async issueTx(
    tx: Prisma.TransactionClient,
    companyId: string,
    userId: string,
    resolved: {
      warehouse: { id: string; branchId: string } | null;
      branchId: string;
      item: BatchPolicyItem;
    },
    input: IssueInput,
    quantity: Prisma.Decimal,
  ) {
    const { warehouse, item } = resolved;
    const policy = batchPolicyOf(item);
    const today = new Date();
    if (!warehouse) {
      // The branch has no shelf at all: there is nothing for a lot to belong
      // to, so this is exactly the behaviour before warehouses existed.
      if (policy.requiresBatch) {
        throw new BadRequestException(
          'هذا الصنف يتطلب دفعة ولا يوجد مخزن للفرع. / This item is lot-controlled, but the '
            + 'branch has no warehouse, so a lot cannot be issued from a shelf.',
        );
      }
      return this.issueUnbatched(
        tx,
        companyId,
        userId,
        { id: null, branchId: resolved.branchId },
        item,
        quantity,
        input,
        today,
      );
    }
    {
      // Lock the shelf before looking at its lots. Two simultaneous issues
      // that each read the lots first would both see the same quantity and
      // both promise it away; taken in this order the second waits here.
      const shelf = await this.shelf(tx, companyId, warehouse, item.id);
      const lots = await tx.itemBatch.findMany({
        where: {
          companyId,
          warehouseId: warehouse.id,
          itemId: item.id,
          deletedAt: null,
          remainingQuantity: { gt: 0 },
          ...(input.batchId ? { id: input.batchId } : {}),
        },
        // Locked, so two simultaneous issues cannot both take the last unit
        // of the same lot.
        orderBy: { expiryDate: 'asc' },
      });
      if (input.batchId && lots.length === 0) {
        throw new NotFoundException(
          'الدفعة غير موجودة أو لا يوجد بها رصيد. / The chosen lot does not exist or is empty.',
        );
      }
      if (lots.length === 0) {
        if (policy.requiresBatch) {
          throw new BadRequestException(
            'هذا الصنف يتطلب دفعة. / This item is lot-controlled: no lot is available to issue from.',
          );
        }
        // An item without lots issues from the shelf's plain balance, which is
        // exactly how the program worked before lots existed.
        return this.issueUnbatched(tx, companyId, userId, warehouse, item, quantity, input, today);
      }

      // Only a recorded approval lets an issue *consider* expired lots.
      //
      // The rule used to be written as
      //
      //     if (allowExpired && (input.allowExpired ?? false))
      //
      // so an item whose own policy allowed expired handling, with no
      // `allowExpired` on the request, skipped the check entirely: the policy
      // opened the gate and nothing was ever asked for. An item policy is a
      // standing decision about how an item is tracked; it is not the record of
      // a person taking responsibility for selling out-of-date goods on this
      // document. `expiredIssueNeedsApproval` cannot waive the approval either -
      // it could only ever add to the requirement, never subtract from it.
      //
      // An approval is a complete thing: a person and a reason. The controller
      // builds it from `inventory.batches.expired.issue` on the authenticated
      // user, never from the body. Half of one is not one, and a caller that
      // supplies neither gets the behaviour of a caller that may not touch
      // expired stock at all.
      const approval = input.expiredApproval;
      const approvalRecorded =
        !!approval && !!approval.userId && (approval.reason ?? '').trim().length >= 3;
      // An approval lets this issue touch expired stock. An explicit `false` is
      // still a refusal: a caller that knows it has no such permission must not
      // be surprised by a lot it never agreed to use.
      const expiredEligible = approvalRecorded && input.allowExpired !== false;

      const lotsForFefo = lots.map((lot) => ({
        batchId: lot.id,
        batchNumber: lot.batchNumber,
        expiryDate: lot.expiryDate,
        productionDate: lot.productionDate,
        unitCost: lot.unitCost,
        remainingQuantity: lot.remainingQuantity,
        status: lot.status,
      }));

      // Expired lots stay out of the running for anyone who cannot approve
      // them, so a cashier selling an item that happens to have an old lot in
      // front still gets it out of the fresh stock behind it. Refusing the whole
      // sale because of stock the caller was never allowed to use would block
      // the shop over a rule that does not concern it.
      const selection = selectLotsFefo(lotsForFefo, quantity, {
        today,
        allowExpired: expiredEligible,
        useFefo: policy.useFefo,
      });

      if (!selection.shortfall.isZero() && !expiredEligible) {
        // Would the expired stock have covered it? Then the honest answer is
        // "this needs an approval", not "there is none".
        const withExpired = selectLotsFefo(lotsForFefo, quantity, {
          today,
          allowExpired: true,
          useFefo: policy.useFefo,
        });
        if (withExpired.shortfall.isZero()) {
          throw new ForbiddenException(
            'الكمية المطلوبة متوفرة في دفعات منتهية الصلاحية فقط. صرفها يتطلب اعتمادًا مسجّلًا: ' +
              'صلاحية صرف المنتهي، واسم المعتمِد، وسبب الصرف. / ' +
              'The requested quantity is only available in expired lots. Issuing it needs a ' +
              'recorded approval: the expiry-issue permission, the person who approved it, and a reason.',
          );
        }
      }

      if (!selection.shortfall.isZero()) {
        const expired = lots.filter(
          (lot) => lot.expiryDate && daysUntil(lot.expiryDate, today) < 0,
        ).length;
        throw new BadRequestException(
          `الرصيد غير كافٍ في الدفعات المتاحة: ينقص ${selection.shortfall.toFixed(MONEY_SCALE)}. / ` +
            `Not enough stock in the available lots: ${selection.shortfall.toFixed(MONEY_SCALE)} short.` +
            (expired > 0
              ? ` (${expired} lot(s) exist but have expired; issuing them needs permission.)`
              : ''),
        );
      }

      // Priced at what *this shelf* averages, which is what makes two
      // warehouses holding the same item two different costs.
      const cost = issueAtAverage({ quantity: shelf.quantity, value: shelf.value }, quantity);

      const movements: Array<{ batchId: string; quantity: string; expired: boolean }> = [];
      // The value the shelf lost, split across the lots it left from. Each lot
      // takes its proportional share and the last one takes the remainder, so
      // the movements add up to the balance change to the last fils - a sale
      // that posted 189.0910 of cost against 189.0909 of stock movement would
      // be a rounding leak nobody would ever find on a report.
      const totalValue = cost.value.toDecimalPlaces(MONEY_SCALE);
      let allocatedValue = new Prisma.Decimal(0);
      for (const [index, allocation] of selection.allocations.entries()) {
        const emptied = allocation.quantity.equals(
          lots.find((lot) => lot.id === allocation.batchId)?.remainingQuantity ??
            allocation.quantity,
        );
        const taken = await tx.itemBatch.updateMany({
          // Conditional, so a concurrent issue cannot take a lot below zero
          // even if both of them got past the read above.
          where: {
            id: allocation.batchId,
            remainingQuantity: { gte: allocation.quantity },
          },
          data: {
            remainingQuantity: { decrement: allocation.quantity },
            // A lot emptied by an issue is closed; it is not deleted, because
            // the history of where the goods went is the point of a lot.
            ...(emptied ? { status: 'CLOSED' } : {}),
            updatedBy: userId,
          },
        });
        if (taken.count !== 1) {
          throw new ConflictException(
            'تغير رصيد الدفعة أثناء الصرف. أعد المحاولة. / The lot changed while it was being issued.',
          );
        }
        const isLast = index === selection.allocations.length - 1;
        const lineValue = isLast
          ? totalValue.minus(allocatedValue)
          : allocation.quantity.mul(cost.unitCost).toDecimalPlaces(MONEY_SCALE);
        allocatedValue = allocatedValue.plus(lineValue);
        await tx.stockMovement.create({
          data: {
            companyId,
            branchId: warehouse.branchId,
            warehouseId: warehouse.id,
            itemId: item.id,
            batchId: allocation.batchId,
            storageLocationId: input.storageLocationId ?? null,
            movementDate: input.documentDate ? dayOnly(input.documentDate) : today,
            direction: StockDirection.OUT,
            quantity: allocation.quantity,
            unitCost: cost.unitCost.toDecimalPlaces(MONEY_SCALE),
            totalCost: lineValue,
            ...(input.movementUnits
              ? movementUnitSnapshot({
                  enteredUnit: input.movementUnits.enteredUnit,
                  enteredQuantity: input.movementUnits.enteredQuantity,
                  unitFactor: input.movementUnits.unitFactor,
                  baseUnitName: input.movementUnits.baseUnitName ?? 'unit',
                  baseQuantity: allocation.quantity,
                })
              : {}),
            referenceType: input.referenceType ?? 'STOCK_ISSUE',
            referenceId: input.referenceId ?? allocation.batchId,
            referenceNumber: input.referenceNumber ?? null,
            notes: input.reason ?? null,
            createdBy: userId,
          },
        });
        movements.push({
          batchId: allocation.batchId,
          quantity: allocation.quantity.toFixed(MONEY_SCALE),
          expired: allocation.expired,
        });
      }

      await this.ledger.post(tx, {
        companyId,
        branchId: warehouse.branchId,
        warehouseId: warehouse.id,
        itemId: item.id,
        quantity: quantity.negated(),
        value: totalValue.negated(),
      });

      await tx.itemCostHistory.create({
        data: {
          companyId,
          branchId: warehouse.branchId,
          warehouseId: warehouse.id,
          itemId: item.id,
          occurredAt: today,
          quantityIn: quantity.negated(),
          valueIn: totalValue.negated(),
          quantityAfter: cost.remainingQuantity,
          valueAfter: cost.remainingValue,
          unitCostAfter: cost.unitCost,
          sourceType: input.referenceType ?? 'STOCK_ISSUE',
          sourceId: input.referenceId ?? null,
          createdBy: userId,
        },
      });

      await this.audit.record({
        companyId,
        userId,
        action: 'ISSUE_BATCH',
        entity: 'stock_movements',
        entityId: input.referenceId ?? movements[0]?.batchId ?? item.id,
        after: {
          quantity: quantity.toFixed(MONEY_SCALE),
          averageCost: cost.unitCost.toFixed(4),
          lots: movements.map((row) => `${row.batchId}:${row.quantity}`).join(', '),
          expiredQuantity: selection.expiredQuantity.toFixed(MONEY_SCALE),
          // Who let the expired goods go, why, when, and exactly which lots and
          // quantities left. A boolean in a request body is not an audit trail;
          // this is.
          ...(input.expiredApproval
            ? {
                expiredApproval: {
                  approvedBy: input.expiredApproval.userId,
                  reason: input.expiredApproval.reason,
                  decidedAt: today.toISOString(),
                  expiredLots: movements
                    .filter((row) => row.expired)
                    .map((row) => `${row.batchId}:${row.quantity}`)
                    .join(', '),
                  reference: input.referenceNumber ?? null,
                },
              }
            : {}),
        },
      });

      return {
        lots: movements,
        quantity: quantity.toFixed(MONEY_SCALE),
        unitCost: cost.unitCost.toFixed(4),
        value: totalValue.toFixed(MONEY_SCALE),
        expiredQuantity: selection.expiredQuantity.toFixed(MONEY_SCALE),
      };
    }
  }

  /// An item that keeps no lots still issues - and still costs - the old way.
  private async issueUnbatched(
    tx: Prisma.TransactionClient,
    companyId: string,
    userId: string,
    warehouse: { id: string | null; branchId: string },
    item: { id: string; code: string },
    quantity: Prisma.Decimal,
    input: IssueInput,
    today: Date,
  ) {
    const shelf = await this.shelf(tx, companyId, warehouse, item.id);
    const onHand = shelf.quantity;
    if (onHand.lessThan(quantity)) {
      throw new BadRequestException(
        `الرصيد غير كافٍ في هذا المخزن: ${onHand.toFixed(MONEY_SCALE)} متاح، ` +
          `${quantity.toFixed(MONEY_SCALE)} مطلوب. / Not enough stock in this warehouse.`,
      );
    }
    const cost = issueAtAverage({ quantity: onHand, value: shelf.value }, quantity);
    await tx.stockMovement.create({
      data: {
        companyId,
        branchId: warehouse.branchId,
        warehouseId: warehouse.id,
        itemId: item.id,
        movementDate: today,
        direction: StockDirection.OUT,
        quantity,
        unitCost: cost.unitCost.toDecimalPlaces(MONEY_SCALE),
        totalCost: cost.value.toDecimalPlaces(MONEY_SCALE),
        ...(input.movementUnits
          ? movementUnitSnapshot({
              enteredUnit: input.movementUnits.enteredUnit,
              enteredQuantity: input.movementUnits.enteredQuantity,
              unitFactor: input.movementUnits.unitFactor,
              baseUnitName: input.movementUnits.baseUnitName ?? 'unit',
              baseQuantity: quantity,
            })
          : {}),
        referenceType: input.referenceType ?? 'STOCK_ISSUE',
        referenceId: input.referenceId ?? item.id,
        referenceNumber: input.referenceNumber ?? null,
        createdBy: userId,
      },
    });
    await this.ledger.post(tx, {
      companyId,
      branchId: warehouse.branchId,
      warehouseId: warehouse.id,
      itemId: item.id,
      quantity: quantity.negated(),
      value: cost.value.toDecimalPlaces(MONEY_SCALE).negated(),
    });
    return {
      lots: [],
      quantity: quantity.toFixed(MONEY_SCALE),
      unitCost: cost.unitCost.toFixed(4),
      value: cost.value.toFixed(MONEY_SCALE),
      expiredQuantity: '0.0000',
    };
  }

  // ────────────────────────────────────────────────────────────── write-off

  /// Destroys a quantity from one lot, at that lot's cost, with the ledger.
  ///
  /// The lot is the only thing that may be written off: writing off "some
  /// stock" without naming which lot is how a discrepancy becomes invisible.
  /// The entry debits the inventory-difference account and credits stock, and
  /// the reason travels with it - a write-off without a reason is refused.
  async writeOff(
    companyId: string,
    userId: string,
    input: WriteOffInput,
    scope: WarehouseScope = null,
    costCenterId?: string | null,
  ) {
    const quantity = toDecimal(input.quantity);
    if (quantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        'كمية الإعدام يجب أن تكون أكبر من صفر. / The written-off quantity must be positive.',
      );
    }
    const reason = (input.reason ?? '').trim();
    if (reason.length < 3) {
      throw new BadRequestException(
        'سبب الإعدام مطلوب. / A reason is required to write stock off.',
      );
    }
    const warehouse = await this.requireWarehouse(companyId, input.warehouseId, scope);
    await this.requireItem(companyId, input.itemId);

    const batch = await this.prisma.itemBatch.findFirst({
      where: {
        id: input.batchId,
        companyId,
        warehouseId: warehouse.id,
        itemId: input.itemId,
        deletedAt: null,
      },
    });
    if (!batch) throw new NotFoundException('Batch not found in this warehouse');
    if (batch.remainingQuantity.lessThan(quantity)) {
      throw new BadRequestException(
        `الدفعة تحتوي ${batch.remainingQuantity.toFixed(MONEY_SCALE)} فقط. / ` +
          `The lot holds ${batch.remainingQuantity.toFixed(MONEY_SCALE)}, not ${quantity.toFixed(MONEY_SCALE)}.`,
      );
    }
    if (batch.status === 'WRITTEN_OFF') {
      throw new ConflictException(
        'الدفعة تم إعدامها بالفعل. / This lot has already been written off.',
      );
    }

    const date = input.documentDate ? dayOnly(input.documentDate) : dayOnly(new Date());

    return this.prisma.$transaction(async (tx) => {
      // The lot row is claimed before anything is posted: two simultaneous
      // write-offs of the last unit would otherwise both succeed.
      const claimed = await tx.itemBatch.updateMany({
        where: { id: batch.id, remainingQuantity: { gte: quantity }, status: { not: 'WRITTEN_OFF' } },
        data: {
          remainingQuantity: { decrement: quantity },
          ...(batch.remainingQuantity.equals(quantity) ? { status: 'WRITTEN_OFF' } : {}),
          updatedBy: userId,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException(
          'تم تعديل الدفعة أثناء الإعدام. أعد المحاولة. / The lot changed while it was being written off.',
        );
      }

      const documentNumber = await this.numbers.next(tx, companyId, 'INVENTORY_WRITE_OFF', 'WO');
      const value = quantity.mul(batch.unitCost).toDecimalPlaces(MONEY_SCALE);

      await tx.stockMovement.create({
        data: {
          companyId,
          branchId: warehouse.branchId,
          warehouseId: warehouse.id,
          itemId: batch.itemId,
          batchId: batch.id,
          movementDate: date,
          direction: StockDirection.OUT,
          quantity,
          unitCost: batch.unitCost,
          totalCost: value,
          referenceType: 'STOCK_WRITE_OFF',
          referenceId: batch.id,
          referenceNumber: documentNumber,
          notes: reason,
          createdBy: userId,
        },
      });

      await this.ledger.post(tx, {
        companyId,
        branchId: warehouse.branchId,
        warehouseId: warehouse.id,
        itemId: batch.itemId,
        quantity: quantity.negated(),
        value: value.negated(),
      });

      const accounts = await this.accounts.resolve(tx, companyId, [
        'inventory',
        'inventoryDifference',
      ]);
      const journal = await this.posting.post(tx, {
        companyId,
        branchId: warehouse.branchId,
        userId,
        entryDate: date,
        description: `Write-off of lot ${batch.batchNumber}: ${reason}`,
        sourceType: 'INVENTORY_WRITE_OFF',
        sourceId: batch.id,
        sourceNumber: documentNumber,
        lines: [
          {
            accountId: accounts.inventoryDifference,
            debit: value,
            description: `Write-off ${batch.batchNumber}`,
            costCenterId: costCenterId ?? null,
          },
          {
            accountId: accounts.inventory,
            credit: value,
            description: `Write-off ${batch.batchNumber}`,
          },
        ],
      });

      const remaining = batch.remainingQuantity.minus(quantity);
      await tx.itemCostHistory.create({
        data: {
          companyId,
          branchId: warehouse.branchId,
          warehouseId: warehouse.id,
          itemId: batch.itemId,
          occurredAt: date,
          quantityIn: quantity.negated(),
          valueIn: value.negated(),
          quantityAfter: remaining,
          valueAfter: new Prisma.Decimal(0),
          unitCostAfter: batch.unitCost,
          sourceType: 'STOCK_WRITE_OFF',
          sourceId: batch.id,
          createdBy: userId,
        },
      });

      await this.audit.record({
        companyId,
        userId,
        action: 'WRITE_OFF_BATCH',
        entity: 'item_batches',
        entityId: batch.id,
        before: { remaining: batch.remainingQuantity.toFixed(MONEY_SCALE) },
        after: {
          remaining: remaining.toFixed(MONEY_SCALE),
          value: value.toFixed(MONEY_SCALE),
          reason,
          documentNumber,
          journal: journal.entryNumber,
        },
      });

      return {
        batchId: batch.id,
        documentNumber,
        quantity: quantity.toFixed(MONEY_SCALE),
        value: value.toFixed(MONEY_SCALE),
        remaining: remaining.toFixed(MONEY_SCALE),
        journalEntryNumber: journal.entryNumber,
      };
    });
  }

  // ─────────────────────────────────────────────────────────────── transfers

  /// Moves a quantity of one lot to another warehouse, keeping its identity.
  ///
  /// The lot keeps its number, its dates and its own cost across the move -
  /// otherwise a transfer would launder an expiry date. The destination lot is
  /// the same lot seen from the other shelf: same number, same dates, and the
  /// value it arrived with.
  async transfer(
    companyId: string,
    userId: string,
    input: TransferInput,
    scope: WarehouseScope = null,
  ) {
    const quantity = toDecimal(input.quantity);
    if (quantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        'كمية التحويل يجب أن تكون أكبر من صفر. / The transferred quantity must be positive.',
      );
    }
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw new BadRequestException(
        'لا يمكن التحويل إلى نفس المخزن. / The source and destination warehouses are the same.',
      );
    }
    const from = await this.requireWarehouse(companyId, input.fromWarehouseId, scope);
    const to = await this.requireWarehouse(companyId, input.toWarehouseId, scope);
    if (from.branchId !== to.branchId) {
      throw new BadRequestException(
        'التحويل بين مخزنين في فرعين مختلفين غير مدعوم هنا؛ استخدم تحويل المخازن. / ' +
          'A move between two branches is a stock transfer document, not a lot transfer.',
      );
    }

    const batch = await this.prisma.itemBatch.findFirst({
      where: { id: input.batchId, companyId, warehouseId: from.id, deletedAt: null },
    });
    if (!batch) throw new NotFoundException('Batch not found in the source warehouse');
    if (batch.remainingQuantity.lessThan(quantity)) {
      throw new BadRequestException(
        `الدفعة تحتوي ${batch.remainingQuantity.toFixed(MONEY_SCALE)} فقط. / ` +
          `The lot holds ${batch.remainingQuantity.toFixed(MONEY_SCALE)}.`,
      );
    }

    const date = input.documentDate ? dayOnly(input.documentDate) : dayOnly(new Date());

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.itemBatch.updateMany({
        where: { id: batch.id, remainingQuantity: { gte: quantity } },
        data: { remainingQuantity: { decrement: quantity }, updatedBy: userId },
      });
      if (claimed.count !== 1) {
        throw new ConflictException(
          'تم تعديل الدفعة أثناء التحويل. أعد المحاولة. / The lot changed during the transfer.',
        );
      }

      const destination = await tx.itemBatch.findFirst({
        where: {
          companyId,
          warehouseId: to.id,
          itemId: batch.itemId,
          batchNumber: batch.batchNumber,
          deletedAt: null,
        },
      });
      let destinationId: string;
      if (destination) {
        await tx.itemBatch.update({
          where: { id: destination.id },
          data: {
            receivedQuantity: { increment: quantity },
            remainingQuantity: { increment: quantity },
            updatedBy: userId,
          },
        });
        destinationId = destination.id;
      } else {
        const created = await tx.itemBatch.create({
          data: {
            companyId,
            branchId: to.branchId,
            warehouseId: to.id,
            itemId: batch.itemId,
            batchNumber: batch.batchNumber,
            productionDate: batch.productionDate,
            expiryDate: batch.expiryDate,
            receivedQuantity: quantity,
            remainingQuantity: quantity,
            unitCost: batch.unitCost,
            status: 'OPEN',
            sourceType: 'BATCH_TRANSFER',
            sourceNumber: input.reason ?? null,
            createdBy: userId,
          },
        });
        destinationId = created.id;
      }

      const value = quantity.mul(batch.unitCost).toDecimalPlaces(MONEY_SCALE);
      for (const [warehouse, direction, batchId] of [
        [from, StockDirection.OUT, batch.id],
        [to, StockDirection.IN, destinationId],
      ] as const) {
        await tx.stockMovement.create({
          data: {
            companyId,
            branchId: warehouse.branchId,
            warehouseId: warehouse.id,
            itemId: batch.itemId,
            batchId,
            movementDate: date,
            direction,
            quantity,
            unitCost: batch.unitCost,
            totalCost: value,
            referenceType: direction === StockDirection.OUT ? 'BATCH_TRANSFER_OUT' : 'BATCH_TRANSFER_IN',
            referenceId: batch.id,
            referenceNumber: null,
            notes: input.reason ?? null,
            createdBy: userId,
          },
        });
      }

      // Both sides are in the same branch, so the branch book nets to zero
      // while each shelf's own average moves by exactly what the goods were
      // worth when they left. The destination re-averages from the value it
      // was handed, not from whatever its neighbour happened to pay.
      await this.ledger.post(tx, {
        companyId,
        branchId: from.branchId,
        warehouseId: from.id,
        itemId: batch.itemId,
        quantity: quantity.negated(),
        value: value.negated(),
      });
      await this.ledger.post(tx, {
        companyId,
        branchId: to.branchId,
        warehouseId: to.id,
        itemId: batch.itemId,
        quantity,
        value,
      });

      await this.audit.record({
        companyId,
        userId,
        action: 'TRANSFER_BATCH',
        entity: 'item_batches',
        entityId: batch.id,
        after: {
          toWarehouseId: to.id,
          quantity: quantity.toFixed(MONEY_SCALE),
          value: value.toFixed(MONEY_SCALE),
          reason: input.reason ?? null,
        },
      });

      return {
        from: { warehouseId: from.id, batchId: batch.id },
        to: { warehouseId: to.id, batchId: destinationId },
        quantity: quantity.toFixed(MONEY_SCALE),
        value: value.toFixed(MONEY_SCALE),
      };
    });
  }

  // ───────────────────────────────────────────────────────────────── reports

  /// Lots by expiry band, with the value at risk.
  async expiryReport(
    companyId: string,
    query: {
      band?: string;
      warehouseId?: string;
      itemId?: string;
      categoryId?: string;
      asOf?: string;
      days?: string;
    } = {},
    scope: WarehouseScope = null,
    warehouseIds?: string[],
  ) {
    const asOf = query.asOf ? dayOnly(query.asOf) : dayOnly(new Date());
    const days = query.days ? normalizeExpiryDays(String(query.days).split(',')) : [7, 30, 60, 90];
    const horizon = Math.max(...days, 0);
    const where: Prisma.ItemBatchWhereInput = {
      companyId,
      deletedAt: null,
      remainingQuantity: { gt: 0 },
      expiryDate: { not: null },
      status: { notIn: ['WRITTEN_OFF', 'CLOSED'] },
    };
    if (warehouseIds !== undefined || query.warehouseId) {
      const allowed = warehouseIds === undefined ? undefined : warehouseIds;
      where.warehouseId = {
        in: allowed === undefined
          ? [query.warehouseId!]
          : query.warehouseId
            ? allowed.filter((id) => id === query.warehouseId)
            : allowed,
      };
    }
    if (query.itemId) where.itemId = query.itemId;
    if (query.categoryId) where.item = { categoryId: query.categoryId };
    if (scope !== null) where.warehouse = { branchId: { in: scope } };

    const rows = await this.prisma.itemBatch.findMany({
      where,
      orderBy: [{ expiryDate: 'asc' }, { batchNumber: 'asc' }],
      take: 5000,
      include: {
        item: {
          select: {
            code: true,
            nameEn: true,
            nameAr: true,
            unit: true,
            category: { select: { nameEn: true, nameAr: true } },
          },
        },
        warehouse: { select: { code: true, nameEn: true, nameAr: true } },
      },
    });

    const buckets: Record<string, { count: number; quantity: Prisma.Decimal; value: Prisma.Decimal }> = {
      EXPIRED: { count: 0, quantity: new Prisma.Decimal(0), value: new Prisma.Decimal(0) },
      TODAY: { count: 0, quantity: new Prisma.Decimal(0), value: new Prisma.Decimal(0) },
      IN_7: { count: 0, quantity: new Prisma.Decimal(0), value: new Prisma.Decimal(0) },
      IN_30: { count: 0, quantity: new Prisma.Decimal(0), value: new Prisma.Decimal(0) },
      IN_60: { count: 0, quantity: new Prisma.Decimal(0), value: new Prisma.Decimal(0) },
      IN_90: { count: 0, quantity: new Prisma.Decimal(0), value: new Prisma.Decimal(0) },
      LATER: { count: 0, quantity: new Prisma.Decimal(0), value: new Prisma.Decimal(0) },
    };

    const items = rows
      .map((row) => {
        const band = expiryBand(row.expiryDate, asOf);
        const value = row.remainingQuantity.mul(row.unitCost).toDecimalPlaces(MONEY_SCALE);
        buckets[band].count += 1;
        buckets[band].quantity = buckets[band].quantity.plus(row.remainingQuantity);
        buckets[band].value = buckets[band].value.plus(value);
        return {
          id: row.id,
          batchNumber: row.batchNumber,
          itemCode: row.item.code,
          itemNameEn: row.item.nameEn,
          itemNameAr: row.item.nameAr,
          categoryEn: row.item.category?.nameEn ?? null,
          categoryAr: row.item.category?.nameAr ?? null,
          warehouseCode: row.warehouse.code,
          warehouseNameEn: row.warehouse.nameEn,
          expiryDate: row.expiryDate,
          productionDate: row.productionDate,
          daysToExpiry: daysUntil(row.expiryDate!, asOf),
          band,
          quantity: row.remainingQuantity.toFixed(MONEY_SCALE),
          unitCost: row.unitCost.toFixed(MONEY_SCALE),
          value: value.toFixed(MONEY_SCALE),
          status: row.status,
        };
      })
      .filter((row) => {
        if (!query.band) return row.daysToExpiry <= horizon || query.band === 'EXPIRED';
        if (query.band.toUpperCase() === 'EXPIRED') return row.daysToExpiry < 0;
        return row.band === query.band.toUpperCase();
      });

    return {
      asOf: asOf.toISOString().slice(0, 10),
      days,
      buckets: Object.fromEntries(
        Object.entries(buckets).map(([band, value]) => [
          band,
          {
            count: value.count,
            quantity: value.quantity.toFixed(MONEY_SCALE),
            value: value.value.toFixed(MONEY_SCALE),
          },
        ]),
      ),
      // The number a manager asks for: how much money is at risk right now.
      atRisk: buckets.EXPIRED.value
        .plus(buckets.TODAY.value)
        .plus(buckets.IN_7.value)
        .toDecimalPlaces(MONEY_SCALE)
        .toFixed(MONEY_SCALE),
      items,
    };
  }

  // ───────────────────────────────────────────────────────────────── helpers

  private async requireWarehouse(
    companyId: string,
    warehouseId: string,
    scope: WarehouseScope,
  ) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, companyId, deletedAt: null, isActive: true },
      select: { id: true, branchId: true, code: true, kind: true, parentId: true },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    if (scope !== null && !scope.includes(warehouse.branchId)) {
      throw new ForbiddenException(
        'هذا المخزن يخص فرعًا غير مسند إليك. / This warehouse belongs to a branch you are not assigned to.',
      );
    }
    return warehouse;
  }

  async requireItem(companyId: string, itemId: string): Promise<BatchPolicyItem & { isStockTracked: boolean }> {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, companyId, deletedAt: null },
      select: {
        id: true,
        code: true,
        unit: true,
        isStockTracked: true,
        requiresBatch: true,
        requiresProductionDate: true,
        requiresExpiryDate: true,
        useFefo: true,
        allowExpiredIssue: true,
        expiredIssueNeedsApproval: true,
      },
    });
    if (!item) throw new NotFoundException('Item not found');
    if (!item.isStockTracked) {
      throw new BadRequestException(
        `الصنف ${item.code} غير مخزني. / Item ${item.code} is not stock-tracked.`,
      );
    }
    return item;
  }

  private async requireLocation(companyId: string, warehouseId: string, locationId: string) {
    const location = await this.prisma.storageLocation.findFirst({
      where: { id: locationId, companyId, warehouseId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!location) {
      throw new BadRequestException(
        'موقع التخزين غير موجود في هذا المخزن. / The storage location is not in this warehouse.',
      );
    }
    return location;
  }

  /// One shelf's position, locked for the rest of the transaction.
  ///
  /// This is the number an issue is priced at and the number a receipt
  /// re-averages, so it has to come from the warehouse's own book rather than
  /// from a branch total that averages every shelf together.
  private async shelf(
    tx: Prisma.TransactionClient,
    companyId: string,
    warehouse: { id: string | null; branchId: string },
    itemId: string,
  ) {
    return this.ledger.position(
      tx,
      {
        companyId,
        branchId: warehouse.branchId,
        warehouseId: warehouse.id,
        itemId,
      },
      { forUpdate: true },
    );
  }
}
