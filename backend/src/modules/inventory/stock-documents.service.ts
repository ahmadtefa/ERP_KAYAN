import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InvoiceStatus, Prisma, StockDirection, StockDocumentKind } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { STOCK_VOUCHER_PENDING_APPROVAL, WRITEOFF_PENDING_APPROVAL, dedupeKey } from '../notifications/notification-kinds';
import { randomUUID } from 'node:crypto';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanySettingsService } from '../../common/settings/company-settings.module';
import {
  exactBaseQuantity,
  movementUnitSnapshot,
  parseDocumentQuantity,
  parseFactor,
  resolveUnitSelection,
} from '../../common/units/unit-math';
import { orderCreationIdentity } from '../../common/units/order-creation-identity';
import type { ItemUnitLike } from '../../common/units/unit-math';
import { selectLotsFefo } from '../../common/warehouse/batch-policy';
import { StockLedgerService } from '../../common/warehouse/stock-ledger.service';
import { WarehouseService, type WarehouseScope } from '../../common/warehouse/warehouse.service';
import { AccountMapService } from '../accounting/account-map.service';
import { CostCentersService } from '../accounting/cost-centers.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { PostingService } from '../accounting/posting.service';
import { takeOriginalStockMovement } from './original-stock-movement';
import { addToLotCost, removeFromLotCost } from './lot-primary-location';

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
  /** The lot this line moves or destroys. */
  batchId?: string;
  /** The shelf the goods sat on, when the document names one. */
  storageLocationId?: string;
  /** Transfer only: the shelf of the receiving warehouse the goods go onto. Optional; omitted means they arrive unlocated. */
  toStorageLocationId?: string;
}

/**
 * Stock changes that are not an invoice: adjustments, transfers, counts and
 * write-offs.
 *
 * Each one writes stock movements and - where the value of the stock changes -
 * a journal entry, in a single transaction. The rule is the same one the
 * invoices follow, which is what keeps the stock ledger and the general ledger
 * from ever telling two different stories.
 *
 * Valuation is the weighted average: an issue leaves at the average cost of
 * what is on hand, an addition brings in exactly what it cost.
 *
 * Two document families live here side by side:
 *  - stock vouchers (PR70 workflow): RECEIPT/ISSUE adjustments with an
 *    edit version, a REVIEW -> APPROVE workflow and creation-request
 *    idempotency on the stock_document_creation_requests table;
 *  - plain documents, including WRITE_OFF: approved by a different person
 *    (approve()) and deduplicated by the idempotencyKey column.
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
    private readonly ledger: StockLedgerService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async findAll(
    companyId: string,
    query: { kind?: string; q?: string; voucherOnly?: boolean; branchId?: string; from?: string; to?: string; page?: number; pageSize?: number } = {},
    voucherBranchId?: string | null,
    warehouseScope: WarehouseScope = null,
  ) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);

    const where: Prisma.StockDocumentWhereInput = { companyId, deletedAt: null };
    // Ordinary stock documents retain their existing company-wide policy;
    // vouchers are visible only in the signed-in user's own branch.
    // Undefined is reserved for internal trusted service callers.
    if (voucherBranchId !== undefined) where.AND = [{ OR: [
      { voucherKind: null }, ...(voucherBranchId ? [{ branchId: voucherBranchId }] : []),
    ] }];
    // Per-user warehouse grants scope the list when the company uses them:
    // a document that touches a warehouse the user may not see is hidden.
    // Null scope means "no restriction" (grants not in use).
    if (warehouseScope !== null) {
      const ids = warehouseScope;
      const and: Prisma.StockDocumentWhereInput[] = Array.isArray(where.AND)
        ? [...(where.AND as Prisma.StockDocumentWhereInput[])]
        : where.AND
          ? [where.AND as Prisma.StockDocumentWhereInput]
          : [];
      and.push({
        OR: [
          { fromWarehouseId: null, toWarehouseId: null },
          { fromWarehouseId: null, toWarehouseId: { in: ids } },
          { fromWarehouseId: { in: ids }, toWarehouseId: null },
          { fromWarehouseId: { in: ids }, toWarehouseId: { in: ids } },
        ],
      });
      where.AND = and;
    }
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
        { documentNumber: { contains: term, mode: 'insensitive' } },
        { counterpartyName: { contains: term, mode: 'insensitive' } },
        { reason: { contains: term, mode: 'insensitive' } },
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
          fromWarehouse: { select: { id: true, code: true, nameEn: true, nameAr: true } },
          toWarehouse: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        },
      }),
      this.prisma.stockDocument.count({ where }),
    ]);

    // Who raised and who posted each document. The columns are ids, so the
    // names are read once for the page rather than asked for per row.
    const userIds = [
      ...new Set(
        items
          .flatMap((document) => [document.createdBy, document.postedBy, document.approvedBy])
          .filter((id): id is string => typeof id === 'string' && id !== ''),
      ),
    ];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds }, companyId },
          select: { id: true, username: true },
        })
      : [];
    const userName = new Map(users.map((user) => [user.id, user.username]));

    return {
      items: items.map((document) => ({
        ...this.toSummary({
          ...document,
          createdByName: document.createdBy ? userName.get(document.createdBy) ?? null : null,
          postedByName: document.postedBy ? userName.get(document.postedBy) ?? null : null,
          approvedByName: document.approvedBy ? userName.get(document.approvedBy) ?? null : null,
        }),
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

  async findOne(
    companyId: string,
    id: string,
    mayReadCost = true,
    voucherBranchId?: string | null,
    warehouseIds?: string[],
    branchIds?: string[] | null,
  ) {
    const document = await this.prisma.stockDocument.findFirst({
      where: {
        id, companyId, deletedAt: null,
        ...(branchIds !== undefined && branchIds !== null ? { branchId: { in: branchIds } } : {}),
        ...(warehouseIds ? { OR: [
          { fromWarehouseId: { in: warehouseIds } },
          { toWarehouseId: { in: warehouseIds } },
        ] } : {}),
      },
      include: {
        branch: { select: { code: true, nameEn: true, nameAr: true } },
        costCenter: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        fromWarehouse: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        toWarehouse: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: {
            item: { select: { code: true, nameEn: true, nameAr: true, unit: true } },
            // A write-off names the goods it destroys and the shelf they sat
            // on. Printing only the item left the reader unable to tell two
            // lots of the same product apart - which is the whole point of
            // destroying one of them.
            batch: { select: { id: true, batchNumber: true, expiryDate: true } },
            storageLocation: { select: { id: true, code: true, nameEn: true, nameAr: true } },
          },
        },
      },
    });
    if (!document || (document.voucherKind && voucherBranchId !== undefined && document.branchId !== voucherBranchId)) {
      throw new NotFoundException('Stock document not found');
    }

    // The paper names who raised and who posted it, so the detail resolves the
    // two ids the same way the list does.
    const userIds = [document.createdBy, document.postedBy, document.approvedBy].filter(
      (value): value is string => typeof value === 'string' && value !== '',
    );
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds }, companyId },
          select: { id: true, username: true },
        })
      : [];
    const userName = new Map(users.map((user) => [user.id, user.username]));

    return {
      ...this.toSummary({
        ...document,
        createdByName: document.createdBy ? userName.get(document.createdBy) ?? null : null,
        postedByName: document.postedBy ? userName.get(document.postedBy) ?? null : null,
        approvedByName: document.approvedBy ? userName.get(document.approvedBy) ?? null : null,
      }),
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
        totalCost: mayReadCost ? (line.totalCost ?? line.unitCost.mul(line.quantity)).toFixed(MONEY_SCALE) : null,
        countedQuantity: line.countedQuantity?.toFixed(MONEY_SCALE) ?? null,
        notes: line.notes,
        batchId: line.batchId ?? null,
        batchNumber: line.batch?.batchNumber ?? null,
        expiryDate: line.batch?.expiryDate?.toISOString().slice(0, 10) ?? null,
        storageLocationId: line.storageLocationId ?? null,
        toStorageLocationId: (line as { toStorageLocationId?: string | null }).toStorageLocationId ?? null,
        storageLocationCode: line.storageLocation?.code ?? null,
        storageLocationNameEn: line.storageLocation?.nameEn ?? null,
        storageLocationNameAr: line.storageLocation?.nameAr ?? null,
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
      /// Optional attachment carried with a write-off (photo, certificate).
      attachmentName?: string;
      attachmentPath?: string;
    },
    mayReadCostOrOptions: boolean | { idempotencyKey?: string } = true,
    optionsArg: { idempotencyKey?: string } = {},
  ) {
    const mayReadCost = typeof mayReadCostOrOptions === 'boolean' ? mayReadCostOrOptions : true;
    const options = typeof mayReadCostOrOptions === 'object' && mayReadCostOrOptions !== null
      ? mayReadCostOrOptions
      : optionsArg;
    const targetBranch = dto.branchId ?? dto.toBranchId ?? branchId;
    if (!targetBranch) throw new BadRequestException('The signed-in user is not assigned to a branch');
    const idempotencyKey = String(options.idempotencyKey ?? dto.idempotencyKey ?? '').trim() || null;
    const identity = idempotencyKey
      ? orderCreationIdentity({ ...dto, idempotencyKey } as unknown as Record<string, unknown>)
      : null;
    const voucherKind = dto.voucherKind === undefined ? null : String(dto.voucherKind).toUpperCase();
    if (voucherKind !== null && !['RECEIPT', 'ISSUE'].includes(voucherKind)) throw new BadRequestException('Unknown stock voucher kind');
    // A receipt records inventory valuation. The controller also checks the
    // warehouse cost grant, but enforce the service contract so internal and
    // background callers cannot submit a cost without cost-read authority.
    if (voucherKind === 'RECEIPT' && !mayReadCost) {
      throw new ForbiddenException('inventory.cost.read permission is required to record receipt unit costs');
    }
    if (voucherKind && (!branchId || branchId !== targetBranch)) throw new BadRequestException('Stock voucher must belong to the signed-in branch');
    if (voucherKind && !identity) throw new BadRequestException('idempotencyKey is required for stock vouchers');

    // The request fingerprint is the authority for retries. A document key
    // alone is not enough: reusing it with a different payload must conflict.

      const kind = String(dto.kind ?? '').toUpperCase() as StockDocumentKind;
      if (!Object.values(StockDocumentKind).includes(kind)) {
        throw new BadRequestException('kind must be ADJUSTMENT, TRANSFER, COUNT, WRITE_OFF or OPENING');
      }
      if (voucherKind && kind !== StockDocumentKind.ADJUSTMENT) throw new BadRequestException('Stock vouchers must be adjustments');
      // A write-off is a loss somebody has to own. The reason is not decoration:
      // it is the sentence that explains the difference to an auditor.
      if (kind === StockDocumentKind.WRITE_OFF && !String(dto.reason ?? '').trim()) {
        throw new BadRequestException('A write-off needs a reason. / مستند الإعدام يتطلب سببًا.');
      }
      if (kind === StockDocumentKind.OPENING) {
        throw new BadRequestException(
          'Use an opening balance document for opening stock: it posts the accounting and the stock together.',
        );
      }
      if (voucherKind && (typeof dto.reason !== 'string' || !dto.reason.trim() || typeof dto.counterpartyName !== 'string' || !dto.counterpartyName.trim() || dto.counterpartyName.trim().length > 200 || !dto.toWarehouseId)) {
        throw new BadRequestException('A stock voucher needs a warehouse, reason and counterparty');
      }
      if (voucherKind) {
        const warehouse = await this.prisma.warehouse.findFirst({ where: { id: dto.toWarehouseId, companyId, branchId: targetBranch, deletedAt: null, isActive: true }, select: { id: true } });
        if (!warehouse) throw new BadRequestException('The voucher warehouse does not belong to this branch or is inactive');
      }
      if (!Array.isArray(dto.lines) || dto.lines.length === 0) {
        throw new BadRequestException('A stock document needs at least one line');
      }

      const date = this.date(dto.documentDate, 'documentDate');
    const created = await this.prisma.$transaction(async (tx) => {
      if (identity) {
        // Serialize retries before reading mutable item/unit data. A lost
        // response can be replayed even if a unit was later disabled.
        await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM (
          SELECT pg_advisory_xact_lock(hashtextextended(${`stock-document:${companyId}:${targetBranch}:${identity.key}`}, 0))
        ) AS stock_request_lock`);
        const previous = await tx.$queryRaw<Array<{ documentId: string; requestHash: string }>>(Prisma.sql`
          SELECT "documentId", "requestHash" FROM stock_document_creation_requests
           WHERE "companyId" = ${companyId}::uuid AND "branchId" = ${targetBranch}::uuid
             AND "requestKey" = ${identity.key}
        `);
        if (previous.length) {
          if (previous[0].requestHash !== identity.hash) throw new ConflictException('The idempotency key was used for a different request');
          return { id: previous[0].documentId };
        }
        // Older rows may have the document key but predate the request-hash
        // table. We cannot prove that a retry has the same body, so fail closed
        // rather than silently returning or duplicating an unknown request.
        const legacy = await tx.stockDocument.findFirst({
          where: { companyId, idempotencyKey },
          select: { id: true },
        });
        if (legacy) {
          throw new ConflictException(
            'The idempotency key belongs to a document without a request fingerprint; use a new key.',
          );
        }
      }
      const branchModel = (tx as { branch?: typeof this.prisma.branch }).branch ?? this.prisma.branch;
      if (branchModel) {
        const branch = await branchModel.findFirst({ where: { id: targetBranch, companyId, deletedAt: null }, select: { id: true } });
        if (!branch) throw new BadRequestException('Target branch does not belong to this company');
      }

      // Only the documents whose posting touches a profit-and-loss account can
      // carry a centre. A transfer moves stock between two places the company
      // already owns, so attributing it would turn cost into a promise.
      const costCenterId = dto.costCenterId ? String(dto.costCenterId).trim() : null;
      if (costCenterId) {
        if (kind === StockDocumentKind.TRANSFER) {
          throw new BadRequestException('A stock transfer cannot carry a cost center: it is not a cost.');
        }
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(costCenterId)) {
          throw new BadRequestException('costCenterId must be a UUID');
        }
        await this.costCenters.assertPostable(tx, companyId, [costCenterId], date);
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
        batchId: string | null;
        storageLocationId: string | null;
        toStorageLocationId?: string | null;
      }> = [];
      const itemModel = (tx as { item?: typeof this.prisma.item }).item ?? this.prisma.item;
      const batchModel = (tx as { itemBatch?: typeof this.prisma.itemBatch }).itemBatch ?? this.prisma.itemBatch;
      const locationModel = (tx as { storageLocation?: typeof this.prisma.storageLocation }).storageLocation ?? this.prisma.storageLocation;
      for (const [index, raw] of dto.lines.entries()) {
        const item = await itemModel.findFirst({
          where: { id: raw.itemId, companyId, deletedAt: null },
          select: { id: true, isStockTracked: true, code: true, unit: true, units: true },
        });
        if (!item) throw new BadRequestException(`Line ${index + 1}: the item does not exist`);
        if (!item.isStockTracked) {
          throw new BadRequestException(`Line ${index + 1}: item ${item.code} is not stock-tracked`);
        }

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
            const sign = quantity.isNegative() ? new Prisma.Decimal(-1) : new Prisma.Decimal(1);
            const resolved = resolveUnitSelection({
              lineLabel: `Line ${index + 1}`,
              requestedUnitId: raw.unitId,
              requestedUnitName: requestedUnitName,
              enteredQuantity: quantity.abs(),
              baseUnitName: item.unit,
              units,
              // Stock movements are neither a sale nor a purchase: a unit that
              // is only enabled for one of them is still usable to count goods.
              purpose: 'stock',
            });
            unitName = resolved.snapshot.unitName;
            unitFactor = resolved.snapshot.unitFactor;
            unitQuantity = quantity;
            quantity = resolved.baseQuantity.mul(sign);
          }
          // Zero is a valid physical count, but the chosen unit must still
          // exist, be active and have a valid conversion factor.
          if (countedQuantity !== null) {
            const resolvedCount = resolveUnitSelection({
              lineLabel: `Line ${index + 1}`,
              requestedUnitId: raw.unitId,
              requestedUnitName: requestedUnitName,
              enteredQuantity: countedQuantity,
              baseUnitName: item.unit,
              units,
              purpose: 'stock',
              allowZeroBaseQuantity: true,
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
        // A write-off is goods leaving. Its quantity is the signed change, so a
        // positive one would quietly RECEIVE the goods the paper says were
        // destroyed - the worst kind of mistake, because the document, the
        // movement and the ledger would all agree on a lie.
        if (kind === StockDocumentKind.WRITE_OFF && quantity.greaterThan(0)) {
          throw new BadRequestException(
            `Line ${index + 1}: a write-off removes stock, so its quantity is negative. / ` +
              'الإعدام يُخرج البضاعة من المخزن، فكميته سالبة.',
          );
        }
        if (kind === StockDocumentKind.COUNT && (!countedQuantity || countedQuantity.isNegative())) {
          throw new BadRequestException(`Line ${index + 1}: a count needs the quantity that was actually counted`);
        }
        if (unitCost.isNegative()) {
          throw new BadRequestException(`Line ${index + 1}: the unit cost cannot be negative`);
        }
        if (quantity.abs().mul(unitCost).greaterThanOrEqualTo('1e15')) {
          throw new BadRequestException(`Line ${index + 1}: stock value exceeds the supported range`);
        }

        // A line may name the lot it moves and the shelf it sat on. The lot
        // must belong to this company and this item, otherwise the write-off
        // would decrement somebody else's goods.
        let batchId: string | null = null;
        if (raw.batchId) {
          const lot = await batchModel.findFirst({
            where: { id: String(raw.batchId), companyId, itemId: item.id, deletedAt: null },
            select: { id: true },
          });
          if (!lot) throw new BadRequestException(`Line ${index + 1}: the lot does not belong to this item`);
          batchId = lot.id;
        }
        // On a transfer the named shelf is the one the goods leave from, in the
        // source warehouse; on every other document it is in the document's
        // warehouse.
        const isTransfer = kind === StockDocumentKind.TRANSFER;
        const shelfWarehouse = isTransfer ? dto.fromWarehouseId : dto.toWarehouseId;
        let storageLocationId: string | null = null;
        if (raw.storageLocationId) {
          const location = await locationModel.findFirst({
            where: {
              id: String(raw.storageLocationId),
              companyId,
              warehouseId: shelfWarehouse ? String(shelfWarehouse) : undefined,
              // A shelf that was switched off may still hold stock that has to
              // leave it; goods may only be put onto an active one.
              deletedAt: null,
              ...(isTransfer || kind === StockDocumentKind.WRITE_OFF || ((kind === StockDocumentKind.ADJUSTMENT || kind === StockDocumentKind.COUNT) && Number(raw.quantity) < 0) ? {} : { isActive: true }),
            },
            select: { id: true },
          });
          if (!location) {
            const off = await locationModel.findFirst({
              where: { id: String(raw.storageLocationId), companyId, warehouseId: shelfWarehouse ? String(shelfWarehouse) : undefined, deletedAt: null, isActive: false },
              select: { code: true },
            });
            if (off) {
              throw new BadRequestException({
                code: 'STOCK_DOC_LOCATION_INACTIVE',
                message:
                  `السطر ${index + 1}: الموقع ${off.code} غير مفعّل ولا يستقبل بضاعة أو فائضًا (يمكن السحب منه فقط). فعّل الموقع أو اختر موقعًا نشطًا؛ بياناتك محفوظة ولم يتغير أي رصيد. / ` +
                  `Line ${index + 1}: location ${off.code} is inactive and cannot receive goods or a surplus (goods may only leave it). Activate it or choose an active location; your data is kept and no balance changed.`,
                errors: { lineNumber: String(index + 1), locationCode: off.code.slice(0, 64) },
              });
            }
            throw new BadRequestException({
              code: 'STOCK_DOC_LOCATION_INVALID',
              message:
                `السطر ${index + 1}: الموقع المختار ليس في ${isTransfer ? 'المخزن المحوَّل منه' : 'مخزن المستند'}. اختر موقعًا من نفس المخزن وبياناتك محفوظة. / ` +
                `Line ${index + 1}: the chosen location is not in the ${isTransfer ? 'source warehouse' : 'document warehouse'}. Pick a location of that warehouse; your data is kept.`,
              errors: { lineNumber: String(index + 1) },
            });
          }
          storageLocationId = location.id;
        }
        let toStorageLocationId: string | null = null;
        if (raw.toStorageLocationId) {
          const target = isTransfer && dto.toWarehouseId
            ? await locationModel.findFirst({
                where: { id: String(raw.toStorageLocationId), companyId, warehouseId: String(dto.toWarehouseId), deletedAt: null, isActive: true },
                select: { id: true },
              })
            : null;
          if (!target) {
            throw new BadRequestException({
              code: 'STOCK_DOC_TARGET_LOCATION_INVALID',
              message:
                `السطر ${index + 1}: موقع الاستلام يجب أن يكون في المخزن المحوَّل إليه، وفي مستند تحويل فقط. اختر موقعًا من مخزن الاستلام أو اتركه فارغًا ليصل الصنف بلا موقع. بياناتك محفوظة. / ` +
                `Line ${index + 1}: the receiving location must belong to the receiving warehouse, on a transfer only. Pick one of its locations, or leave it empty so the goods arrive unlocated. Your data is kept.`,
              errors: { lineNumber: String(index + 1) },
            });
          }
          toStorageLocationId = target.id;
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
          batchId,
          storageLocationId,
          toStorageLocationId,
        });
      }

      // Issue vouchers require an explicit beneficiary.
      if (voucherKind === 'ISSUE' && !costCenterId) {
        throw new BadRequestException('A cost center is required when issuing stock from a warehouse.');
      }

      const fromWarehouseId = dto.fromWarehouseId ? String(dto.fromWarehouseId) : null;
      const toWarehouseId = dto.toWarehouseId ? String(dto.toWarehouseId) : null;

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
        const sourceBranch = await branchModel.findFirst({ where: { id: fromBranchId, companyId, deletedAt: null }, select: { id: true } });
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

      // A loss gets its own series. A write-off that shares numbers with
      // adjustments cannot be counted, filed or argued about on its own.
      const prefix =
        kind === StockDocumentKind.TRANSFER
          ? 'ST'
          : kind === StockDocumentKind.COUNT
            ? 'SC'
            : kind === StockDocumentKind.WRITE_OFF
              ? 'WO'
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
          idempotencyKey,
          attachmentName: dto.attachmentName?.trim() || null,
          attachmentPath: dto.attachmentPath?.trim() || null,
          lines: {
            create: lines.map((line, index) => ({
              lineNumber: index + 1,
              itemId: line.itemId,
              quantity: line.quantity,
              unitCost: line.unitCost,
              totalCost: line.quantity.mul(line.unitCost).toDecimalPlaces(MONEY_SCALE),
              countedQuantity: line.countedQuantity,
              notes: line.notes,
              unitName: line.unitName,
              unitFactor: line.unitFactor,
              unitQuantity: line.unitQuantity,
              batchId: line.batchId,
              storageLocationId: line.storageLocationId,
              // new column: written through a cast so this compiles before and after prisma generate
              ...({ toStorageLocationId: line.toStorageLocationId ?? null } as object),
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
      await this.auditInTx(tx, {
        companyId, userId, action: 'CREATE', entity: 'stock_documents',
        entityId: document.id,
        after: { documentNumber: document.documentNumber, kind, lines: lines.length },
      }, );
      return document;
    }, { timeout: 30000 });

    if ('kind' in created && created.kind === StockDocumentKind.WRITE_OFF) {
      await this.announceApproval(companyId, created.id, 'REVIEW', userId, created.createdBy, true);
    }
    return this.findOne(companyId, created.id, mayReadCost, voucherBranchIdOf(branchId));
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
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM stock_documents WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid
          AND "branchId" = ${branchId}::uuid AND "deletedAt" IS NULL FOR UPDATE
      `);
      if (locked.length !== 1) throw new NotFoundException('Stock voucher not found');
      const document = await tx.stockDocument.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      if (!document.voucherKind) throw new NotFoundException('Stock voucher not found');
      const previous = await tx.$queryRaw<Array<{ documentId: string; requestHash: string; resultVersion: number }>>(Prisma.sql`
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
      const warehouse = await tx.warehouse.findFirst({ where: { id: dto.toWarehouseId, companyId, branchId, deletedAt: null, isActive: true }, select: { id: true } });
      if (!warehouse) throw new BadRequestException('The voucher warehouse does not belong to this branch or is inactive');
      const costCenterId = dto.costCenterId ? String(dto.costCenterId).trim() : null;
      if (costCenterId) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(costCenterId)) throw new BadRequestException('costCenterId must be a UUID');
        await this.costCenters.assertPostable(tx, companyId, [costCenterId], date);
      }
      const existing = new Map(document.lines.map(line => [line.id, line]));
      const used = new Set<string>();
      const lines: Array<{ id?: string; itemId: string; lineNumber: number; quantity: Prisma.Decimal; unitCost: Prisma.Decimal;
        unitName: string | null; unitFactor: Prisma.Decimal | null; unitQuantity: Prisma.Decimal | null; notes: string | null }> = [];
      for (const [index, raw] of dto.lines.entries()) {
        if (!raw || typeof raw.itemId !== 'string') throw new BadRequestException(`Line ${index + 1}: item is required`);
        const old = raw.id ? existing.get(raw.id) : undefined;
        if (raw.id && (!old || used.has(raw.id))) throw new BadRequestException(`Line ${index + 1}: invalid or duplicate line id`);
        if (raw.id) used.add(raw.id);
        if (raw.unitId) throw new BadRequestException(`Line ${index + 1}: use unitName when editing a voucher`);
        const item = await tx.item.findFirst({ where: { id: raw.itemId, companyId, deletedAt: null }, select: { id: true, isStockTracked: true, code: true, unit: true, units: true } });
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
            if (!exactBaseQuantity(old.unitQuantity, unitFactor).equals(old.quantity)) throw new BadRequestException(`Line ${index + 1}: inconsistent historic unit snapshot`);
            quantity = exactBaseQuantity(entered, unitFactor);
            unitName = old.unitName; unitQuantity = entered;
          }
        } else if (name) {
          const resolved = resolveUnitSelection({ lineLabel: `Line ${index + 1}`, requestedUnitName: name,
            enteredQuantity: entered.abs(), baseUnitName: item.unit, units: item.units, purpose: 'stock' });
          quantity = entered.isNegative() ? resolved.baseQuantity.negated() : resolved.baseQuantity;
          unitName = resolved.snapshot.unitName; unitFactor = resolved.snapshot.unitFactor; unitQuantity = entered;
        } else { quantity = entered; unitName = null; unitFactor = null; unitQuantity = null; }
        const costMissing = raw.unitCost === undefined || raw.unitCost === null || raw.unitCost === '';
        if (!mayReadCost && document.voucherKind === 'RECEIPT' && !costMissing) {
          throw new ForbiddenException('inventory.cost.read permission is required to submit receipt unit costs');
        }
        const sameSavedItem = old !== undefined && old.itemId === item.id;
        const preserveHiddenCost = !mayReadCost && sameSavedItem &&
          (document.voucherKind === 'ISSUE' || costMissing);
        if (document.voucherKind === 'RECEIPT' && costMissing && !preserveHiddenCost) {
          throw new BadRequestException(`Line ${index + 1}: receipt unit cost is required`);
        }
        // Editors without purchase-price visibility can still update quantities
        // and metadata without blanking or changing a saved valuation. A new
        // receipt line still needs an explicitly supplied cost.
        const unitCost = preserveHiddenCost
          ? old.unitCost
          : raw.unitCost === undefined || raw.unitCost === null || raw.unitCost === ''
            ? new Prisma.Decimal(0)
            : this.decimal(raw.unitCost, `Line ${index + 1} unit cost`);
        if (unitCost.isNegative() || quantity.abs().mul(unitCost).greaterThanOrEqualTo('1e15')) throw new BadRequestException(`Line ${index + 1}: invalid stock value`);
        if (raw.notes != null && typeof raw.notes !== 'string') throw new BadRequestException(`Line ${index + 1}: notes must be text`);
        lines.push({ id: old?.id ?? randomUUID(), itemId: item.id, lineNumber: index + 1, quantity, unitCost, unitName, unitFactor, unitQuantity, notes: raw.notes ?? null });
      }
      if (document.voucherKind === 'ISSUE' && !costCenterId) {
        throw new BadRequestException('A cost center is required when issuing stock from a warehouse.');
      }
      await tx.stockDocumentLine.deleteMany({ where: { documentId: id } });
      await tx.stockDocumentLine.createMany({ data: lines.map(line => ({ ...line, documentId: id })) });
      const version = document.editVersion + 1;
      await tx.stockDocument.update({ where: { id }, data: { documentDate: date, toWarehouseId: dto.toWarehouseId,
        reason: dto.reason.trim(), counterpartyName: dto.counterpartyName.trim(), notes: dto.notes?.trim() || null, costCenterId,
        reviewedAt: null, reviewedBy: null, approvedAt: null, approvedBy: null, editVersion: version } });
      await tx.$executeRaw(Prisma.sql`INSERT INTO stock_voucher_edit_requests
        ("companyId", "branchId", "requestKey", "requestHash", "documentId", "resultVersion")
        VALUES (${companyId}::uuid,${branchId}::uuid,${identity.key},${identity.hash},${id}::uuid,${version})`);
      await this.auditInTx(tx, { companyId, userId, action: 'UPDATE', entity: 'stock_documents', entityId: id,
        before: { version: document.editVersion, reviewed: !!document.reviewedAt, approved: !!document.approvedAt,
          documentDate: document.documentDate.toISOString(), toWarehouseId: document.toWarehouseId, reason: document.reason,
          counterpartyName: document.counterpartyName, notes: document.notes, costCenterId: document.costCenterId,
          lines: document.lines.map(line => ({ id: line.id, itemId: line.itemId, quantity: line.quantity.toString(), unitCost: line.unitCost.toString(),
            unitName: line.unitName, unitFactor: line.unitFactor?.toString() ?? null, unitQuantity: line.unitQuantity?.toString() ?? null, notes: line.notes })) },
        after: { version, reviewed: false, approved: false, documentDate: date.toISOString(), toWarehouseId: dto.toWarehouseId, reason: dto.reason.trim(),
          counterpartyName: dto.counterpartyName.trim(), notes: dto.notes?.trim() || null, costCenterId,
          lines: lines.map(line => ({ id: line.id ?? null, itemId: line.itemId, quantity: line.quantity.toString(), unitCost: line.unitCost.toString(),
            unitName: line.unitName, unitFactor: line.unitFactor?.toString() ?? null, unitQuantity: line.unitQuantity?.toString() ?? null, notes: line.notes })) } }, );
    }, { timeout: 30000 });
    return this.findOne(companyId, id, mayReadCost);
  }

  /** Review and approval are idempotent and atomic with their audit record. */
  async transitionVoucher(companyId: string, branchId: string | null, userId: string, id: string,
    stage: 'REVIEW' | 'APPROVE', mayReadCost = true, expectedVersion?: number) {
    if (!branchId) throw new BadRequestException('The signed-in user is not assigned to a branch');
    await this.prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM stock_documents WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid
          AND "branchId" = ${branchId}::uuid AND "deletedAt" IS NULL FOR UPDATE
      `);
      if (locked.length !== 1) throw new NotFoundException('Stock voucher not found');
      const document = await tx.stockDocument.findUniqueOrThrow({ where: { id } });
      if (!document.voucherKind || document.status !== InvoiceStatus.DRAFT) throw new BadRequestException('Only a draft stock voucher can be reviewed or approved');
      if (expectedVersion !== undefined && document.editVersion !== expectedVersion) throw new ConflictException('The voucher has changed; reload the latest version');
      if (stage === 'REVIEW') {
        if (document.reviewedAt) return;
        await tx.stockDocument.update({ where: { id }, data: { reviewedAt: new Date(), reviewedBy: userId, editVersion: { increment: 1 } } });
      } else {
        if (!document.reviewedAt) throw new BadRequestException('The stock voucher must be reviewed before approval');
        if (document.approvedAt) return;
        await tx.stockDocument.update({ where: { id }, data: { approvedAt: new Date(), approvedBy: userId, editVersion: { increment: 1 } } });
      }
      await this.auditInTx(tx, { companyId, userId, action: stage, entity: 'stock_documents', entityId: id }, );
    });
    await this.announceApproval(companyId, id, stage, userId, null, false);
    return this.findOne(companyId, id, mayReadCost);
  }

  /// Keeps the notification centre in step with write-off and voucher
  /// approval at once. Runs after the action committed, never undoes it; the
  /// 30-minute scan is the backstop. A write-off is raised by the scan (its
  /// create path is not hooked), a voucher is raised when it is reviewed.
  private async announceApproval(
    companyId: string,
    id: string,
    stage: 'REVIEW' | 'APPROVE',
    userId: string,
    createdBy: string | null,
    writeOff: boolean,
  ) {
    if (!this.notifications) return;
    try {
      const doc = await this.prisma.stockDocument.findFirst({
        where: { id, companyId },
        select: { branchId: true, documentNumber: true, createdBy: true },
      });
      if (!doc) return;
      const path = writeOff ? `/inventory/write-offs?document=${id}` : `/inventory/documents?document=${id}`;
      if (stage === 'REVIEW') {
        await this.notifications.raiseSafely({
          companyId,
          type: writeOff ? WRITEOFF_PENDING_APPROVAL : STOCK_VOUCHER_PENDING_APPROVAL,
          branchId: doc.branchId,
          entityType: 'StockDocument',
          entityId: id,
          entityRef: doc.documentNumber,
          actionPath: path,
          titleEn: `${writeOff ? 'Write-off' : 'Stock voucher'} ${doc.documentNumber} is waiting for approval`,
          titleAr: `${writeOff ? 'مستند الإعدام' : 'إذن المخزن'} ${doc.documentNumber} في انتظار الاعتماد`,
          dedupe: dedupeKey({ type: writeOff ? WRITEOFF_PENDING_APPROVAL : STOCK_VOUCHER_PENDING_APPROVAL, entityId: id }),
        });
        return;
      }
      await this.notifications.clearPending(companyId, 'StockDocument', id);
      await this.notifications.tellRequester({
        companyId,
        branchId: doc.branchId,
        requesterId: createdBy ?? doc.createdBy,
        decidedBy: userId,
        outcome: 'APPROVED',
        entityType: 'StockDocument',
        entityId: id,
        entityRef: doc.documentNumber,
        nameAr: writeOff ? 'مستند الإعدام' : 'إذن المخزن',
        nameEn: writeOff ? 'Write-off' : 'Stock voucher',
        actionPath: path,
      });
    } catch {
      // The scan reconciles the centre on its next pass.
    }
  }

  /// Approves a write-off, once. This is a separate approval cycle from the
  /// stock-voucher REVIEW/APPROVE workflow: a loss has its own permission
  /// (inventory.writeoff.approve), and the person who recorded it may not
  /// approve it.
  ///
  /// The claim is a conditional update, not a read-then-write: two people
  /// pressing approve at the same moment produce exactly one approval, and the
  /// loser is told so instead of silently overwriting the first name.
  async approve(companyId: string, userId: string, id: string, mayReadCost = true) {
    const document = await this.prisma.stockDocument.findFirst({
      where: { id, companyId, deletedAt: null },
      select: {
        id: true,
        kind: true,
        status: true,
        documentNumber: true,
        createdBy: true,
        approvedAt: true,
        approvedBy: true,
      },
    });
    if (!document) throw new NotFoundException('Stock document not found');
    if (document.kind !== StockDocumentKind.WRITE_OFF) {
      throw new BadRequestException('Only a write-off needs an approval. / الاعتماد مطلوب لمستند الإعدام فقط.');
    }
    if (document.approvedAt) {
      throw new BadRequestException(`This write-off was already approved. / تم اعتماد هذا المستند مسبقًا (${document.documentNumber}).`);
    }
    if (document.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Only a draft write-off can be approved');
    }
    if (document.createdBy && document.createdBy === userId) {
      throw new BadRequestException('The person who recorded a write-off cannot approve it. / لا يجوز أن يعتمد المستخدم المستند الذي أنشأه.');
    }

    const claimed = await this.prisma.stockDocument.updateMany({
      where: { id: document.id, companyId, approvedAt: null, status: InvoiceStatus.DRAFT },
      data: { approvedAt: new Date(), approvedBy: userId },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException('This write-off was approved by someone else a moment ago.');
    }

    await this.audit.record({
      companyId,
      userId,
      action: 'APPROVE',
      entity: 'stock_documents',
      entityId: document.id,
      after: { documentNumber: document.documentNumber, approvedBy: userId },
    });
    await this.announceApproval(companyId, document.id, 'APPROVE', userId, document.createdBy, true);

    return this.findOne(companyId, document.id, mayReadCost);
  }

  /**
   * Posts the document: movements, stock balances and - when value changes -
   * one journal entry. No endpoint may skip the approval rules: a write-off
   * posted through ANY route must already be approved, and a voucher must be
   * reviewed and approved.
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
    // A loss is approved before it is posted, by somebody other than the person
    // who wrote it down - enforced here, on every posting route, so no
    // alternative endpoint can bypass it.
    if (initialDocument.kind === StockDocumentKind.WRITE_OFF &&
        (!initialDocument.approvedAt || !initialDocument.approvedBy)) {
      throw new BadRequestException(
        'A write-off must be approved before it is posted. / يجب اعتماد مستند الإعدام قبل ترحيله.',
      );
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
      // The conditional update is also the idempotency guard: a replayed post
      // finds the document no longer DRAFT and is refused instead of posting
      // a second time.
      const claimed = await tx.stockDocument.updateMany({
        where: { id, companyId, status: InvoiceStatus.DRAFT, deletedAt: null },
        data: { status: InvoiceStatus.POSTED, postedAt: new Date(), postedBy: userId },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('This document has just been posted by someone else.');
      }
      const reloaded = await (tx.stockDocument.findFirst
        ? tx.stockDocument.findFirst({
            where: { id, companyId, deletedAt: null },
            include: { lines: { orderBy: { lineNumber: 'asc' } } },
          })
        : Promise.resolve(null));
      const document = reloaded ?? initialDocument;
      if (!document) throw new NotFoundException('Stock document not found');
      if (document.voucherKind && document.branchId !== voucherBranchId) throw new NotFoundException('Stock voucher not found');
      if (document.voucherKind && expectedVersion !== undefined && document.editVersion !== expectedVersion) {
        throw new ConflictException('The voucher has changed; reload the latest version');
      }
      if (document.voucherKind && (!document.reviewedAt || !document.approvedAt)) {
        throw new BadRequestException('Stock voucher must be reviewed and approved before posting');
      }
      if (document.kind === StockDocumentKind.WRITE_OFF && (!document.approvedAt || !document.approvedBy)) {
        throw new BadRequestException('A write-off must be approved before it is posted. / يجب اعتماد مستند الإعدام قبل ترحيله.');
      }
      if (document.voucherKind === 'ISSUE') {
        if (!document.costCenterId) {
          throw new BadRequestException('A cost center is required when issuing stock from a warehouse.');
        }
        // Hold a shared row lock through commit. Cost-centre UPDATE/DELETE
        // must either finish before our validation (so we see its new state)
        // or wait until this posting commits.
        await tx.$queryRaw(Prisma.sql`
          SELECT id FROM cost_centers
          WHERE id = ${document.costCenterId}::uuid AND "companyId" = ${companyId}::uuid
          FOR SHARE
        `);
        await this.costCenters.assertPostable(tx, companyId, [document.costCenterId], document.documentDate);
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

      // Source-shelf checks read a shelf and then act on it, so the item locks
      // are taken up front in one sorted order.
      const lockedWarehouses = (
        document.kind === StockDocumentKind.TRANSFER
          ? [fromWarehouseId, toWarehouseId]
          : document.kind === StockDocumentKind.WRITE_OFF
            ? [toWarehouseId]
            : []
      ).filter((w): w is string => !!w);
      if (lockedWarehouses.length) {
        // Same order as an issue: every item advisory key first (sorted over
        // both ends), then the warehouse rows (sorted), never the reverse.
        const keys = Array.from(
          new Set(lockedWarehouses.flatMap((w) => document.lines.map((l) => `${w}:${l.itemId}`))),
        ).sort();
        for (const key of keys) {
          await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
        }
        for (const w of Array.from(new Set(lockedWarehouses)).sort()) {
          await this.warehouses.lockForPosting(tx, companyId, w);
        }
      }

      for (const line of document.lines) {
        if (document.kind === StockDocumentKind.TRANSFER) {
          // Out of the source branch, into the destination, at the cost the
          // stock actually carries. No value is created or destroyed, so no
          // journal entry is needed: it is the same company's inventory.

          // Warehouse-level rule first: the branch total may cover the line
          // while this specific source warehouse does not. The guard locks
          // the warehouse row, which also serialises concurrent transfers
          // draining the same pile. Stock documents never overdraw a
          // warehouse, even if a legacy company setting permits negative
          // stock in other workflows.
          await this.warehouses.assertWarehouseAvailable({
            tx,
            companyId,
            warehouseId: fromWarehouseId,
            itemId: line.itemId,
            quantity: line.quantity,
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
          // What the goods are worth where they leave, not what the branch
          // averages: a transfer carries the source shelf's cost to the
          // destination, and the destination re-averages with it.
          // Prefer the source shelf's own average; when the ledger service is
          // not available (or the shelf holds nothing) fall back to the branch
          // average of the source, and to the draft cost when nothing is held.
          let unitCost: Prisma.Decimal;
          if (typeof (this.ledger as unknown as { position?: unknown }).position === 'function') {
            const sourceShelf = await this.ledger.position(tx, {
              companyId,
              branchId: document.fromBranchId as string,
              warehouseId: fromWarehouseId,
              itemId: line.itemId,
            });
            unitCost = sourceShelf.quantity.isZero()
              ? (availableQty.isZero() ? line.unitCost : availableValue.div(availableQty).toDecimalPlaces(MONEY_SCALE))
              : sourceShelf.unitCost.toDecimalPlaces(MONEY_SCALE);
          } else {
            unitCost = availableQty.isZero()
              ? line.unitCost
              : availableValue.div(availableQty).toDecimalPlaces(MONEY_SCALE);
          }
          const totalCost = unitCost.mul(line.quantity).toDecimalPlaces(MONEY_SCALE);

          // The line keeps the cost it moved at, so the printed document and
          // the movements it produced always agree.
          await tx.stockDocumentLine.update({
            where: { id: line.id },
            data: { unitCost, totalCost },
          });

          await this.move(tx, {
            companyId,
            branchId: document.fromBranchId as string,
            itemId: line.itemId,
            date: document.documentDate,
            direction: StockDirection.OUT,
            quantity: line.quantity,
            enteredUnit: line.unitName,
            enteredQuantity: line.unitQuantity,
            unitFactor: line.unitFactor,
            baseUnitName: line.unitName ?? 'unit',
            unitCost,
            totalCost,
            referenceType: 'STOCK_TRANSFER_OUT',
            referenceId: document.id,
            referenceNumber: document.documentNumber,
            userId,
            requireStock: !settings.allowNegativeStock,
            warehouseId: fromWarehouseId,
            batchId: line.batchId ?? null,
            storageLocationId: line.storageLocationId ?? null,
          });
          const receivingShelf = (line as { toStorageLocationId?: string | null }).toStorageLocationId ?? null;
          if (receivingShelf) {
            const ok = await tx.storageLocation.findFirst({
              where: { id: receivingShelf, companyId, warehouseId: toWarehouseId ?? undefined, deletedAt: null, isActive: true },
              select: { id: true },
            });
            if (!ok) {
              throw new BadRequestException({
                code: 'STOCK_DOC_TARGET_LOCATION_INVALID',
                message:
                  `المستند ${document.documentNumber}: موقع الاستلام لم يعد نشطًا أو حُذف. صحّح موقع الاستلام في المسودة أو اتركه فارغًا ثم رحّل من جديد؛ لم يتغير أي رصيد. / ` +
                  `Document ${document.documentNumber}: the receiving location is no longer active or was deleted. Correct it on the draft or leave it empty, then post again; no balance changed.`,
                errors: { locationId: receivingShelf },
              });
            }
          }
          const destinationLots: Array<{ batchId: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal }> = [];
          // The lots travel with the goods. Only what the lots actually hold
          // is moved: a partial transfer moves the requested quantity out of
          // the source lot and the remainder stays where it was.
          await this.moveLots(tx, {
            companyId,
            userId,
            itemId: line.itemId,
            fromWarehouseId: fromWarehouseId ?? null,
            toWarehouseId,
            toBranchId: document.branchId,
            quantity: line.quantity,
            batchId: line.batchId ?? null,
            date: document.documentDate,
            referenceNumber: document.documentNumber,
            destinationLots,
          });
          if (destinationLots.length > 0 &&
              !(destinationLots.length === 1 && destinationLots[0].quantity.equals(line.quantity))) {
            throw new BadRequestException({
              code: 'STOCK_DOC_TRANSFER_LOT_COVERAGE',
              message:
                `المستند ${document.documentNumber} (سطر ${line.lineNumber}): الكمية المطلوبة تتوزع على أكثر من دفعة أو لا تغطيها دفعة واحدة بالكامل، ولا يمكن تتبعها بدقة. اختر دفعة واحدة تغطي الكمية أو قسّم السطر إلى أسطر بدفعة لكل سطر؛ لم يتغير أي رصيد وبياناتك محفوظة في المسودة. / ` +
                `Document ${document.documentNumber} (line ${line.lineNumber}): the quantity spans several lots or is not fully covered by one lot, so it cannot be tracked exactly. Pick one lot that covers the quantity, or split the line into one line per lot; no balance changed and your draft is kept.`,
              errors: { lineNumber: String(line.lineNumber) },
            });
          }
          await this.move(tx, {
            companyId,
            branchId: document.branchId,
            itemId: line.itemId,
            date: document.documentDate,
            direction: StockDirection.IN,
            quantity: line.quantity,
            enteredUnit: line.unitName,
            enteredQuantity: line.unitQuantity,
            unitFactor: line.unitFactor,
            baseUnitName: line.unitName ?? 'unit',
            unitCost,
            totalCost,
            referenceType: 'STOCK_TRANSFER_IN',
            referenceId: document.id,
            referenceNumber: document.documentNumber,
            userId,
            requireStock: false,
            warehouseId: toWarehouseId,
            // The IN movement is bound to the DESTINATION lot that actually
            // received the goods (not the source lot id), so the receiving
            // lot's shelf balance sees it. A transfer spread over several lots
            // or only partly covered by lots keeps the legacy binding.
            batchId:
              destinationLots.length === 1 && destinationLots[0].quantity.equals(line.quantity)
                ? destinationLots[0].batchId
                : (line.batchId ?? null),
            // The source shelf belongs to the source warehouse; the receiving shelf
            // is the one the document names for it, or none (arrive unlocated).
            storageLocationId: (line as { toStorageLocationId?: string | null }).toStorageLocationId ?? null,
          });
          if (destinationLots.length === 1 && destinationLots[0].quantity.equals(line.quantity)) {
            await tx.$executeRaw(Prisma.sql`
              UPDATE "stock_movements" SET "lotUnitCost" = ${destinationLots[0].unitCost}
               WHERE "companyId" = ${companyId}::uuid AND "referenceId" = ${document.id}::uuid
                 AND "referenceType" = 'STOCK_TRANSFER_IN' AND "itemId" = ${line.itemId}::uuid
                 AND "batchId" = ${destinationLots[0].batchId}::uuid
            `);
          }

          continue;
        }

        // ADJUSTMENT, WRITE_OFF and COUNT all come down to "this many units move".
        let quantity = line.quantity;
        let unitCost = line.unitCost;
        // Re-check the line's shelf as it is NOW: a shelf may have been deleted
        // or switched off since the draft was written. Goods may leave an
        // inactive shelf (a deficit drains it) but never arrive on one.
        if (
          line.storageLocationId &&
          (document.kind === StockDocumentKind.ADJUSTMENT || document.kind === StockDocumentKind.COUNT)
        ) {
          const shelfNow = await tx.storageLocation.findFirst({
            where: { id: line.storageLocationId, companyId, deletedAt: null },
            select: { code: true, isActive: true },
          });
          if (!shelfNow || (quantity.greaterThan(0) && !shelfNow.isActive)) {
            throw new BadRequestException({
              code: 'STOCK_DOC_LOCATION_INVALID',
              message:
                `المستند ${document.documentNumber}: ${shelfNow ? `الموقع ${shelfNow.code} لم يعد نشطًا ولا يستقبل فائضًا` : 'موقع السطر حُذف'}. صحّح موقع السطر في المسودة أو اتركه فارغًا ثم رحّل من جديد؛ لم يتغير أي رصيد. / ` +
                `Document ${document.documentNumber}: ${shelfNow ? `location ${shelfNow.code} is no longer active and cannot receive a surplus` : 'the line location was deleted'}. Correct the line location on the draft or leave it empty, then post again; no balance changed.`,
              errors: { lineNumber: String(line.lineNumber) },
            });
          }
        }
        // For an issue (negative adjustment or write-off) take the warehouse
        // lock before the branch balance lock, as transfer and reversal do;
        // taking them in the opposite order can deadlock.
        if (
          (document.kind === StockDocumentKind.ADJUSTMENT ||
            document.kind === StockDocumentKind.WRITE_OFF) &&
          quantity.lessThan(0)
        ) {
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
        // as issues and transfers).
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
          // A count is of a place, not of a company. When it names a
          // warehouse, the book figure it is compared with is that warehouse's
          // own card - the same figure the difference report calls the system
          // quantity.
          const bookQuantity =
            toWarehouseId
              ? await this.warehouses.availableQuantity(tx, companyId, toWarehouseId, line.itemId)
              : onHand;
          const counted = line.countedQuantity ?? new Prisma.Decimal(0);
          quantity = counted.minus(bookQuantity);
          // Shortfalls consume existing inventory at its locked moving-average
          // cost; a draft's arbitrary price cannot rewrite that valuation.
          if (quantity.isNegative() || unitCost.isZero()) unitCost = averageCost;
          await tx.stockDocumentLine.update({
            where: { id: line.id },
            data: { quantity, unitCost, totalCost: unitCost.mul(quantity.abs()).toDecimalPlaces(MONEY_SCALE) },
          });
        } else if (quantity.lessThan(0)) {
          // A write-off or issue leaves at the locked moving-average cost; an
          // arbitrary draft cost would misstate both stock and the cost centre.
          unitCost = averageCost;
          await tx.stockDocumentLine.update({ where: { id: line.id }, data: { unitCost, totalCost: unitCost.mul(quantity.abs()).toDecimalPlaces(MONEY_SCALE) } });
        }

        if (quantity.isZero()) continue;

        const direction = quantity.greaterThan(0) ? StockDirection.IN : StockDirection.OUT;
        const absoluteQuantity = quantity.abs();
        let totalCost = unitCost.mul(absoluteQuantity).toDecimalPlaces(MONEY_SCALE);
        // Goods that leave a warehouse are valued at THAT warehouse's own
        // average, and the whole warehouse value leaves with the last unit. The
        // branch average blends other warehouses and would leave the selected
        // warehouse with value and no quantity (or the reverse), so the branch
        // book and the warehouse books would drift apart.
        if (
          direction === StockDirection.OUT &&
          toWarehouseId &&
          typeof (this.ledger as unknown as { position?: unknown }).position === 'function'
        ) {
          const shelfBook = await this.ledger.position(tx, {
            companyId,
            branchId: document.branchId,
            warehouseId: toWarehouseId,
            itemId: line.itemId,
          });
          if (shelfBook.quantity.greaterThan(0)) {
            const priced = this.ledger.issuePrice(shelfBook, absoluteQuantity);
            totalCost = priced.value.toDecimalPlaces(MONEY_SCALE);
            unitCost = absoluteQuantity.isZero()
              ? unitCost
              : totalCost.div(absoluteQuantity).toDecimalPlaces(MONEY_SCALE);
          }
        }

        await tx.stockDocumentLine.update({
          where: { id: line.id },
          data: { unitCost, totalCost },
        });

        await this.move(tx, {
          companyId,
          branchId: document.branchId,
          itemId: line.itemId,
          date: document.documentDate,
          direction,
          quantity: absoluteQuantity,
          enteredUnit: line.unitName,
          enteredQuantity: line.unitQuantity,
          unitFactor: line.unitFactor,
          baseUnitName: line.unitName ?? 'unit',
          unitCost,
          totalCost,
          referenceType:
            document.kind === StockDocumentKind.COUNT
              ? 'STOCK_COUNT'
              : document.kind === StockDocumentKind.WRITE_OFF
                ? 'STOCK_WRITE_OFF'
                : 'STOCK_ADJUSTMENT',
          referenceId: document.id,
          referenceNumber: document.documentNumber,
          userId,
          requireStock: direction === StockDirection.OUT && !settings.allowNegativeStock,
          warehouseId: toWarehouseId,
          costCenterId: document.costCenterId,
          batchId: line.batchId ?? null,
          storageLocationId: line.storageLocationId ?? null,
        });

        // A line that names a lot moves that lot, not only the shelf: a
        // write-off must not leave the lot card claiming goods that have been
        // destroyed, and a count that found units missing from a lot must
        // take them out of that lot.
        if (line.batchId) {
          if (direction === StockDirection.OUT) {
            const claimedBatch = await tx.itemBatch.updateMany({
              where: {
                id: line.batchId,
                companyId,
                remainingQuantity: { gte: absoluteQuantity },
              },
              data: { remainingQuantity: { decrement: absoluteQuantity } },
            });
            if (claimedBatch.count !== 1) {
              throw new BadRequestException(
                'The lot does not hold enough for that quantity. / الدفعة لا تحمل الكمية المطلوبة.',
              );
            }
            await tx.$executeRaw(Prisma.sql`
              UPDATE "item_batches"
                 SET "status" = 'CLOSED'
               WHERE "id" = ${line.batchId}::uuid
                 AND "remainingQuantity" = 0
                 AND "status" <> 'WRITTEN_OFF'
            `);
          } else {
            await tx.itemBatch.updateMany({
              where: { id: line.batchId, companyId },
              data: {
                remainingQuantity: { increment: absoluteQuantity },
                receivedQuantity: { increment: absoluteQuantity },
              },
            });
          }
        }

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
            ? { accountId: accounts.inventory, debit: valueChange, description: 'Stock increase' }
            : { accountId: accounts.inventory, credit: valueChange.negated(), description: 'Stock decrease' },
        );
        journalLines.push(
          valueChange.greaterThan(0)
            ? { accountId: accounts.inventoryDifference, credit: valueChange,
                description: document.reason ?? 'Inventory difference', costCenterId: document.costCenterId }
            : { accountId: accounts.inventoryDifference, debit: valueChange.negated(),
                description: document.reason ?? 'Inventory difference', costCenterId: document.costCenterId },
        );

        journal = await this.posting.post(tx, {
          companyId,
          branchId: document.branchId,
          userId,
          entryDate: document.documentDate,
          description:
            document.kind === StockDocumentKind.COUNT
              ? 'Stock count difference'
              : document.kind === StockDocumentKind.WRITE_OFF
                ? `Write-off ${document.documentNumber}`
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

      await this.auditInTx(tx, {
        companyId, userId, action: 'POST', entity: 'stock_documents', entityId: id,
        after: {
          documentNumber: document.documentNumber,
          kind: document.kind,
          journalNumber: journal?.entryNumber ?? null,
          valueChange: valueChange.toFixed(MONEY_SCALE),
        },
      }, );

    });

    return this.findOne(companyId, id, mayReadCost, voucherBranchId);
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
        : [document.kind === StockDocumentKind.COUNT
            ? 'STOCK_COUNT'
            : document.kind === StockDocumentKind.WRITE_OFF
              ? 'STOCK_WRITE_OFF'
              : 'STOCK_ADJUSTMENT'];
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
              : (document.kind === StockDocumentKind.COUNT
                  ? 'STOCK_COUNT'
                  : document.kind === StockDocumentKind.WRITE_OFF
                    ? 'STOCK_WRITE_OFF'
                    : 'STOCK_ADJUSTMENT'),
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
          // The reversal lands on the shelf the ORIGINAL movement used on that
          // side: a transfer's source shelf on the way back, its receiving
          // shelf (or the unlocated pile) when the goods leave the destination.
          const originalShelf = (original as { storageLocationId?: string | null }).storageLocationId ?? null;
          const originalBatch = (original as { batchId?: string | null }).batchId ?? null;
          if (document.kind === StockDocumentKind.TRANSFER && wasOut && line.batchId && originalBatch !== line.batchId) {
            throw new BadRequestException({
              code: 'STOCK_DOC_REVERSE_LOT_AMBIGUOUS',
              message:
                `لا يمكن عكس المستند ${document.documentNumber} (سطر ${line.lineNumber}): دفعة حركة الصرف الأصلية لا تطابق دفعة السطر. لم يتغير أي رصيد؛ راجع المحاسب أو المدير للتحقق من الدفعة الأصلية قبل أي تصحيح. / ` +
                `Cannot reverse document ${document.documentNumber} (line ${line.lineNumber}): the original issue movement's lot does not match the line's lot. No balance changed; ask the accountant or administrator to verify the original lot before any correction.`,
              errors: { lineNumber: String(line.lineNumber) },
            });
          }
          if (!wasOut && target.warehouseId && originalBatch) {
            const [onLotShelf] = await tx.$queryRaw<Array<{ q: Prisma.Decimal }>>(Prisma.sql`
              SELECT COALESCE(SUM(CASE WHEN "direction" = 'IN' THEN "quantity" ELSE -"quantity" END), 0) AS q
                FROM "stock_movements"
               WHERE "companyId" = ${companyId}::uuid AND "warehouseId" = ${target.warehouseId}::uuid
                 AND "itemId" = ${line.itemId}::uuid AND "batchId" = ${originalBatch}::uuid
                 AND ${originalShelf ? Prisma.sql`"storageLocationId" = ${originalShelf}::uuid` : Prisma.sql`"storageLocationId" IS NULL`}
            `);
            const lotOnShelf = new Prisma.Decimal(onLotShelf?.q ?? 0);
            if (lotOnShelf.lessThan(line.quantity.abs())) {
              throw new BadRequestException({
                code: 'STOCK_DOC_REVERSE_LOT_SHELF_SHORT',
                message:
                  `لا يمكن عكس المستند ${document.documentNumber} (سطر ${line.lineNumber}): الدفعة المستلمة تحمل ${lotOnShelf.toFixed(MONEY_SCALE)} فقط في موقع الاستلام من ${line.quantity.abs().toFixed(MONEY_SCALE)} المطلوبة (نُقل الباقي أو صُرف). لم يتغير أي رصيد؛ راجع المحاسب أو المدير قبل أي تصحيح. / ` +
                  `Cannot reverse document ${document.documentNumber} (line ${line.lineNumber}): the received lot holds only ${lotOnShelf.toFixed(MONEY_SCALE)} at the receiving location of the ${line.quantity.abs().toFixed(MONEY_SCALE)} required (the rest was moved or issued). No balance changed; ask the accountant or administrator before any correction.`,
                errors: { lineNumber: String(line.lineNumber) },
              });
            }
          }
          if (!wasOut && target.warehouseId) {
            const [onShelfRow] = await tx.$queryRaw<Array<{ q: Prisma.Decimal }>>(Prisma.sql`
              SELECT COALESCE(SUM(CASE WHEN "direction" = 'IN' THEN "quantity" ELSE -"quantity" END), 0) AS q
                FROM "stock_movements"
               WHERE "companyId" = ${companyId}::uuid AND "warehouseId" = ${target.warehouseId}::uuid
                 AND "itemId" = ${line.itemId}::uuid
                 AND ${originalShelf ? Prisma.sql`"storageLocationId" = ${originalShelf}::uuid` : Prisma.sql`"storageLocationId" IS NULL`}
            `);
            const onShelf = new Prisma.Decimal(onShelfRow?.q ?? 0);
            if (onShelf.lessThan(line.quantity.abs())) {
              throw new BadRequestException({
                code: 'STOCK_DOC_REVERSE_SHELF_SHORT',
                message:
                  `لا يمكن عكس المستند ${document.documentNumber} (سطر ${line.lineNumber}): الموقع الذي استلم البضاعة يحمل ${onShelf.toFixed(MONEY_SCALE)} فقط من ${line.quantity.abs().toFixed(MONEY_SCALE)} المطلوبة (تم نقل الباقي أو صرفه). لم يتغير أي رصيد؛ راجع المحاسب أو المدير للتحقق قبل أي تصحيح. / ` +
                  `Cannot reverse document ${document.documentNumber} (line ${line.lineNumber}): the location that received the goods holds only ${onShelf.toFixed(MONEY_SCALE)} of the ${line.quantity.abs().toFixed(MONEY_SCALE)} required (the rest was moved or issued). No balance changed; ask the accountant or administrator to verify before any correction.`,
                errors: { lineNumber: String(line.lineNumber) },
              });
            }
          }
          await this.move(tx, {
            companyId,
            branchId,
            itemId: line.itemId,
            date: new Date(),
            direction: wasOut ? StockDirection.IN : StockDirection.OUT,
            quantity: line.quantity.abs(),
            enteredUnit: line.unitName,
            enteredQuantity: line.unitQuantity,
            unitFactor: line.unitFactor,
            baseUnitName: line.unitName ?? 'unit',
            unitCost: original.unitCost,
            totalCost: original.totalCost,
            referenceType: 'STOCK_DOCUMENT_REVERSAL',
            referenceId: document.id,
            referenceNumber: document.documentNumber,
            userId,
            requireStock: false,
            warehouseId: target.warehouseId,
            costCenterId: original.costCenterId,
            batchId: originalBatch,
            storageLocationId: originalShelf,
          });
        }
      }

      if (usedOriginals.size !== originals.length) {
        throw new BadRequestException(
          'The original stock movements do not match the document; it cannot be reversed automatically.',
        );
      }

      // A transfer that moved a lot is undone lot by lot: the receiving lot gives
      // the quantity back at the cost it arrived with, the source lot takes it
      // back at that same cost. A line with no lot that nevertheless produced a
      // transferred lot cannot be matched without guessing, so it is refused.
      if (document.kind === StockDocumentKind.TRANSFER) {
        for (const line of document.lines) {
          if (line.quantity.isZero()) continue;
          const quantity = line.quantity.abs();
          const fail = (code: string, ar: string, en: string) => new BadRequestException({
            code,
            message: `لا يمكن عكس المستند ${document.documentNumber} (سطر ${line.lineNumber}): ${ar} لم يتغير أي رصيد؛ راجع المحاسب أو المدير للتحقق من الدفعة والتكلفة الأصلية قبل أي تصحيح. / Cannot reverse document ${document.documentNumber} (line ${line.lineNumber}): ${en} No balance changed; ask the accountant or administrator to verify the original lot and cost before any correction.`,
            errors: { lineNumber: String(line.lineNumber) },
          });
          if (!line.batchId) {
            const arrived = await tx.itemBatch.count({
              where: { companyId, warehouseId: reversalToWarehouseId ?? undefined, itemId: line.itemId, sourceNumber: document.documentNumber, sourceType: 'BATCH_TRANSFER' },
            });
            if (arrived > 0) {
              throw fail('STOCK_DOC_REVERSE_LOT_AMBIGUOUS', 'هذا السطر لا يحدد دفعة بينما نتج عنه نقل دفعة.', 'this line names no lot, but the transfer moved a lot.');
            }
            continue;
          }
          const source = await tx.itemBatch.findFirst({ where: { id: line.batchId, companyId } });
          const destination = source
            ? await tx.itemBatch.findFirst({
                where: { companyId, warehouseId: reversalToWarehouseId ?? undefined, itemId: line.itemId, batchNumber: source.batchNumber, deletedAt: null },
              })
            : null;
          if (!source || !destination) {
            throw fail('STOCK_DOC_REVERSE_LOT_AMBIGUOUS', 'الدفعة الأصلية أو دفعة الاستلام غير موجودة.', 'the original lot or the receiving lot cannot be found.');
          }
          if (destination.remainingQuantity.lessThan(quantity)) {
            throw fail('STOCK_DOC_REVERSE_LOT_SHORT', `دفعة الاستلام تحمل ${destination.remainingQuantity.toFixed(MONEY_SCALE)} فقط من ${quantity.toFixed(MONEY_SCALE)} المطلوبة.`, `the receiving lot holds only ${destination.remainingQuantity.toFixed(MONEY_SCALE)} of the ${quantity.toFixed(MONEY_SCALE)} required.`);
          }
          // The cost the goods arrived with was recorded on the receipt movement
          // (lotUnitCost) when the transfer was posted. Without it (a legacy
          // document) the original cost cannot be proven and nothing is guessed.
          const [evidence] = await tx.$queryRaw<Array<{ lo: Prisma.Decimal | null; hi: Prisma.Decimal | null; n: bigint; missing: bigint }>>(Prisma.sql`
            SELECT MIN(m."lotUnitCost") AS lo, MAX(m."lotUnitCost") AS hi, COUNT(*)::bigint AS n,
                   COUNT(*) FILTER (WHERE m."lotUnitCost" IS NULL)::bigint AS missing
              FROM "stock_movements" m
             WHERE m."companyId" = ${companyId}::uuid AND m."referenceId" = ${document.id}::uuid
               AND m."referenceType" = 'STOCK_TRANSFER_IN' AND m."itemId" = ${line.itemId}::uuid
               AND m."batchId" = ${destination.id}::uuid
          `);
          // Several lines of one document may land on the same lot at the same
          // source cost; the evidence is usable only when every receipt into
          // that lot recorded one and they all agree.
          if (Number(evidence?.n ?? 0) < 1 || Number(evidence?.missing ?? 0) > 0 || evidence?.lo == null || evidence?.hi == null || !new Prisma.Decimal(evidence.lo).equals(evidence.hi)) {
            throw fail('STOCK_DOC_REVERSE_LOT_COST_UNPROVABLE', 'لا يوجد سجل متسق لتكلفة الدفعة وقت الاستلام (مستند قديم أو دفعة مختلفة).', 'no consistent record of the lot cost at receipt exists (legacy document or a different lot).');
          }
          const arrivalCost = new Prisma.Decimal(evidence.lo);
          await removeFromLotCost(tx, destination.id, quantity, arrivalCost);
          await tx.itemBatch.update({
            where: { id: destination.id },
            data: { remainingQuantity: { decrement: quantity }, receivedQuantity: { decrement: quantity }, updatedBy: userId },
          });
          await tx.$executeRaw(Prisma.sql`
            UPDATE "item_batches" SET "status" = 'CLOSED'
             WHERE "id" = ${destination.id}::uuid AND "remainingQuantity" = 0 AND "status" <> 'WRITTEN_OFF'
          `);
          await addToLotCost(tx, source.id, quantity, arrivalCost);
          await tx.itemBatch.update({
            where: { id: source.id },
            data: { remainingQuantity: { increment: quantity }, updatedBy: userId },
          });
          await tx.$executeRaw(Prisma.sql`
            UPDATE "item_batches" SET "status" = 'OPEN'
             WHERE "id" = ${source.id}::uuid AND "status" = 'CLOSED'
          `);
        }
      }

      // A reversal of a write-off returns the goods to their lot.
      for (const line of document.lines) {
        if (!line.batchId || line.quantity.isZero()) continue;
        if (document.kind === StockDocumentKind.WRITE_OFF ||
            (document.kind === StockDocumentKind.ADJUSTMENT && line.quantity.lessThan(0))) {
          await tx.itemBatch.updateMany({
            where: { id: line.batchId, companyId },
            data: { remainingQuantity: { increment: line.quantity.abs() } },
          });
          await tx.$executeRaw(Prisma.sql`
            UPDATE "item_batches"
               SET "status" = 'OPEN'
             WHERE "id" = ${line.batchId}::uuid
               AND "status" = 'CLOSED'
          `);
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
      await this.auditInTx(tx, {
        companyId, userId, action: 'REVERSE', entity: 'stock_documents', entityId: id,
      }, );
    });

    return this.findOne(companyId, id, mayReadCost, voucherBranchId);
  }

  // ------------------------------------------------------------------ helpers

  /// The branch balance, locked for the rest of the transaction.
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

  /// Takes the same goods out of the source lots and puts them into the
  /// destination's, soonest expiry first.
  ///
  /// Only what the lots actually hold is moved: a partial transfer moves the
  /// requested quantity out of the source lot and the remainder stays on the
  /// source shelf. Nothing is invented, and no lot appears at the destination
  /// with more than left the source.
  private async moveLots(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      userId: string;
      itemId: string;
      fromWarehouseId: string | null;
      toWarehouseId: string | null;
      toBranchId: string;
      quantity: Prisma.Decimal;
      batchId: string | null;
      date: Date;
      referenceNumber: string;
      destinationLots?: Array<{ batchId: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal }>;
    },
  ): Promise<Prisma.Decimal> {
    if (!input.fromWarehouseId || !input.toWarehouseId) return new Prisma.Decimal(0);

    const lots = await tx.itemBatch.findMany({
      where: {
        companyId: input.companyId,
        warehouseId: input.fromWarehouseId,
        itemId: input.itemId,
        deletedAt: null,
        remainingQuantity: { gt: 0 },
        ...(input.batchId ? { id: input.batchId } : {}),
      },
      orderBy: { expiryDate: 'asc' },
    });
    if (lots.length === 0) return new Prisma.Decimal(0);

    // Expiry does not stop a transfer: the goods are already the company's and
    // are not being sold. It only decides the order they are taken in.
    const selection = selectLotsFefo(
      lots.map((lot) => ({
        batchId: lot.id,
        batchNumber: lot.batchNumber,
        expiryDate: lot.expiryDate,
        productionDate: lot.productionDate,
        unitCost: lot.unitCost,
        remainingQuantity: lot.remainingQuantity,
        status: lot.status,
      })),
      input.quantity,
      { today: input.date, allowExpired: true },
    );

    let moved = new Prisma.Decimal(0);
    for (const allocation of selection.allocations) {
      const source = lots.find((lot) => lot.id === allocation.batchId);
      if (!source) continue;
      // Only the requested quantity leaves the source lot; the remainder
      // stays. The conditional update also serialises concurrent transfers.
      const claimed = await tx.itemBatch.updateMany({
        where: { id: source.id, remainingQuantity: { gte: allocation.quantity } },
        data: {
          remainingQuantity: { decrement: allocation.quantity },
          updatedBy: input.userId,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException(
          'تم تعديل الدفعة أثناء التحويل. أعد المحاولة. / The lot changed while the transfer was posted; try again.',
        );
      }
      await tx.$executeRaw(Prisma.sql`
        UPDATE "item_batches"
           SET "status" = 'CLOSED'
         WHERE "id" = ${source.id}::uuid
           AND "remainingQuantity" = 0
           AND "status" <> 'WRITTEN_OFF'
      `);

      // The goods keep whatever hold the source lot was under. Creating the
      // destination pair as OPEN would put quarantined or expired stock on the
      // other shelf as sellable - a transfer would launder the hold. CLOSED is
      // the one state that cannot travel, because a closed lot is empty.
      const sourceHold = source.status === 'CLOSED' ? 'OPEN' : source.status;
      const destination = await tx.itemBatch.findFirst({
        where: {
          companyId: input.companyId,
          warehouseId: input.toWarehouseId,
          itemId: input.itemId,
          batchNumber: source.batchNumber,
          deletedAt: null,
        },
      });
      if (destination) {
        input.destinationLots?.push({ batchId: destination.id, quantity: allocation.quantity, unitCost: source.unitCost });
        await tx.itemBatch.update({
          where: { id: destination.id },
          data: {
            receivedQuantity: { increment: allocation.quantity },
            remainingQuantity: { increment: allocation.quantity },
            // What stays and what arrives are valued together: the lot's
            // average moves to the weighted cost by remaining quantity.
            unitCost: destination.remainingQuantity
              .mul(destination.unitCost)
              .plus(allocation.quantity.mul(source.unitCost))
              .div(destination.remainingQuantity.plus(allocation.quantity))
              .toDecimalPlaces(4),
            // Merging held goods into a lot sitting OPEN would release them.
            ...(sourceHold !== 'OPEN' && destination.status === 'OPEN'
              ? { status: sourceHold }
              : {}),
            updatedBy: input.userId,
          },
        });
      } else {
        const createdLot = await tx.itemBatch.create({
          data: {
            companyId: input.companyId,
            branchId: input.toBranchId,
            warehouseId: input.toWarehouseId,
            itemId: input.itemId,
            batchNumber: source.batchNumber,
            productionDate: source.productionDate,
            expiryDate: source.expiryDate,
            receivedQuantity: allocation.quantity,
            remainingQuantity: allocation.quantity,
            unitCost: source.unitCost,
            status: sourceHold,
            sourceType: 'BATCH_TRANSFER',
            sourceNumber: input.referenceNumber,
            createdBy: input.userId,
          },
        });
        input.destinationLots?.push({ batchId: createdLot.id, quantity: allocation.quantity, unitCost: source.unitCost });
      }
      moved = moved.plus(allocation.quantity);
    }
    return moved;
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
      warehouseId?: string | null;
      costCenterId?: string | null;
      enteredUnit?: string | null;
      enteredQuantity?: Prisma.Decimal | null;
      unitFactor?: Prisma.Decimal | null;
      baseUnitName?: string | null;
      batchId?: string | null;
      storageLocationId?: string | null;
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

    await this.assertSourceLocation(tx, input);

    await tx.stockMovement.create({
      data: {
        companyId: input.companyId,
        branchId: input.branchId,
        warehouseId: input.warehouseId ?? null,
        costCenterId: input.costCenterId ?? null,
        itemId: input.itemId,
        movementDate: input.date,
        direction: input.direction,
        quantity: input.quantity,
        ...movementUnitSnapshot({
          enteredUnit: input.enteredUnit,
          enteredQuantity: input.enteredQuantity,
          unitFactor: input.unitFactor,
          baseUnitName: input.baseUnitName ?? 'unit',
          baseQuantity: input.quantity,
        }),
        unitCost: input.unitCost,
        totalCost: input.totalCost,
        batchId: input.batchId ?? null,
        storageLocationId: input.storageLocationId ?? null,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        referenceNumber: input.referenceNumber,
        createdBy: input.userId,
      },
    });

    // Both books in one place: the shelf the document names, and the branch
    // roll-up the reports read. When the ledger is not wired (a narrow
    // harness, or a caller that already moved the balances) the movement row
    // that was just written stays the single source of truth.
    const ledger = this.ledger as unknown as Partial<StockLedgerService> | undefined;
    if (typeof ledger?.post === 'function') {
      await ledger.post(
        tx,
        {
          companyId: input.companyId,
          branchId: input.branchId,
          warehouseId: input.warehouseId ?? null,
          itemId: input.itemId,
          quantity: input.direction === StockDirection.IN ? input.quantity : input.quantity.negated(),
          value: input.direction === StockDirection.IN ? input.totalCost : input.totalCost.negated(),
        },
        // The guard above already refused an OUT beyond what is held; a reversal
        // path may still need to undo a movement whose shelf has been emptied.
        { allowNegative: !input.requireStock },
      );
    }
  }

  /// Corrects only the shelves of a draft document: the source shelf and, on
  /// a transfer, the receiving shelf. Quantities, units, lots, numbers and
  /// permissions are untouched. A key left out keeps its stored value; null
  /// clears it. Refused once the document is reviewed or approved, because the
  /// approval was given for the document as it was.
  async updateDraftLocations(
    companyId: string,
    userId: string,
    id: string,
    body: {
      expectedVersion?: unknown;
      lines?: Array<{
        lineNumber?: number;
        storageLocationId?: string | null;
        toStorageLocationId?: string | null;
        batchId?: string | null;
        splits?: Array<{ batchId?: string | null; quantity?: unknown; storageLocationId?: string | null; toStorageLocationId?: string | null }>;
      }>;
    },
    mayReadCost = true,
  ) {
    const bad = (code: string, ar: string, en: string, extra: Record<string, string> = {}) =>
      new BadRequestException({ code, message: `${ar} / ${en}`, errors: extra });
    if (!Number.isSafeInteger(body?.expectedVersion)) {
      throw bad('STOCK_DOC_VERSION_REQUIRED', 'أرسل رقم نسخة المستند الذي فتحته. بياناتك محفوظة.', 'Send the version of the document you opened. Your data is kept.');
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      throw bad('STOCK_DOC_LOCATIONS_EMPTY', 'لم تُرسل أي أسطر لتصحيح مواقعها.', 'No lines were sent to correct.');
    }
    await this.prisma.$transaction(async (tx) => {
      const document = await tx.stockDocument.findFirst({
        where: { id, companyId, deletedAt: null },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      if (!document) throw new NotFoundException('Stock document not found');
      if (document.status !== InvoiceStatus.DRAFT) {
        throw bad('STOCK_DOC_NOT_DRAFT', 'لا يمكن تعديل مواقع مستند تم ترحيله. استخدم العكس ثم أنشئ مستندًا جديدًا.', 'The locations of a posted document cannot be edited. Reverse it and create a new one.');
      }
      if (document.approvedAt || document.reviewedAt) {
        throw bad('STOCK_DOC_APPROVED', 'المستند تمت مراجعته أو اعتماده، فلا تُعدَّل مواقعه دون إعادة المراجعة. أعد المستند للمسودة أو أنشئ بدلًا منه.', 'This document was reviewed or approved, so its locations cannot change without a new review. Send it back to draft or create a replacement.');
      }
      const isTransfer = document.kind === StockDocumentKind.TRANSFER;
      const claimed = await tx.stockDocument.updateMany({
        where: { id, companyId, status: InvoiceStatus.DRAFT, editVersion: body.expectedVersion as number },
        data: { editVersion: { increment: 1 } },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          code: 'STOCK_DOC_VERSION_CHANGED',
          message: 'تغير المستند بعد أن فتحته. أعد تحميله ثم أعد التصحيح؛ لم يُحفظ شيء. / The document changed after you opened it. Reload it and correct again; nothing was saved.',
        });
      }
      const locationModel = (tx as { storageLocation?: typeof this.prisma.storageLocation }).storageLocation ?? this.prisma.storageLocation;
      const sourceWarehouse = isTransfer ? document.fromWarehouseId : document.toWarehouseId;
      const seen = new Set<number>();
      // One allocator for the whole request: every split in this PUT draws its
      // new line numbers from here, so two split rows can never collide.
      let nextFreeLine = Math.max(0, ...document.lines.map((l) => l.lineNumber)) + 1;
      for (const change of body.lines!) {
        const line = document.lines.find((l) => l.lineNumber === Number(change.lineNumber));
        if (!line || seen.has(line.lineNumber)) {
          throw bad('STOCK_DOC_LINE_UNKNOWN', `السطر ${String(change.lineNumber)} غير موجود في المستند أو مكرر.`, `Line ${String(change.lineNumber)} is not in this document or is repeated.`, { lineNumber: String(change.lineNumber).slice(0, 12) });
        }
        seen.add(line.lineNumber);
        const data: Record<string, unknown> = {};
        const lineErr = (code: string, ar: string, en: string) =>
          bad(code, `السطر ${line.lineNumber}: ${ar} لم يُحفظ شيء وبياناتك كما أدخلتها.`, `Line ${line.lineNumber}: ${en} Nothing was saved; your input is as you entered it.`, { lineNumber: String(line.lineNumber) });
        const checkLot = async (batchId: string, need: Prisma.Decimal) => {
          if (!isTransfer) {
            throw lineErr('STOCK_DOC_LOT_TRANSFER_ONLY', 'اختيار الدفعة وتقسيم الكمية متاحان لمستند التحويل فقط.', 'Choosing a lot and splitting the quantity are available on a transfer only.');
          }
          const lot = await tx.itemBatch.findFirst({
            where: { id: String(batchId), companyId, itemId: line.itemId, warehouseId: document.fromWarehouseId ?? undefined, deletedAt: null },
            select: { id: true, batchNumber: true, remainingQuantity: true, status: true },
          });
          if (!lot) {
            throw lineErr('STOCK_DOC_LOT_INVALID', 'الدفعة ليست دفعة هذا الصنف في المخزن المحوَّل منه أو محذوفة. اختر دفعة من قائمة دفعات الصنف في ذلك المخزن.', 'the lot is not a lot of this item in the source warehouse, or was deleted. Pick a lot from this item\'s lots in that warehouse.');
          }
          if (lot.status === 'WRITTEN_OFF') {
            throw lineErr('STOCK_DOC_LOT_INVALID', `الدفعة ${lot.batchNumber} مشطوبة ولا يمكن تحويلها. اختر دفعة أخرى.`, `lot ${lot.batchNumber} is written off and cannot be transferred. Pick another lot.`);
          }
          if (lot.remainingQuantity.lessThan(need)) {
            throw lineErr('STOCK_DOC_LOT_SHORT', `الدفعة ${lot.batchNumber} تحمل ${lot.remainingQuantity.toFixed(MONEY_SCALE)} فقط والمطلوب ${need.toFixed(MONEY_SCALE)}. خفّض الكمية أو وزّعها على دفعة أخرى.`, `lot ${lot.batchNumber} holds only ${lot.remainingQuantity.toFixed(MONEY_SCALE)} but ${need.toFixed(MONEY_SCALE)} is needed. Lower the quantity or put the rest on another lot.`);
          }
        };
        const checkShelf = async (id: string | null | undefined, which: 'from' | 'to') => {
          if (!id) return null;
          const warehouseId = which === 'from' ? document.fromWarehouseId : document.toWarehouseId;
          const found = await locationModel.findFirst({
            where: { id: String(id), companyId, warehouseId: warehouseId ?? undefined, deletedAt: null, ...(which === 'to' ? { isActive: true } : {}) },
            select: { id: true },
          });
          if (!found) {
            throw lineErr(which === 'from' ? 'STOCK_DOC_LOCATION_INVALID' : 'STOCK_DOC_TARGET_LOCATION_INVALID', which === 'from' ? 'موقع المصدر ليس في المخزن المحوَّل منه. اختر موقعًا من نفس المخزن.' : 'موقع الاستلام يجب أن يكون نشطًا في المخزن المحوَّل إليه.', which === 'from' ? 'the source location is not in the source warehouse or was deleted. Pick a location of that warehouse.' : 'the receiving location must be an active location of the receiving warehouse.');
          }
          return found.id;
        };
        if (change.splits !== undefined) {
          if (!isTransfer) {
            throw lineErr('STOCK_DOC_LOT_TRANSFER_ONLY', 'تقسيم الكمية متاح لمستند التحويل فقط.', 'Splitting the quantity is available on a transfer only.');
          }
          const parts = change.splits;
          if (!Array.isArray(parts) || parts.length < 2 || parts.length > 20) {
            throw lineErr('STOCK_DOC_SPLIT_INVALID', 'أرسل من 2 إلى 20 جزءًا للتقسيم، لكل جزء دفعة وكمية.', 'send 2 to 20 parts to split, each with a lot and a quantity.');
          }
          // Part quantities are in the line's ENTERED unit when it has one
          // (unitName/unitQuantity/unitFactor), otherwise in base units. The
          // base quantity of each part is the entered quantity times the
          // frozen unit factor; the last part takes the exact remainder.
          const entered = line.unitFactor != null && line.unitQuantity != null;
          const enteredQty = parts.map((part) => this.decimal(part?.quantity, `splits.quantity (line ${line.lineNumber})`));
          if (enteredQty.some((q) => q.lessThanOrEqualTo(0))) {
            throw lineErr('STOCK_DOC_SPLIT_INVALID', 'كل جزء يجب أن تكون كميته أكبر من صفر.', 'every part needs a quantity above zero.');
          }
          const totalEntered = enteredQty.reduce((sum, q) => sum.plus(q), new Prisma.Decimal(0));
          const expectedTotal = entered ? (line.unitQuantity as Prisma.Decimal) : line.quantity;
          if (!totalEntered.equals(expectedTotal)) {
            throw lineErr('STOCK_DOC_SPLIT_TOTAL', `مجموع الأجزاء ${totalEntered.toFixed(MONEY_SCALE)} لا يساوي كمية السطر ${expectedTotal.toFixed(MONEY_SCALE)}${entered ? ` ${line.unitName ?? ''}` : ''}. عدّل الكميات حتى يتساوى المجموع.`, `the parts add up to ${totalEntered.toFixed(MONEY_SCALE)} but the line quantity is ${expectedTotal.toFixed(MONEY_SCALE)}${entered ? ` ${line.unitName ?? ''}` : ''}. Change the quantities so they add up exactly.`);
          }
          const quantities: Prisma.Decimal[] = [];
          let baseUsed = new Prisma.Decimal(0);
          for (let i = 0; i < enteredQty.length; i += 1) {
            const base = i === enteredQty.length - 1
              ? line.quantity.minus(baseUsed)
              : (entered ? enteredQty[i].mul(line.unitFactor as Prisma.Decimal).toDecimalPlaces(MONEY_SCALE) : enteredQty[i]);
            if (base.lessThanOrEqualTo(0)) {
              throw lineErr('STOCK_DOC_SPLIT_INVALID', 'كمية أحد الأجزاء بعد التحويل للوحدة الأساسية صفر أو سالبة. غيّر التوزيع.', 'a part rounds to zero or less in base units. Change the distribution.');
            }
            quantities.push(base);
            baseUsed = baseUsed.plus(base);
          }
          const perLot = new Map<string, Prisma.Decimal>();
          for (let i = 0; i < parts.length; i += 1) {
            if (!parts[i]?.batchId) {
              throw lineErr('STOCK_DOC_SPLIT_INVALID', `الجزء ${i + 1} بلا دفعة. اختر دفعة لكل جزء.`, `part ${i + 1} has no lot. Pick a lot for every part.`);
            }
            const key = String(parts[i].batchId);
            perLot.set(key, (perLot.get(key) ?? new Prisma.Decimal(0)).plus(quantities[i]));
          }
          for (const [lotId, need] of perLot) await checkLot(lotId, need);
          let unitUsed = new Prisma.Decimal(0);
          let costUsed = new Prisma.Decimal(0);
          const created: number[] = [];
          for (let i = 0; i < parts.length; i += 1) {
            const last = i === parts.length - 1;
            const q = quantities[i];
            const unitQuantity = entered ? enteredQty[i] : null;
            const totalCost = last ? line.totalCost.minus(costUsed) : q.mul(line.unitCost).toDecimalPlaces(MONEY_SCALE);
            if (unitQuantity) unitUsed = unitUsed.plus(unitQuantity);
            costUsed = costUsed.plus(totalCost);
            const fields = {
              quantity: q,
              unitQuantity,
              totalCost,
              batchId: String(parts[i].batchId),
              storageLocationId: parts[i].storageLocationId === undefined ? line.storageLocationId : await checkShelf(parts[i].storageLocationId, 'from'),
              toStorageLocationId: parts[i].toStorageLocationId === undefined ? (line as { toStorageLocationId?: string | null }).toStorageLocationId ?? null : await checkShelf(parts[i].toStorageLocationId, 'to'),
            };
            if (i === 0) {
              await tx.stockDocumentLine.update({ where: { id: line.id }, data: fields as never });
            } else {
              await tx.stockDocumentLine.create({
                data: {
                  ...fields,
                  documentId: id,
                  itemId: line.itemId,
                  unitCost: line.unitCost,
                  notes: line.notes,
                  unitName: line.unitName,
                  unitFactor: line.unitFactor,
                  lineNumber: nextFreeLine,
                } as never,
              });
              created.push(nextFreeLine);
              nextFreeLine += 1;
            }
          }
          continue;
        }
        if (change.batchId !== undefined) {
          if (change.batchId === null) data.batchId = null;
          else {
            await checkLot(String(change.batchId), line.quantity);
            data.batchId = String(change.batchId);
          }
        }
        if (change.storageLocationId !== undefined) {
          if (change.storageLocationId === null) data.storageLocationId = null;
          else {
            const found = await locationModel.findFirst({
              where: { id: String(change.storageLocationId), companyId, warehouseId: sourceWarehouse ?? undefined, deletedAt: null, ...(isTransfer || document.kind === StockDocumentKind.WRITE_OFF || ((document.kind === StockDocumentKind.ADJUSTMENT || document.kind === StockDocumentKind.COUNT) && line.quantity.lessThan(0)) ? {} : { isActive: true }) },
              select: { id: true },
            });
            if (!found) {
              throw bad('STOCK_DOC_LOCATION_INVALID', `السطر ${line.lineNumber}: الموقع ليس في ${isTransfer ? 'المخزن المحوَّل منه' : 'مخزن المستند'}. اختر موقعًا من نفس المخزن.`, `Line ${line.lineNumber}: the location is not in the ${isTransfer ? 'source warehouse' : 'document warehouse'}, was deleted, or is switched off for receiving goods. Pick an active location of that warehouse.`, { lineNumber: String(line.lineNumber) });
            }
            data.storageLocationId = found.id;
          }
        }
        if (change.toStorageLocationId !== undefined) {
          if (change.toStorageLocationId === null) data.toStorageLocationId = null;
          else {
            const found = isTransfer && document.toWarehouseId
              ? await locationModel.findFirst({
                  where: { id: String(change.toStorageLocationId), companyId, warehouseId: document.toWarehouseId, deletedAt: null, isActive: true },
                  select: { id: true },
                })
              : null;
            if (!found) {
              throw bad('STOCK_DOC_TARGET_LOCATION_INVALID', `السطر ${line.lineNumber}: موقع الاستلام يجب أن يكون في المخزن المحوَّل إليه وفي مستند تحويل فقط. اتركه فارغًا ليصل الصنف بلا موقع.`, `Line ${line.lineNumber}: the receiving location must be an active location of the receiving warehouse, on a transfer only. Leave it empty so the goods arrive unlocated.`, { lineNumber: String(line.lineNumber) });
            }
            data.toStorageLocationId = found.id;
          }
        }
        if (Object.keys(data).length) {
          await tx.stockDocumentLine.update({ where: { id: line.id }, data: data as never });
        }
      }
      await this.auditInTx(tx, { companyId, userId, action: 'UPDATE', entity: 'stock_documents', entityId: id });
    });
    return this.findOne(companyId, id, mayReadCost);
  }

  /// A write-off or a transfer out takes from a named shelf. Located stock
  /// may not leave without one; a named shelf must hold the quantity. An item
  /// with no located stock keeps the old behaviour.
  private async assertSourceLocation(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      itemId: string;
      direction: StockDirection;
      quantity: Prisma.Decimal;
      referenceType: string;
      referenceNumber: string;
      warehouseId?: string | null;
      batchId?: string | null;
      storageLocationId?: string | null;
    },
  ) {
    if (input.direction !== StockDirection.OUT || !input.warehouseId) return;
    if (input.referenceType !== 'STOCK_WRITE_OFF' && input.referenceType !== 'STOCK_TRANSFER_OUT') return;
    const rows = await tx.$queryRaw<Array<{ id: string; code: string; quantity: Prisma.Decimal }>>(Prisma.sql`
      SELECT l."id" AS "id", l."code" AS "code",
             SUM(CASE WHEN m."direction" = 'IN' THEN m."quantity" ELSE -m."quantity" END) AS "quantity"
        FROM "stock_movements" m
        JOIN "storage_locations" l ON l."id" = m."storageLocationId"
       WHERE m."companyId" = ${input.companyId}::uuid
         AND m."warehouseId" = ${input.warehouseId}::uuid
         AND m."itemId" = ${input.itemId}::uuid
         ${input.batchId ? Prisma.sql`AND m."batchId" = ${input.batchId}::uuid` : Prisma.empty}
       GROUP BY l."id", l."code"
       HAVING SUM(CASE WHEN m."direction" = 'IN' THEN m."quantity" ELSE -m."quantity" END) > 0
       ORDER BY l."code"
    `);
    if (!input.storageLocationId) {
      if (!rows.length) return;
      const list = rows.map((r) => `${r.code}: ${new Prisma.Decimal(r.quantity).toFixed(MONEY_SCALE)}`);
      throw new BadRequestException({
        code: 'STOCK_DOC_LOCATION_REQUIRED',
        message:
          `المستند ${input.referenceNumber}: الصنف له رصيد موزع على مواقع (${list.join('، ')}). اختر الموقع الذي يخرج منه الصنف في هذا السطر ثم رحّل من جديد؛ بياناتك محفوظة ولم يتغير أي رصيد. / ` +
          `Document ${input.referenceNumber}: the item is stored on locations (${list.join(', ')}). Choose the location this line takes from, then post again. Your data is kept and no balance changed.`,
        errors: { locations: rows.map((r) => ({ locationId: r.id, code: r.code, quantity: new Prisma.Decimal(r.quantity).toFixed(MONEY_SCALE) })) },
      });
    }
    const held = rows.find((r) => r.id === input.storageLocationId);
    const have = held ? new Prisma.Decimal(held.quantity) : new Prisma.Decimal(0);
    if (have.lessThan(input.quantity)) {
      const list = rows.map((r) => `${r.code}: ${new Prisma.Decimal(r.quantity).toFixed(MONEY_SCALE)}`);
      throw new BadRequestException({
        code: 'STOCK_DOC_SHELF_SHORT',
        message:
          `المستند ${input.referenceNumber}: الموقع المختار يحتوي ${have.toFixed(MONEY_SCALE)} فقط والمطلوب ${input.quantity.toFixed(MONEY_SCALE)}. ${list.length ? `المتاح: ${list.join('، ')}. ` : ''}خفّض الكمية أو اختر موقعًا آخر أو وزّعها على عدة أسطر ثم رحّل من جديد؛ بياناتك محفوظة. / ` +
          `Document ${input.referenceNumber}: the chosen location holds only ${have.toFixed(MONEY_SCALE)} but ${input.quantity.toFixed(MONEY_SCALE)} is needed. ${list.length ? `Available: ${list.join(', ')}. ` : ''}Lower the quantity, pick another location, or split it over several lines, then post again. Your data is kept.`,
        errors: { locationId: input.storageLocationId, requested: input.quantity.toFixed(MONEY_SCALE), available: have.toFixed(MONEY_SCALE) },
      });
    }
  }

  /// Audit write inside the caller's transaction when the audit service
  /// supports it; otherwise fall back to the standalone record.
  private async auditInTx(tx: Prisma.TransactionClient, input: Parameters<AuditService['recordRequired']>[0]) {
    const audit = this.audit as unknown as { recordRequired?: (i: unknown, t: unknown) => Promise<void>; record: (i: unknown) => Promise<void> };
    if (typeof audit.recordRequired === 'function') return audit.recordRequired(input, tx);
    return audit.record(input);
  }

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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
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
    reviewedAt?: Date | null;
    reviewedBy?: string | null;
    approvedAt?: Date | null;
    approvedBy?: string | null;
    approvedByName?: string | null;
    fromWarehouseId?: string | null;
    toWarehouseId?: string | null;
    createdBy?: string | null;
    postedBy?: string | null;
    fromWarehouse?: { id: string; code: string; nameEn: string; nameAr: string } | null;
    toWarehouse?: { id: string; code: string; nameEn: string; nameAr: string } | null;
    createdByName?: string | null;
    postedByName?: string | null;
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
      reviewedAt: document.reviewedAt?.toISOString() ?? null,
      reviewedBy: document.reviewedBy ?? null,
      // Where the goods left and where they arrived. Null means the branch
      // default, which is what the posting used.
      fromWarehouseId: document.fromWarehouseId ?? null,
      toWarehouseId: document.toWarehouseId ?? null,
      fromWarehouse: document.fromWarehouse ?? null,
      toWarehouse: document.toWarehouse ?? null,
      createdById: document.createdBy ?? null,
      createdByName: document.createdByName ?? null,
      postedById: document.postedBy ?? null,
      postedByName: document.postedByName ?? null,
      branch: document.branch,
      costCenterId: document.costCenterId ?? null,
      costCenter: document.costCenter ?? null,
      journalEntryId: document.journalEntryId,
      postedAt: document.postedAt?.toISOString() ?? null,
      // Who signed the loss or the count, and when.
      approvedAt: document.approvedAt?.toISOString() ?? null,
      approvedById: document.approvedBy ?? null,
      approvedByName: document.approvedByName ?? null,
      createdAt: document.createdAt.toISOString(),
    };
  }
}

/// The branch a voucher belongs to, for scoping reads back to the caller.
function voucherBranchIdOf(branchId: string | null): string | null | undefined {
  return branchId === null ? null : branchId;
}
