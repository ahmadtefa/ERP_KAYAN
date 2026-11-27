import { computeDueSchedule, DEFAULT_PAYMENT_TERM_METHOD, PaymentTermConfig, PaymentTermError, PaymentTermMethod } from '../parties/payment-terms';
import { fieldError } from '../../common/validation/field-errors';
import { branchWhere } from '../../common/auth/branch-read-scope';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InvoiceDocumentType, InvoiceStatus, JournalStatus, OrderStatus, Prisma, StockDirection } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { CustomerCreditService } from './customer-credit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  allocateDocumentDiscount,
  assertDiscountLimit,
  DiscountError,
  DiscountInput,
  effectiveDiscountPercent,
  ResolvedDiscount,
  resolveDiscount,
} from '../../common/pricing/discount';
import { CompanySettingsService } from '../../common/settings/company-settings.module';
import { WarehouseService } from '../../common/warehouse/warehouse.service';
import { StockLedgerService } from '../../common/warehouse/stock-ledger.service';
import { batchPolicyOf } from '../../common/warehouse/batch-policy';
import { BatchesService } from '../inventory/batches.service';
import { historicalOrderUnit, orderUnitForInvoiceLine, TrustedOrderUnit } from '../../common/units/order-conversion-unit';
import { orderConversionIdentity } from '../../common/units/order-conversion-identity';
import { selectedOrderLineQuantities } from '../../common/units/order-conversion-selection';
import { planOrderReallocation } from '../../common/units/order-reallocation';
import { createHash } from 'node:crypto';
import { releaseOrderAllocations } from '../../common/units/order-invoice-reconciliation';
import {
  defaultUnitPrice,
  parseDocumentQuantity,
  resolveUnitSelection,
} from '../../common/units/unit-math';
import { PriceListsService } from './price-lists.service';
import { AccountMapService } from '../accounting/account-map.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { attributedLines } from '../accounting/cost-center-attribution';
import { PostingService } from '../accounting/posting.service';
import {
  CreateSalesInvoiceDto,
  ListInvoicesDto,
  SalesInvoiceLineDto,
} from './dto/sales-invoice.dto';

const MONEY_SCALE = 4;
const RATE_SCALE = 4;

interface PreparedLine {
  isAdditionalCharge: boolean;
  lineNumber: number;
  itemId: string | null;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  /// Net of both discounts: the taxable value and the revenue of this line.
  lineTotal: Prisma.Decimal;
  /// Quantity x unit price before any discount.
  grossLineTotal: Prisma.Decimal;
  discountType: 'PERCENT' | 'AMOUNT' | null;
  discountPercent: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  invoiceDiscountAmount: Prisma.Decimal;
  costCenterId: string | null;
  // Multi-unit snapshot. All null on a legacy/base-unit line; `quantity` above
  // is always the internal base-unit quantity the stock ledger moves.
  unitName: string | null;
  unitFactor: Prisma.Decimal | null;
  unitQuantity: Prisma.Decimal | null;
  /// Seller-chosen source locations, quantities in the line's own unit.
  locationAllocations: Array<{ storageLocationId: string; quantity: string }> | null;
}

interface PreparedInvoice {
  lines: PreparedLine[];
  documentDiscount: ResolvedDiscount;
  lineDiscountTotal: Prisma.Decimal;
}

interface SalesInvoicePreparationOptions {
  pricesExcludeTax?: boolean;
  /// Set by a person saving an invoice from the screen: the save is refused when
  /// a stock item's total quantity is above the branch balance.
  stockCheck?: { mayReadStock: boolean };
}

/// The seller's choice of shelves for one line, kept in the line's own unit.
///
/// The quantities are typed in the line's own unit, so they must add up to the
/// line's quantity in that unit; conversion to base units happens only when
/// the invoice is posted. Every refusal says which line, what was typed and what to
/// change, and nothing is saved until the line is right.
export function normalizeLocationAllocations(
  raw: Array<{ storageLocationId: string; quantity: string }> | undefined,
  lineQuantity: Prisma.Decimal,
  lineNumber: number,
): Array<{ storageLocationId: string; quantity: string }> | null {
  if (!raw || raw.length === 0) return null;
  const seen = new Set<string>();
  let sum = new Prisma.Decimal(0);
  const parsed = raw.map((entry) => {
    let q: Prisma.Decimal;
    try {
      q = new Prisma.Decimal(entry.quantity);
    } catch {
      throw new BadRequestException(
        `السطر ${lineNumber}: كمية الموقع غير صالحة. اكتب رقمًا أكبر من صفر. / ` +
          `Line ${lineNumber}: a location quantity is not a number. Enter a number above zero.`,
      );
    }
    if (q.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        `السطر ${lineNumber}: كمية الموقع يجب أن تكون أكبر من صفر. احذف الموقع أو اكتب كمية. / ` +
          `Line ${lineNumber}: each location quantity must be above zero. Remove that location or enter a quantity.`,
      );
    }
    if (seen.has(entry.storageLocationId)) {
      throw new BadRequestException(
        `السطر ${lineNumber}: نفس الموقع مكرر. اجمع الكميتين في صف واحد. / ` +
          `Line ${lineNumber}: the same location is listed twice. Combine them into one row.`,
      );
    }
    seen.add(entry.storageLocationId);
    sum = sum.plus(q);
    return { id: entry.storageLocationId, q };
  });
  if (!sum.equals(lineQuantity)) {
    throw new BadRequestException(
      `السطر ${lineNumber}: مجموع كميات المواقع ${sum.toFixed(4)} لا يساوي كمية السطر ${lineQuantity.toFixed(4)}. ` +
        'عدّل كميات المواقع حتى يتساوى المجموع مع الكمية. / ' +
        `Line ${lineNumber}: the location quantities add up to ${sum.toFixed(4)} but the line quantity is ` +
        `${lineQuantity.toFixed(4)}. Change the location quantities so they add up to the line quantity.`,
    );
  }
  // Stored exactly as typed, in the line's own unit. The conversion to base
  // units happens once, when the line is posted, so what the screen reads
  // back is what it sent and editing never converts twice.
  return parsed.map((entry) => ({ storageLocationId: entry.id, quantity: entry.q.toFixed(MONEY_SCALE) }));
}

@Injectable()
export class SalesInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: DocumentNumberService,
    private readonly posting: PostingService,
    private readonly accounts: AccountMapService,
    private readonly settings: CompanySettingsService,
    private readonly warehouses: WarehouseService,
    private readonly prices: PriceListsService,
    private readonly audit: AuditService,
    private readonly batches: BatchesService,
    private readonly ledger: StockLedgerService,
    private readonly credit: CustomerCreditService,
  ) {}

  async findAll(companyId: string, query: ListInvoicesDto, mayReadCost = true, branchScope: string[] | null = null) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);

    const where: Prisma.SalesInvoiceWhereInput = {
      companyId,
      deletedAt: null,
      documentType: InvoiceDocumentType.INVOICE,
      ...branchWhere(branchScope),
    };
    if (query.customerId) where.customerId = query.customerId;
    if (query.status) {
      const status = query.status.toUpperCase() as InvoiceStatus;
      if (!Object.values(InvoiceStatus).includes(status)) {
        throw new BadRequestException(`Unknown status: ${query.status}`);
      }
      where.status = status;
    }
    if (query.from || query.to) {
      where.invoiceDate = {};
      if (query.from) (where.invoiceDate as any).gte = new Date(query.from);
      if (query.to) (where.invoiceDate as any).lte = new Date(query.to);
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.salesInvoice.findMany({
        where,
        orderBy: [{ invoiceDate: 'desc' }, { invoiceNumber: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          customer: { select: { code: true, nameEn: true, nameAr: true } },
        },
      }),
      this.prisma.salesInvoice.count({ where }),
    ]);

    return {
      items: items.map((i) => this.toSummary(i, mayReadCost)),
      total,
      page,
      pageSize,
    };
  }

  async taxPricing(companyId: string) {
    const settings = await this.settings.get(companyId);
    return { pricesIncludeTax: settings.pricesIncludeTax };
  }

  async findOne(companyId: string, id: string, mayReadCost = true, branchScope: string[] | null = null) {
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id, companyId, deletedAt: null, ...branchWhere(branchScope) },
      include: {
        customer: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        branch: { select: { code: true, nameEn: true, nameAr: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: { item: { select: { code: true, nameEn: true, nameAr: true, unit: true } } },
        },
      },
    });
    if (!invoice) throw new NotFoundException({ code: 'SALES_INVOICE_NOT_FOUND', message: 'Sales invoice not found' });

    return {
      ...this.toSummary(invoice, mayReadCost),
      warehouseId: invoice.warehouseId ?? null,
      branch: invoice.branch,
      orderId: invoice.salesOrderId,
      updatedAt: invoice.updatedAt.toISOString(),
      notes: invoice.notes,
      journalEntryId: invoice.journalEntryId,
      postedAt: invoice.postedAt?.toISOString() ?? null,
      lines: invoice.lines.map((l) => ({
        id: l.id,
        orderLineId: l.orderLineId,
        lineNumber: l.lineNumber,
        itemId: l.itemId,
        isAdditionalCharge: l.isAdditionalCharge,
        itemCode: l.item?.code ?? null,
        itemNameEn: l.item?.nameEn ?? null,
        itemNameAr: l.item?.nameAr ?? null,
        // Display unit: the unit the user chose, falling back to the item base
        // unit for rows written before multi-unit existed.
        unit: l.unitName ?? l.item?.unit ?? null,
        unitName: l.unitName ?? null,
        unitFactor: l.unitFactor === null || l.unitFactor === undefined ? null : l.unitFactor.toFixed(6),
        // What the user entered in the chosen unit. Legacy rows fall back to
        // the stored quantity, which already is what they typed.
        unitQuantity: (l.unitQuantity ?? l.quantity).toFixed(MONEY_SCALE),
        locationAllocations: (l as { locationAllocations?: unknown }).locationAllocations ?? null,
        description: l.description,
        // Internal base-unit quantity used by stock and returns.
        quantity: l.quantity.toFixed(MONEY_SCALE),
        baseQuantity: l.quantity.toFixed(MONEY_SCALE),
        returnedQuantity: l.returnedQuantity.toFixed(MONEY_SCALE),
        unitPrice: l.unitPrice.toFixed(MONEY_SCALE),
        taxRate: l.taxRate.toFixed(RATE_SCALE),
        taxAmount: l.taxAmount.toFixed(MONEY_SCALE),
        lineTotal: l.lineTotal.toFixed(MONEY_SCALE),
        grossLineTotal: (l.grossLineTotal ?? l.lineTotal).toFixed(MONEY_SCALE),
        discountType: l.discountType ?? null,
        discountPercent: l.discountPercent.toFixed(RATE_SCALE),
        discountAmount: l.discountAmount.toFixed(MONEY_SCALE),
        invoiceDiscountAmount: l.invoiceDiscountAmount.toFixed(MONEY_SCALE),
        costCenterId: l.costCenterId ?? null,
        // Cost snapshots must not leave the API for a role without cost.read;
        // selling, totals and tax figures are unaffected by the redaction.
        unitCost: mayReadCost ? l.unitCost.toFixed(MONEY_SCALE) : null,
        costTotal: mayReadCost ? l.costTotal.toFixed(MONEY_SCALE) : null,
      })),
    };
  }

  /** Creates a DRAFT invoice. Nothing reaches the ledger or the stock ledger. */
  async create(
    companyId: string,
    branchId: string | null,
    userId: string,
    dto: CreateSalesInvoiceDto,
    orderUnits?: readonly TrustedOrderUnit[],
    mayReadCost = true,
    stockView: { mayReadStock: boolean } = { mayReadStock: false },
  ) {
    const created = await this.prisma.$transaction((tx) =>
      this.createInTransaction(companyId, branchId, userId, dto, tx, orderUnits, { stockCheck: stockView }),
    );

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'sales_invoices',
      entityId: created.id,
      after: {
        invoiceNumber: created.invoiceNumber,
        totalAmount: created.totalAmount.toFixed(MONEY_SCALE),
      },
    });

    return this.findOne(companyId, created.id, mayReadCost);
  }

  /** Internal: caller owns the transaction and any required audit records. */
  async createInTransaction(
    companyId: string,
    branchId: string | null,
    userId: string,
    dto: CreateSalesInvoiceDto,
    tx: Prisma.TransactionClient,
    orderUnits?: readonly TrustedOrderUnit[],
    options: SalesInvoicePreparationOptions = {},
  ) {
    if (!branchId) {
      throw new BadRequestException({ code: 'USER_NO_BRANCH', message: 'The signed-in user is not assigned to a branch' });
    }

    const customer = await tx.customer.findFirst({
      where: { id: dto.customerId, companyId, deletedAt: null },
      select: { id: true, nameEn: true, isActive: true },
    });
    if (!customer) throw new BadRequestException({ code: 'CUSTOMER_MISSING', message: 'The customer does not exist' });
    if (!customer.isActive) throw new BadRequestException({ code: 'CUSTOMER_INACTIVE', message: 'The customer is inactive' });

    const prepared = await this.prepareLines(
      companyId,
      dto.lines,
      dto.customerId,
      { type: dto.discountType, percent: dto.discountPercent, amount: dto.discountAmount },
      orderUnits,
      tx,
      options,
    );
    const lines = prepared.lines;
    const totals = this.totalsOf(lines);
    // Every way of raising an invoice, including order and quotation conversion,
    // refuses stock that is not there; conversion callers that cannot tell the
    // person's stock permission default to showing no balance.
    await this.assertStockCovers(tx, companyId, branchId, dto.warehouseId, lines, (options.stockCheck ?? { mayReadStock: false }).mayReadStock);

      // Everything that can be read is read before the number is taken, so
      // the counter row is locked for as short a time as possible.
      const terms = dto.dueDate
        ? { dueDate: new Date(dto.dueDate), dueSchedule: null }
        : await this.dueFromTerms(companyId, dto.customerId, dto.invoiceDate, dto.deliveryDate ?? null, tx);

      const invoiceNumber = await this.numbers.next(
        tx,
        companyId,
        'SALES_INVOICE',
        'SI',
      );

      return tx.salesInvoice.create({
        data: {
          warehouseId: dto.warehouseId ?? null,
          companyId,
          branchId,
          invoiceNumber,
          invoiceDate: new Date(dto.invoiceDate),
          // The due date is what the ageing report counts from. If the person
          // did not give one, the customer's payment terms decide it, so the
          // invoice is never born with no due date at all.
          dueDate: terms.dueDate,
          dueSchedule: terms.dueSchedule ?? Prisma.DbNull,
          deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
          customerId: dto.customerId,
          status: InvoiceStatus.DRAFT,
          discountType: prepared.documentDiscount.type,
          discountPercent: prepared.documentDiscount.percent,
          discountAmount: prepared.documentDiscount.amount,
          lineDiscountTotal: prepared.lineDiscountTotal,
          subTotal: totals.subTotal,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          notes: dto.notes ?? null,
          createdBy: userId,
          lines: {
            create: lines.map((l) => ({
              lineNumber: l.lineNumber,
              itemId: l.itemId,
              isAdditionalCharge: l.isAdditionalCharge,
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              taxRate: l.taxRate,
              taxAmount: l.taxAmount,
              lineTotal: l.lineTotal,
              grossLineTotal: l.grossLineTotal,
              discountType: l.discountType,
              discountPercent: l.discountPercent,
              discountAmount: l.discountAmount,
              invoiceDiscountAmount: l.invoiceDiscountAmount,
              costCenterId: l.costCenterId,
              unitName: l.unitName,
              unitFactor: l.unitFactor,
              unitQuantity: l.unitQuantity,
              ...(l.locationAllocations ? { locationAllocations: l.locationAllocations } : {}),
            })),
          },
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

  }

  /**
   * Replace a draft sales invoice.
   *
   * A posted invoice is immutable: its stock, cost and journal entry already
   * exist, and rewriting the lines afterwards would leave the ledger describing
   * a document that no longer matches it. A draft owns nothing yet, so its
   * lines may be replaced - under a row lock, in one transaction, and only
   * while it is still a draft.
   */
  async updateDraft(
    companyId: string,
    branchId: string | null,
    userId: string,
    id: string,
    dto: CreateSalesInvoiceDto,
    mayReadCost = true,
    stockView: { mayReadStock: boolean } = { mayReadStock: false },
  ) {
    if (!branchId) {
      throw new BadRequestException({ code: 'USER_NO_BRANCH', message: 'The signed-in user is not assigned to a branch' });
    }

    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!invoice) throw new NotFoundException({ code: 'SALES_INVOICE_NOT_FOUND', message: 'Sales invoice not found' });
    if (invoice.salesOrderId) throw new BadRequestException('Order-linked draft editing requires allocation reconciliation; manual review required');
    if (invoice.documentType !== InvoiceDocumentType.INVOICE) {
      throw new BadRequestException({ code: 'INVOICE_RETURN_NOT_EDITABLE', message: 'Return documents cannot be edited as sales invoices' });
    }
    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException({ code: 'INVOICE_NOT_DRAFT_EDIT', message: 'Only a draft sales invoice can be edited' });
    }
    if (invoice.branchId !== branchId) {
      throw new BadRequestException({ code: 'INVOICE_OTHER_BRANCH', message: 'A draft can only be edited from its assigned branch' });
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, companyId, deletedAt: null },
      select: { id: true, isActive: true },
    });
    if (!customer) throw new BadRequestException({ code: 'CUSTOMER_MISSING', message: 'The customer does not exist' });
    if (!customer.isActive) throw new BadRequestException({ code: 'CUSTOMER_INACTIVE', message: 'The customer is inactive' });

    const prepared = await this.prepareLines(
      companyId,
      dto.lines,
      dto.customerId,
      { type: dto.discountType, percent: dto.discountPercent, amount: dto.discountAmount },
    );
    const lines = prepared.lines;
    const totals = this.totalsOf(lines);
    const invoiceDate = new Date(dto.invoiceDate);
    const terms = dto.dueDate
      ? { dueDate: new Date(dto.dueDate), dueSchedule: null }
      : await this.dueFromTerms(companyId, dto.customerId, dto.invoiceDate, dto.deliveryDate ?? null);
    const dueDate = terms.dueDate;

    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: InvoiceStatus; salesOrderId: string | null }>>(Prisma.sql`
        SELECT status, "salesOrderId"
          FROM sales_invoices
         WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL
         FOR UPDATE
      `);
      if (locked.length !== 1 || locked[0].status !== InvoiceStatus.DRAFT) {
        throw new BadRequestException(
          'This invoice was posted or changed by someone else. Reload it before editing.',
        );
      }

      if (locked[0].salesOrderId) throw new BadRequestException('Order-linked draft editing requires allocation reconciliation; manual review required');

      await this.assertStockCovers(tx, companyId, branchId, dto.warehouseId ?? invoice.warehouseId, lines, stockView.mayReadStock);

      await tx.salesInvoice.update({
        where: { id },
        data: {
          customerId: dto.customerId,
          invoiceDate,
          dueDate,
          dueSchedule: terms.dueSchedule ?? Prisma.DbNull,
          deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
          warehouseId: dto.warehouseId ?? invoice.warehouseId,
          discountType: prepared.documentDiscount.type,
          discountPercent: prepared.documentDiscount.percent,
          discountAmount: prepared.documentDiscount.amount,
          lineDiscountTotal: prepared.lineDiscountTotal,
          subTotal: totals.subTotal,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          notes: dto.notes ?? null,
          lines: {
            deleteMany: {},
            create: lines.map((line) => ({
              lineNumber: line.lineNumber,
              itemId: line.itemId,
              isAdditionalCharge: line.isAdditionalCharge,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              taxRate: line.taxRate,
              taxAmount: line.taxAmount,
              lineTotal: line.lineTotal,
              grossLineTotal: line.grossLineTotal,
              discountType: line.discountType,
              discountPercent: line.discountPercent,
              discountAmount: line.discountAmount,
              invoiceDiscountAmount: line.invoiceDiscountAmount,
              costCenterId: line.costCenterId,
              unitName: line.unitName,
              unitFactor: line.unitFactor,
              unitQuantity: line.unitQuantity,
              ...(line.locationAllocations ? { locationAllocations: line.locationAllocations } : {}),
            })),
          },
        },
      });
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'sales_invoices',
      entityId: id,
      before: { status: invoice.status, totalAmount: invoice.totalAmount.toFixed(MONEY_SCALE) },
      after: { status: InvoiceStatus.DRAFT, totalAmount: totals.totalAmount.toFixed(MONEY_SCALE) },
    });

    return this.findOne(companyId, id, mayReadCost);
  }

  /**
   * Posts a draft invoice.
   *
   * Everything happens in one transaction: the stock is issued at the current
   * weighted average cost, the cost lines are written onto the invoice, and the
   * journal entry is created. If any of it fails, none of it happened.
   */
  /** Replace the allocation of an order-linked draft without changing its original conversion identity. */
  async updateOrderAllocation(companyId: string, branchId: string | null, userId: string, id: string, dto: Record<string, unknown>) {
    if (!branchId) throw new BadRequestException({ code: 'USER_NO_BRANCH', message: 'The signed-in user is not assigned to a branch' });
    const before = await this.prisma.salesInvoice.findFirst({
      where: { id, companyId, branchId, deletedAt: null }, select: { salesOrderId: true },
    });
    if (!before?.salesOrderId) throw new BadRequestException('Invoice is not linked to an order');
    const orderId = before.salesOrderId;
    if (typeof dto.expectedUpdatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(dto.expectedUpdatedAt)) {
      throw new BadRequestException({ code: 'FIELD_REQUIRED', message: 'expectedUpdatedAt is required', field: 'expectedUpdatedAt' });
    }
    const expectedUpdatedAt = dto.expectedUpdatedAt;
    await this.prisma.$transaction(async (tx) => {
      // Lock in the same order as conversion, cancellation and reversal.
      const lockedOrder = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM sales_orders WHERE id = ${orderId}::uuid AND "companyId" = ${companyId}::uuid
          AND "branchId" = ${branchId}::uuid AND "deletedAt" IS NULL FOR UPDATE
      `);
      if (lockedOrder.length !== 1) throw new NotFoundException({ code: 'SALES_ORDER_NOT_FOUND', message: 'Sales order not found' });
      const lockedInvoice = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM sales_invoices WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid
          AND "branchId" = ${branchId}::uuid AND "deletedAt" IS NULL FOR UPDATE
      `);
      if (lockedInvoice.length !== 1) throw new NotFoundException({ code: 'SALES_INVOICE_NOT_FOUND', message: 'Sales invoice not found' });
      const invoice = await tx.salesInvoice.findFirst({
        where: { id, companyId, branchId, deletedAt: null }, include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      const order = await tx.salesOrder.findFirst({
        where: { id: orderId, companyId, branchId, deletedAt: null }, include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      if (!invoice || !order || invoice.salesOrderId !== orderId) throw new BadRequestException('Order allocation changed; reload');
      const requested = selectedOrderLineQuantities(dto.lines, order.lines);
      const identity = orderConversionIdentity(dto, requested);
      const hash = createHash('sha256').update(JSON.stringify({ selection: identity.hash, expectedUpdatedAt })).digest('hex');
      const previous = await tx.auditLog.findFirst({
        where: { companyId, entity: 'sales_invoices', entityId: id, action: 'AMEND_ORDER_ALLOCATION',
          afterJson: { path: ['amendmentKey'], equals: identity.key } },
      });
      if (previous) {
        const after = previous.afterJson as { amendmentHash?: string } | null;
        if (after?.amendmentHash !== hash) throw new ConflictException('The idempotency key was used for a different amendment');
        if (invoice.status !== InvoiceStatus.DRAFT) throw new ConflictException('The amended invoice is no longer a draft');
        return;
      }
      if (invoice.status !== InvoiceStatus.DRAFT || invoice.documentType !== InvoiceDocumentType.INVOICE) {
        throw new BadRequestException('Only an active draft invoice can be amended');
      }
      if (invoice.updatedAt.toISOString() !== expectedUpdatedAt) throw new ConflictException({ code: 'INVOICE_CHANGED_RELOAD', message: 'The invoice changed; reload before editing' });
      if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.DRAFT) throw new BadRequestException('Related order cannot be amended');
      if (!invoice.discountAmount.isZero() || !invoice.discountPercent.isZero()) {
        throw new BadRequestException('This invoice has additional charges or discounts; manual review required');
      }
      const counters = planOrderReallocation(order.lines, invoice.lines, requested);
      const prior = new Map<string, typeof invoice.lines[number]>();
      for (const old of invoice.lines) {
        if (old.isAdditionalCharge || !old.orderLineId || prior.has(old.orderLineId) || old.discountType === 'AMOUNT' || !old.returnedQuantity.isZero()) {
          throw new BadRequestException('Historical invoice lines require manual review');
        }
        prior.set(old.orderLineId, old);
      }
      const selected = order.lines.filter((line) => requested.has(line.id));
      const units: TrustedOrderUnit[] = [];
      const rawLines = selected.map((line) => {
        const existing = prior.get(line.id);
        if (existing && existing.itemId !== line.itemId) throw new BadRequestException('Historical order item changed; manual review required');
        // Existing lines keep the invoice snapshot even if the order was
        // changed later. Newly selected lines use the agreed order snapshot.
        const source = existing ?? line;
        const historical = historicalOrderUnit({ label: `Line ${line.lineNumber}`, unitName: source.unitName,
          unitFactor: source.unitFactor, baseQuantity: requested.get(line.id)! });
        units.push({ itemId: line.itemId, resolved: historical });
        return { itemId: line.itemId, description: source.description,
          quantity: (historical.snapshot.unitQuantity ?? historical.baseQuantity).toFixed(MONEY_SCALE),
          unitPrice: source.unitPrice.toFixed(MONEY_SCALE), taxRate: source.taxRate.toFixed(MONEY_SCALE),
          discountPercent: source.discountPercent.toFixed(MONEY_SCALE), unitName: source.unitName ?? undefined,
          costCenterId: existing?.costCenterId ?? undefined };
      });
      const prepared = await this.prepareLines(companyId, rawLines, invoice.customerId, {}, units, tx);
      const totals = this.totalsOf(prepared.lines);
      const subTotal = totals.subTotal, taxAmount = totals.taxAmount, totalAmount = totals.totalAmount;
      await tx.salesInvoice.update({
        where: { id }, data: { subTotal, taxAmount, totalAmount,
          discountType: prepared.documentDiscount.type, discountPercent: prepared.documentDiscount.percent,
          discountAmount: prepared.documentDiscount.amount, lineDiscountTotal: prepared.lineDiscountTotal,
          lines: { deleteMany: {}, create: prepared.lines.map((line, index) => ({
            orderLineId: selected[index].id, lineNumber: line.lineNumber, itemId: line.itemId,
            description: line.description, quantity: line.quantity, unitPrice: line.unitPrice,
            taxRate: line.taxRate, taxAmount: line.taxAmount, lineTotal: line.lineTotal,
            grossLineTotal: line.grossLineTotal, discountType: line.discountType,
            discountPercent: line.discountPercent, discountAmount: line.discountAmount,
            invoiceDiscountAmount: line.invoiceDiscountAmount,
            costCenterId: line.costCenterId, unitName: line.unitName, unitFactor: line.unitFactor, unitQuantity: line.unitQuantity,
          })) },
        },
      });
      for (const line of order.lines) await tx.salesOrderLine.update({
        where: { id: line.id }, data: { invoicedQuantity: counters.get(line.id)! },
      });
      const complete = order.lines.every((line) => counters.get(line.id)!.greaterThanOrEqualTo(line.quantity));
      const none = order.lines.every((line) => counters.get(line.id)!.isZero());
      await tx.salesOrder.update({ where: { id: orderId }, data: {
        status: none ? OrderStatus.APPROVED : complete ? OrderStatus.FULFILLED : OrderStatus.PARTIALLY_FULFILLED,
      } });
      await this.audit.recordRequired({
        companyId, userId, action: 'AMEND_ORDER_ALLOCATION', entity: 'sales_invoices', entityId: id,
        before: { totalAmount: invoice.totalAmount.toFixed(MONEY_SCALE), allocations: invoice.lines.map((line) => ({ orderLineId: line.orderLineId, quantity: line.quantity.toFixed(MONEY_SCALE) })) },
        after: { amendmentKey: identity.key, amendmentHash: hash, totalAmount: totalAmount.toFixed(MONEY_SCALE),
          allocations: selected.map((line) => ({ orderLineId: line.id, quantity: requested.get(line.id)!.toFixed(MONEY_SCALE) })) },
      }, tx);
    }, { maxWait: 10000, timeout: 30000 });
    return this.findOne(companyId, id, false);
  }

  /** Cancel a draft without deleting its historical identity or retry key. */
  async cancelDraft(companyId: string, branchId: string | null, userId: string, id: string) {
    if (!branchId) throw new BadRequestException({ code: 'USER_NO_BRANCH', message: 'The signed-in user is not assigned to a branch' });
    await this.prisma.$transaction(async (tx) => {
      let invoice = await tx.salesInvoice.findFirst({
        where: { id, companyId, branchId, deletedAt: null },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      if (!invoice) throw new NotFoundException({ code: 'SALES_INVOICE_NOT_FOUND', message: 'Sales invoice not found' });
      if (invoice.documentType !== InvoiceDocumentType.INVOICE || invoice.status !== InvoiceStatus.DRAFT) {
        throw new BadRequestException({ code: 'INVOICE_NOT_DRAFT_CANCEL', message: 'Only a draft invoice can be cancelled' });
      }
      if (invoice.salesOrderId) {
        // An amendment can commit while we wait for the order lock. Reload
        // its allocation afterwards; releasing the pre-lock snapshot corrupts
        // the order counters even though both operations are transactions.
        const orderId = invoice.salesOrderId;
        const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM sales_orders WHERE id = ${orderId}::uuid AND "companyId" = ${companyId}::uuid
            AND "deletedAt" IS NULL FOR UPDATE
        `);
        if (locked.length !== 1) throw new BadRequestException('Related order is missing; manual review required');
        invoice = await tx.salesInvoice.findFirst({
          where: { id, companyId, branchId, deletedAt: null },
          include: { lines: { orderBy: { lineNumber: 'asc' } } },
        });
        if (!invoice || invoice.salesOrderId !== orderId || invoice.status !== InvoiceStatus.DRAFT) {
          throw new BadRequestException('Invoice was posted or cancelled concurrently');
        }
        await releaseOrderAllocations(tx, 'sales', companyId, orderId, invoice.lines);
      }
      const claimed = await tx.salesInvoice.updateMany({
        where: { id, companyId, branchId, status: InvoiceStatus.DRAFT, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (claimed.count !== 1) throw new BadRequestException('Invoice was posted or cancelled concurrently');
      await this.audit.recordRequired({ companyId, userId, action: 'CANCEL_DRAFT',
        entity: 'sales_invoices', entityId: id, after: { invoiceNumber: invoice.invoiceNumber } }, tx);
    });
    return { id, cancelled: true };
  }

  /// Posts a draft invoice, issuing its goods from the lots they live in.
  ///
  /// `expiry` is what the controller resolved from the caller's permissions, not
  /// anything the request body said. When it is absent a sale simply may not
  /// touch an expired lot: the engine skips those and answers with how many
  /// short the invoice is.
  /// What the warehouse holds on real locations for one item, per location.
  /// Refuses a save whose quantities cannot be issued from the stock on hand.
  ///
  /// Posting makes the same comparisons under a lock; this is the early refusal
  /// so an invoice that could never be posted is not saved as a draft at all.
  /// Quantities of the same item on several lines are added together first.
  /// Two books are compared, the way posting reads them: the branch total
  /// (stock_balances) and the warehouse the invoice will issue from
  /// (warehouse_stock_balances). The warehouse is the one named on the invoice,
  /// else the branch default; when none can be found without creating one, only
  /// the branch total is checked and posting decides. Nothing is written, and the
  /// person's screen keeps what they typed. This is not a reservation: two
  /// people saving at once can both pass, and the locked check at post stays.
  private async assertStockCovers(
    tx: Prisma.TransactionClient,
    companyId: string,
    branchId: string,
    namedWarehouseId: string | null | undefined,
    lines: Array<{ lineNumber: number; itemId: string | null; quantity: Prisma.Decimal; isAdditionalCharge: boolean }>,
    mayReadStock: boolean,
  ) {
    const wanted = new Map<string, { total: Prisma.Decimal; lineNumbers: number[] }>();
    for (const line of lines) {
      if (line.isAdditionalCharge || !line.itemId) continue;
      const entry = wanted.get(line.itemId) ?? { total: new Prisma.Decimal(0), lineNumbers: [] };
      entry.total = entry.total.plus(line.quantity);
      entry.lineNumbers.push(line.lineNumber);
      wanted.set(line.itemId, entry);
    }
    if (wanted.size === 0) return;
    const items = await tx.item.findMany({
      where: { id: { in: [...wanted.keys()] }, companyId, deletedAt: null },
      select: { id: true, code: true, nameEn: true, nameAr: true, unit: true, isStockTracked: true },
    });
    const tracked = items.filter((i) => i.isStockTracked);
    if (tracked.length === 0) return;

    // The warehouse posting would use, found without creating anything.
    let warehouse: { id: string; code: string } | null = null;
    if (namedWarehouseId) {
      warehouse = await tx.warehouse.findFirst({
        where: { id: namedWarehouseId, companyId, branchId, deletedAt: null, isActive: true },
        select: { id: true, code: true },
      });
    } else {
      warehouse = await tx.warehouse.findFirst({
        where: { companyId, branchId, deletedAt: null },
        orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
        select: { id: true, code: true },
      });
    }
    const itemIds = tracked.map((i) => i.id);
    const idList = Prisma.join(itemIds.map((id) => Prisma.sql`${id}::uuid`));
    const branchRows = await tx.$queryRaw<Array<{ itemId: string; quantity: Prisma.Decimal }>>(Prisma.sql`
      SELECT "itemId", "quantity"
        FROM "stock_balances"
       WHERE "companyId" = ${companyId}::uuid
         AND "branchId" = ${branchId}::uuid
         AND "itemId" IN (${idList})
    `);
    const branchHave = new Map(branchRows.map((r) => [r.itemId, new Prisma.Decimal(r.quantity)]));
    const warehouseHave = new Map<string, Prisma.Decimal>();
    if (warehouse) {
      const rows = await tx.$queryRaw<Array<{ itemId: string; quantity: Prisma.Decimal }>>(Prisma.sql`
        SELECT "itemId", "quantity"
          FROM "warehouse_stock_balances"
         WHERE "companyId" = ${companyId}::uuid
           AND "warehouseId" = ${warehouse.id}::uuid
           AND "itemId" IN (${idList})
      `);
      for (const r of rows) warehouseHave.set(r.itemId, new Prisma.Decimal(r.quantity));
    }
    const zero = new Prisma.Decimal(0);
    const f = (d: Prisma.Decimal) => d.toFixed(MONEY_SCALE);
    const short = tracked
      .map((item) => {
        const need = wanted.get(item.id)!;
        const inBranch = branchHave.get(item.id) ?? zero;
        const inWarehouse = warehouse ? (warehouseHave.get(item.id) ?? zero) : null;
        // The warehouse is the tighter, more specific book when it is known.
        const scope: 'WAREHOUSE' | 'BRANCH' | null =
          inWarehouse !== null && inWarehouse.lessThan(need.total)
            ? 'WAREHOUSE'
            : inBranch.lessThan(need.total) ? 'BRANCH' : null;
        return { item, need, scope, have: scope === 'WAREHOUSE' ? inWarehouse! : inBranch };
      })
      .filter((x) => x.scope !== null)
      .sort((a, b) => Math.min(...a.need.lineNumbers) - Math.min(...b.need.lineNumbers));
    if (short.length === 0) return;
    const parts = short.map(({ item, need, have, scope }) => {
      const lineList = need.lineNumbers.join(', ');
      const label = `${item.code} ${item.nameAr || item.nameEn}`.trim();
      const whCode = warehouse?.code ?? '';
      const whereAr = scope === 'WAREHOUSE' ? `في المخزن ${whCode}` : 'في فرع الفاتورة';
      const whereEn = scope === 'WAREHOUSE' ? `in warehouse ${whCode}` : 'in the invoice branch';
      return mayReadStock
        ? { ar: `${label} (سطر ${lineList}): المطلوب ${f(need.total)} والمتاح ${whereAr} ${f(have)} ${item.unit}`,
            en: `${item.code} ${item.nameEn} (line ${lineList}): requested ${f(need.total)}, available ${whereEn} ${f(have)} ${item.unit}` }
        : { ar: `${label} (سطر ${lineList}): المطلوب ${f(need.total)} أكبر من المتاح ${whereAr}`,
            en: `${item.code} ${item.nameEn} (line ${lineList}): requested ${f(need.total)} is more than is available ${whereEn}` };
    });
    throw new BadRequestException({
      code: 'SALES_SAVE_STOCK_SHORT',
      message:
        `لم تُحفظ الفاتورة: الكمية أكبر من رصيد المخزون. ${parts.map((p) => p.ar).join('؛ ')}. ` +
        `خفّض الكمية إلى المتاح أو غيّر المخزن أو احذف الصنف من الفاتورة ثم احفظ من جديد؛ بياناتك كما أدخلتها ولم يُنشأ مستند. / ` +
        `The invoice was not saved: the quantity is more than the stock on hand. ${parts.map((p) => p.en).join('; ')}. ` +
        `Lower the quantity to what is available, choose another warehouse, or remove the item, then save again; your entries are kept and no document was created.`,
      errors: {
        lines: short.map(({ item, need, have, scope }) => ({
          lineNumbers: need.lineNumbers,
          itemCode: item.code,
          requested: f(need.total),
          scope,
          ...(scope === 'WAREHOUSE' && warehouse ? { warehouseCode: warehouse.code } : {}),
          ...(mayReadStock ? { available: f(have) } : {}),
        })),
      },
    });
  }

  private async placedStock(
    tx: Prisma.TransactionClient,
    companyId: string,
    warehouseId: string,
    itemId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ code: string; quantity: Prisma.Decimal }>>(Prisma.sql`
      SELECT l."code" AS "code",
             SUM(CASE WHEN m."direction" = 'IN' THEN m."quantity" ELSE -m."quantity" END) AS "quantity"
        FROM "stock_movements" m
        JOIN "storage_locations" l ON l."id" = m."storageLocationId"
       WHERE m."companyId" = ${companyId}::uuid
         AND m."warehouseId" = ${warehouseId}::uuid
         AND m."itemId" = ${itemId}::uuid
       GROUP BY l."code"
      HAVING SUM(CASE WHEN m."direction" = 'IN' THEN m."quantity" ELSE -m."quantity" END) > 0
       ORDER BY l."code"
    `);
    const mapped = rows.map((r) => ({ code: r.code, quantity: new Prisma.Decimal(r.quantity) }));
    return { rows: mapped, total: mapped.reduce((a, r) => a.plus(r.quantity), new Prisma.Decimal(0)) };
  }

  async post(
    companyId: string,
    userId: string,
    id: string,
    mayReadCost = true,
    expiry?: { mayIssueExpired: boolean; reason?: string | null },
    creditView: { mayDiscloseBalance: boolean; mayReadStock?: boolean; mayReadInvoice?: boolean } = { mayDiscloseBalance: false },
  ) {
    const expiredApproval =
      expiry?.mayIssueExpired === true
        ? {
            userId,
            reason: (expiry.reason ?? '').trim().length >= 3 ? (expiry.reason as string).trim() : '',
          }
        : null;

    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { status: true },
    });
    if (!invoice) throw new NotFoundException({ code: 'SALES_INVOICE_NOT_FOUND', message: 'Sales invoice not found' });
    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException(
        `Only draft invoices can be posted (current status: ${invoice.status})`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // A customer over their credit limit cannot be invoiced without a signed
      // approval for this very invoice. Checked before the claim so the
      // invoice being posted is not already counted in the balance.
      await this.credit.assertCanPost(tx, companyId, id, creditView.mayDiscloseBalance);
      // A customer past the agreed payment period is held the same way.
      await this.credit.assertPeriodCanPost(tx, companyId, id, creditView.mayDiscloseBalance);
      // Claim the document before anything else happens. Two people pressing
      // Post at the same moment: the row lock lets exactly one of them win, and
      // the other is told the invoice has already been posted - instead of both
      // of them issuing the same stock and writing the same revenue twice.
      const claimed = await tx.salesInvoice.updateMany({
        where: { id, companyId, status: InvoiceStatus.DRAFT, deletedAt: null },
        data: { status: InvoiceStatus.POSTED, postedAt: new Date(), postedBy: userId },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException(
          'This invoice was posted by someone else a moment ago. Reload it to see the current state.',
        );
      }

      // The draft may have been edited while this request waited for the row
      // lock. Read both the header and lines only after the guarded claim, on
      // the same transaction, so stock and journal use the committed version.
      const invoice = await tx.salesInvoice.findFirst({
        where: { id, companyId, deletedAt: null },
        include: {
          lines: { orderBy: { lineNumber: 'asc' } },
          customer: { select: { code: true, nameEn: true } },
        },
      });
      if (!invoice) throw new NotFoundException({ code: 'SALES_INVOICE_NOT_FOUND', message: 'Sales invoice not found' });

      const accounts = await this.accounts.resolve(tx, companyId, [
        'accountsReceivable',
        'salesRevenue',
        'vatPayable',
        'inventory',
        'costOfGoodsSold',
      ]);

      // Which pile the goods left. A document that names none uses the
      // branch's default, which is what keeps the warehouse reports complete.
      const warehouseId = await this.warehouses.resolve(
        tx,
        companyId,
        invoice.branchId,
        invoice.warehouseId,
      );
      if (!invoice.warehouseId && warehouseId) {
        await tx.salesInvoice.update({
          where: { id: invoice.id },
          data: { warehouseId },
        });
      }

      // ---- stock issue
      //
      // The goods leave the lots they actually live in, not an abstract
      // branch balance. Issuing through the lot engine is what makes FEFO
      // real: it picks the nearest expiry first, skips expired lots unless an
      // approval travels with the request, walks on to the next lot when one
      // cannot cover the line, and writes one stock movement per lot so every
      // quantity sold can be traced back to where it came from.
      //
      // An item that keeps no lots still issues exactly as before. The engine
      // detects that itself and takes the weighted average off the shelf, so
      // the two paths cannot drift apart.
      // Every item's stock lock is taken up front, in one fixed order, before
      // any line is issued: two invoices listing A,B and B,A must not deadlock.
      if (warehouseId) {
        await this.batches.lockItemsStock(
          tx,
          warehouseId,
          invoice.lines.flatMap((l) => (l.itemId ? [l.itemId] : [])),
        );
      }
      let costOfGoods = new Prisma.Decimal(0);
      const costByLine = new Map<string, { unitCost: Prisma.Decimal; costTotal: Prisma.Decimal }>();

      for (const line of invoice.lines) {
        if (!line.itemId) continue;

        const item = await tx.item.findFirst({
          where: { id: line.itemId, companyId, deletedAt: null },
          select: {
            id: true,
            code: true,
            nameEn: true,
            nameAr: true,
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
        if (!item) throw new BadRequestException('An invoice line references a missing item');
        if (!item.isStockTracked) continue;

        // The branch balance is still checked first, because it is the figure
        // the invoice's own cost is computed from and the one a reader sees on
        // the customer's screen. The lot engine then proves the goods exist in
        // this particular warehouse and takes them from named lots.
        const lockedBalances = await tx.$queryRaw<
          Array<{ quantity: Prisma.Decimal; value: Prisma.Decimal }>
        >(Prisma.sql`
          SELECT "quantity", "value"
            FROM "stock_balances"
           WHERE "companyId" = ${companyId}::uuid
             AND "branchId" = ${invoice.branchId}::uuid
             AND "itemId" = ${item.id}::uuid
           FOR UPDATE
        `);
        const balance = lockedBalances[0] ?? null;

        const qtyOnHand = balance?.quantity ?? new Prisma.Decimal(0);
        const valueOnHand = balance?.value ?? new Prisma.Decimal(0);

        if (qtyOnHand.lessThan(line.quantity)) {
          throw new BadRequestException({
            code: 'SALES_POST_BRANCH_STOCK',
            message: 'Review stock in the invoice branch before posting.',
            errors: {
              ...(creditView.mayReadInvoice ? { lineNumber: String(line.lineNumber), itemCode: item.code.slice(0, 64) } : {}),
              ...(creditView.mayReadStock ? { available: qtyOnHand.toFixed(MONEY_SCALE), requested: line.quantity.toFixed(MONEY_SCALE) } : {}),
            },
          });
        }

        // A lot-controlled item cannot be sold from a branch that has no shelf
        // for it: there would be nothing to point at when somebody asks which
        // batch the customer received.
        if (batchPolicyOf(item).requiresBatch && !warehouseId) {
          throw new BadRequestException(
            `الصنف ${item.code} يتطلب دفعة ولا يوجد مخزن للفرع. / ` +
              `Item ${item.code} is lot-controlled, and this branch has no warehouse to issue it from.`,
          );
        }

        // Where the goods come from. When the item has placed stock in this
        // warehouse the seller must say which shelves, otherwise the shelf
        // balances would drift away from the goods that actually left. An item
        // with no placed stock sells exactly as before.
        const enteredAllocations = (line as { locationAllocations?: unknown }).locationAllocations as
          | Array<{ storageLocationId: string; quantity: string }>
          | null
          | undefined;
        // Typed in the line's unit; stock moves in base units. Converted here,
        // once. The last row takes the rounding remainder so the parts add up
        // to the base quantity exactly.
        const enteredTotal = new Prisma.Decimal(line.unitQuantity ?? line.quantity);
        const toBase = enteredTotal.isZero() ? new Prisma.Decimal(1) : line.quantity.div(enteredTotal);
        let usedBase = new Prisma.Decimal(0);
        const allocations = enteredAllocations?.length
          ? enteredAllocations.map((entry, i) => {
              const base =
                i === enteredAllocations.length - 1
                  ? line.quantity.minus(usedBase)
                  : new Prisma.Decimal(entry.quantity).mul(toBase).toDecimalPlaces(MONEY_SCALE);
              usedBase = usedBase.plus(base);
              return { storageLocationId: entry.storageLocationId, quantity: base.toFixed(MONEY_SCALE) };
            })
          : null;
        if (enteredAllocations?.length) {
          const typed = enteredAllocations.reduce((acc, e) => acc.plus(e.quantity), new Prisma.Decimal(0));
          if (!typed.equals(enteredTotal)) {
            throw new BadRequestException(
              `السطر ${line.lineNumber}: مجموع المواقع ${typed.toFixed(MONEY_SCALE)} لا يساوي الكمية ${enteredTotal.toFixed(MONEY_SCALE)}. عدّل السطر ثم رحّل. / ` +
                `Line ${line.lineNumber}: locations add up to ${typed.toFixed(MONEY_SCALE)} but the quantity is ${enteredTotal.toFixed(MONEY_SCALE)}. Edit the line, then post again.`,
            );
          }
        }
        const placed = warehouseId
          ? await this.placedStock(tx, companyId, warehouseId, item.id)
          : { total: new Prisma.Decimal(0), rows: [] as Array<{ code: string; quantity: Prisma.Decimal }> };
        if (!allocations?.length && placed.total.greaterThan(0)) {
          throw new BadRequestException({
            code: 'SALES_POST_LOCATION_REQUIRED',
            message:
              `الصنف ${item.code} له رصيد موزع على مواقع (${placed.rows
                .map((r) => `${r.code}: ${r.quantity.toFixed(MONEY_SCALE)}`)
                .join('، ')}). افتح السطر ${line.lineNumber} وحدد الموقع والكمية ثم رحّل من جديد؛ بيانات الفاتورة محفوظة. / ` +
              `Item ${item.code} is stored on locations (${placed.rows
                .map((r) => `${r.code}: ${r.quantity.toFixed(MONEY_SCALE)}`)
                .join(', ')}). Open line ${line.lineNumber}, choose the location(s) and quantity to take from, then post again. ` +
              'The invoice data is kept.',
            errors: {
              lineNumber: String(line.lineNumber),
              itemCode: item.code.slice(0, 64),
              locations: placed.rows.map((r) => ({ code: r.code, quantity: r.quantity.toFixed(MONEY_SCALE) })),
            },
          });
        }
        if (allocations?.length && !warehouseId) {
          throw new BadRequestException(
            `السطر ${line.lineNumber}: حُدد موقع لكن الفرع بلا مخزن. احذف المواقع من السطر أو أضف مخزنًا للفرع. / ` +
              `Line ${line.lineNumber} names a location but this branch has no warehouse. Remove the locations from the line or add a warehouse to the branch.`,
          );
        }
        const allocated = (allocations ?? []).reduce(
          (acc, entry) => acc.plus(entry.quantity),
          new Prisma.Decimal(0),
        );
        if (allocations?.length && !allocated.equals(line.quantity)) {
          throw new BadRequestException(
            `السطر ${line.lineNumber}: مجموع المواقع ${allocated.toFixed(MONEY_SCALE)} لا يساوي الكمية ${line.quantity.toFixed(MONEY_SCALE)}. ` +
              'عدّل السطر ثم رحّل. / ' +
              `Line ${line.lineNumber}: locations add up to ${allocated.toFixed(MONEY_SCALE)} but the quantity is ${line.quantity.toFixed(MONEY_SCALE)}. Edit the line, then post again.`,
          );
        }

        const issueFrom = async (storageLocationId: string | null, quantity: Prisma.Decimal) =>
          this.batches.issueTx(
            tx,
            companyId,
            userId,
            {
              warehouse: warehouseId ? { id: warehouseId, branchId: invoice.branchId } : null,
              branchId: invoice.branchId,
              item,
            },
            {
              branchId: invoice.branchId,
              warehouseId,
              itemId: item.id,
              quantity,
              storageLocationId,
              sourceLineId: line.id,
              referenceType: 'SALES_INVOICE',
              referenceId: invoice.id,
              referenceNumber: invoice.invoiceNumber,
              documentDate: invoice.invoiceDate.toISOString().slice(0, 10),
              ...(expiredApproval ? { allowExpired: true, expiredApproval } : {}),
              movementUnits:
                line.unitName && line.unitQuantity && line.unitFactor && !storageLocationId
                  ? {
                      enteredUnit: line.unitName,
                      enteredQuantity: line.unitQuantity,
                      unitFactor: line.unitFactor,
                      baseUnitName: item.unit,
                    }
                  : undefined,
            },
            quantity,
          );
        let issued: { unitCost: string; value: string };
        if (allocations?.length) {
          let totalValue = new Prisma.Decimal(0);
          for (const entry of allocations) {
            let part;
            try {
              part = await issueFrom(entry.storageLocationId, new Prisma.Decimal(entry.quantity));
            } catch (error) {
              if (error instanceof BadRequestException) {
                const code = await tx.storageLocation.findFirst({
                  where: { id: entry.storageLocationId, companyId },
                  select: { code: true },
                });
                const response = error.getResponse();
                const original = typeof response === 'string' ? response : ((response as { message?: string }).message ?? '');
                throw new BadRequestException(
                  `السطر ${line.lineNumber} (${item.code}) من الموقع ${code?.code ?? entry.storageLocationId}: ${original} ` +
                    'غيّر الكمية أو اختر موقعًا آخر ثم رحّل؛ بيانات الفاتورة محفوظة. / ' +
                    `Line ${line.lineNumber} (${item.code}) from location ${code?.code ?? entry.storageLocationId}: ${original} ` +
                    'Lower that quantity or pick another location, then post again. The invoice data is kept.',
                );
              }
              throw error;
            }
            totalValue = totalValue.plus(part.value);
          }
          const total = totalValue.toDecimalPlaces(MONEY_SCALE);
          issued = {
            value: total.toFixed(MONEY_SCALE),
            unitCost: total.div(line.quantity).toDecimalPlaces(MONEY_SCALE).toFixed(4),
          };
        } else {
          issued = await issueFrom(null, line.quantity);
        }

        // The engine already moved the branch and shelf books. Sales still owns
        // the invoice's cost, so it is read back from what was issued - one
        // number per line, whatever number of lots that line left from.
        const unitCost = new Prisma.Decimal(issued.unitCost);
        const costTotal = new Prisma.Decimal(issued.value);

        costOfGoods = costOfGoods.plus(costTotal);
        costByLine.set(line.id, { unitCost, costTotal });
      }

      // The cost of each line is frozen onto the invoice, so the gross profit
      // of a posted document does not move when later purchases change the
      // average cost.
      for (const line of invoice.lines) {
        const cost = costByLine.get(line.id);
        if (!cost) continue;
        await tx.salesInvoiceLine.update({
          where: { id: line.id },
          data: { unitCost: cost.unitCost, costTotal: cost.costTotal },
        });
      }

      // ---- accounting
      const journal = await this.posting.post(tx, {
        companyId,
        branchId: invoice.branchId,
        userId,
        entryDate: invoice.invoiceDate,
        description: `Sales invoice to ${invoice.customer.nameEn} (${invoice.customer.code})`,
        sourceType: 'SALES_INVOICE',
        sourceId: invoice.id,
        sourceNumber: invoice.invoiceNumber,
        lines: [
          { accountId: accounts.accountsReceivable, debit: invoice.totalAmount, description: 'Customer balance' },
          // Revenue and its cost are attributed line by line to the cost
          // centres the invoice named. Lines without a centre stay unallocated
          // rather than being pushed onto one for the sake of a tidy report.
          ...attributedLines(
            accounts.salesRevenue,
            'credit',
            'Sales revenue',
            invoice.lines.map((line) => ({
              costCenterId: line.costCenterId,
              amount: line.lineTotal,
            })),
          ),
          { accountId: accounts.vatPayable, credit: invoice.taxAmount, description: 'VAT on sales' },
          ...attributedLines(
            accounts.costOfGoodsSold,
            'debit',
            'Cost of goods sold',
            invoice.lines.map((line) => ({
              costCenterId: line.costCenterId,
              amount: costByLine.get(line.id)?.costTotal ?? new Prisma.Decimal(0),
            })),
          ),
          ...attributedLines(
            accounts.inventory,
            'credit',
            'Inventory issued',
            invoice.lines.map((line) => ({
              costCenterId: line.costCenterId,
              amount: costByLine.get(line.id)?.costTotal ?? new Prisma.Decimal(0),
            })),
          ),
        ],
      });

      // The transaction already claimed the invoice as POSTED. Attach the
      // accounting/cost results without repeating the guarded status change.
      await tx.salesInvoice.update({
        where: { id: invoice.id },
        data: {
          costOfGoods,
          journalEntryId: journal.id,
        },
      });

      await this.audit.recordRequired({
        companyId, userId, action: 'POST', entity: 'sales_invoices', entityId: id,
        before: { status: InvoiceStatus.DRAFT },
        after: {
          status: InvoiceStatus.POSTED,
          journalEntryId: journal.id,
          journalNumber: journal.entryNumber,
          costOfGoods: costOfGoods.toFixed(MONEY_SCALE),
        },
      }, tx);
    });

    return this.findOne(companyId, id, mayReadCost);
  }

  /**
   * Reverses a posted invoice.
   *
   * Nothing is edited or deleted. A reversing journal entry is written, the
   * stock goes back in at exactly the cost it left at, and the invoice is
   * marked REVERSED so it can never be posted twice.
   */
  async reverse(companyId: string, userId: string, id: string, mayReadCost = true) {
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!invoice) throw new NotFoundException({ code: 'SALES_INVOICE_NOT_FOUND', message: 'Sales invoice not found' });
    if (invoice.status !== InvoiceStatus.POSTED) {
      throw new BadRequestException('Only posted invoices can be reversed');
    }
    if (!invoice.journalEntryId) {
      throw new BadRequestException('This invoice has no journal entry to reverse');
    }

    const original = await this.prisma.journalEntry.findFirst({
      where: { id: invoice.journalEntryId, companyId },
      include: {
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: { allocations: true },
        },
      },
    });
    if (!original) throw new NotFoundException('The original journal entry is missing');
    if (original.status === JournalStatus.REVERSED) {
      throw new BadRequestException('This invoice has already been reversed');
    }

    await this.prisma.$transaction(async (tx) => {
      if (invoice.salesOrderId) {
        await releaseOrderAllocations(tx, 'sales', companyId, invoice.salesOrderId, invoice.lines);
      }
      const claimedInvoice = await tx.salesInvoice.updateMany({
        where: { id: invoice.id, companyId, status: InvoiceStatus.POSTED, deletedAt: null },
        data: { status: InvoiceStatus.REVERSED },
      });
      if (claimedInvoice.count !== 1) {
        throw new BadRequestException('This invoice has already been reversed');
      }
      const activeReturns = await tx.salesInvoice.count({
        where: {
          companyId,
          originalInvoiceId: invoice.id,
          documentType: InvoiceDocumentType.CREDIT_NOTE,
          status: InvoiceStatus.POSTED,
          deletedAt: null,
        },
      });
      if (activeReturns > 0) {
        throw new BadRequestException(
          'Reverse the posted sales returns before reversing their source invoice.',
        );
      }
      // The journal claim itself happens inside PostingService.reverse,
      // below, in the same transaction as the stock coming back in.

      const warehouseId = await this.warehouses.resolveForReversal(
        tx,
        companyId,
        invoice.branchId,
        invoice.warehouseId,
      );
      if (!invoice.warehouseId && warehouseId) {
        await tx.salesInvoice.update({
          where: { id: invoice.id },
          data: { warehouseId },
        });
      }

      // The goods go back where they came from - not into "the warehouse" as
      // an average, and never into a different lot. Each OUT movement the
      // posting wrote names its lot, so the reversal walks those same rows and
      // returns the exact quantity to the exact lot. A lot that the sale had
      // emptied was closed by the issue; it is reopened here, because the sale
      // is being undone and refusing to reopen would silently lose the stock.
      //
      // If the invoice left a lot, there is nothing to reopen: an item that
      // keeps no lots is put back on the shelf book the way it always was.
      for (const line of invoice.lines) {
        if (!line.itemId) continue;
        const item = await tx.item.findFirst({
          where: { id: line.itemId, companyId, deletedAt: null },
          select: { id: true, isStockTracked: true },
        });
        if (!item) throw new BadRequestException('A sales invoice item no longer exists');
        if (!item.isStockTracked) continue;

        // What this invoice actually took, lot by lot. Read from the movements
        // rather than recomputed: the movements are the record of the sale, and
        // FEFO decided them at posting time with information that may no longer
        // exist (a lot could have been closed since).
        const consumed = await tx.stockMovement.findMany({
          where: {
            companyId,
            itemId: line.itemId,
            direction: StockDirection.OUT,
            referenceType: 'SALES_INVOICE',
            referenceId: invoice.id,
          },
          select: { batchId: true, storageLocationId: true, quantity: true, unitCost: true, totalCost: true },
        });

        const lotRows = consumed.filter((row) => row.batchId !== null);
        const unbatchedQuantity = consumed
          .filter((row) => row.batchId === null)
          .reduce((sum, row) => sum.plus(row.quantity), new Prisma.Decimal(0));
        const lotQuantity = lotRows.reduce(
          (sum, row) => sum.plus(row.quantity),
          new Prisma.Decimal(0),
        );

        // A posted invoice that took goods from lots must give them back to
        // those lots. If the historical movements are missing and the item is
        // lot-controlled, a blind shelf credit would invent stock that no lot
        // owns - refuse instead of hiding the discrepancy.
        if (lotRows.length === 0 && consumed.length === 0 && line.quantity.greaterThan(0)) {
          const policy = batchPolicyOf(
            await tx.item.findFirst({
              where: { id: line.itemId, companyId, deletedAt: null },
              select: { requiresBatch: true },
            }),
          );
          if (policy.requiresBatch) {
            throw new BadRequestException(
              'لا يمكن عكس فاتورة صنف يتطلب دفعة دون حركات دفعات مسجّلة. / ' +
                'A lot-controlled invoice cannot be reversed: its original lot movements are missing.',
            );
          }
        }

        for (const row of lotRows) {
          // Conditional reopen: fail loudly if the lot has vanished rather than
          // crediting stock to a lot nobody can name.
          const restored = await tx.itemBatch.updateMany({
            where: { id: row.batchId as string, companyId },
            data: {
              remainingQuantity: { increment: row.quantity },
              // Only a CLOSED lot is reopened. A lot that was written off or
              // quarantined after the sale keeps that status; the quantity
              // still returns, because the sale is being undone.
              ...(await (async () => {
                const current = await tx.itemBatch.findFirst({
                  where: { id: row.batchId as string, companyId },
                  select: { status: true },
                });
                return current?.status === 'CLOSED' ? { status: 'OPEN' as const } : {};
              })()),
              updatedBy: userId,
            },
          });
          if (restored.count !== 1) {
            throw new BadRequestException(
              'دفعة أصلية لم تعد موجودة؛ لا يمكن إعادة الكمية. / ' +
                'An original lot no longer exists, so its quantity cannot be given back.',
            );
          }

          await tx.stockMovement.create({
            data: {
              companyId,
              branchId: invoice.branchId,
              warehouseId,
              itemId: line.itemId,
              batchId: row.batchId,
              storageLocationId: row.storageLocationId,
              movementDate: new Date(),
              direction: StockDirection.IN,
              quantity: row.quantity,
              unitCost: row.unitCost,
              totalCost: row.totalCost,
              referenceType: 'SALES_INVOICE_REVERSAL',
              referenceId: invoice.id,
              referenceNumber: invoice.invoiceNumber,
              notes: `Reversal of ${invoice.invoiceNumber}`,
              createdBy: userId,
            },
          });
        }

        // Whatever was not taken from a named lot goes back on the branch book
        // with no lot attached, which is exactly how it left.
        const backfill = lotRows.length > 0 ? new Prisma.Decimal(0) : line.quantity;
        if (backfill.greaterThan(0)) {
          await tx.stockMovement.create({
            data: {
              companyId,
              branchId: invoice.branchId,
              warehouseId,
              itemId: line.itemId,
              movementDate: new Date(),
              direction: StockDirection.IN,
              quantity: backfill,
              unitCost: line.unitCost,
              totalCost: line.costTotal,
              referenceType: 'SALES_INVOICE_REVERSAL',
              referenceId: invoice.id,
              referenceNumber: invoice.invoiceNumber,
              notes: `Reversal of ${invoice.invoiceNumber}`,
              createdBy: userId,
            },
          });
        }

        // The branch and shelf books are moved once for the whole line, by the
        // same ledger the issue used - not once per lot. Doing it per lot would
        // round each slice and leave a fils behind on every reversal.
        await this.ledger.post(tx, {
          companyId,
          branchId: invoice.branchId,
          warehouseId,
          itemId: line.itemId,
          quantity: line.quantity,
          value: line.costTotal,
        });
      }


      // One reversal path for the whole system: it claims the original,
      // refuses a closed period with a readable message (instead of the
      // database trigger surfacing as a 500), and stamps the mirror with
      // the invoice as its source so a ledger reader can drill back to it.
      const reversal = await this.posting.reverse(
        tx,
        companyId,
        userId,
        original.id,
        `Reversal of sales invoice ${invoice.invoiceNumber}`,
      );
      await this.audit.recordRequired({
        companyId, userId, action: 'REVERSE', entity: 'sales_invoices', entityId: id,
        after: { reversalJournalNumber: reversal.entryNumber },
      }, tx);
    });

    return this.findOne(companyId, id, mayReadCost);
  }

  // ------------------------------------------------------------------ helpers

  /**
   * What the customer's payment terms imply for an invoice dated [invoiceDate]:
   * the first due date (what ageing counts from) and, when the terms split the
   * invoice into several shares, every share. No terms at all gives no due date.
   */
  private async dueFromTerms(
    companyId: string,
    customerId: string,
    invoiceDate: string,
    deliveryDate: string | null,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<{ dueDate: Date | null; dueSchedule: Prisma.InputJsonValue | null }> {
    const customer = await client.customer.findFirst({
      where: { id: customerId, companyId },
      select: { paymentTermDays: true, paymentTermMethod: true, paymentTermConfig: true },
    });
    const days = customer?.paymentTermDays ?? 0;
    const method = (customer?.paymentTermMethod ?? DEFAULT_PAYMENT_TERM_METHOD) as PaymentTermMethod;
    if (!customer || (days <= 0 && method === DEFAULT_PAYMENT_TERM_METHOD)) return { dueDate: null, dueSchedule: null };
    try {
      const schedule = computeDueSchedule(
        { method, days, config: customer.paymentTermConfig as PaymentTermConfig | null },
        invoiceDate.slice(0, 10),
        deliveryDate ? deliveryDate.slice(0, 10) : null,
      );
      return {
        dueDate: new Date(schedule.firstDueDate),
        dueSchedule: schedule.shares.length > 1 ? (schedule.shares as unknown as Prisma.InputJsonValue) : null,
      };
    } catch (error) {
      if (error instanceof PaymentTermError) {
        throw fieldError(error.field === 'date' ? 'invoiceDate' : 'customerId', 'The customer payment terms cannot be applied to this invoice date. Check the customer card.');
      }
      throw error;
    }
  }

  private async prepareLines(
    companyId: string,
    input: SalesInvoiceLineDto[],
    customerId: string | null | undefined,
    documentDiscount: DiscountInput,
    orderUnits?: readonly TrustedOrderUnit[],
    client: Prisma.TransactionClient = this.prisma,
    options: SalesInvoicePreparationOptions = {},
  ): Promise<PreparedInvoice> {
    const prepared: PreparedLine[] = [];
    // The company's own policy: the rate to apply when nobody said otherwise,
    // and whether the prices being typed already contain it.
    const settings = await this.settings.get(companyId, client);

    if (orderUnits && orderUnits.length !== input.length) {
      throw new BadRequestException('Order invoice unit snapshots do not match its lines');
    }
    for (const [index, raw] of input.entries()) {
      const isAdditionalCharge = raw.isAdditionalCharge === true;
      if (isAdditionalCharge && (orderUnits || raw.itemId || raw.unitName || raw.unitId)) {
        throw new BadRequestException('Additional charges cannot be linked to an item or an order');
      }
      const quantity = parseDocumentQuantity(raw.quantity, `Line ${index + 1} quantity`);
      if (quantity.lessThanOrEqualTo(0)) throw new BadRequestException(`Line ${index + 1} quantity must be greater than zero`);

      if (isAdditionalCharge && (!quantity.equals(1) || raw.discountType ||
          raw.discountAmount || raw.discountPercent)) {
        throw new BadRequestException('An additional charge must have quantity one and no line discount');
      }

      // A price typed on the line is what was charged. When nobody typed one,
      // the customer's agreed list speaks, and failing that the item's own
      // selling price - resolved below, once the item is known.
      const typedPrice =
        raw.unitPrice === undefined || raw.unitPrice === null || raw.unitPrice === ''
          ? null
          : this.nonNegative(raw.unitPrice, `Line ${index + 1} unitPrice`);

      // A line needs to identify itself: either an item, or free text for a
      // service that is not stocked.
      let item: {
        code: string;
        nameEn: string;
        taxRate: Prisma.Decimal | null;
        salePrice: Prisma.Decimal;
        unit: string;
      } | null = null;

      if (raw.itemId) {
        item = await client.item.findFirst({
          where: { id: raw.itemId, companyId, deletedAt: null },
          select: {
            code: true,
            nameEn: true,
            taxRate: true,
            isActive: true,
            salePrice: true,
            unit: true,
            units: true,
          },
        });
        if (!item) throw new BadRequestException(`Line ${index + 1}: the item does not exist`);
        if (!(item as any).isActive) {
          throw new BadRequestException(`Line ${index + 1}: the item is inactive`);
        }
      }

      // Resolve the chosen unit before any money is calculated. The entered
      // quantity is in the chosen unit; the base quantity is what stock moves.
      const historical = orderUnitForInvoiceLine(orderUnits, index, raw.itemId, quantity);
      const resolved = historical ?? (item
        ? resolveUnitSelection({
            lineLabel: `Line ${index + 1}`,
            requestedUnitId: raw.unitId,
            requestedUnitName: raw.unitName,
            enteredQuantity: quantity,
            baseUnitName: item.unit,
            units: (item as { units?: any[] }).units ?? [],
          })
        : {
            snapshot: { unitName: null, unitFactor: null, unitQuantity: null },
            baseQuantity: quantity,
            row: null,
            isLegacy: true,
          });
      // What the user typed, measured in the unit they picked. All money is
      // computed from this; the base quantity is reserved for stock.
      const enteredQuantity = resolved.snapshot.unitQuantity ?? quantity;

      const description = raw.description?.trim() || (item ? `${item.code} ${item.nameEn}` : '');
      if (!description) {
        throw new BadRequestException(
          `Line ${index + 1}: give either an item or a description`,
        );
      }

      // What this line costs, when the person did not say.
      let unitPrice: Prisma.Decimal;
      if (typedPrice !== null) {
        // A price typed on the line is the price of one CHOSEN unit.
        unitPrice = typedPrice;
      } else if (item) {
        const chosenUnitName = resolved.snapshot.unitName ?? item.unit;
        const listed = await this.prices.resolvePrice(client, companyId, {
          partyId: customerId ?? null,
          partyKind: 'CUSTOMER',
          itemId: raw.itemId ?? null,
          unit: chosenUnitName,
          quantity: enteredQuantity,
        });
        if (listed) {
          unitPrice = listed.price
            .mul(new Prisma.Decimal(1).minus(listed.discountPercent.div(100)))
            .toDecimalPlaces(MONEY_SCALE);
        } else {
          // The unit's own independent price, falling back to the item-level
          // price when the unit carries none. Always per chosen unit.
          unitPrice = defaultUnitPrice('sale', resolved.row, item.salePrice);
        }
      } else {
        throw new BadRequestException(
          `Line ${index + 1}: a price is required when the line names no item`,
        );
      }

      // Missing or cleared tax is zero. Conversion callers pass the stored
      // rate explicitly so historical document snapshots are preserved.
      const taxRate: Prisma.Decimal =
        raw.taxRate === undefined || raw.taxRate === null || (typeof raw.taxRate === 'string' && raw.taxRate.trim() === '')
          ? new Prisma.Decimal(0)
          : this.rate(String(raw.taxRate), `Line ${index + 1} taxRate`);

      // What the person typed is the price of the goods, unless the company
      // has said its prices already include VAT - in which case the tax is
      // inside the number and has to be taken back out of it, not added on top
      // of it a second time. Money always follows the entered quantity in the
      // chosen unit, never the converted base quantity.
      const typedTotal = enteredQuantity.mul(unitPrice).toDecimalPlaces(MONEY_SCALE);
      const grossUp = new Prisma.Decimal(1).plus(taxRate.div(100));

      // When prices include tax, the typed total is a tax-inclusive number:
      // take the tax back out first, then discount the goods value. Tax is
      // then charged on the discounted value, which is what "discount applied
      // before tax" means on these documents.
      // Sales orders currently store prices as tax-exclusive when created.
      // Do not reinterpret an old agreed price using today's company setting.
      const grossLineTotal = !isAdditionalCharge && !orderUnits && !options.pricesExcludeTax && settings.pricesIncludeTax && taxRate.greaterThan(0)
        ? typedTotal.div(grossUp).toDecimalPlaces(MONEY_SCALE)
        : typedTotal;

      const lineDiscount = this.lineDiscount(
        grossLineTotal,
        raw,
        index,
        new Prisma.Decimal(orderUnits ? '100' : settings.maxDiscountPercent),
      );

      // A cost center must be this company's and active; the posting path
      // repeats the check at the entry date, because an invoice can be
      // prepared today and posted after the centre was retired.
      let costCenterId: string | null = raw.costCenterId ?? null;
      if (costCenterId) {
        const center = await client.costCenter.findFirst({
          where: { id: costCenterId, companyId, deletedAt: null },
          select: { id: true, isActive: true, code: true },
        });
        if (!center) {
          throw new BadRequestException(
            `Line ${index + 1}: the cost center does not exist`,
          );
        }
        if (!center.isActive) {
          throw new BadRequestException(
            `Line ${index + 1}: cost center ${center.code} is inactive`,
          );
        }
      }

      prepared.push({
        lineNumber: index + 1,
        itemId: raw.itemId ?? null,
        isAdditionalCharge,
        description,
        // Internal base-unit quantity that stock and cost operate on.
        quantity: resolved.baseQuantity,
        unitPrice,
        taxRate,
        // Replaced below, once the document-level discount has been spread.
        taxAmount: new Prisma.Decimal(0),
        lineTotal: lineDiscount.net,
        grossLineTotal,
        discountType: lineDiscount.type,
        discountPercent: lineDiscount.percent,
        discountAmount: lineDiscount.amount,
        invoiceDiscountAmount: new Prisma.Decimal(0),
        costCenterId,
        // Frozen display snapshot (null on legacy/base-unit lines).
        unitName: resolved.snapshot.unitName,
        unitFactor: resolved.snapshot.unitFactor,
        unitQuantity: resolved.snapshot.unitQuantity,
        locationAllocations: normalizeLocationAllocations(
          raw.locationAllocations,
          quantity,
          index + 1,
        ),
      });
    }

    // The document-level discount is spread over the net line values, in exact
    // proportion, before tax. The share is stored on each line so a posted
    // invoice can reproduce its own arithmetic and a partial return can be
    // credited at the price the customer actually paid.
    let allocation: ReturnType<typeof allocateDocumentDiscount>;
    try {
      allocation = allocateDocumentDiscount(
        prepared.map((line) => line.isAdditionalCharge ? new Prisma.Decimal(0) : line.lineTotal),
        documentDiscount,
      );
    } catch (error) {
      throw new BadRequestException(this.discountMessage(error, 'Invoice'));
    }

    const grossTotal = prepared.reduce(
      (sum, line) => line.isAdditionalCharge ? sum : sum.plus(line.grossLineTotal),
      new Prisma.Decimal(0),
    );
    const lineDiscountTotal = prepared.reduce(
      (sum, line) => sum.plus(line.discountAmount),
      new Prisma.Decimal(0),
    );
    try {
      assertDiscountLimit(
        effectiveDiscountPercent(
          grossTotal,
          lineDiscountTotal.plus(allocation.discount.amount),
        ),
        new Prisma.Decimal(orderUnits ? '100' : settings.maxDiscountPercent),
        'Document',
      );
    } catch (error) {
      throw new BadRequestException(this.discountMessage(error, 'Invoice'));
    }

    const lines = prepared.map((line, index) => {
      const invoiceDiscountAmount = allocation.shares[index];
      const lineTotal = line.lineTotal.minus(invoiceDiscountAmount);
      return {
        ...line,
        invoiceDiscountAmount,
        lineTotal,
        taxAmount: lineTotal
          .mul(line.taxRate)
          .div(100)
          .toDecimalPlaces(MONEY_SCALE),
      };
    });

    return { lines, documentDiscount: allocation.discount, lineDiscountTotal };
  }

  /** Resolves one line's discount and enforces the company's ceiling. */
  private lineDiscount(
    base: Prisma.Decimal,
    raw: SalesInvoiceLineDto,
    index: number,
    maximum: Prisma.Decimal,
  ): ResolvedDiscount {
    try {
      const resolved = resolveDiscount(base, {
        type: raw.discountType,
        percent: raw.discountPercent,
        amount: raw.discountAmount,
      });
      assertDiscountLimit(resolved.percent, maximum, `Line ${index + 1}`);
      return resolved;
    } catch (error) {
      throw new BadRequestException(this.discountMessage(error, `Line ${index + 1}`));
    }
  }

  private discountMessage(error: unknown, subject: string): string {
    if (error instanceof DiscountError) return `${subject}: ${error.message}`;
    if (error instanceof Error) return `${subject}: ${error.message}`;
    return `${subject}: the discount could not be applied`;
  }

  private totalsOf(lines: PreparedLine[]) {
    const subTotal = lines.reduce(
      (sum, l) => sum.plus(l.lineTotal),
      new Prisma.Decimal(0),
    );
    const taxAmount = lines.reduce(
      (sum, l) => sum.plus(l.taxAmount),
      new Prisma.Decimal(0),
    );
    return { subTotal, taxAmount, totalAmount: subTotal.plus(taxAmount) };
  }

  private positive(value: string, field: string): Prisma.Decimal {
    const d = this.decimal(value, field);
    if (d.lessThanOrEqualTo(0)) {
      throw new BadRequestException({ code: 'FIELD_POSITIVE', message: `${field} must be greater than zero`, field });
    }
    return d;
  }

  private nonNegative(value: string, field: string): Prisma.Decimal {
    const d = this.decimal(value, field);
    if (d.isNegative()) throw new BadRequestException({ code: 'FIELD_NOT_NEGATIVE', message: `${field} cannot be negative`, field });
    return d;
  }

  private rate(value: string, field: string): Prisma.Decimal {
    const d = this.decimal(value, field, RATE_SCALE);
    if (d.isNegative() || d.greaterThan(100)) {
      throw new BadRequestException(`${field} must be between 0 and 100`);
    }
    return d;
  }

  private decimal(
    value: string,
    field: string,
    scale = MONEY_SCALE,
  ): Prisma.Decimal {
    try {
      const amount = new Prisma.Decimal(value);
      if (!amount.isFinite()) throw new Error('Non-finite amount');
      return amount.toDecimalPlaces(scale);
    } catch {
      throw new BadRequestException(`${field} is not a valid number: ${value}`);
    }
  }

  private toSummary(
    invoice: {
    id: string;
    branchId: string;
    invoiceNumber: string;
    invoiceDate: Date;
    dueDate: Date | null;
    deliveryDate?: Date | null;
    status: InvoiceStatus;
    currency: string;
    subTotal: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    paidAmount: Prisma.Decimal;
    costOfGoods: Prisma.Decimal;
    createdAt: Date;
    discountType?: string | null;
    discountPercent?: Prisma.Decimal;
    discountAmount?: Prisma.Decimal;
    lineDiscountTotal?: Prisma.Decimal;
    customer?: { id?: string; code: string; nameEn: string; nameAr: string };
    },
    mayReadCost = true,
  ) {
    return {
      id: invoice.id,
      branchId: invoice.branchId,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
      dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
      deliveryDate: invoice.deliveryDate?.toISOString().slice(0, 10) ?? null,
      status: invoice.status.toLowerCase(),
      currency: invoice.currency,
      customer: invoice.customer,
      discountType: invoice.discountType ?? null,
      discountPercent: (invoice.discountPercent ?? new Prisma.Decimal(0)).toFixed(RATE_SCALE),
      discountAmount: (invoice.discountAmount ?? new Prisma.Decimal(0)).toFixed(MONEY_SCALE),
      lineDiscountTotal: (invoice.lineDiscountTotal ?? new Prisma.Decimal(0)).toFixed(MONEY_SCALE),
      subTotal: invoice.subTotal.toFixed(MONEY_SCALE),
      taxAmount: invoice.taxAmount.toFixed(MONEY_SCALE),
      totalAmount: invoice.totalAmount.toFixed(MONEY_SCALE),
      paidAmount: invoice.paidAmount.toFixed(MONEY_SCALE),
      balanceDue: invoice.totalAmount.minus(invoice.paidAmount).toFixed(MONEY_SCALE),
      // Cost-derived figures: withheld for callers without inventory.cost.read.
      costOfGoods: mayReadCost ? invoice.costOfGoods.toFixed(MONEY_SCALE) : null,
      grossProfit: mayReadCost
        ? invoice.subTotal.minus(invoice.costOfGoods).toFixed(MONEY_SCALE)
        : null,
      createdAt: invoice.createdAt.toISOString(),
    };
  }
}
