import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceDocumentType,
  InvoiceStatus,
  Prisma,
  StockDirection,
} from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WarehouseService } from '../../common/warehouse/warehouse.service';
import { exactBaseQuantity, parseDocumentQuantity } from '../../common/units/unit-math';
import { AccountMapService } from '../accounting/account-map.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { attributedLines } from '../accounting/cost-center-attribution';
import { PostingService } from '../accounting/posting.service';
import { addToLotCost, boundCoverageMissing, legacyIdentityAmbiguous, legacyIdentityError, receiptFor, receiptLotMovements, refreshLotPrimaryLocation, removeFromLotCost } from '../inventory/lot-primary-location';

const MONEY_SCALE = 4;

export interface ReturnLineInput {
  originalLineId: string;
  /** Quantity in the ORIGINAL document's unit for that line. */
  quantity: string | number;
  /** Optional: defaults to the price on the original line. */
  unitPrice?: string | number;
  /**
   * Optional confirmation of the unit being returned. A return follows the
   * original invoice, so this must match the unit stored on its line.
   */
  unitName?: string;
  unitId?: string;
}

/**
 * Returns, in both directions.
 *
 * A return is its own document - a credit note against a sale, a debit note
 * against a purchase - and it names the invoice it returns. It is never a
 * negative copy of that invoice, because then neither document would be
 * readable on its own and the stock ledger would have to guess which way the
 * goods went.
 *
 * The rules that matter:
 *   * you cannot return more than what was sold or bought, counting every
 *     earlier return against the same line (enforced with a lock, so two
 *     people returning the same goods at once cannot both succeed);
 *   * returned stock re-enters the ledger at exactly the cost it left at, not
 *     at today's average;
 *   * the accounting is written in the same transaction as the stock.
 */
@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: DocumentNumberService,
    private readonly posting: PostingService,
    private readonly accounts: AccountMapService,
    private readonly audit: AuditService,
    private readonly warehouses: WarehouseService,
  ) {}

  async findAll(
    companyId: string,
    side: 'sales' | 'purchases',
    query: { from?: string; to?: string; page?: number; pageSize?: number } = {},
    mayReadCost = true,
    branchScope: string[] | null = null,
  ) {
    const bw = branchScope ? { branchId: { in: branchScope } } : {};
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);
    const dateFilter =
      query.from || query.to
        ? {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          }
        : undefined;

    if (side === 'sales') {
      const where: Prisma.SalesInvoiceWhereInput = {
        companyId,
        deletedAt: null,
        documentType: InvoiceDocumentType.CREDIT_NOTE,
        ...bw,
        ...(dateFilter ? { invoiceDate: dateFilter } : {}),
      };
      const [items, total] = await this.prisma.$transaction([
        this.prisma.salesInvoice.findMany({
          where,
          orderBy: [{ invoiceDate: 'desc' }, { invoiceNumber: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            customer: { select: { code: true, nameEn: true, nameAr: true } },
            originalInvoice: { select: { invoiceNumber: true } },
          },
        }),
        this.prisma.salesInvoice.count({ where }),
      ]);
      return {
        items: items.map((invoice) => this.toSummary(invoice, mayReadCost)),
        total,
        page,
        pageSize,
      };
    }

    const where: Prisma.PurchaseInvoiceWhereInput = {
      companyId,
      deletedAt: null,
      documentType: InvoiceDocumentType.DEBIT_NOTE,
      ...bw,
      ...(dateFilter ? { invoiceDate: dateFilter } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.purchaseInvoice.findMany({
        where,
        orderBy: [{ invoiceDate: 'desc' }, { invoiceNumber: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          supplier: { select: { code: true, nameEn: true, nameAr: true } },
          originalInvoice: { select: { invoiceNumber: true } },
        },
      }),
      this.prisma.purchaseInvoice.count({ where }),
    ]);
    return { items: items.map((invoice) => this.toSummary(invoice, mayReadCost)), total, page, pageSize };
  }

  async findOne(
    companyId: string,
    side: 'sales' | 'purchases',
    id: string,
    mayReadCost = true,
    branchScope: string[] | null = null,
  ) {
    const bw = branchScope ? { branchId: { in: branchScope } } : {};
    if (side === 'sales') {
      const invoice = await this.prisma.salesInvoice.findFirst({
        where: { id, companyId, deletedAt: null, documentType: InvoiceDocumentType.CREDIT_NOTE, ...bw },
        include: {
          customer: { select: { id: true, code: true, nameEn: true, nameAr: true } },
          originalInvoice: { select: { id: true, invoiceNumber: true, invoiceDate: true } },
          lines: { orderBy: { lineNumber: 'asc' }, include: { item: { select: { code: true, nameEn: true, nameAr: true, unit: true } } } },
        },
      });
      if (!invoice) throw new NotFoundException('Return document not found');
      return {
        ...this.toSummary(invoice, mayReadCost),
        journalEntryId: invoice.journalEntryId,
        postedAt: invoice.postedAt?.toISOString() ?? null,
        lines: invoice.lines.map((line) => ({
          id: line.id,
          lineNumber: line.lineNumber,
          itemId: line.itemId,
          itemCode: line.item?.code ?? null,
          itemNameEn: line.item?.nameEn ?? null,
          itemNameAr: line.item?.nameAr ?? null,
          unit: line.unitName ?? line.item?.unit ?? null,
          unitName: line.unitName ?? null,
          unitFactor:
            line.unitFactor === null || line.unitFactor === undefined
              ? null
              : line.unitFactor.toFixed(6),
          unitQuantity: (line.unitQuantity ?? line.quantity).toFixed(MONEY_SCALE),
          description: line.description,
          isAdditionalCharge: line.isAdditionalCharge,
          quantity: line.quantity.toFixed(MONEY_SCALE),
          baseQuantity: line.quantity.toFixed(MONEY_SCALE),
          unitPrice: line.unitPrice.toFixed(MONEY_SCALE),
          taxRate: line.taxRate.toFixed(MONEY_SCALE),
          taxAmount: line.taxAmount.toFixed(MONEY_SCALE),
          lineTotal: line.lineTotal.toFixed(MONEY_SCALE),
          // Cost snapshots are gated by inventory.cost.read, exactly as on
          // the sales invoice these goods came from.
          unitCost: mayReadCost ? line.unitCost.toFixed(MONEY_SCALE) : null,
          costTotal: mayReadCost ? line.costTotal.toFixed(MONEY_SCALE) : null,
          costCenterId: line.costCenterId ?? null,
        })),
      };
    }

    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id, companyId, deletedAt: null, documentType: InvoiceDocumentType.DEBIT_NOTE, ...bw },
      include: {
        supplier: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        originalInvoice: { select: { id: true, invoiceNumber: true, invoiceDate: true } },
        lines: { orderBy: { lineNumber: 'asc' }, include: { item: { select: { code: true, nameEn: true, nameAr: true, unit: true } } } },
      },
    });
    if (!invoice) throw new NotFoundException('Return document not found');
    return {
      ...this.toSummary(invoice, mayReadCost),
      journalEntryId: invoice.journalEntryId,
      postedAt: invoice.postedAt?.toISOString() ?? null,
      lines: invoice.lines.map((line) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        itemId: line.itemId,
        itemCode: line.item?.code ?? null,
        itemNameEn: line.item?.nameEn ?? null,
          itemNameAr: line.item?.nameAr ?? null,
          unit: line.unitName ?? line.item?.unit ?? null,
          unitName: line.unitName ?? null,
          unitFactor:
            line.unitFactor === null || line.unitFactor === undefined
              ? null
              : line.unitFactor.toFixed(6),
          unitQuantity: (line.unitQuantity ?? line.quantity).toFixed(MONEY_SCALE),
          description: line.description,
          quantity: line.quantity.toFixed(MONEY_SCALE),
          baseQuantity: line.quantity.toFixed(MONEY_SCALE),
          unitPrice: line.unitPrice.toFixed(MONEY_SCALE),
          netUnitPrice: line.quantity.isZero()
            ? line.unitPrice.toFixed(MONEY_SCALE)
            : line.lineTotal.div(line.quantity).toDecimalPlaces(MONEY_SCALE).toFixed(MONEY_SCALE),
        taxRate: line.taxRate.toFixed(MONEY_SCALE),
        taxAmount: line.taxAmount.toFixed(MONEY_SCALE),
        lineTotal: line.lineTotal.toFixed(MONEY_SCALE),
        // Landed/inventory cost components are cost-side figures. The line's
        // own unit price (the document's transaction amount) stays visible.
        landedCostAmount: mayReadCost
          ? line.landedCostAmount.toFixed(MONEY_SCALE)
          : null,
        inventoryCostTotal: mayReadCost
          ? line.inventoryCostTotal.toFixed(MONEY_SCALE)
          : null,
      })),
    };
  }

  // ------------------------------------------------------------ sales return

  async createSalesReturn(
    companyId: string,
    branchId: string | null,
    userId: string,
    dto: {
      originalInvoiceId: string;
      returnDate: string;
      reason?: string;
      notes?: string;
      lines: ReturnLineInput[];
    },
    mayReadCost = true,
  ) {
    if (!branchId) {
      throw new BadRequestException('The signed-in user is not assigned to a branch');
    }
    // An absent id is not a wildcard: Prisma reads `undefined` as "no filter",
    // so leaving it out used to select an arbitrary invoice. The request must
    // name the document it is returning.
    const originalInvoiceId = this.requiredId(dto.originalInvoiceId, 'originalInvoiceId');
    const original = await this.prisma.salesInvoice.findFirst({
      where: { id: originalInvoiceId, companyId, deletedAt: null },
      include: { lines: { orderBy: { lineNumber: 'asc' }, include: { item: { select: { unit: true } } } } },
    });
    if (!original) throw new BadRequestException('The original sales invoice does not exist');
    if (original.status !== InvoiceStatus.POSTED) {
      throw new BadRequestException('Only a posted sales invoice can be returned');
    }
    if (original.documentType !== InvoiceDocumentType.INVOICE) {
      throw new BadRequestException('A return document cannot itself be returned');
    }
    if (original.branchId !== branchId) {
      throw new BadRequestException('A return must be recorded in the branch that issued the original invoice');
    }
    if (!Array.isArray(dto.lines) || dto.lines.length === 0) {
      throw new BadRequestException('A return needs at least one line');
    }

    const date = this.date(dto.returnDate, 'returnDate');
    if (date < original.invoiceDate) {
      throw new BadRequestException('The return date cannot be before the invoice date');
    }

    const prepared: Array<{
      originalLineId: string;
      itemId: string | null;
      isAdditionalCharge: boolean;
      description: string;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      taxRate: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
      unitCost?: Prisma.Decimal;
      costTotal?: Prisma.Decimal;
      unitName: string | null;
      unitFactor: Prisma.Decimal | null;
      unitQuantity: Prisma.Decimal | null;
    }> = [];
    const seenOriginalLineIds = new Set<string>();
    for (const [index, raw] of dto.lines.entries()) {
      const originalLineId = this.requiredId(
        raw.originalLineId,
        `Line ${index + 1} originalLineId`,
      );
      const originalLine = original.lines.find((line) => line.id === originalLineId);
      if (!originalLine) {
        throw new BadRequestException(`Line ${index + 1}: that line does not belong to the invoice`);
      }
      if (seenOriginalLineIds.has(originalLine.id)) {
        throw new BadRequestException(`Line ${index + 1}: an invoice line may appear only once in a return`);
      }
      seenOriginalLineIds.add(originalLine.id);
      // The return follows the original document's unit. The entered quantity
      // is converted into the base quantity the existing return/limit math and
      // the stock ledger already work in.
      const unit = this.resolveReturnUnit(`Line ${index + 1}`, originalLine, raw);
      const remaining = originalLine.quantity.minus(originalLine.returnedQuantity);
      const quantity = unit.baseQuantity;
      if (quantity.greaterThan(remaining)) {
        throw new BadRequestException(
          `Line ${index + 1}: ${remaining.toFixed(MONEY_SCALE)} of ${originalLine.description} ` +
            `is still returnable, ${quantity.toFixed(MONEY_SCALE)} was requested.`,
        );
      }

      const unitPrice =
        raw.unitPrice === undefined
          ? originalLine.unitPrice
          : this.nonNegative(raw.unitPrice, `Line ${index + 1} unit price`);
      const lineTotal = this.allocateReturnedCost(
        originalLine.lineTotal,
        originalLine.returnedSubTotal,
        originalLine.quantity,
        originalLine.returnedQuantity,
        quantity,
        `Line ${index + 1} net value`,
      );
      // The money credited is the line total above, which is already net of
      // the line and document discounts the customer received. A caller may
      // describe the price it saw either way: the catalogue unit price from
      // the invoice, or the discounted price actually paid per unit. Neither
      // changes the amount: the stored document keeps the invoice price and
      // the discounted value lives in lineTotal.
      const netUnitPrice = lineTotal.div(quantity).toDecimalPlaces(MONEY_SCALE);
      if (
        !unitPrice.equals(originalLine.unitPrice) &&
        !unitPrice.equals(netUnitPrice)
      ) {
        throw new BadRequestException(
          `Line ${index + 1}: a sales return uses the original invoice unit price ` +
            `(${originalLine.unitPrice.toFixed(MONEY_SCALE)}) or the discounted price actually paid ` +
            `(${netUnitPrice.toFixed(MONEY_SCALE)})`,
        );
      }
      const taxAmount = this.allocateReturnedCost(
        originalLine.taxAmount,
        originalLine.returnedTaxTotal,
        originalLine.quantity,
        originalLine.returnedQuantity,
        quantity,
        `Line ${index + 1} tax`,
      );

      const costTotal = this.allocateReturnedCost(
        originalLine.costTotal,
        originalLine.returnedCostTotal,
        originalLine.quantity,
        originalLine.returnedQuantity,
        quantity,
        `Line ${index + 1}`,
      );
      prepared.push({
        originalLineId: originalLine.id,
        itemId: originalLine.itemId,
        isAdditionalCharge: originalLine.isAdditionalCharge,
        description: originalLine.description,
        quantity,
        unitPrice,
        taxRate: originalLine.taxRate,
        taxAmount,
        lineTotal,
        // Estimate the exact original cost now; posting rechecks and settles
        // the rounding remainder under the original-line lock.
        unitCost: costTotal.div(quantity).toDecimalPlaces(MONEY_SCALE),
        costTotal,
        unitName: unit.unitName,
        unitFactor: unit.unitFactor,
        unitQuantity: unit.unitQuantity,
      });
    }

    const subTotal = prepared.reduce((sum, line) => sum.plus(line.lineTotal), new Prisma.Decimal(0));
    const taxAmount = prepared.reduce((sum, line) => sum.plus(line.taxAmount), new Prisma.Decimal(0));

    const created = await this.prisma.$transaction(async (tx) => {
      const invoiceNumber = await this.numbers.next(tx, companyId, 'SALES_RETURN', 'SR');
      return tx.salesInvoice.create({
        data: {
          companyId,
          branchId,
          invoiceNumber,
          invoiceDate: date,
          customerId: original.customerId,
          warehouseId: original.warehouseId,
          status: InvoiceStatus.DRAFT,
          currency: original.currency,
          documentType: InvoiceDocumentType.CREDIT_NOTE,
          originalInvoiceId: original.id,
          returnReason: dto.reason?.trim() || null,
          subTotal,
          taxAmount,
          totalAmount: subTotal.plus(taxAmount),
          costOfGoods: prepared.reduce(
            (sum, line) => sum.plus(line.costTotal ?? new Prisma.Decimal(0)),
            new Prisma.Decimal(0),
          ),
          notes: dto.notes?.trim() || null,
          createdBy: userId,
          lines: {
            create: prepared.map((line, index) => ({
              lineNumber: index + 1,
              itemId: line.itemId,
              originalLineId: line.originalLineId,
              isAdditionalCharge: line.isAdditionalCharge,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              taxRate: line.taxRate,
              taxAmount: line.taxAmount,
              lineTotal: line.lineTotal,
              unitCost: line.unitCost ?? new Prisma.Decimal(0),
              costTotal: line.costTotal ?? new Prisma.Decimal(0),
              unitName: line.unitName,
              unitFactor: line.unitFactor,
              unitQuantity: line.unitQuantity,
            })),
          },
        },
      });
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'sales_returns',
      entityId: created.id,
      after: {
        invoiceNumber: created.invoiceNumber,
        originalInvoice: original.invoiceNumber,
        totalAmount: created.totalAmount.toFixed(MONEY_SCALE),
      },
    });

    return this.findOne(companyId, 'sales', created.id, mayReadCost);
  }

  /// Takes the shelf and lot lock of every item on a return, in one fixed
  /// order, with the same key every other stock writer uses.
  private async lockItems(tx: Prisma.TransactionClient, warehouseId: string | null, itemIds: string[]) {
    if (!warehouseId) return;
    for (const id of [...new Set(itemIds)].sort()) {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${warehouseId}:${id}`}, 0))`,
      );
    }
  }

  /// A purchase return gives goods back to the supplier from the lot and the
  /// shelf the receipt put them on, or says plainly why it cannot.
  private async takeBackFromReceipt(
    tx: Prisma.TransactionClient,
    args: {
      companyId: string;
      warehouseId: string | null;
      itemId: string;
      lineNumber: number;
      quantity: Prisma.Decimal;
      receipt: { batchNumber: string | null; storageLocationId: string | null } | null;
      /// the receipt movement (lot, cost) of the original line, when known
      receiptMovement?: { batchId: string | null; unitCost: Prisma.Decimal } | null;
    },
  ): Promise<{ lotId: string | null; shelfId: string | null }> {
    const { companyId, warehouseId, itemId, lineNumber, quantity, receipt, receiptMovement } = args;
    if (!receipt || !warehouseId) return { lotId: null, shelfId: null };
    let lotId: string | null = null;
    if (receiptMovement?.batchId || receipt.batchNumber) {
      const lot = await tx.itemBatch.findFirst({
        where: receiptMovement?.batchId
          ? { id: receiptMovement.batchId, companyId }
          : { companyId, warehouseId, itemId, batchNumber: receipt.batchNumber!, deletedAt: null },
        select: { id: true, remainingQuantity: true, batchNumber: true },
      });
      if (lot) {
        const lotName = lot.batchNumber ?? receipt.batchNumber ?? '';
        if (lot.remainingQuantity.lessThan(quantity)) {
          throw new BadRequestException({
            code: 'PURCHASE_RETURN_LOT_SHORT',
            message:
              `السطر ${lineNumber}: الدفعة ${lotName} المتبقي منها ${lot.remainingQuantity.toFixed(MONEY_SCALE)} فقط والمطلوب إرجاعه ${quantity.toFixed(MONEY_SCALE)}، فجزء منها بِيع أو نُقل. قلل الكمية المرتجعة إلى المتاح؛ بيانات المرتجع محفوظة. / ` +
              `Line ${lineNumber}: lot ${lotName} has only ${lot.remainingQuantity.toFixed(MONEY_SCALE)} left to return, not ${quantity.toFixed(MONEY_SCALE)}, because part of it was sold or moved. Reduce the returned quantity to what is left; the return data is kept.`,
            errors: { lineNumber: String(lineNumber), lot: lotName.slice(0, 60), remaining: lot.remainingQuantity.toFixed(MONEY_SCALE) },
          });
        }
        lotId = lot.id;
        if (receiptMovement?.batchId) await removeFromLotCost(tx, lot.id, quantity, new Prisma.Decimal(receiptMovement.unitCost));
      }
    }
    if (receipt.storageLocationId) {
      const rows = await tx.$queryRaw<Array<{ quantity: Prisma.Decimal | null }>>(Prisma.sql`
        SELECT SUM(CASE WHEN "direction" = 'IN' THEN "quantity" ELSE -"quantity" END) AS "quantity"
          FROM "stock_movements"
         WHERE "companyId" = ${companyId}::uuid
           AND "warehouseId" = ${warehouseId}::uuid
           AND "itemId" = ${itemId}::uuid
           AND "storageLocationId" = ${receipt.storageLocationId}::uuid
           ${lotId ? Prisma.sql`AND "batchId" = ${lotId}::uuid` : Prisma.empty}
      `);
      const have = new Prisma.Decimal(rows[0]?.quantity ?? 0);
      if (have.lessThan(quantity)) {
        throw new BadRequestException({
          code: 'PURCHASE_RETURN_SHELF_SHORT',
          message:
            `السطر ${lineNumber}: موقع الاستلام يحوي ${have.toFixed(MONEY_SCALE)} فقط والمطلوب إرجاعه ${quantity.toFixed(MONEY_SCALE)}، فالبضاعة نُقلت من موقعها. أعدها إلى موقع الاستلام بنقل مواقع ثم أعد الترحيل؛ بيانات المرتجع محفوظة. / ` +
            `Line ${lineNumber}: the receiving location holds only ${have.toFixed(MONEY_SCALE)}, not ${quantity.toFixed(MONEY_SCALE)}, because the goods were moved off it. Move them back to that location, then post again; the return data is kept.`,
          errors: { lineNumber: String(lineNumber), available: have.toFixed(MONEY_SCALE), quantity: quantity.toFixed(MONEY_SCALE) },
        });
      }
    }
    if (lotId) {
      const claimed = await tx.itemBatch.updateMany({
        where: { id: lotId, remainingQuantity: { gte: quantity } },
        data: { remainingQuantity: { decrement: quantity } },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException(
          'تغيرت الدفعة أثناء الترحيل؛ أعد المحاولة. / The lot changed while posting; try again.',
        );
      }
      await tx.itemBatch.updateMany({
        where: { id: lotId, remainingQuantity: { lte: 0 }, status: 'OPEN' },
        data: { status: 'CLOSED' },
      });
    }
    return { lotId, shelfId: receipt.storageLocationId };
  }

  /// Reverses a posted return by mirroring the movements that return itself
  /// wrote for the line: the same lot, shelf and cost, in the opposite
  /// direction. Returns false when the return has no movements bound to its
  /// line (posted before that existed); the caller then keeps its old
  /// behaviour. Nothing is written when a guard refuses.
  private async undoReturnMovements(
    tx: Prisma.TransactionClient,
    args: {
      companyId: string;
      userId: string;
      branchId: string;
      warehouseId: string | null;
      itemId: string;
      lineId: string;
      lineNumber: number;
      quantity: Prisma.Decimal;
      costTotal: Prisma.Decimal;
      document: { id: string; invoiceNumber: string | null };
      returnType: 'SALES_RETURN' | 'PURCHASE_RETURN';
    },
  ): Promise<boolean> {
    const { companyId, userId, branchId, warehouseId, itemId, lineId, lineNumber, quantity: lineQuantity, costTotal: lineCost, document, returnType } = args;
    const moves = await tx.$queryRaw<
      Array<{ batchId: string | null; storageLocationId: string | null; quantity: Prisma.Decimal; unitCost: Prisma.Decimal; totalCost: Prisma.Decimal }>
    >(Prisma.sql`
      SELECT "batchId", "storageLocationId", "quantity", "unitCost", "totalCost"
        FROM "stock_movements"
       WHERE "companyId" = ${companyId}::uuid
         AND "referenceType" = ${returnType}
         AND "referenceId" = ${document.id}::uuid
         AND "sourceLineId" = ${lineId}::uuid
         AND "itemId" = ${itemId}::uuid
       ORDER BY "createdAt" ASC
    `);
    // Movements of this return that are not tied to any line: written before
    // the line was stored on them. If they hold a lot or a shelf, nobody can
    // say whose they are, so mirroring (or the old unbatched write) would put
    // stock on the wrong lot or shelf. Refuse; nothing is written.
    const untied = await tx.$queryRaw<Array<{ n: bigint | number }>>(Prisma.sql`
      SELECT COUNT(*) AS n
        FROM "stock_movements"
       WHERE "companyId" = ${companyId}::uuid
         AND "referenceType" = ${returnType}
         AND "referenceId" = ${document.id}::uuid
         AND "itemId" = ${itemId}::uuid
         AND "sourceLineId" IS NULL
         AND ("batchId" IS NOT NULL OR "storageLocationId" IS NOT NULL)
    `);
    const covered = moves.reduce((t, m) => t.plus(new Prisma.Decimal(m.quantity)), new Prisma.Decimal(0));
    if (Number(untied[0]?.n ?? 0) > 0 || (moves.length > 0 && !covered.equals(lineQuantity))) {
      throw legacyIdentityError(`${returnType}_REVERSE_LEGACY_AMBIGUOUS`, document.invoiceNumber, lineNumber);
    }
    if (moves.length > 0) {
      const movedCost = moves.reduce((t, m) => t.plus(new Prisma.Decimal(m.totalCost)), new Prisma.Decimal(0));
      if (movedCost.minus(lineCost).abs().greaterThan(0.01)) {
        throw new BadRequestException({
          code: 'RETURN_REVERSE_COST_MISMATCH',
          message:
            `السطر ${lineNumber} من المستند ${document.invoiceNumber ?? ''}: تكلفة حركات المخزون المسجلة (${movedCost.toFixed(MONEY_SCALE)}) لا تساوي تكلفة السطر في القيد المحاسبي (${new Prisma.Decimal(lineCost).toFixed(MONEY_SCALE)})، فلا يمكن عكسه دون أن يختل المخزون أو الحسابات. لم يتغير شيء وبياناتك محفوظة. أبلغ المسؤول أو المحاسب بالمستند ورقم السطر للتحقق من التكلفة الأصلية. / ` +
            `Line ${lineNumber} of ${document.invoiceNumber ?? ''}: the recorded stock movement cost (${movedCost.toFixed(MONEY_SCALE)}) does not match the line cost in the accounting entry (${new Prisma.Decimal(lineCost).toFixed(MONEY_SCALE)}), so reversing it would put stock and accounts out of step. Nothing changed and your data is kept. Give your administrator or accountant the document and line number to verify the original cost.`,
          errors: { lineNumber: String(lineNumber) },
        });
      }
    }
    if (!moves.length) return false;
    const takingAway = returnType === 'SALES_RETURN';
    for (const m of moves) {
      const qty = new Prisma.Decimal(m.quantity);
      const unitCost = new Prisma.Decimal(m.unitCost);
      if (takingAway) {
        if (m.batchId) {
          const lot = await tx.itemBatch.findFirst({ where: { id: m.batchId, companyId }, select: { remainingQuantity: true, batchNumber: true } });
          if (!lot || lot.remainingQuantity.lessThan(qty)) {
            throw new BadRequestException({
              code: 'RETURN_REVERSE_LOT_SHORT',
              message:
                `السطر ${lineNumber}: الدفعة ${lot?.batchNumber ?? ''} المتبقي منها ${(lot?.remainingQuantity ?? new Prisma.Decimal(0)).toFixed(MONEY_SCALE)} فقط والمطلوب سحبه ${qty.toFixed(MONEY_SCALE)} لأن جزءًا منها بِيع أو نُقل بعد المرتجع. أرجع تلك الحركات أولًا ثم أعد عكس المرتجع. / ` +
                `Line ${lineNumber}: lot ${lot?.batchNumber ?? ''} has only ${(lot?.remainingQuantity ?? new Prisma.Decimal(0)).toFixed(MONEY_SCALE)} left to take back, not ${qty.toFixed(MONEY_SCALE)}, because part of it was sold or moved after the return. Undo those first, then reverse the return again.`,
              errors: { lineNumber: String(lineNumber), quantity: qty.toFixed(MONEY_SCALE) },
            });
          }
        }
        if (m.storageLocationId && warehouseId) {
          const rows = await tx.$queryRaw<Array<{ quantity: Prisma.Decimal | null }>>(Prisma.sql`
            SELECT SUM(CASE WHEN "direction" = 'IN' THEN "quantity" ELSE -"quantity" END) AS "quantity"
              FROM "stock_movements"
             WHERE "companyId" = ${companyId}::uuid
               AND "warehouseId" = ${warehouseId}::uuid
               AND "itemId" = ${itemId}::uuid
               AND "storageLocationId" = ${m.storageLocationId}::uuid
               ${m.batchId ? Prisma.sql`AND "batchId" = ${m.batchId}::uuid` : Prisma.empty}
          `);
          const have = new Prisma.Decimal(rows[0]?.quantity ?? 0);
          if (have.lessThan(qty)) {
            throw new BadRequestException({
              code: 'RETURN_REVERSE_SHELF_SHORT',
              message:
                `السطر ${lineNumber}: الموقع الذي أُعيدت إليه البضاعة يحوي ${have.toFixed(MONEY_SCALE)} فقط والمطلوب سحبه ${qty.toFixed(MONEY_SCALE)}، فقد نُقلت منه. أعدها إلى هذا الموقع بنقل مواقع ثم أعد عكس المرتجع. / ` +
                `Line ${lineNumber}: the location the goods went back to holds only ${have.toFixed(MONEY_SCALE)}, not ${qty.toFixed(MONEY_SCALE)}, because they were moved off it. Move them back to that location, then reverse the return again.`,
              errors: { lineNumber: String(lineNumber), available: have.toFixed(MONEY_SCALE), quantity: qty.toFixed(MONEY_SCALE) },
            });
          }
        }
        if (m.batchId) {
          await removeFromLotCost(tx, m.batchId, qty, unitCost);
          const claimed = await tx.itemBatch.updateMany({
            where: { id: m.batchId, remainingQuantity: { gte: qty } },
            data: { remainingQuantity: { decrement: qty } },
          });
          if (claimed.count !== 1) {
            throw new BadRequestException('تغيرت الدفعة أثناء العكس؛ أعد المحاولة. / The lot changed during the reversal; try again.');
          }
          await tx.itemBatch.updateMany({ where: { id: m.batchId, remainingQuantity: { lte: 0 }, status: 'OPEN' }, data: { status: 'CLOSED' } });
        }
      } else if (m.batchId) {
        await addToLotCost(tx, m.batchId, qty, unitCost);
        const lot = await tx.itemBatch.findFirst({ where: { id: m.batchId, companyId }, select: { status: true } });
        await tx.itemBatch.update({
          where: { id: m.batchId },
          data: { remainingQuantity: { increment: qty }, ...(lot?.status === 'CLOSED' ? { status: 'OPEN' } : {}) },
        });
      }
      await tx.stockMovement.create({
        data: {
          companyId,
          branchId,
          warehouseId,
          itemId,
          batchId: m.batchId,
          storageLocationId: m.storageLocationId,
          ...({ sourceLineId: lineId } as object),
          movementDate: new Date(),
          direction: takingAway ? StockDirection.OUT : StockDirection.IN,
          quantity: qty,
          unitCost,
          totalCost: new Prisma.Decimal(m.totalCost),
          referenceType: `${returnType}_REVERSAL`,
          referenceId: document.id,
          referenceNumber: document.invoiceNumber,
          createdBy: userId,
        },
      });
      if (m.batchId) await refreshLotPrimaryLocation(tx, companyId, m.batchId, null);
    }
    return true;
  }

  async postSalesReturn(companyId: string, userId: string, id: string, mayReadCost = true) {
    const document = await this.prisma.salesInvoice.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { lines: { orderBy: { lineNumber: 'asc' } }, originalInvoice: true },
    });
    if (!document) throw new NotFoundException('Return document not found');
    if (document.documentType !== InvoiceDocumentType.CREDIT_NOTE) {
      throw new BadRequestException('Only a sales credit note can be posted as a sales return.');
    }
    if (document.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException(
        `Only a draft return can be posted (current status: ${document.status})`,
      );
    }
    if (!document.originalInvoiceId) {
      throw new BadRequestException('A return must name the invoice it returns');
    }

    let postedTotalAmount = document.totalAmount;
    const result = await this.prisma.$transaction(async (tx) => {
      // Serialize the return with reversal of its source invoice. The source
      // row lock makes the status check authoritative: either the return posts
      // first and the invoice reversal sees it, or the invoice reverses first
      // and this return is refused.
      const source = await tx.$queryRaw<Array<{ status: InvoiceStatus; documentType: InvoiceDocumentType }>>(Prisma.sql`
        SELECT status, "documentType"
          FROM sales_invoices
         WHERE id = ${document.originalInvoiceId}::uuid
           AND "companyId" = ${companyId}::uuid
         FOR UPDATE
      `);
      if (source.length !== 1 || source[0].status !== InvoiceStatus.POSTED ||
          source[0].documentType !== InvoiceDocumentType.INVOICE) {
        throw new BadRequestException('The source sales invoice is no longer posted; this return cannot be posted.');
      }

      const claimed = await tx.salesInvoice.updateMany({
        where: { id: document.id, status: InvoiceStatus.DRAFT, deletedAt: null },
        data: { status: InvoiceStatus.POSTED },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('This return has just been posted by someone else.');
      }

      const accounts = await this.accounts.resolve(tx, companyId, [
        'accountsReceivable',
        'salesReturns',
        'vatPayable',
        'inventory',
        'costOfGoodsSold',
      ]);

      let costTotal = new Prisma.Decimal(0);
      let returnedSubTotal = new Prisma.Decimal(0);
      let returnedTaxTotal = new Prisma.Decimal(0);
      // Revenue and cost given back, split the same way the original invoice
      // split them, so a cost-center report nets the return against the sale.
      const revenueParts: Array<{ costCenterId: string | null; amount: Prisma.Decimal }> = [];
      const costParts: Array<{ costCenterId: string | null; amount: Prisma.Decimal }> = [];
      const warehouseId = await this.warehouses.resolve(
        tx,
        companyId,
        document.branchId,
        document.warehouseId,
      );
      if (warehouseId && !document.warehouseId) {
        await tx.salesInvoice.update({ where: { id: document.id }, data: { warehouseId } });
      }
      // The item locks first, sorted, as issues take them; then lot, shelf
      // and balance rows.
      await this.lockItems(tx, warehouseId, document.lines.map((l) => l.itemId).filter((x): x is string => !!x));

      for (const line of document.lines) {
        // The row of the original invoice is locked for the length of this
        // transaction, so two people returning the same goods at the same
        // moment cannot both find room for it.
        const matching = await this.lockSalesLine(
          tx,
          line.originalLineId,
          document.originalInvoiceId as string,
        );
        const remaining = matching.quantity.minus(matching.returnedQuantity);
        if (line.quantity.greaterThan(remaining)) {
          throw new BadRequestException(
            `${remaining.toFixed(MONEY_SCALE)} of "${matching.description}" is still returnable; ` +
              `this return asks for ${line.quantity.toFixed(MONEY_SCALE)}. Somebody has returned it already.`,
          );
        }

        const returnedLineTotal = this.allocateReturnedCost(
          matching.lineTotal,
          matching.returnedSubTotal,
          matching.quantity,
          matching.returnedQuantity,
          line.quantity,
          `Return line ${line.lineNumber} net value`,
        );
        const returnedCost = this.allocateReturnedCost(
          matching.costTotal,
          matching.returnedCostTotal,
          matching.quantity,
          matching.returnedQuantity,
          line.quantity,
          `Return line ${line.lineNumber}`,
        );
        const unitCost = returnedCost.div(line.quantity).toDecimalPlaces(MONEY_SCALE);
        const returnedTax = this.allocateReturnedCost(
          matching.taxAmount,
          matching.returnedTaxTotal,
          matching.quantity,
          matching.returnedQuantity,
          line.quantity,
          `Return line ${line.lineNumber} tax`,
        );
        await tx.salesInvoiceLine.update({
          where: { id: matching.id },
          data: {
            returnedQuantity: { increment: line.quantity },
            returnedSubTotal: { increment: returnedLineTotal },
            returnedCostTotal: { increment: returnedCost },
            returnedTaxTotal: { increment: returnedTax },
          },
        });
        await tx.salesInvoiceLine.update({
          where: { id: line.id },
          data: {
            lineTotal: returnedLineTotal,
            unitCost,
            costTotal: returnedCost,
            taxAmount: returnedTax,
            // The return line keeps the dimension it gives back, so the
            // document itself can be read by cost center too.
            costCenterId: matching.costCenterId,
          },
        });
        returnedSubTotal = returnedSubTotal.plus(returnedLineTotal);
        returnedTaxTotal = returnedTaxTotal.plus(returnedTax);

        if (line.itemId) {
          const item = await tx.item.findFirst({
            where: { id: line.itemId, companyId, deletedAt: null },
            select: { id: true, isStockTracked: true },
          });
          if (!item) throw new BadRequestException('A sales-return item no longer exists');
          if (!item.isStockTracked && !returnedCost.isZero()) {
            throw new BadRequestException('A sales-return item is no longer tracked in stock');
          }
          if (item.isStockTracked) {
            // The goods came out of named lots when the invoice was posted, so
            // a return has to put them back into those same lots. Writing one
            // unbatched stock movement credited the shelf while the lot stayed
            // short: the lot's remaining quantity never recovered, the next
            // FEFO issue could not see the stock, and a lot the sale had
            // emptied stayed closed. The original OUT movements are the record
            // of which lot each unit left, so they are read back here.
            const allOut = (document.originalInvoiceId
              ? ((await tx.stockMovement.findMany({
                  where: {
                    companyId,
                    itemId: item.id,
                    direction: StockDirection.OUT,
                    referenceType: 'SALES_INVOICE',
                    referenceId: document.originalInvoiceId,
                  },
                  // sourceLineId needs the regenerated Prisma client; the
                  // cast compiles before and after `prisma generate`.
                  select: { batchId: true, storageLocationId: true, quantity: true, unitCost: true, sourceLineId: true } as never,
                  orderBy: { createdAt: 'asc' },
                })) as unknown as Array<{ batchId: string | null; storageLocationId: string | null; quantity: Prisma.Decimal; unitCost: Prisma.Decimal; sourceLineId?: string | null }>)
              : []);
            // Movements written since the sale line was stored on them say
            // which line each unit left for; older ones cannot, and are read
            // for the whole invoice and item as before.
            const lineBound = allOut.some((row) => row.sourceLineId);
            if (!lineBound && legacyIdentityAmbiguous(allOut)) {
              const sameItemLines = await tx.salesInvoiceLine.count({
                where: { invoiceId: document.originalInvoiceId!, itemId: item.id },
              });
              if (sameItemLines > 1) {
                throw legacyIdentityError('SALES_RETURN_LEGACY_AMBIGUOUS', document.invoiceNumber, line.lineNumber);
              }
            }
            if (lineBound && !allOut.some((row) => row.sourceLineId === matching.id)) {
              throw legacyIdentityError('SALES_RETURN_LEGACY_AMBIGUOUS', document.invoiceNumber, line.lineNumber);
            }
            let consumed = (lineBound ? allOut.filter((row) => row.sourceLineId === matching.id) : allOut).map((row) => ({
              ...row,
              quantity: new Prisma.Decimal(row.quantity),
              unitCost: new Prisma.Decimal(row.unitCost),
            }));
            // Movements written in one transaction share a timestamp and carry
            // random ids, so their order is not a record of anything. When the
            // sale line names its shelves in order, that order is the one the
            // employee chose; return along it.
            const allocationOrder = Array.isArray((matching as { locationAllocations?: unknown }).locationAllocations)
              ? ((matching as unknown as { locationAllocations: Array<{ storageLocationId?: string }> }).locationAllocations).map((a) => a.storageLocationId ?? '')
              : [];
            if (allocationOrder.length && consumed.every((row) => allocationOrder.includes(row.storageLocationId ?? ''))) {
              consumed = [...consumed].sort(
                (a, b) => allocationOrder.indexOf(a.storageLocationId ?? '') - allocationOrder.indexOf(b.storageLocationId ?? ''),
              );
            }
            // Earlier returns of this same invoice already put some of it back,
            // lot by lot and shelf by shelf. Take that off what each OUT can
            // still give back, so a second return continues where the first
            // stopped instead of refilling the first shelf again.
            const priorRows = await tx.$queryRaw<Array<{ batchId: string | null; storageLocationId: string | null; quantity: Prisma.Decimal }>>(Prisma.sql`
              SELECT m."batchId" AS "batchId", m."storageLocationId" AS "storageLocationId",
                     SUM(CASE WHEN m."referenceType" = 'SALES_RETURN' THEN m."quantity" ELSE -m."quantity" END) AS "quantity"
                FROM "stock_movements" m
                JOIN "sales_invoices" r ON r."id" = m."referenceId"
                ${lineBound
                  ? Prisma.sql`JOIN "sales_invoice_lines" rl ON rl."id" = m."sourceLineId" AND rl."originalLineId" = ${matching.id}::uuid`
                  : Prisma.empty}
               WHERE m."companyId" = ${companyId}::uuid
                 AND m."itemId" = ${item.id}::uuid
                 AND m."referenceType" IN ('SALES_RETURN', 'SALES_RETURN_REVERSAL')
                 AND r."originalInvoiceId" = ${document.originalInvoiceId}::uuid
               GROUP BY m."batchId", m."storageLocationId"
            `);
            const restoredBy = new Map<string, Prisma.Decimal>(
              priorRows.map((r) => [`${r.batchId ?? ''}|${r.storageLocationId ?? ''}`, new Prisma.Decimal(r.quantity)]),
            );
            const consumedLeft = consumed
              .map((row) => {
                const key = `${row.batchId ?? ''}|${row.storageLocationId ?? ''}`;
                const done = restoredBy.get(key) ?? new Prisma.Decimal(0);
                const taken = Prisma.Decimal.min(done, row.quantity);
                restoredBy.set(key, done.minus(taken));
                return { ...row, quantity: row.quantity.minus(taken) };
              })
              .filter((row) => row.quantity.greaterThan(0));
            if (lineBound && consumedLeft.reduce((t, r) => t.plus(r.quantity), new Prisma.Decimal(0)).lessThan(line.quantity)) {
              throw legacyIdentityError('SALES_RETURN_LEGACY_AMBIGUOUS', document.invoiceNumber, line.lineNumber);
            }
            const lotRows = consumedLeft.filter((row) => row.batchId !== null);
            // Return the quantity lot by lot in the order it left. Anything the
            // invoice took from an unbatched shelf - or everything, when the
            // original movements are not available - goes to the shelf as
            // before, so an item that keeps no lots behaves unchanged.
            let unbatched = line.quantity;
            for (const row of lotRows) {
              if (unbatched.lessThanOrEqualTo(0)) break;
              const giveBack = Prisma.Decimal.min(unbatched, row.quantity);
              const lot = await tx.itemBatch.findFirst({
                where: { id: row.batchId!, companyId },
                select: { id: true, unitCost: true, status: true },
              });
              if (!lot) {
                throw new BadRequestException(
                  'دفعة الفاتورة الأصلية لم تعد موجودة. / The original invoice lot no longer exists.',
                );
              }
              // Reopening a lot the sale closed is the point: the sale is being
              // undone, and refusing to reopen would silently lose the stock.
              // A lot still in QUARANTINE or EXPIRED keeps that state - the
              // return puts goods back, it does not clear a quality hold.
              await addToLotCost(tx, lot.id, giveBack, new Prisma.Decimal(row.unitCost));
              await tx.itemBatch.update({
                where: { id: lot.id },
                data: {
                  remainingQuantity: { increment: giveBack },
                  ...(lot.status === 'CLOSED' ? { status: 'OPEN' } : {}),
                },
              });
              const lineCost = giveBack.mul(row.unitCost).toDecimalPlaces(MONEY_SCALE);
              await tx.stockMovement.create({
                data: {
                  companyId,
                  branchId: document.branchId,
                  warehouseId,
                  itemId: item.id,
                  batchId: lot.id,
                  // back onto the shelf this sale took it from
                  storageLocationId: row.storageLocationId ?? null,
                  movementDate: document.invoiceDate,
                  direction: StockDirection.IN,
                  quantity: giveBack,
                  unitCost: row.unitCost,
                  totalCost: lineCost,
                  ...({ sourceLineId: line.id } as object),
                  referenceType: 'SALES_RETURN',
                  referenceId: document.id,
                  referenceNumber: document.invoiceNumber,
                  notes: `Return of ${document.originalInvoice?.invoiceNumber ?? ''}`,
                  createdBy: userId,
                },
              });
              await refreshLotPrimaryLocation(tx, companyId, lot.id, null);
              unbatched = unbatched.minus(giveBack);
            }
            // An item that keeps no lots goes back to the shelf each OUT left.
            let shelfSplit = false;
            for (const row of consumedLeft) {
              if (row.batchId !== null || !row.storageLocationId) continue;
              if (unbatched.lessThanOrEqualTo(0)) break;
              const giveBack = Prisma.Decimal.min(unbatched, row.quantity);
              shelfSplit = true;
              await tx.stockMovement.create({
                data: {
                  companyId,
                  branchId: document.branchId,
                  warehouseId,
                  itemId: item.id,
                  storageLocationId: row.storageLocationId,
                  movementDate: document.invoiceDate,
                  direction: StockDirection.IN,
                  quantity: giveBack,
                  unitCost,
                  totalCost: unitCost.mul(giveBack).toDecimalPlaces(MONEY_SCALE),
                  ...({ sourceLineId: line.id } as object),
                  referenceType: 'SALES_RETURN',
                  referenceId: document.id,
                  referenceNumber: document.invoiceNumber,
                  notes: `Return of ${document.originalInvoice?.invoiceNumber ?? ''}`,
                  createdBy: userId,
                },
              });
              unbatched = unbatched.minus(giveBack);
            }
            if (unbatched.greaterThan(0)) {
              await tx.stockMovement.create({
                data: {
                  companyId,
                  branchId: document.branchId,
                  warehouseId,
                  itemId: item.id,
                  movementDate: document.invoiceDate,
                  direction: StockDirection.IN,
                  quantity: unbatched,
                  unitCost,
                  totalCost: shelfSplit ? unitCost.mul(unbatched).toDecimalPlaces(MONEY_SCALE) : returnedCost,
                  ...({ sourceLineId: line.id } as object),
                  referenceType: 'SALES_RETURN',
                  referenceId: document.id,
                  referenceNumber: document.invoiceNumber,
                  notes: `Return of ${document.originalInvoice?.invoiceNumber ?? ''}`,
                  createdBy: userId,
                },
              });
            }
            await tx.stockBalance.upsert({
              where: {
                companyId_branchId_itemId: {
                  companyId,
                  branchId: document.branchId,
                  itemId: item.id,
                },
              },
              create: {
                companyId,
                branchId: document.branchId,
                itemId: item.id,
                quantity: line.quantity,
                value: returnedCost,
              },
              update: {
                quantity: { increment: line.quantity },
                value: { increment: returnedCost },
              },
            });
            costTotal = costTotal.plus(returnedCost);
            costParts.push({ costCenterId: matching.costCenterId, amount: returnedCost });
          }
        }
        revenueParts.push({
          costCenterId: matching.costCenterId,
          amount: returnedLineTotal,
        });
      }

      postedTotalAmount = returnedSubTotal.plus(returnedTaxTotal);

      const journalLines = [
        // Revenue comes back down. It lands on the sales-returns account so a
        // report can show gross sales and returns separately, and it carries
        // the same cost centers the sale carried.
        ...attributedLines(
          accounts.salesReturns,
          'debit',
          `Sales return (${document.originalInvoice?.invoiceNumber ?? ''})`,
          revenueParts,
        ),
        ...(returnedTaxTotal.isZero()
          ? []
          : [
              {
                accountId: accounts.vatPayable,
                debit: returnedTaxTotal,
                description: 'VAT on sales return',
              },
            ]),
        {
          accountId: accounts.accountsReceivable,
          credit: postedTotalAmount,
          description: 'Customer credit note',
        },
      ];

      if (!costTotal.isZero()) {
        journalLines.push(
          ...attributedLines(
            accounts.inventory,
            'debit',
            'Stock returned to inventory',
            costParts,
          ),
          ...attributedLines(
            accounts.costOfGoodsSold,
            'credit',
            'Cost of goods returned',
            costParts,
          ),
        );
      }

      await tx.salesInvoice.update({
        where: { id: document.id },
        data: {
          subTotal: returnedSubTotal,
          taxAmount: returnedTaxTotal,
          totalAmount: postedTotalAmount,
        },
      });

      const journal = await this.posting.post(tx, {
        companyId,
        branchId: document.branchId,
        userId,
        entryDate: document.invoiceDate,
        description: `Sales return ${document.invoiceNumber}`,
        sourceType: 'SALES_RETURN',
        sourceId: document.id,
        sourceNumber: document.invoiceNumber,
        currency: document.currency,
        lines: journalLines,
      });

      await tx.salesInvoice.update({
        where: { id: document.id },
        data: {
          journalEntryId: journal.id,
          postedAt: new Date(),
          postedBy: userId,
          costOfGoods: costTotal,
        },
      });

      return journal;
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'POST',
      entity: 'sales_returns',
      entityId: id,
      after: {
        journalNumber: result.entryNumber,
        totalAmount: postedTotalAmount.toFixed(MONEY_SCALE),
      },
    });

    return this.findOne(companyId, 'sales', id, mayReadCost);
  }

  // --------------------------------------------------------- purchase return

  async createPurchaseReturn(
    companyId: string,
    branchId: string | null,
    userId: string,
    dto: {
      originalInvoiceId: string;
      returnDate: string;
      reason?: string;
      notes?: string;
      lines: ReturnLineInput[];
    },
    mayReadCost = true,
  ) {
    if (!branchId) {
      throw new BadRequestException('The signed-in user is not assigned to a branch');
    }
    const originalInvoiceId = this.requiredId(dto.originalInvoiceId, 'originalInvoiceId');
    const original = await this.prisma.purchaseInvoice.findFirst({
      where: { id: originalInvoiceId, companyId, deletedAt: null },
      include: { lines: { orderBy: { lineNumber: 'asc' }, include: { item: { select: { unit: true } } } } },
    });
    if (!original) throw new BadRequestException('The original purchase invoice does not exist');
    if (original.status !== InvoiceStatus.POSTED) {
      throw new BadRequestException('Only a posted purchase invoice can be returned');
    }
    if (original.documentType !== InvoiceDocumentType.INVOICE) {
      throw new BadRequestException('A return document cannot itself be returned');
    }
    if (original.branchId !== branchId) {
      throw new BadRequestException('A return must be recorded in the branch that issued the original invoice');
    }
    if (!Array.isArray(dto.lines) || dto.lines.length === 0) {
      throw new BadRequestException('A return needs at least one line');
    }

    const date = this.date(dto.returnDate, 'returnDate');
    if (date < original.invoiceDate) {
      throw new BadRequestException('The return date cannot be before the invoice date');
    }

    const prepared: Array<{
      originalLineId: string;
      itemId: string | null;
      description: string;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      taxRate: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
      landedCostAmount: Prisma.Decimal;
      inventoryCostTotal: Prisma.Decimal;
      unitName: string | null;
      unitFactor: Prisma.Decimal | null;
      unitQuantity: Prisma.Decimal | null;
    }> = [];
    const seenOriginalLineIds = new Set<string>();
    for (const [index, raw] of dto.lines.entries()) {
      const originalLineId = this.requiredId(
        raw.originalLineId,
        `Line ${index + 1} originalLineId`,
      );
      const originalLine = original.lines.find((line) => line.id === originalLineId);
      if (!originalLine) {
        throw new BadRequestException(`Line ${index + 1}: that line does not belong to the invoice`);
      }
      if (seenOriginalLineIds.has(originalLine.id)) {
        throw new BadRequestException(`Line ${index + 1}: an invoice line may appear only once in a return`);
      }
      seenOriginalLineIds.add(originalLine.id);
      // Follow the original document's unit; convert the entered quantity into
      // the base quantity every existing return/limit calculation already uses.
      const unit = this.resolveReturnUnit(`Line ${index + 1}`, originalLine, raw);
      const remaining = originalLine.quantity.minus(originalLine.returnedQuantity);
      const quantity = unit.baseQuantity;
      if (quantity.greaterThan(remaining)) {
        throw new BadRequestException(
          `Line ${index + 1}: ${remaining.toFixed(MONEY_SCALE)} of ${originalLine.description} ` +
            `is still returnable, ${quantity.toFixed(MONEY_SCALE)} was requested.`,
        );
      }
      const unitPrice =
        raw.unitPrice === undefined
          ? originalLine.unitPrice
          : this.nonNegative(raw.unitPrice, `Line ${index + 1} unit price`);
      const lineTotal = this.allocateReturnedCost(
        originalLine.lineTotal,
        originalLine.returnedSubTotal,
        originalLine.quantity,
        originalLine.returnedQuantity,
        quantity,
        `Line ${index + 1} net value`,
      );
      // Same rule as a sales return: the invoice price or the discounted
      // price actually paid describe the same line, and neither changes the
      // amount, which comes from the net line total.
      const netUnitPrice = lineTotal.div(quantity).toDecimalPlaces(MONEY_SCALE);
      if (
        !unitPrice.equals(originalLine.unitPrice) &&
        !unitPrice.equals(netUnitPrice)
      ) {
        throw new BadRequestException(
          `Line ${index + 1}: a purchase return uses the original invoice unit price ` +
            `(${originalLine.unitPrice.toFixed(MONEY_SCALE)}) or the discounted price actually paid ` +
            `(${netUnitPrice.toFixed(MONEY_SCALE)})`,
        );
      }
      const taxAmount = this.allocateReturnedCost(
        originalLine.taxAmount,
        originalLine.returnedTaxTotal,
        originalLine.quantity,
        originalLine.returnedQuantity,
        quantity,
        `Line ${index + 1} tax`,
      );
      const originalInventoryCost = originalLine.inventoryCostTotal.isZero()
        ? originalLine.lineTotal
        : originalLine.inventoryCostTotal;
      const inventoryCostTotal = this.allocateReturnedCost(
        originalInventoryCost,
        originalLine.returnedCostTotal,
        originalLine.quantity,
        originalLine.returnedQuantity,
        quantity,
        `Line ${index + 1} landed inventory cost`,
      );
      const landedCostAmount = inventoryCostTotal.minus(lineTotal);
      if (landedCostAmount.isNegative()) {
        throw new BadRequestException(`Line ${index + 1}: allocated inventory cost is below the returned invoice value`);
      }

      prepared.push({
        originalLineId: originalLine.id,
        itemId: originalLine.itemId,
        description: originalLine.description,
        quantity,
        unitPrice,
        taxRate: originalLine.taxRate,
        taxAmount,
        lineTotal,
        landedCostAmount,
        inventoryCostTotal,
        unitName: unit.unitName,
        unitFactor: unit.unitFactor,
        unitQuantity: unit.unitQuantity,
      });
    }

    const subTotal = prepared.reduce((sum, line) => sum.plus(line.lineTotal), new Prisma.Decimal(0));
    const taxAmount = prepared.reduce((sum, line) => sum.plus(line.taxAmount), new Prisma.Decimal(0));
    const landedCostAmount = prepared.reduce((sum, line) => sum.plus(line.landedCostAmount), new Prisma.Decimal(0));

    const created = await this.prisma.$transaction(async (tx) => {
      const invoiceNumber = await this.numbers.next(tx, companyId, 'PURCHASE_RETURN', 'PR');
      return tx.purchaseInvoice.create({
        data: {
          companyId,
          branchId,
          invoiceNumber,
          invoiceDate: date,
          supplierId: original.supplierId,
          warehouseId: original.warehouseId,
          status: InvoiceStatus.DRAFT,
          currency: original.currency,
          documentType: InvoiceDocumentType.DEBIT_NOTE,
          originalInvoiceId: original.id,
          returnReason: dto.reason?.trim() || null,
          subTotal,
          taxAmount,
          landedCostAmount,
          totalAmount: subTotal.plus(taxAmount).plus(landedCostAmount),
          notes: dto.notes?.trim() || null,
          createdBy: userId,
          lines: {
            create: prepared.map((line, index) => ({
              lineNumber: index + 1,
              itemId: line.itemId,
              originalLineId: line.originalLineId,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              taxRate: line.taxRate,
              taxAmount: line.taxAmount,
              lineTotal: line.lineTotal,
              landedCostAmount: line.landedCostAmount,
              inventoryCostTotal: line.inventoryCostTotal,
              unitName: line.unitName,
              unitFactor: line.unitFactor,
              unitQuantity: line.unitQuantity,
            })),
          },
        },
      });
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'purchase_returns',
      entityId: created.id,
      after: {
        invoiceNumber: created.invoiceNumber,
        originalInvoice: original.invoiceNumber,
        totalAmount: created.totalAmount.toFixed(MONEY_SCALE),
      },
    });

    return this.findOne(companyId, 'purchases', created.id, mayReadCost);
  }

  async postPurchaseReturn(companyId: string, userId: string, id: string, mayReadCost = true) {
    const document = await this.prisma.purchaseInvoice.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { lines: { orderBy: { lineNumber: 'asc' } }, originalInvoice: true },
    });
    if (!document) throw new NotFoundException('Return document not found');
    if (document.documentType !== InvoiceDocumentType.DEBIT_NOTE) {
      throw new BadRequestException('Only a purchase debit note can be posted as a purchase return.');
    }
    if (document.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException(
        `Only a draft return can be posted (current status: ${document.status})`,
      );
    }
    if (!document.originalInvoiceId) {
      throw new BadRequestException('A return must name the invoice it returns');
    }

    let postedTotalAmount = document.totalAmount;
    const result = await this.prisma.$transaction(async (tx) => {
      // Lock the source invoice before claiming this return so source reversal
      // and return posting cannot both commit against stale state.
      const source = await tx.$queryRaw<Array<{ status: InvoiceStatus; documentType: InvoiceDocumentType }>>(Prisma.sql`
        SELECT status, "documentType"
          FROM purchase_invoices
         WHERE id = ${document.originalInvoiceId}::uuid
           AND "companyId" = ${companyId}::uuid
         FOR UPDATE
      `);
      if (source.length !== 1 || source[0].status !== InvoiceStatus.POSTED ||
          source[0].documentType !== InvoiceDocumentType.INVOICE) {
        throw new BadRequestException('The source purchase invoice is no longer posted; this return cannot be posted.');
      }

      const claimed = await tx.purchaseInvoice.updateMany({
        where: { id: document.id, status: InvoiceStatus.DRAFT, deletedAt: null },
        data: { status: InvoiceStatus.POSTED },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('This return has just been posted by someone else.');
      }

      await this.lockItems(
        tx,
        await this.warehouses.resolve(tx, companyId, document.branchId, document.warehouseId),
        document.lines.flatMap((l) => (l.itemId ? [l.itemId] : [])),
      );

      const accounts = await this.accounts.resolve(tx, companyId, [
        'accountsPayable',
        'inventory',
        'vatReceivable',
      ]);
      const warehouseId = await this.warehouses.resolve(
        tx,
        companyId,
        document.branchId,
        document.warehouseId,
      );
      if (warehouseId && !document.warehouseId) {
        await tx.purchaseInvoice.update({ where: { id: document.id }, data: { warehouseId } });
      }

      let subTotal = new Prisma.Decimal(0);
      let taxAmount = new Prisma.Decimal(0);
      let landedCostAmount = new Prisma.Decimal(0);
      // The inventory value handed back to the supplier, per cost center.
      const inventoryParts: Array<{
        costCenterId: string | null;
        amount: Prisma.Decimal;
      }> = [];

      for (const line of document.lines) {
        const matching = await this.lockPurchaseLine(
          tx,
          line.originalLineId,
          document.originalInvoiceId as string,
        );
        const remaining = matching.quantity.minus(matching.returnedQuantity);
        if (line.quantity.greaterThan(remaining)) {
          throw new BadRequestException(
            `${remaining.toFixed(MONEY_SCALE)} of "${matching.description}" is still returnable; ` +
              `this return asks for ${line.quantity.toFixed(MONEY_SCALE)}.`,
          );
        }

        const lineTotal = this.allocateReturnedCost(
          matching.lineTotal,
          matching.returnedSubTotal,
          matching.quantity,
          matching.returnedQuantity,
          line.quantity,
          `Return line ${line.lineNumber} net value`,
        );
        const originalInventoryCost = matching.inventoryCostTotal.isZero()
          ? matching.lineTotal
          : matching.inventoryCostTotal;
        const returnedCost = this.allocateReturnedCost(
          originalInventoryCost,
          matching.returnedCostTotal,
          matching.quantity,
          matching.returnedQuantity,
          line.quantity,
          `Return line ${line.lineNumber} landed inventory cost`,
        );
        const unitCost = returnedCost.div(line.quantity).toDecimalPlaces(MONEY_SCALE);
        const returnedLandedCost = returnedCost.minus(lineTotal);
        if (returnedLandedCost.isNegative()) {
          throw new BadRequestException(
            `Return line ${line.lineNumber}: allocated inventory cost is below the returned invoice value.`,
          );
        }
        const returnedTax = this.allocateReturnedCost(
          matching.taxAmount,
          matching.returnedTaxTotal,
          matching.quantity,
          matching.returnedQuantity,
          line.quantity,
          `Return line ${line.lineNumber} tax`,
        );

        await tx.purchaseInvoiceLine.update({
          where: { id: matching.id },
          data: {
            returnedQuantity: { increment: line.quantity },
            returnedSubTotal: { increment: lineTotal },
            returnedCostTotal: { increment: returnedCost },
            returnedTaxTotal: { increment: returnedTax },
          },
        });
        await tx.purchaseInvoiceLine.update({
          where: { id: line.id },
          data: {
            lineTotal,
            taxAmount: returnedTax,
            landedCostAmount: returnedLandedCost,
            inventoryCostTotal: returnedCost,
            costCenterId: matching.costCenterId,
          },
        });
        subTotal = subTotal.plus(lineTotal);
        taxAmount = taxAmount.plus(returnedTax);
        landedCostAmount = landedCostAmount.plus(returnedLandedCost);
        inventoryParts.push({
          costCenterId: matching.costCenterId,
          amount: returnedCost,
        });

        if (line.itemId) {
          const item = await tx.item.findFirst({
            where: { id: line.itemId, companyId, deletedAt: null },
            select: { id: true, isStockTracked: true },
          });
          if (!item || !item.isStockTracked) {
            throw new BadRequestException('A purchase-return item is no longer tracked in stock');
          }

          const lockedBalances = await tx.$queryRaw<
            Array<{ quantity: Prisma.Decimal; value: Prisma.Decimal }>
          >(Prisma.sql`
            SELECT "quantity", "value"
              FROM "stock_balances"
             WHERE "companyId" = ${companyId}::uuid
               AND "branchId" = ${document.branchId}::uuid
               AND "itemId" = ${item.id}::uuid
             FOR UPDATE
          `);
          const balance = lockedBalances[0] ?? null;
          const onHand = balance?.quantity ?? new Prisma.Decimal(0);
          if (onHand.lessThan(line.quantity)) {
            throw new BadRequestException(
              `Cannot return ${line.quantity.toFixed(MONEY_SCALE)} to the supplier: ` +
                `${onHand.toFixed(MONEY_SCALE)} is available in stock.`,
            );
          }
          if (balance && balance.value.lessThan(returnedCost)) {
            throw new BadRequestException(
              `Cannot reverse ${returnedCost.toFixed(MONEY_SCALE)} of inventory cost; ` +
                `${balance.value.toFixed(MONEY_SCALE)} is currently valued in stock.`,
            );
          }

          // Same warehouse-level rule as sales: returning goods to a supplier
          // drains one named warehouse, which must actually hold them even
          // when the branch total would be enough. Returns never go negative.
          await this.warehouses.assertWarehouseAvailable({
            tx,
            companyId,
            warehouseId,
            itemId: item.id,
            quantity: line.quantity,
            allowNegative: false,
            reference: document.invoiceNumber,
          });

          const originalReceipt = line.originalLineId
            ? await tx.purchaseInvoiceLine.findUnique({
                where: { id: line.originalLineId },
                select: { id: true, batchNumber: true, storageLocationId: true, quantity: true, lineNumber: true, invoiceId: true, itemId: true },
              })
            : null;
          // The original receipt movement says which lot the goods went into,
          // even when the line carries no lot number. Two identical lines of
          // one invoice map to their movements in line order.
          let receiptMovement: { batchId: string | null; unitCost: Prisma.Decimal } | null = null;
          if (originalReceipt?.invoiceId && originalReceipt.itemId) {
            const moves = await receiptLotMovements(tx, companyId, originalReceipt.invoiceId, originalReceipt.itemId);
            const siblings = await tx.purchaseInvoiceLine.findMany({
              where: { invoiceId: originalReceipt.invoiceId, itemId: originalReceipt.itemId },
              select: { lineNumber: true, quantity: true, storageLocationId: true },
              orderBy: { lineNumber: 'asc' },
            });
            const same = (a: { quantity: Prisma.Decimal; storageLocationId: string | null }) =>
              new Prisma.Decimal(a.quantity).equals(originalReceipt.quantity) &&
              (a.storageLocationId ?? null) === (originalReceipt.storageLocationId ?? null);
            const index = siblings.filter(same).findIndex((l) => l.lineNumber === originalReceipt.lineNumber);
            if (legacyIdentityAmbiguous(moves) || boundCoverageMissing(moves, originalReceipt.id)) {
              throw legacyIdentityError('PURCHASE_RETURN_LEGACY_AMBIGUOUS', document.invoiceNumber, line.lineNumber);
            }
            const pick = receiptFor(moves, { id: originalReceipt.id, quantity: new Prisma.Decimal(originalReceipt.quantity), storageLocationId: originalReceipt.storageLocationId }, index);
            if (pick) receiptMovement = { batchId: pick.batchId, unitCost: new Prisma.Decimal(pick.unitCost) };
          }
          const back = await this.takeBackFromReceipt(tx, {
            companyId,
            warehouseId,
            itemId: item.id,
            lineNumber: line.lineNumber,
            quantity: line.quantity,
            receipt: originalReceipt,
            receiptMovement,
          });
          await tx.stockMovement.create({
            data: {
              companyId,
              branchId: document.branchId,
              warehouseId,
              itemId: item.id,
              batchId: back.lotId,
              storageLocationId: back.shelfId,
              movementDate: document.invoiceDate,
              direction: StockDirection.OUT,
              quantity: line.quantity,
              unitCost,
              totalCost: returnedCost,
              ...({ sourceLineId: line.id } as object),
              referenceType: 'PURCHASE_RETURN',
              referenceId: document.id,
              referenceNumber: document.invoiceNumber,
              notes: `Return of ${document.originalInvoice?.invoiceNumber ?? ''}`,
              createdBy: userId,
            },
          });
          if (back.lotId) await refreshLotPrimaryLocation(tx, companyId, back.lotId, null);
          await tx.stockBalance.update({
            where: {
              companyId_branchId_itemId: {
                companyId,
                branchId: document.branchId,
                itemId: item.id,
              },
            },
            data: {
              quantity: { decrement: line.quantity },
              value: { decrement: returnedCost },
            },
          });
        }
      }

      postedTotalAmount = subTotal.plus(taxAmount).plus(landedCostAmount);
      await tx.purchaseInvoice.update({
        where: { id: document.id },
        data: { subTotal, taxAmount, landedCostAmount, totalAmount: postedTotalAmount },
      });

      const journal = await this.posting.post(tx, {
        companyId,
        branchId: document.branchId,
        userId,
        entryDate: document.invoiceDate,
        description: `Purchase return ${document.invoiceNumber}`,
        sourceType: 'PURCHASE_RETURN',
        sourceId: document.id,
        sourceNumber: document.invoiceNumber,
        currency: document.currency,
        lines: [
          {
            accountId: accounts.accountsPayable,
            debit: postedTotalAmount,
            description: 'Supplier debit note',
          },
          ...attributedLines(
            accounts.inventory,
            'credit',
            'Inventory and landed costs returned to supplier',
            inventoryParts,
          ),
          ...(taxAmount.isZero()
            ? []
            : [
                {
                  accountId: accounts.vatReceivable,
                  credit: taxAmount,
                  description: 'VAT on purchase return',
                },
              ]),
        ],
      });

      await tx.purchaseInvoice.update({
        where: { id: document.id },
        data: {
          journalEntryId: journal.id,
          postedAt: new Date(),
          postedBy: userId,
        },
      });

      return journal;
    });
    await this.audit.record({
      companyId,
      userId,
      action: 'POST',
      entity: 'purchase_returns',
      entityId: id,
      after: {
        journalNumber: result.entryNumber,
        totalAmount: postedTotalAmount.toFixed(MONEY_SCALE),
      },
    });

    return this.findOne(companyId, 'purchases', id, mayReadCost);
  }

  /** Reverses a posted return: the mirror entry, and the stock back the way it came. */
  async reverse(companyId: string, userId: string, side: 'sales' | 'purchases', id: string, mayReadCost = true) {
    if (side === 'sales') {
      const document = await this.prisma.salesInvoice.findFirst({
        where: { id, companyId, deletedAt: null },
        include: { lines: true },
      });
      if (!document) throw new NotFoundException('Return document not found');
      if (document.documentType !== InvoiceDocumentType.CREDIT_NOTE) {
        throw new BadRequestException('Only a sales credit note can be reversed as a sales return.');
      }
      if (document.status !== InvoiceStatus.POSTED || !document.journalEntryId) {
        throw new BadRequestException('Only a posted return can be reversed');
      }

      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.salesInvoice.updateMany({
          where: { id, status: InvoiceStatus.POSTED },
          data: { status: InvoiceStatus.REVERSED },
        });
        if (claimed.count !== 1) {
          throw new BadRequestException('This return has just been changed by someone else.');
        }

        // The goods leave again, at the same cost they came back in at, and
        // the original line is freed so it can be returned properly later.
        const warehouseId = await this.warehouses.resolveForReversal(
          tx,
          companyId,
          document.branchId,
          document.warehouseId,
        );
        if (warehouseId && !document.warehouseId) {
          await tx.salesInvoice.update({ where: { id: document.id }, data: { warehouseId } });
        }
        // Every item's advisory lock first, in one sorted order, before any
        // balance or lot row is locked (issues take them in that order).
        await this.lockItems(tx, warehouseId, document.lines.map((l) => l.itemId).filter((x): x is string => !!x));
        for (const line of document.lines) {
          const originalLine = await this.findOriginalLineById(tx, line);
          if (originalLine) {
            await tx.salesInvoiceLine.update({
              where: { id: originalLine.id },
              data: {
                returnedQuantity: { decrement: line.quantity },
                returnedSubTotal: { decrement: line.lineTotal },
                returnedCostTotal: { decrement: line.costTotal },
                returnedTaxTotal: { decrement: line.taxAmount },
              },
            });
          }
          if (!line.itemId) continue;
          const item = await tx.item.findFirst({
            where: { id: line.itemId, companyId, deletedAt: null },
            select: { id: true, isStockTracked: true },
          });
          if (!item) throw new BadRequestException('A sales-return item no longer exists');
          // A stock-tracked free item still needs its returned quantity removed;
          // zero value is not a reason to skip the movement on reversal.
          if (!item.isStockTracked) continue;
          const lockedBalances = await tx.$queryRaw<
            Array<{ quantity: Prisma.Decimal; value: Prisma.Decimal }>
          >(Prisma.sql`
            SELECT "quantity", "value"
              FROM "stock_balances"
             WHERE "companyId" = ${companyId}::uuid
               AND "branchId" = ${document.branchId}::uuid
               AND "itemId" = ${line.itemId}::uuid
             FOR UPDATE
          `);
          const balance = lockedBalances[0] ?? null;
          const onHand = balance?.quantity ?? new Prisma.Decimal(0);
          if (onHand.lessThan(line.quantity)) {
            throw new BadRequestException(
              `Cannot reverse this return: ${onHand.toFixed(MONEY_SCALE)} is available in stock, ` +
                `${line.quantity.toFixed(MONEY_SCALE)} is required.`,
            );
          }
          if (balance && balance.value.lessThan(line.costTotal)) {
            throw new BadRequestException(
              `Cannot reverse this return: ${balance.value.toFixed(MONEY_SCALE)} of inventory value ` +
                `is available, ${line.costTotal.toFixed(MONEY_SCALE)} is required.`,
            );
          }

          await this.lockItems(tx, warehouseId, [line.itemId]);
          const mirrored = await this.undoReturnMovements(tx, {
            companyId, userId, branchId: document.branchId, warehouseId, itemId: line.itemId,
            lineId: line.id, lineNumber: line.lineNumber, quantity: new Prisma.Decimal(line.quantity), costTotal: new Prisma.Decimal(line.costTotal), document, returnType: 'SALES_RETURN',
          });
          if (!mirrored) {
            await tx.stockMovement.create({
              data: {
                companyId,
                branchId: document.branchId,
                warehouseId,
                itemId: line.itemId,
                movementDate: new Date(),
                direction: StockDirection.OUT,
                quantity: line.quantity,
                unitCost: line.unitCost,
                totalCost: line.costTotal,
                referenceType: 'SALES_RETURN_REVERSAL',
                referenceId: document.id,
                referenceNumber: document.invoiceNumber,
                createdBy: userId,
              },
            });
          }
          await tx.stockBalance.update({
            where: {
              companyId_branchId_itemId: {
                companyId,
                branchId: document.branchId,
                itemId: line.itemId,
              },
            },
            data: {
              quantity: { decrement: line.quantity },
              value: { decrement: line.costTotal },
            },
          });
        }

        await this.posting.reverse(
          tx,
          companyId,
          userId,
          document.journalEntryId as string,
          `Reversal of sales return ${document.invoiceNumber}`,
        );
      });

      await this.audit.record({
        companyId,
        userId,
        action: 'REVERSE',
        entity: 'sales_returns',
        entityId: id,
      });
      return this.findOne(companyId, 'sales', id, mayReadCost);
    }

    const document = await this.prisma.purchaseInvoice.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { lines: true },
    });
    if (!document) throw new NotFoundException('Return document not found');
    if (document.documentType !== InvoiceDocumentType.DEBIT_NOTE) {
      throw new BadRequestException('Only a purchase debit note can be reversed as a purchase return.');
    }
    if (document.status !== InvoiceStatus.POSTED || !document.journalEntryId) {
      throw new BadRequestException('Only a posted return can be reversed');
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.purchaseInvoice.updateMany({
        where: { id, status: InvoiceStatus.POSTED },
        data: { status: InvoiceStatus.REVERSED },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('This return has just been changed by someone else.');
      }

      const warehouseId = await this.warehouses.resolveForReversal(
        tx,
        companyId,
        document.branchId,
        document.warehouseId,
      );
      if (warehouseId && !document.warehouseId) {
        await tx.purchaseInvoice.update({ where: { id: document.id }, data: { warehouseId } });
      }
      await this.lockItems(tx, warehouseId, document.lines.map((l) => l.itemId).filter((x): x is string => !!x));
      for (const line of document.lines) {
        const originalLine = await this.findOriginalPurchaseLineById(tx, line);
        const totalCost = line.inventoryCostTotal.isZero()
          ? line.unitPrice.mul(line.quantity).toDecimalPlaces(MONEY_SCALE)
          : line.inventoryCostTotal;
        const unitCost = totalCost.div(line.quantity).toDecimalPlaces(MONEY_SCALE);
        if (originalLine) {
          await tx.purchaseInvoiceLine.update({
            where: { id: originalLine.id },
            data: {
              returnedQuantity: { decrement: line.quantity },
              returnedSubTotal: { decrement: line.lineTotal },
              returnedCostTotal: { decrement: totalCost },
              returnedTaxTotal: { decrement: line.taxAmount },
            },
          });
        }
        if (!line.itemId) continue;
        await this.lockItems(tx, warehouseId, [line.itemId]);
        const mirrored = await this.undoReturnMovements(tx, {
          companyId, userId, branchId: document.branchId, warehouseId, itemId: line.itemId,
          lineId: line.id, lineNumber: line.lineNumber, quantity: new Prisma.Decimal(line.quantity), costTotal: totalCost, document, returnType: 'PURCHASE_RETURN',
        });
        if (!mirrored) {
          await tx.stockMovement.create({
            data: {
              companyId,
              branchId: document.branchId,
              warehouseId,
              itemId: line.itemId,
              movementDate: new Date(),
              direction: StockDirection.IN,
              quantity: line.quantity,
              unitCost,
              totalCost,
              referenceType: 'PURCHASE_RETURN_REVERSAL',
              referenceId: document.id,
              referenceNumber: document.invoiceNumber,
              createdBy: userId,
            },
          });
        }
        await tx.stockBalance.upsert({
          where: {
            companyId_branchId_itemId: {
              companyId,
              branchId: document.branchId,
              itemId: line.itemId,
            },
          },
          create: {
            companyId,
            branchId: document.branchId,
            itemId: line.itemId,
            quantity: line.quantity,
            value: totalCost,
          },
          update: {
            quantity: { increment: line.quantity },
            value: { increment: totalCost },
          },
        });
      }

      await this.posting.reverse(
        tx,
        companyId,
        userId,
        document.journalEntryId as string,
        `Reversal of purchase return ${document.invoiceNumber}`,
      );
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'REVERSE',
      entity: 'purchase_returns',
      entityId: id,
    });
    return this.findOne(companyId, 'purchases', id, mayReadCost);
  }

  // ------------------------------------------------------------------ helpers

  /// Locks one line of the original invoice and returns it with its current
  /// returned quantity.
  private async lockSalesLine(
    tx: Prisma.TransactionClient,
    originalLineId: string | null,
    originalInvoiceId: string,
  ) {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        quantity: Prisma.Decimal;
        returnedQuantity: Prisma.Decimal;
        unitPrice: Prisma.Decimal;
        lineTotal: Prisma.Decimal;
        returnedSubTotal: Prisma.Decimal;
        costTotal: Prisma.Decimal;
        returnedCostTotal: Prisma.Decimal;
        taxAmount: Prisma.Decimal;
        returnedTaxTotal: Prisma.Decimal;
        description: string;
        itemId: string | null;
        costCenterId: string | null;
      }>
    >(Prisma.sql`
      SELECT id, quantity, "returnedQuantity", "unitPrice", "lineTotal", "returnedSubTotal",
             "costTotal", "returnedCostTotal", "taxAmount", "returnedTaxTotal", description, "itemId",
             "costCenterId"
        FROM sales_invoice_lines
       WHERE "invoiceId" = ${originalInvoiceId}::uuid
         AND (${originalLineId}::uuid IS NULL OR id = ${originalLineId}::uuid)
       ORDER BY "lineNumber"
       FOR UPDATE
    `);
    if (rows.length === 0) {
      throw new BadRequestException('The original invoice line could not be found');
    }
    return rows[0];
  }

  private async lockPurchaseLine(
    tx: Prisma.TransactionClient,
    originalLineId: string | null,
    originalInvoiceId: string,
  ) {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        quantity: Prisma.Decimal;
        returnedQuantity: Prisma.Decimal;
        unitPrice: Prisma.Decimal;
        lineTotal: Prisma.Decimal;
        returnedSubTotal: Prisma.Decimal;
        inventoryCostTotal: Prisma.Decimal;
        returnedCostTotal: Prisma.Decimal;
        taxAmount: Prisma.Decimal;
        returnedTaxTotal: Prisma.Decimal;
        description: string;
        itemId: string | null;
        costCenterId: string | null;
      }>
    >(Prisma.sql`
      SELECT id, quantity, "returnedQuantity", "unitPrice", "lineTotal", "returnedSubTotal",
             "inventoryCostTotal", "returnedCostTotal", "taxAmount", "returnedTaxTotal",
             description, "itemId", "costCenterId"
        FROM purchase_invoice_lines
       WHERE "invoiceId" = ${originalInvoiceId}::uuid
         AND (${originalLineId}::uuid IS NULL OR id = ${originalLineId}::uuid)
       ORDER BY "lineNumber"
       FOR UPDATE
    `);
    if (rows.length === 0) {
      throw new BadRequestException('The original invoice line could not be found');
    }
    return rows[0];
  }

  /// The line of the original invoice that a return line gives back, for
  /// reversing a return.
  private async findOriginalLineById(
    tx: Prisma.TransactionClient,
    returnLine: { originalLineId: string | null },
  ) {
    if (!returnLine.originalLineId) return null;
    return tx.salesInvoiceLine.findUnique({ where: { id: returnLine.originalLineId } });
  }

  private async findOriginalPurchaseLineById(
    tx: Prisma.TransactionClient,
    returnLine: { originalLineId: string | null },
  ) {
    if (!returnLine.originalLineId) return null;
    return tx.purchaseInvoiceLine.findUnique({ where: { id: returnLine.originalLineId } });
  }

  /// Assigns a proportional amount to a partial return and gives the final
  /// return the exact remaining cents/four-decimal units. This is used for
  /// inventory cost and VAT, so a sequence of partial notes exactly reverses
  /// the posted original line.
  private allocateReturnedCost(
    originalTotal: Prisma.Decimal,
    alreadyReturned: Prisma.Decimal,
    originalQuantity: Prisma.Decimal,
    alreadyReturnedQuantity: Prisma.Decimal,
    quantity: Prisma.Decimal,
    field: string,
  ): Prisma.Decimal {
    if (originalTotal.isNegative() || alreadyReturned.isNegative()) {
      throw new BadRequestException(`${field} has an invalid negative amount`);
    }
    const remainingQuantity = originalQuantity.minus(alreadyReturnedQuantity);
    const remainingAmount = originalTotal.minus(alreadyReturned);
    if (remainingQuantity.lessThanOrEqualTo(0) || remainingAmount.isNegative()) {
      throw new BadRequestException(`${field} is already fully returned or inconsistent`);
    }
    if (quantity.greaterThan(remainingQuantity)) {
      throw new BadRequestException(`${field} exceeds the original line's remaining quantity`);
    }
    if (quantity.equals(remainingQuantity)) return remainingAmount;
    return remainingAmount
      .mul(quantity)
      .div(remainingQuantity)
      .toDecimalPlaces(MONEY_SCALE);
  }

  /// An identifier that a request must carry. An empty one is refused instead
  /// of being handed to Prisma, where `undefined` means "match anything".
  private requiredId(value: unknown, field: string): string {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id) throw new BadRequestException(`${field} is required`);
    return id;
  }

  /**
   * A return always follows the unit of its original invoice line. The entered
   * quantity is expressed in that unit and converted into the base quantity
   * the existing return limits, cost allocation and stock ledger all operate
   * in. Legacy lines without a snapshot behave exactly as before (factor 1).
   */
  private resolveReturnUnit(
    field: string,
    originalLine: {
      unitName?: string | null;
      unitFactor?: Prisma.Decimal | null;
      item?: { unit: string } | null;
    },
    raw: ReturnLineInput,
  ): {
    baseQuantity: Prisma.Decimal;
    unitName: string | null;
    unitFactor: Prisma.Decimal | null;
    unitQuantity: Prisma.Decimal | null;
  } {
    const entered = parseDocumentQuantity(raw.quantity, `${field} quantity`);
    if (entered.lessThanOrEqualTo(0)) throw new BadRequestException(`${field} quantity must be greater than zero`);
    // Unit ids are not frozen on historical invoice lines; they cannot be
    // trusted as evidence of the original conversion factor.
    if (raw.unitId) throw new BadRequestException(`${field}: unit id cannot be verified against the original invoice`);
    const hasSnapshot =
      originalLine.unitFactor !== null && originalLine.unitFactor !== undefined;

    if (!hasSnapshot) {
      const requested = String(raw.unitName ?? '').trim().toLowerCase();
      const base = String(originalLine.item?.unit ?? '').trim().toLowerCase();
      if (requested && (!base || requested !== base)) {
        throw new BadRequestException(`${field}: legacy invoice has no trusted conversion for the requested unit`);
      }
      return { baseQuantity: entered, unitName: null, unitFactor: null, unitQuantity: null };
    }

    if (raw.unitName) {
      const asked = String(raw.unitName).trim().toLowerCase();
      const stored = String(originalLine.unitName ?? '').trim().toLowerCase();
      if (asked !== stored) {
        throw new BadRequestException(
          `${field}: a return must use the original document's unit (${originalLine.unitName})`,
        );
      }
    }

    const factor = new Prisma.Decimal(originalLine.unitFactor as Prisma.Decimal);
    const baseQuantity = exactBaseQuantity(entered, factor);
    return {
      baseQuantity,
      unitName: originalLine.unitName ?? null,
      unitFactor: factor,
      unitQuantity: entered,
    };
  }

  private positive(value: unknown, field: string): Prisma.Decimal {
    let decimal: Prisma.Decimal;
    try {
      decimal = new Prisma.Decimal(String(value)).toDecimalPlaces(MONEY_SCALE);
    } catch {
      throw new BadRequestException(`${field} is not a valid number`);
    }
    if (decimal.lessThanOrEqualTo(0)) {
      throw new BadRequestException(`${field} must be greater than zero`);
    }
    return decimal;
  }

  private nonNegative(value: unknown, field: string): Prisma.Decimal {
    let decimal: Prisma.Decimal;
    try {
      decimal = new Prisma.Decimal(String(value)).toDecimalPlaces(MONEY_SCALE);
    } catch {
      throw new BadRequestException(`${field} is not a valid number`);
    }
    if (decimal.isNegative()) {
      throw new BadRequestException(`${field} cannot be negative`);
    }
    return decimal;
  }

  private date(value: string, field: string): Date {
    const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${field} is not a valid date`);
    return parsed;
  }

  private toSummary(
    invoice: {
    id: string;
    invoiceNumber: string;
    invoiceDate: Date;
    status: InvoiceStatus;
    documentType: InvoiceDocumentType;
    currency: string;
    subTotal: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    paidAmount: Prisma.Decimal;
    landedCostAmount?: Prisma.Decimal;
    returnReason?: string | null;
    createdAt: Date;
    customer?: { code: string; nameEn: string; nameAr: string } | null;
    supplier?: { code: string; nameEn: string; nameAr: string } | null;
    originalInvoice?: { invoiceNumber: string } | null;
    },
    mayReadCost = true,
  ) {
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
      status: invoice.status.toLowerCase(),
      documentType: invoice.documentType.toLowerCase(),
      currency: invoice.currency,
      subTotal: invoice.subTotal.toFixed(MONEY_SCALE),
      taxAmount: invoice.taxAmount.toFixed(MONEY_SCALE),
      totalAmount: invoice.totalAmount.toFixed(MONEY_SCALE),
      landedCostAmount: mayReadCost
        ? invoice.landedCostAmount?.toFixed(MONEY_SCALE) ?? '0.0000'
        : null,
      paidAmount: invoice.paidAmount.toFixed(MONEY_SCALE),
      balanceDue: invoice.totalAmount.minus(invoice.paidAmount).toFixed(MONEY_SCALE),
      returnReason: invoice.returnReason ?? null,
      originalInvoiceNumber: invoice.originalInvoice?.invoiceNumber ?? null,
      customer: invoice.customer ?? null,
      supplier: invoice.supplier ?? null,
      createdAt: invoice.createdAt.toISOString(),
    };
  }
}
