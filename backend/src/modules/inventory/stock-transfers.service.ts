import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, StockDocumentKind } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  ApprovalActor,
  ApprovalsService,
} from '../../common/approvals/approvals.service';
import { ApprovalChain } from '../../common/approvals/approval-chain';
import { StockDocumentsService } from './stock-documents.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  STOCK_TRANSFER_APPROVAL_REQUIRED,
  STOCK_TRANSFER_CLOSE_REQUIRED,
  STOCK_TRANSFER_DISPATCH_REQUIRED,
  STOCK_TRANSFER_RECEIPT_REQUIRED,
  STOCK_TRANSFER_RECEIVED,
  STOCK_TRANSFER_LEVEL_PENDING,
  STOCK_TRANSFER_RETURNED,
  STOCK_TRANSFER_REVIEW_REQUIRED,
  STOCK_TRANSFER_SETTLEMENT_APPROVAL_REQUIRED,
  dedupeKey,
} from '../notifications/notification-kinds';

type LineInput = { itemId: string; quantity: string | number; unitId?: string; unitName?: string; batchId?: string; notes?: string };
type StageLineInput = { lineId: string; quantity: string | number; notes?: string };

@Injectable()
export class StockTransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: StockDocumentsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly approvals: ApprovalsService,
  ) {}

  async list(companyId: string, query: { status?: string; q?: string; sourceWarehouseId?: string; destinationWarehouseId?: string } = {}) {
    const where: Prisma.StockTransferWhereInput = { companyId };
    if (query.status) where.status = query.status.toUpperCase();
    if (query.sourceWarehouseId) where.sourceWarehouseId = query.sourceWarehouseId;
    if (query.destinationWarehouseId) where.destinationWarehouseId = query.destinationWarehouseId;
    if (query.q?.trim()) where.OR = [
      { documentNumber: { contains: query.q.trim(), mode: 'insensitive' } },
      { reason: { contains: query.q.trim(), mode: 'insensitive' } },
    ];
    return this.prisma.stockTransfer.findMany({
      where, orderBy: [{ transferDate: 'desc' }, { documentNumber: 'desc' }],
      include: { lines: { include: { item: { select: { code: true, nameEn: true, nameAr: true, unit: true } } } },
        sourceWarehouse: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        destinationWarehouse: { select: { id: true, code: true, nameEn: true, nameAr: true } } },
    });
  }

  async findOne(companyId: string, id: string) {
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id, companyId },
      include: { lines: { orderBy: { lineNumber: 'asc' }, include: {
        item: { select: { id: true, code: true, nameEn: true, nameAr: true, unit: true, barcode: true } },
        sourceBatch: { select: { id: true, batchNumber: true, productionDate: true, expiryDate: true } },
        transitBatch: { select: { id: true, batchNumber: true, productionDate: true, expiryDate: true } },
      } }, actions: { orderBy: { createdAt: 'asc' } },
        sourceWarehouse: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        destinationWarehouse: { select: { id: true, code: true, nameEn: true, nameAr: true } } },
    });
    if (!transfer) throw new NotFoundException('Stock transfer not found');
    return transfer;
  }

  async create(companyId: string, userId: string, input: {
    sourceWarehouseId: string; destinationWarehouseId: string; transferDate: string; reason: string;
    notes?: string; idempotencyKey: string; lines: LineInput[];
  }, allowedBranches: string[] | null = null) {
    const key = this.key(input.idempotencyKey);
    const reason = String(input.reason ?? '').trim();
    if (!reason) throw new BadRequestException('A transfer reason is required');
    if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 500) throw new BadRequestException('A transfer needs 1 to 500 lines');
    const date = this.day(input.transferDate);
    const hash = this.hash({ ...input, idempotencyKey: key });
    const result = await this.prisma.$transaction(async tx => {
      // The lock function returns void, which the typed query API cannot
      // deserialize: every transfer creation answered 500 until this was run
      // as a statement whose result is discarded. The lock itself is held
      // until the transaction ends, which is the whole point of it.
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`stock-transfer-create:${companyId}:${key}`}, 0))`);
      const prior = await tx.stockTransfer.findFirst({ where: { companyId, idempotencyKey: key } });
      if (prior) {
        const recorded = await tx.stockTransferAction.findFirst({ where: { transferId: prior.id, requestKey: `CREATE:${key}` } });
        if (!recorded || recorded.requestHash !== hash) throw new ConflictException('The idempotency key belongs to a different transfer request');
        return prior.id;
      }
      const [source, destination] = await Promise.all([
        tx.warehouse.findFirst({ where: { id: input.sourceWarehouseId, companyId, deletedAt: null, isActive: true, isTransit: false }, include: { branch: { select: { id: true } } } }),
        tx.warehouse.findFirst({ where: { id: input.destinationWarehouseId, companyId, deletedAt: null, isActive: true, isTransit: false }, include: { branch: { select: { id: true } } } }),
      ]);
      if (!source || !destination) throw new BadRequestException('Source and destination warehouses must be active warehouses in this company');
      if (allowedBranches && (!allowedBranches.includes(source.branch.id) || !allowedBranches.includes(destination.branch.id))) throw new NotFoundException('Warehouse not found');
      if (source.id === destination.id) throw new BadRequestException('Choose two different warehouses');
      const normalized = [] as Array<{ itemId: string; quantity: Prisma.Decimal; enteredQuantity: Prisma.Decimal; unitFactor: Prisma.Decimal; batchId: string | null; unitName: string; notes: string | null }>;
      for (const [idx, line] of input.lines.entries()) {
        const quantity = this.positive(line.quantity, `Line ${idx + 1} quantity`);
        const item = await tx.item.findFirst({ where: { id: line.itemId, companyId, deletedAt: null, isActive: true }, include: { units: { select: { id: true, unit: true, factor: true, isActive: true } } } });
        if (!item?.isStockTracked) throw new BadRequestException(`Line ${idx + 1}: item is not a stock-tracked item`);
        const selectedUnit = item.units.find(u => line.unitId ? u.id === line.unitId : u.unit === (line.unitName?.trim() || item.unit));
        if (!selectedUnit && (line.unitId || (line.unitName?.trim() && line.unitName.trim() !== item.unit))) throw new BadRequestException(`Line ${idx + 1}: selected unit does not exist for this item`);
        if (selectedUnit && !selectedUnit.isActive) throw new BadRequestException(`Line ${idx + 1}: selected unit is not active for this item`);
        const unitFactor = selectedUnit ? new Prisma.Decimal(selectedUnit.factor) : new Prisma.Decimal(1);
        const baseQuantity = quantity.mul(unitFactor);
        if (!baseQuantity.equals(baseQuantity.toDecimalPlaces(4))) throw new BadRequestException(`Line ${idx + 1}: quantity does not convert exactly to base units`);
        let batchId: string | null = null;
        if (line.batchId) {
          const batch = await tx.itemBatch.findFirst({ where: { id: line.batchId, companyId, itemId: item.id, warehouseId: source.id, deletedAt: null, remainingQuantity: { gte: baseQuantity } } });
          if (!batch) throw new BadRequestException(`Line ${idx + 1}: source lot is unavailable or has insufficient quantity`);
          batchId = batch.id;
        } else if (item.requiresBatch) throw new BadRequestException(`Line ${idx + 1}: choose a source lot for this batch-controlled item`);
        normalized.push({ itemId: item.id, quantity: baseQuantity, enteredQuantity: quantity, unitFactor, batchId, unitName: selectedUnit?.unit ?? item.unit, notes: line.notes?.trim() || null });
      }
      const number = `TR-${date.toISOString().slice(0,10).replaceAll('-', '')}-${randomSuffix()}`;
      const transfer = await tx.stockTransfer.create({ data: {
        companyId, sourceBranchId: source.branch.id, destinationBranchId: destination.branch.id,
        sourceWarehouseId: source.id, destinationWarehouseId: destination.id,
        documentNumber: number, transferDate: date, reason, notes: input.notes?.trim() || null,
        createdBy: userId, idempotencyKey: key,
        lines: { create: normalized.map((line, i) => ({ lineNumber: i + 1, itemId: line.itemId,
          requestedQuantity: line.quantity, sourceBatchId: line.batchId, unitName: line.unitName,
          unitFactor: line.unitFactor, unitQuantity: line.enteredQuantity, notes: line.notes })) },
      } });
      await tx.stockTransferAction.create({ data: { companyId, transferId: transfer.id, requestKey: `CREATE:${key}`, requestHash: hash, action: 'CREATE', resultVersion: 0 } });
      return transfer.id;
    }, { timeout: 30000 });
    const created = await this.findOne(companyId, result);
    await this.audit.record({ companyId, userId, action: 'CREATE', entity: 'stock_transfers', entityId: result, after: { documentNumber: created.documentNumber } });
    await this.notifyNextStages(created);
    return created;
  }

  /// Submit a draft. Under a configured chain this is the requester's own
  /// act — it opens the chain rather than deciding anything — so the
  /// "requester cannot review their own transfer" rule does not apply here;
  /// it applies to every decision, which is where the separation matters.
  async submit(companyId: string, userId: string, id: string, key: string) {
    const row = await this.findOne(companyId, id);
    const chain = await this.chainFor(companyId, row);
    if (chain.source === 'LEGACY') {
      if (row.createdBy === userId) {
        throw new BadRequestException('The requester cannot review their own transfer');
      }
      return this.transition(companyId, userId, id, key, ['DRAFT'], 'REVIEWED', {
        reviewedBy: userId,
        reviewedAt: new Date(),
      });
    }
    return this.transition(companyId, userId, id, key, ['DRAFT'], 'PENDING_APPROVAL', {
      submittedBy: userId,
      submittedAt: new Date(),
    });
  }

  /// Kept for clients written against the two-door flow. It means "submit for
  /// review", and under a configured chain that is exactly `submit`.
  async review(companyId: string, userId: string, id: string, key: string) {
    return this.submit(companyId, userId, id, key);
  }

  /// Decide the pending level of the configured chain.
  ///
  /// When the chain becomes complete the transfer moves to APPROVED, which is
  /// the only state from which dispatch is allowed. Until then it stays in
  /// PENDING_APPROVAL and dispatch is refused.
  async approve(
    companyId: string,
    userId: string,
    id: string,
    key: string,
    actor?: ApprovalActor,
    reason?: string | null,
    expectedLevel?: number | null,
  ) {
    const row = await this.findOne(companyId, id);
    const chain = await this.chainFor(companyId, row);
    if (chain.source === 'LEGACY') {
      if (row.createdBy === userId) throw new BadRequestException('The requester cannot approve their own transfer');
      if (row.reviewedBy === userId) throw new BadRequestException('The reviewer cannot also approve the transfer');
      return this.transition(companyId, userId, id, key, ['REVIEWED'], 'APPROVED', {
        approvedBy: userId,
        approvedAt: new Date(),
      });
    }
    if (!actor) throw new BadRequestException('An approval actor is required for a configured chain');
    const result = await this.approvals.decide(actor, {
      entityType: 'StockTransfer',
      entityId: id,
      chain,
      requesterId: row.createdBy,
      decision: 'APPROVE',
      reason: reason ?? null,
      expectedLevel: expectedLevel ?? null,
    });
    if (result.state.isComplete) {
      return this.transition(companyId, userId, id, key, ['PENDING_APPROVAL'], 'APPROVED', {
        approvedBy: userId,
        approvedAt: new Date(),
      });
    }
    const updated = await this.findOne(companyId, id);
    await this.notifyNextStages(updated);
    return updated;
  }

  /// Refuse the request. The chain is marked as stopped and the transfer goes
  /// back to REJECTED; the requester sees the reason and the history keeps it.
  async reject(companyId: string, userId: string, id: string, key: string, reason: string, actor?: ApprovalActor) {
    if (!reason?.trim()) throw new BadRequestException('A rejection reason is required');
    const row = await this.findOne(companyId, id);
    const chain = await this.chainFor(companyId, row);
    if (chain.source === 'LEGACY') {
      if (row.createdBy === userId) throw new BadRequestException('The requester cannot reject their own transfer');
      return this.transition(companyId, userId, id, key, ['REVIEWED'], 'REJECTED', {
        rejectedBy: userId, rejectedAt: new Date(), rejectionReason: reason.trim(),
      });
    }
    if (!actor) throw new BadRequestException('An approval actor is required to reject a configured chain');
    await this.approvals.decide(actor, {
      entityType: 'StockTransfer', entityId: id, chain,
      requesterId: row.createdBy, decision: 'REJECT', reason: reason.trim(),
    });
    return this.transition(companyId, userId, id, key, ['PENDING_APPROVAL'], 'REJECTED', {
      rejectedBy: userId, rejectedAt: new Date(), rejectionReason: reason.trim(),
    });
  }

  /// Send an in-flight request back to its author for amendment.
  ///
  /// This is the third outcome the company asked for, and it is deliberately
  /// distinct from rejection: RETURN leaves the document editable and
  /// resubmittable, and it keeps the reason on the record. The transfer lands
  /// in DRAFT so the requester can fix the quantities and submit again; the
  /// chain restarts from level 1 in a fresh sequence, and the earlier
  /// decisions stay in the history.
  async returnForAmendment(
    companyId: string,
    userId: string,
    id: string,
    key: string,
    reason: string,
    actor: ApprovalActor,
  ) {
    if (!reason?.trim()) throw new BadRequestException('A return reason is required');
    const row = await this.findOne(companyId, id);
    if (!['PENDING_APPROVAL', 'SUBMITTED', 'REVIEWED'].includes(row.status)) {
      throw new ConflictException(`A transfer cannot be returned from ${row.status}`);
    }
    const chain = await this.chainFor(companyId, row);
    if (chain.source === 'LEGACY') {
      if (row.createdBy === userId) throw new BadRequestException('The requester cannot return their own transfer');
      return this.transition(companyId, userId, id, key, [row.status], 'DRAFT', {
        returnedBy: userId, returnedAt: new Date(), returnReason: reason.trim(),
      });
    }
    await this.approvals.decide(actor, {
      entityType: 'StockTransfer', entityId: id, chain,
      requesterId: row.createdBy, decision: 'RETURN', reason: reason.trim(),
    });
    return this.transition(companyId, userId, id, key, [row.status], 'DRAFT', {
      returnedBy: userId, returnedAt: new Date(), returnReason: reason.trim(),
    });
  }

  /// The chain that governs this transfer, given its own facts.
  ///
  /// The amount a threshold is compared against is the value of the goods
  /// being moved, because that is what a manager is authorising. A line's
  /// `unitCost` is filled in at dispatch, so a draft transfer would otherwise
  /// value every request at zero and silently dodge its own approval rule.
  /// Before dispatch the item's own cost is used, then its sale price, and
  /// only if the company has priced the item nowhere is the line worth zero.
  async chainFor(
    companyId: string,
    row: {
      sourceBranchId: string;
      destinationBranchId: string;
      sourceWarehouseId: string;
      destinationWarehouseId: string;
      lines: Array<{
        itemId: string;
        requestedQuantity: Prisma.Decimal;
        unitCost: Prisma.Decimal | null;
      }>;
    },
  ): Promise<ApprovalChain> {
    const quantity = row.lines.reduce(
      (sum, line) => sum.add(line.requestedQuantity),
      new Prisma.Decimal(0),
    );
    const needsItemPrice = row.lines.some(
      (line) => (line.unitCost ?? new Prisma.Decimal(0)).isZero(),
    );
    const itemPrices = new Map<string, Prisma.Decimal>();
    if (needsItemPrice) {
      const items = await this.prisma.item.findMany({
        where: { companyId, id: { in: [...new Set(row.lines.map((line) => line.itemId))] } },
        select: { id: true, purchasePrice: true },
      });
      for (const item of items) {
        // Only a purchase price is a cost. The selling price is what we hope to
        // get for the goods, not what they are worth on the shelf, and using it
        // would let a cheap-to-buy/expensive-to-sell item be valued upward into
        // an approval rule it should never have needed - or, for a loss leader,
        // downward out of one it should.
        if (item.purchasePrice !== null) {
          itemPrices.set(item.id, new Prisma.Decimal(item.purchasePrice));
        }
      }
    }
    // A line we cannot price is not a line worth zero: zero is a claim, and it
    // is the claim that makes an amount threshold quietly stop applying.
    let amountUnderstated = false;
    const amount = row.lines.reduce((sum, line) => {
      const recordedCost = line.unitCost ?? new Prisma.Decimal(0);
      let unit = recordedCost;
      if (recordedCost.isZero()) {
        const known = itemPrices.get(line.itemId);
        if (known === undefined) {
          amountUnderstated = true;
          return sum;
        }
        unit = known;
      }
      return sum.add(line.requestedQuantity.mul(unit));
    }, new Prisma.Decimal(0));
    return this.approvals.chainFor(companyId, 'STOCK_TRANSFER', {
      branchIds: [row.sourceBranchId, row.destinationBranchId],
      sourceWarehouseId: row.sourceWarehouseId,
      destinationWarehouseId: row.destinationWarehouseId,
      amount: amount.toFixed(4),
      amountUnderstated,
      quantity: quantity.toString(),
    });
  }

  /// The approval path for one transfer, as the screen shows it.
  ///
  /// Every level states who may close it and whether it already has been, so a
  /// person holding no authority sees a path with no buttons rather than
  /// buttons that fail. That is enforcement *and* explanation from one source.
  async approvalPath(companyId: string, id: string) {
    const row = await this.findOne(companyId, id);
    const chain = await this.chainFor(companyId, row);
    if (chain.source === 'LEGACY') {
      return {
        source: 'LEGACY' as const,
        policy: null,
        levels: [] as unknown[],
        decisions: await this.approvals.decisions(companyId, 'StockTransfer', id),
        status: row.status,
      };
    }
    const { decisions, state } = await this.approvals.stateFor(
      companyId,
      chain,
      'StockTransfer',
      id,
    );
    return {
      source: 'POLICY' as const,
      policy: {
        id: chain.policyId,
        nameEn: chain.policyNameEn,
        nameAr: chain.policyNameAr,
      },
      status: row.status,
      complete: state.isComplete,
      stopped: state.stopped
        ? { level: state.stopped.level, decision: state.stopped.decision, reason: state.stopped.reason }
        : null,
      levels: chain.levels.map((level) => {
        const recorded = decisions.find(
          (decision) => decision.level === level.level && decision.decision === 'APPROVE',
        );
        return {
          level: level.level,
          nameEn: level.nameEn,
          nameAr: level.nameAr,
          permission: level.permission,
          roleCode: level.roleCode,
          optional: level.optional,
          state: recorded
            ? 'APPROVED'
            : state.stopped && state.stopped.level === level.level
              ? state.stopped.decision === 'RETURN'
                ? 'RETURNED'
                : 'REJECTED'
              : state.pendingLevel === level.level
                ? 'PENDING'
                : 'WAITING',
          decidedBy: recorded ? recorded.actorId : null,
          decidedAt: recorded ? recorded.createdAt : null,
          reason: recorded ? recorded.reason : null,
        };
      }),
    };
  }

  async dispatch(companyId: string, userId: string, id: string, key: string, lines?: StageLineInput[]) {
    const transfer = await this.findOne(companyId, id);
    const safeKey = this.key(key);
    const actionKey = `DISPATCH:${safeKey}`;
    const actionHash = this.hash({ lines: lines ?? null });
    let action = await this.prisma.stockTransferAction.findFirst({ where: { companyId, transferId: id, requestKey: actionKey } });
    if (action && action.requestHash !== actionHash) throw new ConflictException('Idempotency key was reused with different dispatch quantities');
    if (action?.stockDocumentId) {
      await this.notifyNextStages(transfer);
      return transfer;
    }
    let effectiveKey = safeKey;
    let quantities = this.stageQuantities(transfer.lines, lines, 'dispatch');
    if (!action && transfer.status === 'DISPATCHING') {
      const reservations = await this.prisma.stockTransferAction.findMany({ where: { companyId, transferId: id, action: 'DISPATCH' }, orderBy: { createdAt: 'desc' } });
      const pending = reservations.find(x => !x.stockDocumentId && x.requestHash === actionHash);
      if (pending) { action = pending; effectiveKey = pending.requestKey.slice('DISPATCH:'.length); }
    }
    if (!action) {
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM stock_transfers WHERE id=${id}::uuid AND "companyId"=${companyId}::uuid FOR UPDATE`);
        const current = await tx.stockTransfer.findFirst({ where: { id, companyId }, include: { lines: true } });
        if (!current) throw new NotFoundException('Stock transfer not found');
        const currentAction = await tx.stockTransferAction.findFirst({ where: { companyId, transferId: id, requestKey: actionKey } });
        if (currentAction) { if (currentAction.requestHash !== actionHash) throw new ConflictException('Idempotency key was reused with different dispatch quantities'); return; }
        if (!['APPROVED', 'PARTIALLY_DISPATCHED', 'PARTIALLY_RECEIVED'].includes(current.status)) throw new ConflictException(`Cannot dispatch a transfer in ${current.status}`);
        quantities = this.stageQuantities(current.lines, lines, 'dispatch');
        await tx.stockTransferAction.create({ data: { companyId, transferId: id, requestKey: actionKey, requestHash: actionHash, action: 'DISPATCH', resultVersion: current.version + 1 } });
        await tx.stockTransfer.update({ where: { id }, data: { status: 'DISPATCHING', dispatchedBy: userId, dispatchedAt: new Date(), version: { increment: 1 } } });
      });
      action = await this.prisma.stockTransferAction.findFirst({ where: { companyId, transferId: id, requestKey: actionKey } });
    } else {
      // Recover a reserved dispatch after a process/network failure. If a caller
      // retries with a fresh key, continue only when its exact payload matches
      // the one already reserved; stock cannot be dispatched twice.
      if (transfer.status === 'DISPATCHING') {
        const reservations = await this.prisma.stockTransferAction.findMany({ where: { companyId, transferId: id, action: 'DISPATCH' }, orderBy: { createdAt: 'desc' } });
        const pending = reservations.find(x => !x.stockDocumentId && x.requestHash === actionHash);
        if (pending) { action = pending; effectiveKey = pending.requestKey.slice('DISPATCH:'.length); }
      }
    }
    if (!action) throw new ConflictException('Another dispatch is in progress; retry after it completes');
    if (transfer.status !== 'DISPATCHING' && !['APPROVED','PARTIALLY_DISPATCHED','PARTIALLY_RECEIVED'].includes(transfer.status)) throw new ConflictException(`Cannot dispatch a transfer in ${transfer.status}`);
    const transit = await this.transitWarehouse(companyId, transfer.sourceBranchId, userId);
    const docKey = `transfer:${id}:dispatch:${createHash('sha256').update(effectiveKey).digest('hex').slice(0,24)}`;
    const doc = await this.documents.create(companyId, transfer.sourceBranchId, userId, {
      kind: StockDocumentKind.TRANSFER, fromBranchId: transfer.sourceBranchId, toBranchId: transfer.sourceBranchId,
      fromWarehouseId: transfer.sourceWarehouseId, toWarehouseId: transit.id,
      documentDate: transfer.transferDate.toISOString().slice(0,10), reason: `Transfer ${transfer.documentNumber} dispatch`, notes: transfer.reason,
      lines: quantities.map(({ line, quantity }) => ({ itemId: line.itemId, quantity: quantity.toString(), batchId: line.sourceBatchId ?? undefined, unitCost: '0', notes: line.notes ?? undefined })),
    }, true, { idempotencyKey: docKey });
    await this.postIfDraft(companyId, userId, doc.id);
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM stock_transfers WHERE id=${id}::uuid AND "companyId"=${companyId}::uuid FOR UPDATE`);
      const currentAction = await tx.stockTransferAction.findFirst({ where: { companyId, transferId: id, requestKey: action!.requestKey } });
      if (!currentAction) throw new ConflictException('Dispatch reservation was lost');
      if (currentAction.stockDocumentId) return;
      const current = await tx.stockTransfer.findFirst({ where: { id, companyId }, include: { lines: true } });
      if (!current || current.status !== 'DISPATCHING') throw new ConflictException('Transfer changed while dispatching');
      for (const [index, entry] of quantities.entries()) {
        const old = current.lines.find(x => x.id === entry.line.id)!;
        const docLine = doc.lines[index] as { unitCost?: string } | undefined;
        await tx.stockTransferLine.update({ where: { id: entry.line.id }, data: { dispatchedQuantity: old.dispatchedQuantity.add(entry.quantity), unitCost: docLine?.unitCost ?? old.unitCost } });
        if (entry.line.sourceBatchId) {
          const sourceBatch = await tx.itemBatch.findFirst({ where: { id: entry.line.sourceBatchId } });
          const transitBatch = sourceBatch ? await tx.itemBatch.findFirst({ where: { companyId, warehouseId: transit.id, itemId: entry.line.itemId, batchNumber: sourceBatch.batchNumber, deletedAt: null } }) : null;
          if (transitBatch) await tx.stockTransferLine.update({ where: { id: entry.line.id }, data: { transitBatchId: transitBatch.id } });
        }
      }
      const latestLines = await tx.stockTransferLine.findMany({ where: { transferId: id } });
      const fullyDispatched = latestLines.every(x => x.dispatchedQuantity.gte(x.requestedQuantity));
      await tx.stockTransfer.update({ where: { id }, data: { status: fullyDispatched ? 'DISPATCHED' : 'PARTIALLY_DISPATCHED', version: { increment: 1 } } });
      await tx.stockTransferAction.update({ where: { id: currentAction.id }, data: { stockDocumentId: doc.id, resultVersion: current.version + 2 } });
    });
    await this.audit.record({ companyId, userId, action: 'DISPATCH', entity: 'stock_transfers', entityId: id, after: { stockDocumentId: doc.id } });
    const dispatched = await this.findOne(companyId, id);
    await this.notifyNextStages(dispatched);
    return dispatched;
  }

  async receive(companyId: string, userId: string, id: string, key: string, lines: StageLineInput[]) {
    const transfer = await this.findOne(companyId, id);
    const safeKey = this.key(key);
    const actionKey = `RECEIVE:${safeKey}`;
    const actionHash = this.hash({ lines });
    let action = await this.prisma.stockTransferAction.findFirst({ where: { companyId, transferId: id, requestKey: actionKey } });
    if (action && action.requestHash !== actionHash) throw new ConflictException('Idempotency key was reused with different receipt quantities');
    if (action?.stockDocumentId) {
      await this.notifyNextStages(transfer);
      return transfer;
    }
    let effectiveKey = safeKey;
    let quantities = this.stageQuantities(transfer.lines, lines, 'receive');
    if (!action && transfer.status === 'RECEIVING') {
      const reservations = await this.prisma.stockTransferAction.findMany({ where: { companyId, transferId: id, action: 'RECEIVE' }, orderBy: { createdAt: 'desc' } });
      const pending = reservations.find(x => !x.stockDocumentId && x.requestHash === actionHash);
      if (pending) { action = pending; effectiveKey = pending.requestKey.slice('RECEIVE:'.length); }
    }
    if (!action) {
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM stock_transfers WHERE id=${id}::uuid AND "companyId"=${companyId}::uuid FOR UPDATE`);
        const current = await tx.stockTransfer.findFirst({ where: { id, companyId }, include: { lines: true } });
        if (!current) throw new NotFoundException('Stock transfer not found');
        const prior = await tx.stockTransferAction.findFirst({ where: { companyId, transferId: id, requestKey: actionKey } });
        if (prior) { if (prior.requestHash !== actionHash) throw new ConflictException('Idempotency key was reused with different receipt quantities'); return; }
        if (!['DISPATCHED', 'PARTIALLY_DISPATCHED', 'PARTIALLY_RECEIVED'].includes(current.status)) throw new ConflictException(`Cannot receive a transfer in ${current.status}`);
        quantities = this.stageQuantities(current.lines, lines, 'receive');
        await tx.stockTransferAction.create({ data: { companyId, transferId: id, requestKey: actionKey, requestHash: actionHash, action: 'RECEIVE', resultVersion: current.version + 1 } });
        await tx.stockTransfer.update({ where: { id }, data: { status: 'RECEIVING', version: { increment: 1 } } });
      });
      action = await this.prisma.stockTransferAction.findFirst({ where: { companyId, transferId: id, requestKey: actionKey } });
    }
    if (!action) throw new ConflictException('Another receipt is in progress; retry after it completes');
    if (transfer.status !== 'RECEIVING' && !['DISPATCHED','PARTIALLY_DISPATCHED','PARTIALLY_RECEIVED'].includes(transfer.status)) throw new ConflictException(`Cannot receive a transfer in ${transfer.status}`);
    const transit = await this.transitWarehouse(companyId, transfer.sourceBranchId, userId);
    const documentKey = `transfer:${id}:receive:${createHash('sha256').update(effectiveKey).digest('hex').slice(0,24)}`;
    const doc = await this.documents.create(companyId, transfer.destinationBranchId, userId, {
      kind: StockDocumentKind.TRANSFER, fromBranchId: transfer.sourceBranchId, toBranchId: transfer.destinationBranchId,
      fromWarehouseId: transit.id, toWarehouseId: transfer.destinationWarehouseId,
      documentDate: transfer.transferDate.toISOString().slice(0,10), reason: `Transfer ${transfer.documentNumber} receipt`, notes: transfer.reason,
      lines: quantities.map(({ line, quantity }) => ({ itemId: line.itemId, quantity: quantity.toString(), batchId: line.transitBatchId ?? undefined, unitCost: line.unitCost.toString(), notes: line.notes ?? undefined })),
    }, true, { idempotencyKey: documentKey });
    await this.postIfDraft(companyId, userId, doc.id);
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM stock_transfers WHERE id=${id}::uuid AND "companyId"=${companyId}::uuid FOR UPDATE`);
      const currentAction = await tx.stockTransferAction.findFirst({ where: { companyId, transferId: id, requestKey: action!.requestKey } });
      if (!currentAction) throw new ConflictException('Receipt reservation was lost');
      if (currentAction.stockDocumentId) return;
      const current = await tx.stockTransfer.findFirst({ where: { id, companyId }, include: { lines: true } });
      if (!current || current.status !== 'RECEIVING') throw new ConflictException('Transfer changed while receiving');
      for (const { line, quantity } of quantities) await tx.stockTransferLine.update({ where: { id: line.id }, data: { receivedQuantity: line.receivedQuantity.add(quantity) } });
      const linesNow = await tx.stockTransferLine.findMany({ where: { transferId: id } });
      const allReceived = linesNow.every(x => x.dispatchedQuantity.gte(x.requestedQuantity) && x.receivedQuantity.add(x.returnedQuantity).add(x.writtenOffQuantity).gte(x.dispatchedQuantity));
      await tx.stockTransfer.update({ where: { id }, data: { status: allReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED', version: { increment: 1 } } });
      await tx.stockTransferAction.update({ where: { id: currentAction.id }, data: { stockDocumentId: doc.id, resultVersion: current.version + 2 } });
    });
    await this.audit.record({ companyId, userId, action: 'RECEIVE', entity: 'stock_transfers', entityId: id, after: { stockDocumentId: doc.id } });
    const received = await this.findOne(companyId, id);
    await this.notifyNextStages(received);
    return received;
  }

  async settle(companyId: string, userId: string, id: string, key: string, lines: Array<{ lineId: string; returnedQuantity?: string | number; shortage?: string | number; damage?: string | number; reason: string }>) {
    const transfer = await this.findOne(companyId, id);
    let requestKey = `SETTLE:${this.key(key)}`;
    const requestHash = this.hash(lines);
    let prior = await this.prisma.stockTransferAction.findFirst({ where: { companyId, transferId: id, requestKey } });
    if (!prior && transfer.status === 'SETTLING') {
      const reservations = await this.prisma.stockTransferAction.findMany({ where: { companyId, transferId: id, action: 'SETTLE' }, orderBy: { createdAt: 'desc' } });
      prior = reservations.find(x => x.requestHash === requestHash) ?? null;
      if (prior) requestKey = prior.requestKey;
    }
    if (prior && prior.requestHash !== requestHash) throw new ConflictException('Idempotency key was reused with different settlement quantities');
    if (prior && transfer.status !== 'SETTLING') {
      await this.notifyNextStages(transfer);
      return transfer;
    }
    if (!['DISPATCHED', 'PARTIALLY_DISPATCHED', 'RECEIVED', 'PARTIALLY_RECEIVED', 'SETTLING'].includes(transfer.status)) throw new ConflictException('Receive dispatched goods before settling differences');
    const returns: Array<{ line: typeof transfer.lines[number]; quantity: Prisma.Decimal }> = [];
    const writeOffs: Array<{ line: typeof transfer.lines[number]; quantity: Prisma.Decimal; shortage: Prisma.Decimal; damage: Prisma.Decimal; reason: string }> = [];
    const used = new Set<string>();
    for (const input of lines) {
      const line = transfer.lines.find(x => x.id === input.lineId);
      if (!line || used.has(input.lineId)) throw new BadRequestException('Unknown or repeated transfer line');
      used.add(input.lineId);
      const returned = input.returnedQuantity === undefined ? new Prisma.Decimal(0) : this.nonnegative(input.returnedQuantity, 'returned quantity');
      const shortage = input.shortage === undefined ? new Prisma.Decimal(0) : this.nonnegative(input.shortage, 'shortage');
      const damage = input.damage === undefined ? new Prisma.Decimal(0) : this.nonnegative(input.damage, 'damage');
      const unresolved = line.dispatchedQuantity.sub(line.receivedQuantity).sub(line.returnedQuantity).sub(line.writtenOffQuantity);
      if (returned.plus(shortage).plus(damage).greaterThan(unresolved)) throw new BadRequestException('Settlement exceeds the unresolved quantity in transit');
      if ((shortage.greaterThan(0) || damage.greaterThan(0)) && !input.reason?.trim()) throw new BadRequestException('A reason is required for every shortage or damage write-off');
      if (returned.greaterThan(0)) returns.push({ line, quantity: returned });
      const writeOff = shortage.plus(damage);
      if (writeOff.greaterThan(0)) writeOffs.push({ line, quantity: writeOff, shortage, damage, reason: input.reason.trim() });
    }
    if (!returns.length && !writeOffs.length) throw new BadRequestException('Enter returned, missing or damaged quantities to settle');
    if (!prior) {
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM stock_transfers WHERE id=${id}::uuid AND "companyId"=${companyId}::uuid FOR UPDATE`);
        const current = await tx.stockTransfer.findFirst({ where: { id, companyId } });
        if (!current) throw new NotFoundException('Stock transfer not found');
        if (!['DISPATCHED', 'PARTIALLY_DISPATCHED', 'RECEIVED', 'PARTIALLY_RECEIVED'].includes(current.status)) throw new ConflictException(`Cannot settle a transfer in ${current.status}`);
        await tx.stockTransferAction.create({ data: { companyId, transferId: id, requestKey, requestHash, action: 'SETTLE', resultVersion: current.version + 1 } });
        await tx.stockTransfer.update({ where: { id }, data: { status: 'SETTLING', version: { increment: 1 } } });
      });
    }

    const transit = await this.transitWarehouse(companyId, transfer.sourceBranchId, userId);
    let returnDocumentId: string | null = null;
    if (returns.length) {
      const returnDoc = await this.documents.create(companyId, transfer.sourceBranchId, userId, {
        kind: StockDocumentKind.TRANSFER, fromBranchId: transfer.sourceBranchId, toBranchId: transfer.sourceBranchId,
        fromWarehouseId: transit.id, toWarehouseId: transfer.sourceWarehouseId,
        documentDate: transfer.transferDate.toISOString().slice(0,10), reason: `Return from transfer ${transfer.documentNumber}`,
        lines: returns.map(x => ({ itemId: x.line.itemId, quantity: x.quantity.toString(), batchId: x.line.transitBatchId ?? undefined, unitCost: x.line.unitCost.toString() })),
      }, true, { idempotencyKey: `transfer:${id}:return:${createHash('sha256').update(this.key(key)).digest('hex').slice(0,24)}` });
      returnDocumentId = returnDoc.id;
      await this.postIfDraft(companyId, userId, returnDoc.id);
    }
    let settlementDocumentId: string | null = null;
    if (writeOffs.length) {
      const writeOffDoc = await this.documents.create(companyId, transfer.sourceBranchId, userId, {
        kind: StockDocumentKind.WRITE_OFF, toWarehouseId: transit.id,
        documentDate: transfer.transferDate.toISOString().slice(0,10),
        reason: `Transfer ${transfer.documentNumber} differences: ${writeOffs.map(x=>x.reason).join('; ').slice(0,180)}`,
        lines: writeOffs.map(x => ({ itemId: x.line.itemId, quantity: x.quantity.negated().toString(), batchId: x.line.transitBatchId ?? undefined, notes: x.reason })),
      }, true, { idempotencyKey: `transfer:${id}:writeoff:${createHash('sha256').update(this.key(key)).digest('hex').slice(0,24)}` });
      settlementDocumentId = writeOffDoc.id;
    }
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM stock_transfers WHERE id=${id}::uuid AND "companyId"=${companyId}::uuid FOR UPDATE`);
      const previous = await tx.stockTransferAction.findFirst({ where: { companyId, transferId: id, requestKey } });
      if (!previous || previous.requestHash !== requestHash) throw new ConflictException('Settlement reservation was lost or changed');
      const currentTransfer = await tx.stockTransfer.findFirst({ where: { id, companyId } });
      if (!currentTransfer || currentTransfer.status !== 'SETTLING') throw new ConflictException('Transfer changed while settlement was processing');
      for (const {line,quantity} of returns) await tx.stockTransferLine.update({ where: { id: line.id }, data: { returnedQuantity: { increment: quantity } } });
      for (const {line,shortage,damage,reason} of writeOffs) await tx.stockTransferLine.update({ where: { id: line.id }, data: { reportedShortage: { increment: shortage }, reportedDamage: { increment: damage }, differenceReason: reason } });
      if (returnDocumentId) await tx.stockTransferAction.create({ data: { companyId, transferId: id, requestKey: `RETURN:${this.key(key)}`, requestHash, action: 'RETURN', stockDocumentId: returnDocumentId, resultVersion: transfer.version + 1 } });
      const updatedLines = await tx.stockTransferLine.findMany({ where: { transferId: id } });
      const unresolved = updatedLines.some(line => line.dispatchedQuantity.lt(line.requestedQuantity) || line.dispatchedQuantity.gt(line.receivedQuantity.add(line.returnedQuantity).add(line.writtenOffQuantity).add(writeOffs.find(x=>x.line.id===line.id)?.quantity ?? new Prisma.Decimal(0))));
      const status = settlementDocumentId ? 'SETTLEMENT_PENDING' : unresolved ? 'PARTIALLY_RECEIVED' : 'SETTLED';
      await tx.stockTransfer.update({ where: { id }, data: { status, settlementDocumentId, settlementRequestedBy: settlementDocumentId ? userId : null, version: { increment: 1 } } });
      await tx.stockTransferAction.update({ where: { id: previous.id }, data: { stockDocumentId: settlementDocumentId, resultVersion: currentTransfer.version + 1 } });
    });
    await this.audit.record({ companyId, userId, action: 'SETTLE', entity: 'stock_transfers', entityId: id, after: { settlementDocumentId, returns: returns.map(x=>[x.line.id,x.quantity.toString()]), writeOffs: writeOffs.map(x=>[x.line.id,x.quantity.toString()]) } });
    const settled = await this.findOne(companyId, id);
    await this.notifyNextStages(settled);
    return settled;
  }

  async approveSettlement(companyId: string, userId: string, id: string) {
    const transfer = await this.findOne(companyId, id);
    if (transfer.status !== 'SETTLEMENT_PENDING' || !transfer.settlementDocumentId) throw new ConflictException('There is no pending transfer write-off to approve');
    if (transfer.settlementRequestedBy === userId) throw new BadRequestException('The person reporting a transfer difference cannot approve its write-off');
    const document = await this.documents.findOne(companyId, transfer.settlementDocumentId, true) as { status?: string; approvedAt?: string | null };
    if (document.status !== 'POSTED') {
      if (!document.approvedAt) await this.documents.approve(companyId, userId, transfer.settlementDocumentId, true);
      await this.documents.post(companyId, userId, transfer.settlementDocumentId, true);
    }
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM stock_transfers WHERE id=${id}::uuid AND "companyId"=${companyId}::uuid FOR UPDATE`);
      const current = await tx.stockTransfer.findFirst({ where: { id, companyId }, include: { lines: true } });
      if (!current) throw new NotFoundException('Stock transfer not found');
      if (current.status === 'SETTLED') return;
      if (current.status !== 'SETTLEMENT_PENDING') throw new ConflictException('Transfer settlement has changed');
      for (const line of current.lines) {
        const remainingDifference = line.reportedShortage.add(line.reportedDamage).sub(line.writtenOffQuantity);
        if (remainingDifference.gt(0)) await tx.stockTransferLine.update({ where: { id: line.id }, data: { writtenOffQuantity: { increment: remainingDifference } } });
      }
      const finalLines = await tx.stockTransferLine.findMany({ where: { transferId: id } });
      const unresolved = finalLines.some(line => line.dispatchedQuantity.lt(line.requestedQuantity) || line.dispatchedQuantity.gt(line.receivedQuantity.add(line.returnedQuantity).add(line.writtenOffQuantity)));
      await tx.stockTransfer.update({ where: { id }, data: { status: unresolved ? 'PARTIALLY_RECEIVED' : 'SETTLED', settlementApprovedBy: userId, settlementApprovedAt: new Date(), version: { increment: 1 } } });
    });
    await this.audit.record({ companyId, userId, action: 'APPROVE_TRANSFER_SETTLEMENT', entity: 'stock_transfers', entityId: id, after: { stockDocumentId: transfer.settlementDocumentId } });
    const approved = await this.findOne(companyId, id);
    await this.notifyNextStages(approved);
    return approved;
  }

  async close(companyId: string, userId: string, id: string, key: string) {
    const row = await this.findOne(companyId, id);
    if (!['RECEIVED', 'SETTLED'].includes(row.status)) throw new ConflictException('A transfer may close only after receipts and differences are reconciled');
    const outstanding = row.lines.some(x => x.dispatchedQuantity.lt(x.requestedQuantity) || x.dispatchedQuantity.gt(x.receivedQuantity.add(x.returnedQuantity).add(x.writtenOffQuantity)));
    if (outstanding) throw new ConflictException('Unresolved goods remain in transit; receive, return or approve a write-off before closing');
    return this.transition(companyId, userId, id, key, [row.status], 'CLOSED', { closedBy: userId, closedAt: new Date() });
  }

  async cancel(companyId: string, userId: string, id: string, key: string) {
    const safeKey = this.key(key);
    const row = await this.findOne(companyId, id);
    if (row.status === 'CANCELLED') return row;
    const actionKey = `CANCEL:${safeKey}`;
    const actionHash = this.hash({ id, action: 'CANCEL' });
    const existing = await this.prisma.stockTransferAction.findFirst({ where: { companyId, transferId: id, requestKey: actionKey } });
    if (existing) { if (existing.requestHash !== actionHash) throw new ConflictException('Idempotency key was reused for a different cancellation'); return row; }
    if (['DRAFT', 'REVIEWED', 'REJECTED'].includes(row.status)) {
      return this.transition(companyId, userId, id, safeKey, [row.status], 'CANCELLED', { cancelledBy: userId, cancelledAt: new Date() });
    }
    if (row.status === 'SETTLEMENT_PENDING') throw new ConflictException('Approve or reconcile the pending write-off before cancellation');
    if (['DISPATCHED', 'PARTIALLY_DISPATCHED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'SETTLED'].includes(row.status)) {
      const actions = await this.prisma.stockTransferAction.findMany({
        where: { companyId, transferId: id, action: { in: ['RECEIVE', 'DISPATCH', 'RETURN', 'SETTLE'] } },
        orderBy: { createdAt: 'desc' },
      });
      const priority: Record<string, number> = { SETTLE: 0, RETURN: 1, RECEIVE: 2, DISPATCH: 3 };
      actions.sort((a,b)=>(priority[a.action] ?? 9)-(priority[b.action] ?? 9) || b.createdAt.getTime()-a.createdAt.getTime());
      for (const action of actions) {
        if (!action.stockDocumentId) continue;
        const reverseKey = `REVERSE:${action.stockDocumentId}`;
        const reversed = await this.prisma.stockTransferAction.findFirst({ where: { transferId: id, requestKey: reverseKey } });
        if (reversed) continue;
        const document = await this.documents.findOne(companyId, action.stockDocumentId, true) as { status?: string };
        if (document.status === 'POSTED') await this.documents.reverse(companyId, userId, action.stockDocumentId, true);
        else if (document.status !== 'REVERSED') throw new ConflictException('A transfer movement is not in a reversible posted state');
        await this.prisma.stockTransferAction.create({ data: { companyId, transferId: id, requestKey: reverseKey, requestHash: this.hash({ documentId: action.stockDocumentId }), action: 'REVERSAL', stockDocumentId: action.stockDocumentId, resultVersion: row.version } });
      }
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM stock_transfers WHERE id=${id}::uuid AND "companyId"=${companyId}::uuid FOR UPDATE`);
        const current = await tx.stockTransfer.findFirst({ where: { id, companyId } });
        if (!current || current.status === 'CLOSED') throw new ConflictException('Transfer changed and cannot be cancelled');
        if (current.status !== 'CANCELLED') await tx.stockTransfer.update({ where: { id }, data: { status: 'CANCELLED', cancelledBy: userId, cancelledAt: new Date(), version: { increment: 1 } } });
        const old = await tx.stockTransferAction.findFirst({ where: { transferId: id, requestKey: actionKey } });
        if (!old) await tx.stockTransferAction.create({ data: { companyId, transferId: id, requestKey: actionKey, requestHash: actionHash, action: 'CANCEL', resultVersion: current.version + 1 } });
      });
      await this.audit.record({ companyId, userId, action: 'CANCEL_AND_REVERSE', entity: 'stock_transfers', entityId: id });
      const cancelled = await this.findOne(companyId, id);
      await this.notifyNextStages(cancelled);
      return cancelled;
    }
    throw new ConflictException('This transfer cannot be cancelled at its current stage');
  }

  async report(companyId: string, query: { from?: string; to?: string; status?: string } = {}) {
    const rows = await this.list(companyId, { status: query.status });
    const filtered = rows.filter(row => (!query.from || row.transferDate >= this.day(query.from)) && (!query.to || row.transferDate <= this.day(query.to)));
    return { rows: filtered.map(row => ({ id: row.id, documentNumber: row.documentNumber, transferDate: row.transferDate,
      status: row.status, sourceBranchId: row.sourceBranchId, destinationBranchId: row.destinationBranchId,
      sourceWarehouseId: row.sourceWarehouseId, destinationWarehouseId: row.destinationWarehouseId,
      sourceWarehouse: row.sourceWarehouse, destinationWarehouse: row.destinationWarehouse,
      requested: row.lines.reduce((s,l)=>s.plus(l.requestedQuantity),new Prisma.Decimal(0)).toString(),
      dispatched: row.lines.reduce((s,l)=>s.plus(l.dispatchedQuantity),new Prisma.Decimal(0)).toString(),
      received: row.lines.reduce((s,l)=>s.plus(l.receivedQuantity),new Prisma.Decimal(0)).toString(),
      inTransit: row.lines.reduce((s,l)=>s.plus(l.dispatchedQuantity).minus(l.receivedQuantity).minus(l.returnedQuantity).minus(l.writtenOffQuantity),new Prisma.Decimal(0)).toString(),
      differences: row.lines.reduce((s,l)=>s.plus(l.reportedShortage).plus(l.reportedDamage),new Prisma.Decimal(0)).toString() })) };
  }

  private async transition(companyId: string, userId: string, id: string, key: string, allowed: string[], status: string, extra: Record<string, unknown>) {
    const requestKey = `${status}:${this.key(key)}`;
    const hash = this.hash({ id, status, extra });
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM stock_transfers WHERE id=${id}::uuid AND "companyId"=${companyId}::uuid FOR UPDATE`);
      const row = await tx.stockTransfer.findFirst({ where: { id, companyId } });
      if (!row) throw new NotFoundException('Stock transfer not found');
      const previous = await tx.stockTransferAction.findFirst({ where: { transferId: id, requestKey } });
      if (previous) { if (previous.requestHash !== hash) throw new ConflictException('Idempotency key was reused with a different action'); return; }
      if (!allowed.includes(row.status)) throw new ConflictException(`Cannot transition transfer from ${row.status} to ${status}`);
      const updated = await tx.stockTransfer.updateMany({ where: { id, companyId, status: row.status, version: row.version }, data: { status, version: { increment: 1 }, ...extra } as never });
      if (updated.count !== 1) throw new ConflictException('Transfer changed; reload and retry');
      await tx.stockTransferAction.create({ data: { companyId, transferId: id, requestKey, requestHash: hash, action: status, resultVersion: row.version + 1 } });
    });
    await this.audit.record({ companyId, userId, action: status, entity: 'stock_transfers', entityId: id });
    const updated = await this.findOne(companyId, id);
    await this.notifyNextStages(updated);
    return updated;
  }

  private async notifyNextStages(transfer: Awaited<ReturnType<StockTransfersService['findOne']>>) {
    const stages: string[] = [];
    // A configured chain announces the level that is actually waiting, not the
    // generic "awaiting approval". That is what makes the alert land in front
    // of the right person: the kind carries the level's own permission.
    const chain = await this.chainFor(transfer.companyId, transfer);
    if (transfer.status === 'PENDING_APPROVAL' && chain.source === 'POLICY') {
      const current = await this.approvals.stateFor(
        transfer.companyId,
        chain,
        'StockTransfer',
        transfer.id,
      );
      const level = chain.levels.find((candidate) => candidate.level === current.state.pendingLevel);
      for (const type of level ? [STOCK_TRANSFER_LEVEL_PENDING] : []) {
        await this.notifyStage(transfer, type, level ?? undefined);
      }
      return;
    }
    // A returned request is the requester's own news, and it must reach them
    // rather than the approvers who have just finished with it.
    if (transfer.status === 'DRAFT' && transfer.returnedAt) {
      await this.notifications.raise({
        companyId: transfer.companyId,
        branchId: transfer.sourceBranchId,
        warehouseId: transfer.sourceWarehouseId,
        type: STOCK_TRANSFER_RETURNED,
        titleAr: 'تحويل أُعيد للتعديل',
        titleEn: 'Transfer returned for amendment',
        bodyAr: `أُعيد التحويل ${transfer.documentNumber} للتعديل: ${transfer.returnReason ?? ''}`,
        bodyEn: `Transfer ${transfer.documentNumber} was returned for amendment: ${transfer.returnReason ?? ''}`,
        entityType: 'StockTransfer',
        entityId: transfer.id,
        entityRef: transfer.documentNumber,
        actionPath: `/inventory/stock-transfers?transferId=${encodeURIComponent(transfer.id)}`,
        dedupe: dedupeKey({ type: STOCK_TRANSFER_RETURNED, entityId: transfer.id }),
      });
      return;
    }
    if (transfer.status === 'DRAFT') stages.push(STOCK_TRANSFER_REVIEW_REQUIRED);
    if (transfer.status === 'REVIEWED') stages.push(STOCK_TRANSFER_APPROVAL_REQUIRED);
    if (['APPROVED', 'PARTIALLY_DISPATCHED', 'PARTIALLY_RECEIVED'].includes(transfer.status) &&
        transfer.lines.some(line => line.dispatchedQuantity.lt(line.requestedQuantity))) {
      stages.push(STOCK_TRANSFER_DISPATCH_REQUIRED);
    }
    if (['DISPATCHED', 'PARTIALLY_DISPATCHED', 'PARTIALLY_RECEIVED'].includes(transfer.status) &&
        transfer.lines.some(line => line.dispatchedQuantity.gt(line.receivedQuantity.add(line.returnedQuantity).add(line.writtenOffQuantity)))) {
      stages.push(STOCK_TRANSFER_RECEIPT_REQUIRED);
    }
    if (['PARTIALLY_RECEIVED', 'RECEIVED', 'SETTLED'].includes(transfer.status)) {
      stages.push(STOCK_TRANSFER_RECEIVED);
    }
    if (transfer.status === 'SETTLEMENT_PENDING') stages.push(STOCK_TRANSFER_SETTLEMENT_APPROVAL_REQUIRED);
    if (['RECEIVED', 'SETTLED'].includes(transfer.status)) stages.push(STOCK_TRANSFER_CLOSE_REQUIRED);
    // Keep the current human task visible until it is completed; close the
    // previous stage so a dispatched task does not linger after receipt.
    await this.notifications.resolveEntity(
      transfer.companyId,
      'StockTransfer',
      transfer.id,
      stages,
    );
    for (const type of stages) await this.notifyStage(transfer, type);
  }

  private async notifyStage(
    transfer: Awaited<ReturnType<StockTransfersService['findOne']>>,
    type: string,
    level?: { level: number; nameEn: string; nameAr: string; permission: string },
  ) {
    const destinationStage = type === STOCK_TRANSFER_RECEIPT_REQUIRED ||
      type === STOCK_TRANSFER_SETTLEMENT_APPROVAL_REQUIRED ||
      type === STOCK_TRANSFER_CLOSE_REQUIRED;
    const warehouse = destinationStage ? transfer.destinationWarehouse : transfer.sourceWarehouse;
    const fromName = transfer.sourceWarehouse.nameAr || transfer.sourceWarehouse.nameEn;
    const toName = transfer.destinationWarehouse.nameAr || transfer.destinationWarehouse.nameEn;
    const documentNumber = transfer.documentNumber;
    const date = transfer.transferDate.toISOString().slice(0, 10);
    const labels: Record<string, { titleAr: string; titleEn: string; bodyAr: string; bodyEn: string }> = {
      [STOCK_TRANSFER_REVIEW_REQUIRED]: {
        titleAr: 'طلب تحويل بانتظار المراجعة', titleEn: 'Transfer awaiting review',
        bodyAr: `التحويل ${documentNumber} من ${fromName} إلى ${toName} بتاريخ ${date} بانتظار المراجعة.`,
        bodyEn: `Transfer ${documentNumber} from ${fromName} to ${toName}, dated ${date}, is awaiting review.`,
      },
      [STOCK_TRANSFER_APPROVAL_REQUIRED]: {
        titleAr: 'تحويل بانتظار الاعتماد', titleEn: 'Transfer awaiting approval',
        bodyAr: `التحويل ${documentNumber} من ${fromName} إلى ${toName} بتاريخ ${date} بانتظار الاعتماد.`,
        bodyEn: `Transfer ${documentNumber} from ${fromName} to ${toName}, dated ${date}, is awaiting approval.`,
      },
      [STOCK_TRANSFER_DISPATCH_REQUIRED]: {
        titleAr: 'تحويل معتمد بانتظار التسليم', titleEn: 'Approved transfer awaiting dispatch',
        bodyAr: `التحويل ${documentNumber} من ${fromName} إلى ${toName} بتاريخ ${date} بانتظار التسليم من المخزن المصدر.`,
        bodyEn: `Transfer ${documentNumber} from ${fromName} to ${toName}, dated ${date}, is awaiting dispatch from the source warehouse.`,
      },
      [STOCK_TRANSFER_RECEIPT_REQUIRED]: {
        titleAr: 'بضاعة بالطريق بانتظار الاستلام', titleEn: 'Goods in transit awaiting receipt',
        bodyAr: `تم تسليم التحويل ${documentNumber} من ${fromName} بتاريخ ${date} إلى البضاعة بالطريق. يُرجى استكمال الاستلام أو الإبلاغ عن الفروق في ${toName}.`,
        bodyEn: `Transfer ${documentNumber} was dispatched from ${fromName} on ${date}. Complete receipt or report differences at ${toName}.`,
      },
      [STOCK_TRANSFER_RECEIVED]: {
        titleAr: 'تم استلام بضاعة التحويل', titleEn: 'Transfer goods received',
        bodyAr: `تم تسجيل استلام التحويل ${documentNumber} في ${toName} بتاريخ ${date}.`,
        bodyEn: `Receipt for transfer ${documentNumber} was recorded at ${toName} on ${date}.`,
      },
      [STOCK_TRANSFER_SETTLEMENT_APPROVAL_REQUIRED]: {
        titleAr: 'فروق تحويل بانتظار الاعتماد', titleEn: 'Transfer differences awaiting approval',
        bodyAr: `التحويل ${documentNumber} من ${fromName} إلى ${toName} بتاريخ ${date} لديه فروق بانتظار اعتماد التسوية.`,
        bodyEn: `Transfer ${documentNumber} from ${fromName} to ${toName}, dated ${date}, has differences awaiting settlement approval.`,
      },
      [STOCK_TRANSFER_LEVEL_PENDING]: {
        titleAr: level ? `اعتماد التحويل — ${level.nameAr}` : 'اعتماد تحويل',
        titleEn: level ? `Transfer approval — ${level.nameEn}` : 'Transfer approval',
        bodyAr: `التحويل ${documentNumber} من ${fromName} إلى ${toName} بتاريخ ${date} بانتظار المستوى ${level?.level ?? ''} من الاعتماد.`,
        bodyEn: `Transfer ${documentNumber} from ${fromName} to ${toName}, dated ${date}, is awaiting approval level ${level?.level ?? ''}.`,
      },
      [STOCK_TRANSFER_CLOSE_REQUIRED]: {
        titleAr: 'تحويل مكتمل بانتظار الإغلاق', titleEn: 'Completed transfer awaiting closure',
        bodyAr: `اكتمل استلام وتسوية التحويل ${documentNumber} بين ${fromName} و${toName} بتاريخ ${date}؛ يمكن إغلاقه.`,
        bodyEn: `Transfer ${documentNumber} between ${fromName} and ${toName} was received and reconciled on ${date}; it can be closed.`,
      },
    };
    const label = labels[type];
    if (!label) return;
    await this.notifications.raise({
      companyId: transfer.companyId,
      branchId: destinationStage ? transfer.destinationBranchId : transfer.sourceBranchId,
      warehouseId: warehouse.id,
      type,
      ...label,
      entityType: 'StockTransfer',
      entityId: transfer.id,
      entityRef: documentNumber,
      actionPath: `/inventory/stock-transfers?transferId=${encodeURIComponent(transfer.id)}`,
      // A configured level names the permission that may close it, so the
      // alert names that permission rather than the kind's default.
      permission: level?.permission ?? null,
      // A transfer's current task is one deduplicated alert, even if the
      // shipment arrives in several dispatch/receipt batches.
      dedupe: dedupeKey({ type, entityId: transfer.id }),
    });
  }

  private async transitWarehouse(companyId: string, branchId: string, userId: string) {
    const existing = await this.prisma.warehouse.findFirst({ where: { companyId, branchId, isTransit: true, deletedAt: null } });
    if (existing) return existing;
    try {
      return await this.prisma.warehouse.create({ data: { companyId, branchId, code: `TRANSIT-${branchId.slice(0,8)}`, nameEn: 'Goods in transit', nameAr: 'بضاعة بالطريق', isTransit: true, isDefault: false, isActive: true, createdBy: userId } });
    } catch {
      const created = await this.prisma.warehouse.findFirst({ where: { companyId, branchId, isTransit: true, deletedAt: null } });
      if (created) return created;
      throw new ConflictException('Could not initialize the company transit warehouse');
    }
  }

  private async postIfDraft(companyId: string, userId: string, id: string) {
    const doc = await this.documents.findOne(companyId, id, true);
    if ((doc as { status?: string }).status === 'POSTED') return doc;
    return this.documents.post(companyId, userId, id, true);
  }
  private stageQuantities(lines: Array<{ id: string; itemId: string; requestedQuantity: Prisma.Decimal; dispatchedQuantity: Prisma.Decimal; receivedQuantity: Prisma.Decimal; returnedQuantity: Prisma.Decimal; writtenOffQuantity: Prisma.Decimal; sourceBatchId: string | null; transitBatchId: string | null; unitName: string | null; unitCost: Prisma.Decimal; notes: string | null }>, input: StageLineInput[] | undefined, stage: 'dispatch'|'receive') {
    const remaining = (line: typeof lines[number]) => stage === 'dispatch'
      ? line.requestedQuantity.sub(line.dispatchedQuantity)
      : line.dispatchedQuantity.sub(line.receivedQuantity).sub(line.returnedQuantity).sub(line.writtenOffQuantity);
    const source = input?.length ? input : lines.filter(x => remaining(x).gt(0)).map(x => ({ lineId: x.id, quantity: remaining(x).toString() }));
    if (!source.length) throw new BadRequestException('No quantities are available for this action');
    const seen = new Set<string>();
    return source.map(x => {
      const line = lines.find(l => l.id === x.lineId); if (!line || seen.has(x.lineId)) throw new BadRequestException('Unknown or repeated transfer line'); seen.add(x.lineId);
      const quantity = this.positive(x.quantity, 'quantity');
      const available = stage==='dispatch' ? line.requestedQuantity.sub(line.dispatchedQuantity) : line.dispatchedQuantity.sub(line.receivedQuantity).sub(line.returnedQuantity).sub(line.writtenOffQuantity);
      if (quantity.gt(available)) throw new BadRequestException(`Quantity exceeds the ${stage==='dispatch'?'undispatched':'in-transit'} quantity`);
      if (stage==='receive' && line.sourceBatchId && !line.transitBatchId) throw new ConflictException('Transit lot is not available; refresh the transfer');
      return { line, quantity };
    });
  }
  private positive(v: string|number, label: string) { return this.nonnegative(v,label).gt(0) ? this.nonnegative(v,label) : (()=>{throw new BadRequestException(`${label} must be greater than zero`)})(); }
  private nonnegative(v: string|number, label: string) { let n: Prisma.Decimal; try { n = new Prisma.Decimal(String(v)); } catch { throw new BadRequestException(`${label} must be numeric`); } if (!n.isFinite() || n.lessThan(0) || !n.equals(n.toDecimalPlaces(4))) throw new BadRequestException(`${label} must be non-negative with at most four decimal places`); return n; }
  private key(v: string) { const key=String(v??'').trim(); if (!key || key.length>120) throw new BadRequestException('A valid idempotency key is required'); if (key.length > 60) throw new BadRequestException('Idempotency keys may be at most 60 characters'); return key; }
  private hash(v: unknown) { return createHash('sha256').update(JSON.stringify(v)).digest('hex'); }
  private day(v: string) { const s=String(v??'').slice(0,10), d=new Date(`${s}T00:00:00.000Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==s) throw new BadRequestException('A valid YYYY-MM-DD date is required'); return d; }
}
function randomSuffix() { return randomUUID().slice(0, 8).toUpperCase(); }
