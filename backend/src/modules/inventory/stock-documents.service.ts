import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, Prisma, StockDirection, StockDocumentKind } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanySettingsService } from '../../common/settings/company-settings.module';
import { exactBaseQuantity, parseDocumentQuantity, parseFactor, resolveUnitSelection } from '../../common/units/unit-math';
import { orderCreationIdentity } from '../../common/units/order-creation-identity';
import type { ItemUnitLike } from '../../common/units/unit-math';
import { WarehouseService } from '../../common/warehouse/warehouse.service';
import { AccountMapService } from '../accounting/account-map.service';
import { CostCentersService } from '../accounting/cost-centers.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { PostingService } from '../accounting/posting.service';
import { takeOriginalStockMovement } from './original-stock-movement';

const MONEY_SCALE = 4;

export interface StockDocumentLineInput {
  itemId: string;
  /** Existing line identity, used only when editing a saved voucher. */
  id?: string;
  /** Adjustment: signed change. Count: ignored (countedQuantity is used). */
  quantity?: string | number;
  countedQuantity?: string | number;
  /**
   * The unit the person counted in, e.g. "carton" for a stock count entered as
   * "3 cartons". The saved conversion factor of that unit turns the figure
   * into base units, which is what stock and value are kept in. Omitted means
   * the item's base unit.
   */
  unit?: string;
  unitCost?: string | number;
  notes?: string;
  /** Optional chosen unit; quantity/countedQuantity are expressed in it. */
  unitName?: string;
  unitId?: string;
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
    private readonly costCenters: CostCentersService,
  ) {}

  async findAll(
    companyId: string,
    query: { kind?: string; q?: string; voucherOnly?: boolean; branchId?: string; from?: string; to?: string; page?: number; pageSize?: number } = {},
    voucherBranchId?: string | null,
  ) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);

    const where: Prisma.StockDocumentWhereInput = { companyId, deletedAt: null };
    // Ordinary stock documents retain their existing company-wide policy;
    // vouchers are visible only in the signed-in user's own branch.
    // Undefined is reserved for internal trusted service callers.
    if (voucherBranchId !== undefined) where.AND = [{OR:[
      {voucherKind:null}, ...(voucherBranchId ? [{branchId:voucherBranchId}] : []),
    ]}];
    if (query.kind) {
      const kind = query.kind.toUpperCase();
      if (!Object.values(StockDocumentKind).includes(kind as StockDocumentKind)) {
        throw new BadRequestException(`Unknown stock document kind: ${query.kind}`);
      }
      where.kind = kind as StockDocumentKind;
    }
    if (query.voucherOnly) where.voucherKind = { not: null };
    if (query.q !== undefined) {
      if (typeof query.q !== 'string' || query.q.trim().length > 120) {
        throw new BadRequestException('Search must be text of at most 120 characters');
      }
      const term = query.q.trim();
      if (term) where.OR = [
        {documentNumber:{contains:term,mode:'insensitive'}},
        {counterpartyName:{contains:term,mode:'insensitive'}},
        {reason:{contains:term,mode:'insensitive'}},
      ];
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
        include: {
          lines: true,
          branch: { select: { code: true, nameEn: true, nameAr: true } },
          costCenter: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        },
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

  async findOne(companyId: string, id: string, mayReadCost = true, voucherBranchId?: string | null) {
    const document = await this.prisma.stockDocument.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        branch: { select: { code: true, nameEn: true, nameAr: true } },
        costCenter: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        toWarehouse: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: { item: { select: { code: true, nameEn: true, nameAr: true, unit: true } } },
        },
      },
    });
    if (!document || (document.voucherKind && voucherBranchId !== undefined && document.branchId !== voucherBranchId)) {
      throw new NotFoundException('Stock document not found');
    }

    return {
      ...this.toSummary(document),
      lines: document.lines.map((line) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        itemId: line.itemId,
        itemCode: line.item.code,
        itemNameEn: line.item.nameEn,
        itemNameAr: line.item.nameAr,
        unit: line.unitName ?? line.item.unit,
        unitName: line.unitName ?? null,
        unitFactor:
          line.unitFactor === null || line.unitFactor === undefined
            ? null
            : line.unitFactor.toFixed(6),
        unitQuantity: (line.unitQuantity ?? line.quantity).toFixed(MONEY_SCALE),
        quantity: line.quantity.toFixed(MONEY_SCALE),
        baseQuantity: line.quantity.toFixed(MONEY_SCALE),
        // Unit cost is a cost figure: withheld when the caller lacks cost.read;
        // the document and its quantities remain fully readable.
        unitCost: mayReadCost ? line.unitCost.toFixed(MONEY_SCALE) : null,
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
      idempotencyKey?: string;
      voucherKind?: string;
      counterpartyName?: string;
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

      /// The centre that bears an adjustment's loss or gain. Refused on a
      /// transfer, which moves value between two balance-sheet places.
      costCenterId?: string;

      lines: StockDocumentLineInput[];
    },
    mayReadCost = true,
  ) {
    const targetBranch = dto.branchId ?? dto.toBranchId ?? branchId;
    if (!targetBranch) throw new BadRequestException('The signed-in user is not assigned to a branch');
    const identity = orderCreationIdentity(dto as unknown as Record<string, unknown>);
    const voucherKind = dto.voucherKind === undefined ? null : String(dto.voucherKind).toUpperCase();
    if (voucherKind !== null && !['RECEIPT', 'ISSUE'].includes(voucherKind)) throw new BadRequestException('Unknown stock voucher kind');
    if (voucherKind && (!branchId || branchId !== targetBranch)) throw new BadRequestException('Stock voucher must belong to the signed-in branch');
    if (voucherKind && !identity) throw new BadRequestException('idempotencyKey is required for stock vouchers');
    if (voucherKind === 'RECEIPT' && !mayReadCost) throw new ForbiddenException('Receipt vouchers require inventory.cost.read');
    const created = await this.prisma.$transaction(async (tx) => {
      if (identity) {
        // Serialize retries before reading mutable item/unit data. A lost
        // response can be replayed even if a unit was later disabled.
        await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM (
          SELECT pg_advisory_xact_lock(hashtextextended(${`stock-document:${companyId}:${targetBranch}:${identity.key}`}, 0))
        ) AS stock_request_lock`);
        const previous = await tx.$queryRaw<Array<{ documentId:string; requestHash:string }>>(Prisma.sql`
          SELECT "documentId", "requestHash" FROM stock_document_creation_requests
           WHERE "companyId" = ${companyId}::uuid AND "branchId" = ${targetBranch}::uuid
             AND "requestKey" = ${identity.key}
        `);
        if (previous.length) {
          if (previous[0].requestHash !== identity.hash) throw new ConflictException('The idempotency key was used for a different request');
          return { id: previous[0].documentId };
        }
      }
      const branch = await tx.branch.findFirst({where:{id:targetBranch,companyId,deletedAt:null},select:{id:true}});
      if (!branch) throw new BadRequestException('Target branch does not belong to this company');
      const kind = String(dto.kind ?? '').toUpperCase() as StockDocumentKind;
    if (!Object.values(StockDocumentKind).includes(kind)) {
      throw new BadRequestException('kind must be ADJUSTMENT, TRANSFER, COUNT or OPENING');
    }
    if (voucherKind && kind !== StockDocumentKind.ADJUSTMENT) throw new BadRequestException('Stock vouchers must be adjustments');
    if (voucherKind && (typeof dto.reason !== 'string' || !dto.reason.trim() || typeof dto.counterpartyName !== 'string' || !dto.counterpartyName.trim() || dto.counterpartyName.trim().length > 200 || !dto.toWarehouseId)) {
      throw new BadRequestException('A stock voucher needs a warehouse, reason and counterparty');
    }
    if (voucherKind) {
      const warehouse = await tx.warehouse.findFirst({where:{id:dto.toWarehouseId,companyId,branchId:targetBranch,deletedAt:null,isActive:true},select:{id:true}});
      if (!warehouse) throw new BadRequestException('The voucher warehouse does not belong to this branch or is inactive');
    }
    if (kind === StockDocumentKind.OPENING) {
      throw new BadRequestException(
        'Use an opening balance document for opening stock: it posts the accounting and the stock together.',
      );
    }

    if (!Array.isArray(dto.lines) || dto.lines.length === 0) {
      throw new BadRequestException('A stock document needs at least one line');
    }

    const date = this.date(dto.documentDate, 'documentDate');

    // Only the documents whose posting touches a profit-and-loss account can
    // carry a centre. A transfer moves stock between two places the company
    // already owns, so attributing it would turn cost into a promise.
    const costCenterId = dto.costCenterId
      ? String(dto.costCenterId).trim()
      : null;
    if (costCenterId) {
      if (kind === StockDocumentKind.TRANSFER) {
        throw new BadRequestException(
          'A stock transfer cannot carry a cost center: it is not a cost.',
        );
      }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(costCenterId)) {
        throw new BadRequestException('costCenterId must be a UUID');
      }
      await this.costCenters.assertPostable(
        tx,
        companyId,
        [costCenterId],
        date,
      );
    }

    const lines: Array<{
      itemId: string;
      quantity: Prisma.Decimal;
      countedQuantity: Prisma.Decimal | null;
      unitCost: Prisma.Decimal;
      notes: string | null;
      unitName: string | null;
      unitFactor: Prisma.Decimal | null;
      unitQuantity: Prisma.Decimal | null;
    }> = [];
    for (const [index, raw] of dto.lines.entries()) {
      const item = await tx.item.findFirst({
        where: { id: raw.itemId, companyId, deletedAt: null },
        select: { id: true, isStockTracked: true, code: true, unit: true, units: true },
      });
      if (!item) throw new BadRequestException(`Line ${index + 1}: the item does not exist`);
      if (!item.isStockTracked) {
        throw new BadRequestException(`Line ${index + 1}: item ${item.code} is not stock-tracked`);
      }

      // One conversion path for both the stock-document `unit` field and the
      // document-line `unitName/unitId` fields. The entered quantity stays in
      // the chosen unit until resolveUnitSelection turns it into base units;
      // that helper also refuses unknown/inactive units and freezes the
      // factor in the display snapshot.
      const requestedUnitName = raw.unitName ?? raw.unit;
      let quantity =
        raw.quantity === undefined
          ? new Prisma.Decimal(0)
          : parseDocumentQuantity(raw.quantity, `Line ${index + 1} quantity`);
      let countedQuantity =
        raw.countedQuantity === undefined
          ? null
          : parseDocumentQuantity(raw.countedQuantity, `Line ${index + 1} counted quantity`);
      if (voucherKind === 'RECEIPT' && (raw.unitCost === undefined || raw.unitCost === null || raw.unitCost === '')) {
        throw new BadRequestException(`Line ${index + 1}: receipt unit cost is required`);
      }
      const unitCost =
        raw.unitCost === undefined
          ? new Prisma.Decimal(0)
          : this.decimal(raw.unitCost, `Line ${index + 1} unit cost`);

      // Multi-unit: convert the entered values into base-unit quantities the
      // posting logic already understands, keeping a frozen display snapshot.
      let unitName: string | null = null;
      let unitFactor: Prisma.Decimal | null = null;
      let unitQuantity: Prisma.Decimal | null = null;
      if (requestedUnitName || raw.unitId) {
        const units = (item as { units?: ItemUnitLike[] }).units ?? [];
        if (!quantity.isZero()) {
          // Adjustments may be negative (write-off): convert the
          // magnitude and restore the sign on the base quantity.
          const sign = quantity.isNegative() ? new Prisma.Decimal(-1) : new Prisma.Decimal(1);
          const resolved = resolveUnitSelection({
            lineLabel: `Line ${index + 1}`,
            requestedUnitId: raw.unitId,
            requestedUnitName: requestedUnitName,
            enteredQuantity: quantity.abs(),
            baseUnitName: item.unit,
            units,
          });
          unitName = resolved.snapshot.unitName;
          unitFactor = resolved.snapshot.unitFactor;
          unitQuantity = quantity;
          quantity = resolved.baseQuantity.mul(sign);
        }
        if (countedQuantity && !countedQuantity.isZero()) {
          const resolvedCount = resolveUnitSelection({
            lineLabel: `Line ${index + 1}`,
            requestedUnitId: raw.unitId,
            requestedUnitName: requestedUnitName,
            enteredQuantity: countedQuantity,
            baseUnitName: item.unit,
            units,
          });
          unitName = resolvedCount.snapshot.unitName;
          unitFactor = resolvedCount.snapshot.unitFactor;
          unitQuantity = countedQuantity;
          countedQuantity = resolvedCount.baseQuantity;
        }
      }

      if (kind !== StockDocumentKind.COUNT && quantity.isZero()) {
        throw new BadRequestException(`Line ${index + 1}: a quantity is required`);
      }
      if (voucherKind === 'RECEIPT' && !quantity.isPositive()) throw new BadRequestException(`Line ${index + 1}: receipt quantity must be positive`);
      if (voucherKind === 'ISSUE' && !quantity.isNegative()) throw new BadRequestException(`Line ${index + 1}: issue quantity must be negative`);
      if (kind === StockDocumentKind.TRANSFER && quantity.isNegative()) {
        throw new BadRequestException(`Line ${index + 1}: transfer quantity must be positive`);
      }
      if (kind === StockDocumentKind.COUNT && (!countedQuantity || countedQuantity.isNegative())) {
        throw new BadRequestException(
          `Line ${index + 1}: a count needs the quantity that was actually counted`,
        );
      }
      if (unitCost.isNegative()) {
        throw new BadRequestException(`Line ${index + 1}: the unit cost cannot be negative`);
      }
      if (quantity.abs().mul(unitCost).greaterThanOrEqualTo('1e15')) {
        throw new BadRequestException(`Line ${index + 1}: stock value exceeds the supported range`);
      }

      lines.push({
        itemId: item.id,
        quantity,
        countedQuantity,
        unitCost,
        notes: raw.notes ?? null,
        unitName,
        unitFactor,
        unitQuantity,
      });
    }

    // Every stock issue is an expense attribution, not an anonymous balance
    // change. Enforce this in the API so UI omissions cannot bypass accounting.
    if (kind === StockDocumentKind.ADJUSTMENT &&
        lines.some((line) => line.quantity.isNegative()) && !costCenterId) {
      throw new BadRequestException(
        'A cost center is required when issuing stock from a warehouse.',
      );
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
      const sourceBranch = await tx.branch.findFirst({where:{id:fromBranchId,companyId,deletedAt:null},select:{id:true}});
      if (!sourceBranch) throw new BadRequestException('Source branch does not belong to this company');
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

      const prefix =
        kind === StockDocumentKind.TRANSFER
          ? 'ST'
          : kind === StockDocumentKind.COUNT
            ? 'SC'
            : 'SA';
      const documentNumber = await this.numbers.next(tx, companyId, `STOCK_${kind}`, prefix);
      const document = await tx.stockDocument.create({
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
          voucherKind,
          counterpartyName: voucherKind ? dto.counterpartyName!.trim() : null,
          notes: dto.notes?.trim() || null,
          costCenterId,
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
              unitName: line.unitName,
              unitFactor: line.unitFactor,
              unitQuantity: line.unitQuantity,
            })),
          },
        },
      });
      if (identity) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO stock_document_creation_requests ("companyId", "branchId", "requestKey", "requestHash", "documentId")
          VALUES (${companyId}::uuid, ${targetBranch}::uuid, ${identity.key}, ${identity.hash}, ${document.id}::uuid)
        `);
      }
      await this.audit.recordRequired({
        companyId, userId, action: 'CREATE', entity: 'stock_documents',
        entityId: document.id,
        after: { documentNumber: document.documentNumber, kind, lines: lines.length },
      }, tx);
      return document;
    }, { timeout: 30000 });

    return this.findOne(companyId, created.id, mayReadCost);
  }

  /** Replace a saved voucher draft under its parent row lock. Workflow
   * approvals are invalidated with the edit; retries have their own ledger.
   * A line retaining its original item and unit keeps its historical factor.
   */
  async updateVoucher(companyId: string, branchId: string | null, userId: string, id: string,
    dto: { idempotencyKey?: string; expectedVersion: number; documentDate: string; toWarehouseId: string;
      counterpartyName: string; reason: string; notes?: string | null; costCenterId?: string | null;
      lines: StockDocumentLineInput[] }, mayReadCost = true) {
    if (!branchId) throw new BadRequestException('The signed-in user is not assigned to a branch');
    const identity = orderCreationIdentity(dto as unknown as Record<string, unknown>);
    if (!identity) throw new BadRequestException('idempotencyKey is required');
    if (!Number.isSafeInteger(dto.expectedVersion) || dto.expectedVersion < 0) {
      throw new BadRequestException('expectedVersion must be a non-negative integer');
    }
    await this.prisma.$transaction(async tx => {
      // Acquire key before row, consistently for same-key concurrent retries.
      await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM (
        SELECT pg_advisory_xact_lock(hashtextextended(${`stock-voucher-edit:${companyId}:${branchId}:${identity.key}`}, 0))
      ) AS edit_request_lock`);
      const locked = await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`
        SELECT id FROM stock_documents WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid
          AND "branchId" = ${branchId}::uuid AND "deletedAt" IS NULL FOR UPDATE
      `);
      if (locked.length !== 1) throw new NotFoundException('Stock voucher not found');
      const document = await tx.stockDocument.findUniqueOrThrow({where:{id},include:{lines:true}});
      if (!document.voucherKind) throw new NotFoundException('Stock voucher not found');
      if (document.voucherKind === 'RECEIPT' && !mayReadCost) throw new ForbiddenException('Receipt vouchers require inventory.cost.read');
      const previous = await tx.$queryRaw<Array<{documentId:string;requestHash:string;resultVersion:number}>>(Prisma.sql`
        SELECT "documentId", "requestHash", "resultVersion" FROM stock_voucher_edit_requests
        WHERE "companyId" = ${companyId}::uuid AND "branchId" = ${branchId}::uuid AND "requestKey" = ${identity.key}
      `);
      if (previous.length) {
        if (previous[0].documentId !== id || previous[0].requestHash !== identity.hash) {
          throw new ConflictException('The idempotency key was used for a different request');
        }
        if (document.editVersion !== previous[0].resultVersion || document.status !== InvoiceStatus.DRAFT) {
          throw new ConflictException('The voucher has changed since this request; reload the latest version');
        }
        return;
      }
      if (document.status !== InvoiceStatus.DRAFT) throw new BadRequestException('Only a draft stock voucher can be edited');
      if (document.editVersion !== dto.expectedVersion) throw new ConflictException('The voucher has changed; reload the latest version');
      if (typeof dto.reason !== 'string' || !dto.reason.trim() || typeof dto.counterpartyName !== 'string' ||
          !dto.counterpartyName.trim() || dto.counterpartyName.trim().length > 200 || typeof dto.toWarehouseId !== 'string') {
        throw new BadRequestException('A stock voucher needs a warehouse, reason and counterparty');
      }
      if (dto.notes != null && typeof dto.notes !== 'string') throw new BadRequestException('notes must be text');
      if (!Array.isArray(dto.lines) || dto.lines.length === 0 || dto.lines.length > 1000) {
        throw new BadRequestException('A stock voucher needs between 1 and 1000 lines');
      }
      const date = this.date(dto.documentDate, 'documentDate');
      const warehouse = await tx.warehouse.findFirst({where:{id:dto.toWarehouseId,companyId,branchId,deletedAt:null,isActive:true},select:{id:true}});
      if (!warehouse) throw new BadRequestException('The voucher warehouse does not belong to this branch or is inactive');
      const costCenterId = dto.costCenterId ? String(dto.costCenterId).trim() : null;
      if (costCenterId) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(costCenterId)) throw new BadRequestException('costCenterId must be a UUID');
        await this.costCenters.assertPostable(tx,companyId,[costCenterId],date);
      }
      const existing = new Map(document.lines.map(line => [line.id,line]));
      const used = new Set<string>();
      const lines: Array<{id?:string;itemId:string;lineNumber:number;quantity:Prisma.Decimal;unitCost:Prisma.Decimal;
        unitName:string|null;unitFactor:Prisma.Decimal|null;unitQuantity:Prisma.Decimal|null;notes:string|null}> = [];
      for (const [index,raw] of dto.lines.entries()) {
        if (!raw || typeof raw.itemId !== 'string') throw new BadRequestException(`Line ${index + 1}: item is required`);
        const old = raw.id ? existing.get(raw.id) : undefined;
        if (raw.id && (!old || used.has(raw.id))) throw new BadRequestException(`Line ${index + 1}: invalid or duplicate line id`);
        if (raw.id) used.add(raw.id);
        if (raw.unitId) throw new BadRequestException(`Line ${index + 1}: use unitName when editing a voucher`);
        const item = await tx.item.findFirst({where:{id:raw.itemId,companyId,deletedAt:null},select:{id:true,isStockTracked:true,code:true,unit:true,units:true}});
        if (!item || !item.isStockTracked) throw new BadRequestException(`Line ${index + 1}: the stock item does not exist`);
        const entered = parseDocumentQuantity(raw.quantity, `Line ${index + 1} quantity`);
        if ((document.voucherKind === 'RECEIPT' && !entered.isPositive()) ||
            (document.voucherKind === 'ISSUE' && !entered.isNegative())) throw new BadRequestException(`Line ${index + 1}: invalid voucher quantity`);
        const name = raw.unitName ?? raw.unit ?? null;
        let quantity: Prisma.Decimal, unitName: string | null, unitFactor: Prisma.Decimal | null, unitQuantity: Prisma.Decimal | null;
        if (old && old.itemId === item.id && old.unitName === name) {
          if (old.unitName === null) {
            if (old.unitFactor !== null || old.unitQuantity !== null) throw new BadRequestException(`Line ${index + 1}: invalid historic unit snapshot`);
            quantity = entered; unitName = null; unitFactor = null; unitQuantity = null;
          } else {
            if (old.unitFactor === null || old.unitQuantity === null) throw new BadRequestException(`Line ${index + 1}: invalid historic unit snapshot`);
            unitFactor = parseFactor(old.unitFactor, `Line ${index + 1} historic factor`);
            if (!exactBaseQuantity(old.unitQuantity,unitFactor).equals(old.quantity)) throw new BadRequestException(`Line ${index + 1}: inconsistent historic unit snapshot`);
            quantity = exactBaseQuantity(entered,unitFactor);
            unitName = old.unitName; unitQuantity = entered;
          }
        } else if (name) {
          const resolved = resolveUnitSelection({lineLabel:`Line ${index + 1}`,requestedUnitName:name,
            enteredQuantity:entered.abs(),baseUnitName:item.unit,units:item.units});
          quantity = entered.isNegative() ? resolved.baseQuantity.negated() : resolved.baseQuantity;
          unitName = resolved.snapshot.unitName; unitFactor = resolved.snapshot.unitFactor; unitQuantity = entered;
        } else { quantity = entered; unitName = null; unitFactor = null; unitQuantity = null; }
        if (document.voucherKind === 'RECEIPT' && (raw.unitCost === undefined || raw.unitCost === null || raw.unitCost === '')) {
          throw new BadRequestException(`Line ${index + 1}: receipt unit cost is required`);
        }
        // Issue-only editors may not have cost visibility. Omitted or
        // unauthorized issue cost never destroys or replaces a saved cost.
        const unitCost = document.voucherKind === 'ISSUE' && (!mayReadCost || raw.unitCost === undefined)
          ? (old && old.itemId === item.id ? old.unitCost : new Prisma.Decimal(0))
          : raw.unitCost === undefined ? new Prisma.Decimal(0) : this.decimal(raw.unitCost,`Line ${index + 1} unit cost`);
        if (unitCost.isNegative() || quantity.abs().mul(unitCost).greaterThanOrEqualTo('1e15')) throw new BadRequestException(`Line ${index + 1}: invalid stock value`);
        if (raw.notes != null && typeof raw.notes !== 'string') throw new BadRequestException(`Line ${index + 1}: notes must be text`);
        lines.push({id:old?.id ?? randomUUID(),itemId:item.id,lineNumber:index + 1,quantity,unitCost,unitName,unitFactor,unitQuantity,notes:raw.notes ?? null});
      }
      if (document.voucherKind === 'ISSUE' &&
          lines.some((line) => line.quantity.isNegative()) && !costCenterId) {
        throw new BadRequestException(
          'A cost center is required when issuing stock from a warehouse.',
        );
      }
      await tx.stockDocumentLine.deleteMany({where:{documentId:id}});
      await tx.stockDocumentLine.createMany({data:lines.map(line => ({...line,documentId:id}))});
      const version = document.editVersion + 1;
      await tx.stockDocument.update({where:{id},data:{documentDate:date,toWarehouseId:dto.toWarehouseId,
        reason:dto.reason.trim(),counterpartyName:dto.counterpartyName.trim(),notes:dto.notes?.trim() || null,costCenterId,
        reviewedAt:null,reviewedBy:null,approvedAt:null,approvedBy:null,editVersion:version}});
      await tx.$executeRaw(Prisma.sql`INSERT INTO stock_voucher_edit_requests
        ("companyId", "branchId", "requestKey", "requestHash", "documentId", "resultVersion")
        VALUES (${companyId}::uuid,${branchId}::uuid,${identity.key},${identity.hash},${id}::uuid,${version})`);
      await this.audit.recordRequired({companyId,userId,action:'UPDATE',entity:'stock_documents',entityId:id,
        before:{version:document.editVersion,reviewed:!!document.reviewedAt,approved:!!document.approvedAt,
          documentDate:document.documentDate.toISOString(),toWarehouseId:document.toWarehouseId,reason:document.reason,
          counterpartyName:document.counterpartyName,notes:document.notes,costCenterId:document.costCenterId,
          lines:document.lines.map(line => ({id:line.id,itemId:line.itemId,quantity:line.quantity.toString(),unitCost:line.unitCost.toString(),
            unitName:line.unitName,unitFactor:line.unitFactor?.toString() ?? null,unitQuantity:line.unitQuantity?.toString() ?? null,notes:line.notes}))},
        after:{version,reviewed:false,approved:false,documentDate:date.toISOString(),toWarehouseId:dto.toWarehouseId,reason:dto.reason.trim(),
          counterpartyName:dto.counterpartyName.trim(),notes:dto.notes?.trim() || null,costCenterId,
          lines:lines.map(line => ({id:line.id ?? null,itemId:line.itemId,quantity:line.quantity.toString(),unitCost:line.unitCost.toString(),
            unitName:line.unitName,unitFactor:line.unitFactor?.toString() ?? null,unitQuantity:line.unitQuantity?.toString() ?? null,notes:line.notes}))}},tx);
    },{timeout:30000});
    return this.findOne(companyId,id,mayReadCost);
  }

  /** Review and approval are idempotent and atomic with their audit record. */
  async transitionVoucher(companyId: string, branchId: string | null, userId: string, id: string,
    stage: 'REVIEW' | 'APPROVE', mayReadCost = true, expectedVersion?: number) {
    if (!branchId) throw new BadRequestException('The signed-in user is not assigned to a branch');
    await this.prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`
        SELECT id FROM stock_documents WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid
          AND "branchId" = ${branchId}::uuid AND "deletedAt" IS NULL FOR UPDATE
      `);
      if (locked.length !== 1) throw new NotFoundException('Stock voucher not found');
      const document = await tx.stockDocument.findUniqueOrThrow({where:{id}});
      if (!document.voucherKind || document.status !== InvoiceStatus.DRAFT) throw new BadRequestException('Only a draft stock voucher can be reviewed or approved');
      if (expectedVersion !== undefined && document.editVersion !== expectedVersion) throw new ConflictException('The voucher has changed; reload the latest version');
      if (stage === 'REVIEW') {
        if (document.reviewedAt) return;
        await tx.stockDocument.update({where:{id},data:{reviewedAt:new Date(),reviewedBy:userId,editVersion:{increment:1}}});
      } else {
        if (!document.reviewedAt) throw new BadRequestException('The stock voucher must be reviewed before approval');
        if (document.approvedAt) return;
        await tx.stockDocument.update({where:{id},data:{approvedAt:new Date(),approvedBy:userId,editVersion:{increment:1}}});
      }
      await this.audit.recordRequired({companyId,userId,action:stage,entity:'stock_documents',entityId:id},tx);
    });
    return this.findOne(companyId,id,mayReadCost);
  }

  /**
   * Posts the document: movements, stock balances and - when value changes -
   * one journal entry.
   */
  async post(companyId: string, userId: string, id: string, mayReadCost = true, voucherBranchId: string | null = null,
    expectedVersion?: unknown, requireVoucherVersion = false) {
    const initialDocument = await this.prisma.stockDocument.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!initialDocument) throw new NotFoundException('Stock document not found');
    if (initialDocument.voucherKind && initialDocument.branchId !== voucherBranchId) throw new NotFoundException('Stock voucher not found');
    if (initialDocument.voucherKind && requireVoucherVersion && (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 0)) {
      throw new BadRequestException('expectedVersion is required for posting a stock voucher');
    }
    if (initialDocument.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException(
        `Only a draft stock document can be posted (current status: ${initialDocument.status})`,
      );
    }
    if (initialDocument.voucherKind && (!initialDocument.reviewedAt || !initialDocument.approvedAt)) {
      throw new BadRequestException('Stock voucher must be reviewed and approved before posting');
    }

    if (initialDocument.kind === StockDocumentKind.TRANSFER &&
        initialDocument.lines.some((line) => !line.quantity.greaterThan(0))) {
      throw new BadRequestException('Transfer quantities must be positive before posting');
    }
    const settings = await this.settings.get(companyId);

    await this.prisma.$transaction(async (tx) => {
      // Claim the row before reading the lines used for posting. An edit or
      // workflow transition may have committed after the preliminary read;
      // all financial work must use the version protected by this row lock.
      const claimed = await tx.stockDocument.updateMany({
        where: { id, companyId, status: InvoiceStatus.DRAFT, deletedAt: null },
        data: { status: InvoiceStatus.POSTED, postedAt: new Date(), postedBy: userId },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('This document has just been posted by someone else.');
      }
      const document = await tx.stockDocument.findFirst({
        where: { id, companyId, deletedAt: null },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      if (!document) throw new NotFoundException('Stock document not found');
      if (document.voucherKind && document.branchId !== voucherBranchId) throw new NotFoundException('Stock voucher not found');
      if (document.voucherKind && expectedVersion !== undefined && document.editVersion !== expectedVersion) {
        throw new ConflictException('The voucher has changed; reload the latest version');
      }
      if (document.voucherKind && (!document.reviewedAt || !document.approvedAt)) {
        throw new BadRequestException('Stock voucher must be reviewed and approved before posting');
      }
      if (document.kind === StockDocumentKind.TRANSFER &&
          document.lines.some((line) => !line.quantity.greaterThan(0))) {
        throw new BadRequestException('Transfer quantities must be positive before posting');
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
        costCenterId?: string | null;
      }> = [];
      let valueChange = new Prisma.Decimal(0);

      for (const line of document.lines) {
        if (document.kind === StockDocumentKind.TRANSFER) {
          // Out of the source branch, into the destination, at the cost the
          // stock actually carries. No value is created or destroyed, so no
          // journal entry is needed: it is the same company's inventory.

          // Warehouse-level rule first: the branch total may cover the line
          // while this specific source warehouse does not. stock_balances is
          // branch-granular, so without this check the warehouse's derived
          // card could be driven below zero (observed defect). The guard
          // locks the warehouse row, which also serialises concurrent
          // transfers draining the same pile.
          await this.warehouses.assertWarehouseAvailable({
            tx,
            companyId,
            warehouseId: fromWarehouseId,
            itemId: line.itemId,
            quantity: line.quantity,
            // Stock documents never overdraw a warehouse, even if a legacy
            // company setting permits negative stock in other workflows.
            allowNegative: false,
            reference: document.documentNumber,
          });

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
          // A later reversal must use the cost actually posted, not the draft
          // cost entered before the balance was locked and valued.
          await tx.stockDocumentLine.update({ where: { id: line.id }, data: { unitCost } });

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
        // For a write-off the direction and amount are already known. Take
        // the warehouse lock before the branch balance lock, as transfer and
        // reversal do; taking them in the opposite order can deadlock.
        if (document.kind === StockDocumentKind.ADJUSTMENT && quantity.lessThan(0)) {
          await this.warehouses.assertWarehouseAvailable({
            tx,
            companyId,
            warehouseId: toWarehouseId,
            itemId: line.itemId,
            quantity: quantity.abs(),
            // An issue/negative adjustment cannot overdraw its selected pile,
            // even if legacy company settings allow negative stock elsewhere.
            allowNegative: false,
            reference: document.documentNumber,
          });
        }
        // A count reconciles the selected pile, not every warehouse in the
        // branch. Lock the warehouse before the branch balance (the same order
        // as issues and transfers) and read its committed movements only after
        // that balance lock has serialized competing stock writes.
        if (document.kind === StockDocumentKind.COUNT && toWarehouseId) {
          await this.warehouses.lockForPosting(tx, companyId, toWarehouseId);
        }
        const balance = await this.balance(tx, companyId, document.branchId, line.itemId);
        const onHand = balance?.quantity ?? new Prisma.Decimal(0);
        const onHandValue = balance?.value ?? new Prisma.Decimal(0);
        const averageCost = onHand.isZero()
          ? new Prisma.Decimal(0)
          : onHandValue.div(onHand).toDecimalPlaces(MONEY_SCALE);

        if (document.kind === StockDocumentKind.COUNT) {
          const counted = line.countedQuantity ?? new Prisma.Decimal(0);
          const countedPile = toWarehouseId
            ? await this.warehouses.availableQuantity(tx, companyId, toWarehouseId, line.itemId)
            : onHand;
          quantity = counted.minus(countedPile);
          // Shortfalls consume existing inventory at its locked moving-average
          // cost; a draft's arbitrary price cannot rewrite that valuation.
          if (quantity.isNegative() || unitCost.isZero()) unitCost = averageCost;
          await tx.stockDocumentLine.update({
            where: { id: line.id },
            data: { quantity, unitCost },
          });
        } else if (quantity.lessThan(0)) {
          // A write-off uses the locked moving-average inventory cost; an
          // arbitrary draft cost would misstate both stock and the cost centre.
          unitCost = averageCost;
          // Persist the posted cost so reversal replays the same valuation.
          await tx.stockDocumentLine.update({ where: { id: line.id }, data: { unitCost } });
        }

        if (quantity.isZero()) continue;
        if (quantity.isNegative() && !document.costCenterId) {
          throw new BadRequestException(
            'A cost center is required when issuing stock from a warehouse.',
          );
        }

        const direction = quantity.greaterThan(0) ? StockDirection.IN : StockDirection.OUT;
        const absoluteQuantity = quantity.abs();
        const totalCost = unitCost.mul(absoluteQuantity).toDecimalPlaces(MONEY_SCALE);

        // The warehouse lock and counted quantity above prevent a count from
        // consuming stock held in another warehouse.
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
                costCenterId: document.costCenterId,
              }
            : {
                accountId: accounts.inventoryDifference,
                debit: valueChange.negated(),
                description: document.reason ?? 'Inventory difference',
                costCenterId: document.costCenterId,
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

      await this.audit.recordRequired({
        companyId, userId, action: 'POST', entity: 'stock_documents', entityId: id,
        after: {
          documentNumber: document.documentNumber,
          kind: document.kind,
          journalNumber: journal?.entryNumber ?? null,
          valueChange: valueChange.toFixed(MONEY_SCALE),
        },
      }, tx);
    });

    return this.findOne(companyId, id, mayReadCost);
  }

  /** Reverses a posted document: opposite movements, and the entry mirror. */
  async reverse(companyId: string, userId: string, id: string, mayReadCost = true, voucherBranchId: string | null = null) {
    const document = await this.prisma.stockDocument.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!document) throw new NotFoundException('Stock document not found');
    if (document.voucherKind && document.branchId !== voucherBranchId) throw new NotFoundException('Stock voucher not found');
    if (document.status !== InvoiceStatus.POSTED) {
      throw new BadRequestException('Only a posted stock document can be reversed');
    }

    if (document.kind === StockDocumentKind.TRANSFER &&
        document.lines.some((line) => line.quantity.isNegative())) {
      throw new BadRequestException('Cannot automatically reverse a transfer with negative quantities; contact support');
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

      // Check every pile that the reversal will take stock from before any
      // branch balance is locked or movement is written. Aggregate repeated
      // items: checking each line against the same starting balance would let
      // several individually affordable lines overdraw the warehouse.
      const outgoing = new Map<string, { warehouseId: string; itemId: string; quantity: Prisma.Decimal }>();
      for (const line of document.lines) {
        const warehouseId = reversalToWarehouseId;
        const isOutgoing = document.kind === StockDocumentKind.TRANSFER
          ? !line.quantity.isZero()
          : line.quantity.greaterThan(0);
        if (!warehouseId || !isOutgoing) continue;
        const key = `${warehouseId}:${line.itemId}`;
        const previous = outgoing.get(key);
        outgoing.set(key, {
          warehouseId,
          itemId: line.itemId,
          quantity: (previous?.quantity ?? new Prisma.Decimal(0)).plus(line.quantity.abs()),
        });
      }
      // Consistent warehouse ordering avoids taking warehouse locks in line
      // order; other posting paths still need real-Postgres concurrency tests.
      const checks = [...outgoing.values()].sort((a, b) =>
        a.warehouseId.localeCompare(b.warehouseId) || a.itemId.localeCompare(b.itemId),
      );
      for (const check of checks) {
        await this.warehouses.assertWarehouseAvailable({
          tx,
          companyId,
          warehouseId: check.warehouseId,
          itemId: check.itemId,
          quantity: check.quantity,
          allowNegative: false,
          reference: document.documentNumber,
        });
      }

      // The original ledger movements carry the authoritative valuation for
      // legacy documents as well as new ones; a draft line may have been zero.
      const originalTypes = document.kind === StockDocumentKind.TRANSFER
        ? ['STOCK_TRANSFER_OUT', 'STOCK_TRANSFER_IN']
        : [document.kind === StockDocumentKind.COUNT ? 'STOCK_COUNT' : 'STOCK_ADJUSTMENT'];
      const originals = await tx.stockMovement.findMany({
        where: { companyId, referenceId: document.id, referenceType: { in: originalTypes } },
      });
      const usedOriginals = new Set<string>();

      for (const line of document.lines) {
        const targets =
          document.kind === StockDocumentKind.TRANSFER
            ? [
                { branchId: document.fromBranchId as string, warehouseId: reversalFromWarehouseId },
                { branchId: document.branchId, warehouseId: reversalToWarehouseId },
              ]
            : [{ branchId: document.branchId, warehouseId: reversalToWarehouseId }];

        let transferOriginal: { unitCost: Prisma.Decimal; totalCost: Prisma.Decimal } | null = null;
        for (const [index, target] of targets.entries()) {
          const branchId = target.branchId;
          if (line.quantity.isZero()) continue;
          // The original movement's direction, flipped.
          const wasOut =
            document.kind === StockDocumentKind.TRANSFER
              ? index === 0
              : line.quantity.lessThan(0);
          const original = takeOriginalStockMovement(originals, usedOriginals, {
            itemId: line.itemId,
            branchId,
            warehouseId: target.warehouseId,
            direction: wasOut ? StockDirection.OUT : StockDirection.IN,
            referenceType: document.kind === StockDocumentKind.TRANSFER
              ? (wasOut ? 'STOCK_TRANSFER_OUT' : 'STOCK_TRANSFER_IN')
              : (document.kind === StockDocumentKind.COUNT ? 'STOCK_COUNT' : 'STOCK_ADJUSTMENT'),
            quantity: line.quantity.abs(),
          });
          if (document.kind === StockDocumentKind.TRANSFER) {
            if (transferOriginal &&
                (!original.unitCost.equals(transferOriginal.unitCost) ||
                 !original.totalCost.equals(transferOriginal.totalCost))) {
              throw new BadRequestException('The original transfer movements have different costs; it cannot be reversed automatically.');
            }
            transferOriginal = original;
          }
          await this.move(tx, {
            companyId,
            branchId,
            itemId: line.itemId,
            date: new Date(),
            direction: wasOut ? StockDirection.IN : StockDirection.OUT,
            quantity: line.quantity.abs(),
            unitCost: original.unitCost,
            totalCost: original.totalCost,
            referenceType: 'STOCK_DOCUMENT_REVERSAL',
            referenceId: document.id,
            referenceNumber: document.documentNumber,
            userId,
            requireStock: false,
            warehouseId: target.warehouseId,
          });
        }
      }

      if (usedOriginals.size !== originals.length) {
        throw new BadRequestException(
          'The original stock movements do not match the document; it cannot be reversed automatically.',
        );
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
      await this.audit.recordRequired({
        companyId, userId, action: 'REVERSE', entity: 'stock_documents', entityId: id,
      }, tx);
    });

    return this.findOne(companyId, id, mayReadCost);
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

  // Unit resolution for stock lines lives in resolveUnitSelection
  // (common/units/unit-math): it refuses unknown and inactive units, converts
  // the entered quantity into base units and builds the frozen snapshot. The
  // previous private unitFactor() helper is fully subsumed by that path, which
  // also honours the stock-document `unit` field via requestedUnitName.

  private decimal(value: unknown, field: string): Prisma.Decimal {
    let parsed: Prisma.Decimal;
    try { parsed = new Prisma.Decimal(String(value)); }
    catch { throw new BadRequestException(`${field} is not a valid number`); }
    if (!parsed.isFinite() || parsed.abs().greaterThanOrEqualTo('1e15') || !parsed.equals(parsed.toDecimalPlaces(MONEY_SCALE))) {
      throw new BadRequestException(`${field} is outside the supported range or precision`);
    }
    return parsed;
  }

  private date(value: string, field: string): Date {
    const day = String(value).slice(0, 10);
    const parsed = new Date(`${day}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== day) {
      throw new BadRequestException(`${field} is not a valid date`);
    }
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
    costCenterId?: string | null;
    costCenter?: { id: string; code: string; nameEn: string; nameAr: string } | null;
    voucherKind?: string | null;
    editVersion?: number;
    counterpartyName?: string | null;
    toWarehouseId?: string | null;
    toWarehouse?: {id:string;code:string;nameEn:string;nameAr:string} | null;
    reviewedAt?: Date | null;
    reviewedBy?: string | null;
    approvedAt?: Date | null;
    approvedBy?: string | null;
  }) {
    return {
      id: document.id,
      documentNumber: document.documentNumber,
      kind: document.kind.toLowerCase(),
      documentDate: document.documentDate.toISOString().slice(0, 10),
      status: document.status.toLowerCase(),
      reason: document.reason,
      notes: document.notes,
      voucherKind: document.voucherKind ?? null,
      editVersion: document.editVersion ?? 0,
      counterpartyName: document.counterpartyName ?? null,
      toWarehouseId: document.toWarehouseId ?? null,
      toWarehouse: document.toWarehouse ?? null,
      reviewedAt: document.reviewedAt?.toISOString() ?? null,
      reviewedBy: document.reviewedBy ?? null,
      approvedAt: document.approvedAt?.toISOString() ?? null,
      approvedBy: document.approvedBy ?? null,
      branch: document.branch,
      costCenterId: document.costCenterId ?? null,
      costCenter: document.costCenter ?? null,
      journalEntryId: document.journalEntryId,
      postedAt: document.postedAt?.toISOString() ?? null,
      createdAt: document.createdAt.toISOString(),
    };
  }
}
