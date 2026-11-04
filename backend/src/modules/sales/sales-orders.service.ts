import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { selectedOrderLineQuantities } from '../../common/units/order-conversion-selection';
import { orderConversionIdentity } from '../../common/units/order-conversion-identity';
import { orderCreationIdentity, OrderCreationDuplicateError } from '../../common/units/order-creation-identity';
import { planDraftOrderEdit } from '../../common/units/order-draft-edit';
import { historicalOrderUnit, TrustedOrderUnit } from '../../common/units/order-conversion-unit';
import { CompanySettingsService } from '../../common/settings/company-settings.module';
import {
  defaultUnitPrice,
  ItemUnitLike,
  parseDocumentQuantity,
  resolveUnitSelection,
} from '../../common/units/unit-math';
import { DocumentNumberService } from '../accounting/document-number.service';
import { SalesInvoicesService } from './sales-invoices.service';
import { PriceListsService } from '../sales/price-lists.service';

const MONEY_SCALE = 4;

export interface OrderLineInput {
  itemId: string;
  description?: string;
  quantity: string | number;
  /// Omitted means "whatever the price list or the item's own price says".
  unitPrice?: string | number;
  discountPercent?: string | number;
  taxRate?: string | number;
  notes?: string;
  /// Optional chosen unit; the quantity is expressed in it.
  unitName?: string;
  unitId?: string;
}

/**
 * Sales orders: what the company has promised to deliver.
 *
 * An order is a promise and nothing else - no stock, no ledger, no tax. It
 * exists so that the dispatch can be checked against what was agreed, and so
 * that a price agreed last month is not retyped from memory today. Turning an
 * order into an invoice hands the whole thing to the invoice service, which is
 * the only place that knows how to issue goods and write the accounting, so
 * the two can never disagree about what happened.
 */
@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: DocumentNumberService,
    private readonly settings: CompanySettingsService,
    private readonly prices: PriceListsService,
    private readonly invoices: SalesInvoicesService,
    private readonly audit: AuditService,
  ) {}

  async findAll(
    companyId: string,
    query: {
      customerId?: string;
      status?: string;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);

    const where: Prisma.SalesOrderWhereInput = { companyId, deletedAt: null };
    if (query.customerId) where.customerId = query.customerId;
    if (query.status) {
      const status = query.status.toUpperCase();
      if (!Object.values(OrderStatus).includes(status as OrderStatus)) {
        throw new BadRequestException(`Unknown order status: ${query.status}`);
      }
      where.status = status as OrderStatus;
    }
    if (query.from || query.to) {
      where.orderDate = {};
      if (query.from) (where.orderDate as Prisma.DateTimeFilter).gte = new Date(query.from);
      if (query.to) (where.orderDate as Prisma.DateTimeFilter).lte = new Date(query.to);
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.salesOrder.findMany({
        where,
        orderBy: [{ orderDate: 'desc' }, { orderNumber: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          customer: { select: { code: true, nameEn: true, nameAr: true } },
          _count: { select: { lines: true, invoices: true } },
        },
      }),
      this.prisma.salesOrder.count({ where }),
    ]);

    return {
      items: items.map((row) => ({
        ...this.summary(row),
        lineCount: row._count.lines,
        invoiceCount: row._count.invoices,
      })),
      total,
      page,
      pageSize,
    };
  }

  async findOne(companyId: string, id: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        customer: { select: { code: true, nameEn: true, nameAr: true, paymentTermDays: true } },
        branch: { select: { code: true, nameEn: true, nameAr: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: { item: { select: { code: true, nameEn: true, nameAr: true, unit: true } } },
        },
        invoices: { where: { deletedAt: null }, select: { id: true, invoiceNumber: true, status: true, totalAmount: true } },
      },
    });
    if (!order) throw new NotFoundException('Sales order not found');

    return {
      ...this.summary(order),
      updatedAt: order.updatedAt.toISOString(),
      customerCode: order.customer.code,
      customerNameEn: order.customer.nameEn,
      customerNameAr: order.customer.nameAr,
      branchCode: order.branch.code,
      approvedAt: order.approvedAt?.toISOString() ?? null,
      lines: order.lines.map((line) => ({
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
        description: line.description,
        quantity: line.quantity.toFixed(MONEY_SCALE),
        baseQuantity: line.quantity.toFixed(MONEY_SCALE),
        invoicedQuantity: line.invoicedQuantity.toFixed(MONEY_SCALE),
        remainingQuantity: line.quantity.minus(line.invoicedQuantity).toFixed(MONEY_SCALE),
        unitPrice: line.unitPrice.toFixed(MONEY_SCALE),
        discountPercent: line.discountPercent.toFixed(MONEY_SCALE),
        taxRate: line.taxRate.toFixed(MONEY_SCALE),
        lineTotal: line.lineTotal.toFixed(MONEY_SCALE),
        notes: line.notes,
      })),
      invoices: order.invoices.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        totalAmount: invoice.totalAmount.toFixed(MONEY_SCALE),
      })),
    };
  }

  async create(companyId: string, branchId: string | null, userId: string, dto: Record<string, unknown>) {
    if (!branchId) throw new BadRequestException('The signed-in user is not assigned to a branch');
    const identity = orderCreationIdentity(dto);
    const findReplay = async (): Promise<string | null> => {
      if (!identity) return null;
      const rows = await this.prisma.$queryRaw<Array<{ orderId: string; requestHash: string }>>(Prisma.sql`
        SELECT "orderId", "requestHash" FROM order_creation_requests
        WHERE "companyId" = ${companyId}::uuid AND "branchId" = ${branchId}::uuid
          AND kind = 'sales' AND "requestKey" = ${identity.key}
      `);
      const previous = rows[0];
      if (!previous) return null;
      if (previous.requestHash !== identity.hash) throw new ConflictException('The idempotency key was used for a different request');
      return previous.orderId;
    };
    const previousId = await findReplay();
    if (previousId) return this.findOne(companyId, previousId);
    const customerId = this.text(dto.customerId, 'customerId');
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId, deletedAt: null },
      select: { id: true, isActive: true, code: true },
    });
    if (!customer) throw new BadRequestException('The customer does not exist in this company');
    if (!customer.isActive) throw new BadRequestException(`Customer ${customer.code} is inactive`);

    const orderDate = this.date(dto.orderDate, 'orderDate');
    const rawLines = Array.isArray(dto.lines) ? (dto.lines as OrderLineInput[]) : [];
    if (rawLines.length === 0) throw new BadRequestException('An order needs at least one line');

    const prepared = await this.prepareLines(companyId, customerId, rawLines);

    let created: { id: string };
    try {
      created = await this.prisma.$transaction(async (tx) => {
      const orderNumber = await this.numbers.next(tx, companyId, 'sales_order', 'SO');
      const row = await tx.salesOrder.create({
        data: {
          companyId,
          branchId,
          customerId,
          orderNumber,
          orderDate,
          deliveryDate: dto.deliveryDate ? this.date(dto.deliveryDate, 'deliveryDate') : null,
          currency: String(dto.currency ?? 'EGP').slice(0, 3).toUpperCase(),
          notes: (dto.notes as string) ?? null,
          createdBy: userId,
          subTotal: prepared.subTotal,
          taxAmount: prepared.taxAmount,
          totalAmount: prepared.totalAmount,
          lines: {
            create: prepared.lines.map((line, index) => ({
              lineNumber: index + 1,
              itemId: line.itemId,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountPercent: line.discountPercent,
              taxRate: line.taxRate,
              lineTotal: line.lineTotal,
              notes: line.notes,
              unitName: line.unitName,
              unitFactor: line.unitFactor,
              unitQuantity: line.unitQuantity,
            })),
          },
        },
      });
      if (identity) {
        const inserted = await tx.$queryRaw<Array<{ orderId: string }>>(Prisma.sql`
          INSERT INTO order_creation_requests ("companyId", "branchId", kind, "requestKey", "requestHash", "orderId")
          VALUES (${companyId}::uuid, ${branchId}::uuid, 'sales', ${identity.key}, ${identity.hash}, ${row.id}::uuid)
          ON CONFLICT ("companyId", "branchId", kind, "requestKey") DO NOTHING RETURNING "orderId"
        `);
        if (inserted.length !== 1) throw new OrderCreationDuplicateError();
      }
      await this.audit.recordRequired({
        companyId, userId, action: 'CREATE', entity: 'sales_orders', entityId: row.id,
        after: { orderNumber: row.orderNumber, total: row.totalAmount.toFixed(MONEY_SCALE) },
      }, tx);
      return row;
      });
    } catch (error) {
      // A concurrent request may have committed the unique key while this
      // transaction was waiting. Never reinterpret other failures as success.
      if (identity && error instanceof OrderCreationDuplicateError) {
        const replayId = await findReplay();
        if (replayId) return this.findOne(companyId, replayId);
      }
      throw error;
    }
    return this.findOne(companyId, created.id);
  }

  /** Only drafts with no invoice history can be changed; allocations and
   * approved promises must be revised by a separate controlled workflow. */
  async updateDraft(companyId: string, branchId: string | null, userId: string, id: string, dto: Record<string, unknown>) {
    if (!branchId) throw new BadRequestException('The signed-in user is not assigned to a branch');
    const identity = orderCreationIdentity({ ...dto, orderId: id });
    if (!identity) throw new BadRequestException('idempotencyKey is required');
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM sales_orders WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid
          AND "branchId" = ${branchId}::uuid AND "deletedAt" IS NULL FOR UPDATE
      `);
      if (locked.length !== 1) throw new NotFoundException('Sales order not found');
      const previous = await tx.$queryRaw<Array<{ orderId: string; requestHash: string }>>(Prisma.sql`
        SELECT "orderId", "requestHash" FROM order_creation_requests
        WHERE "companyId" = ${companyId}::uuid AND "branchId" = ${branchId}::uuid
          AND kind = 's-edit' AND "requestKey" = ${identity.key}
      `);
      if (previous.length) {
        if (previous[0].orderId !== id || previous[0].requestHash !== identity.hash) {
          throw new ConflictException('The idempotency key was used for a different request');
        }
        return;
      }
      const order = await tx.salesOrder.findFirst({
        where: { id, companyId, branchId, deletedAt: null }, include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      if (!order) throw new NotFoundException('Sales order not found');
      if (order.status !== OrderStatus.DRAFT) throw new BadRequestException('Only draft orders can be edited');
      if (typeof dto.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(dto.expectedUpdatedAt))) {
        throw new BadRequestException('expectedUpdatedAt is required');
      }
      if (new Date(dto.expectedUpdatedAt).getTime() !== order.updatedAt.getTime()) {
        throw new ConflictException({ code: 'ORDER_EDIT_STALE', detail: 'The order changed since it was opened; refresh before editing' });
      }
      if (await tx.salesInvoice.count({ where: { companyId, salesOrderId: id } }) > 0) {
        throw new BadRequestException('Order has invoice history; draft editing is not allowed');
      }
      const planned = planDraftOrderEdit(order.lines, dto.lines);
      for (const line of planned.lines) {
        await tx.salesOrderLine.update({ where: { id: line.id }, data: {
          quantity: line.quantity, unitQuantity: line.unitQuantity, unitPrice: line.unitPrice,
          discountPercent: line.discountPercent, taxRate: line.taxRate, lineTotal: line.lineTotal,
        } });
      }
      // Prisma timestamps use millisecond resolution. Ensure successive edits
      // always produce a distinct optimistic version even within the same ms.
      const updatedAt = new Date(Math.max(Date.now(), order.updatedAt.getTime() + 1));
      await tx.salesOrder.update({ where: { id }, data: { subTotal: planned.subTotal, taxAmount: planned.taxAmount,
        totalAmount: planned.totalAmount, updatedBy: userId, updatedAt } });
      const inserted = await tx.$queryRaw<Array<{ orderId: string }>>(Prisma.sql`
        INSERT INTO order_creation_requests ("companyId", "branchId", kind, "requestKey", "requestHash", "orderId")
        VALUES (${companyId}::uuid, ${branchId}::uuid, 's-edit', ${identity.key}, ${identity.hash}, ${id}::uuid)
        ON CONFLICT ("companyId", "branchId", kind, "requestKey") DO NOTHING RETURNING "orderId"
      `);
      if (inserted.length !== 1) throw new ConflictException('The idempotency key was used for a different request');
      await this.audit.recordRequired({ companyId, userId, action: 'UPDATE', entity: 'sales_orders', entityId: id,
        before: { total: order.totalAmount.toFixed(MONEY_SCALE), updatedAt: order.updatedAt.toISOString() },
        after: { total: planned.totalAmount.toFixed(MONEY_SCALE), updatedAt: updatedAt.toISOString(),
          lines: planned.lines.map(line => ({ id: line.id, quantity: line.quantity.toFixed(MONEY_SCALE),
            unitPrice: line.unitPrice.toFixed(MONEY_SCALE), discountPercent: line.discountPercent.toFixed(MONEY_SCALE),
            taxRate: line.taxRate.toFixed(MONEY_SCALE) })) },
      }, tx);
    });
    return this.findOne(companyId, id);
  }

  async approve(companyId: string, userId: string, id: string) {
    const settings = await this.settings.get(companyId);
    await this.prisma.$transaction(async (tx) => {
      // Share the order lock with conversion and cancellation. The audit is a
      // required part of the same transaction as the state change.
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM sales_orders WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid
          AND "deletedAt" IS NULL FOR UPDATE
      `);
      if (locked.length !== 1) throw new NotFoundException('Sales order not found');
      const order = await tx.salesOrder.findFirst({
        where: { id, companyId, deletedAt: null },
        select: { id: true, status: true, createdBy: true, orderNumber: true },
      });
      if (!order) throw new NotFoundException('Sales order not found');
      if (order.status !== OrderStatus.DRAFT) {
        throw new BadRequestException(`Only a draft order can be approved (it is ${order.status})`);
      }
      if (settings.segregationOfDuties && order.createdBy === userId) {
        throw new BadRequestException('Segregation of duties is on: the person who raised this order may not approve it');
      }
      const claimed = await tx.salesOrder.updateMany({
        where: { id, companyId, status: OrderStatus.DRAFT, deletedAt: null },
        data: { status: OrderStatus.APPROVED, approvedAt: new Date(), approvedBy: userId },
      });
      if (claimed.count !== 1) throw new BadRequestException('This order was approved by someone else a moment ago.');
      await this.audit.recordRequired({
        companyId, userId, action: 'APPROVE', entity: 'sales_orders', entityId: id,
        before: { status: order.status }, after: { orderNumber: order.orderNumber, status: OrderStatus.APPROVED },
      }, tx);
    });
    return this.findOne(companyId, id);
  }

  async cancel(companyId: string, userId: string, id: string, reason?: string) {
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM sales_orders WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid
          AND "deletedAt" IS NULL FOR UPDATE
      `);
      if (locked.length !== 1) throw new NotFoundException('Sales order not found');
      const order = await tx.salesOrder.findFirst({ where: { id, companyId, deletedAt: null } });
      if (!order) throw new NotFoundException('Sales order not found');
      if (order.status === OrderStatus.CANCELLED) throw new BadRequestException('This order is already cancelled');
      const activeInvoices = await tx.salesInvoice.count({
        where: { companyId, salesOrderId: id, deletedAt: null, status: { not: 'REVERSED' } },
      });
      if (activeInvoices > 0) throw new BadRequestException('This order has active invoices; reverse them before cancelling');
      await tx.salesOrder.update({ where: { id }, data: { status: OrderStatus.CANCELLED,
        notes: reason ? `${order.notes ?? ''}\n${reason}`.trim() : order.notes } });
      await this.audit.recordRequired({
        companyId,
        userId,
        action: 'CANCEL',
        entity: 'sales_orders',
        entityId: id,
        before: { status: order.status },
        after: { status: OrderStatus.CANCELLED, reason: reason ?? null },
      }, tx);
    });

    return this.findOne(companyId, id);
  }

  /**
   * Raises the draft invoice for what has not been invoiced yet.
   *
   * The invoice is left as a draft on purpose: what arrived and what it cost
   * are the seller's business, and a draft is where they say so before the
   * ledger sees it.
   */
  async convertToInvoice(
    companyId: string,
    branchId: string | null,
    userId: string,
    id: string,
    dto: Record<string, unknown> = {},
    mayReadCost = false,
  ) {
    if (!branchId) throw new BadRequestException('The signed-in user is not assigned to a branch');
    const invoiceId = await this.prisma.$transaction(async (tx) => {
      // Serialize both identical retries and competing allocations for the
      // same order before reading its current quantities or state.
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM sales_orders
        WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid
          AND "branchId" = ${branchId}::uuid AND "deletedAt" IS NULL
        FOR UPDATE
      `);
      if (locked.length !== 1) throw new NotFoundException('Sales order not found');
      const order = await tx.salesOrder.findFirst({
        where: { id, companyId, branchId, deletedAt: null },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      if (!order) throw new NotFoundException('Sales order not found');
    // Never infer unselected quantities: an omitted line is not an instruction
    // to invoice its outstanding balance. Quantities are base-unit amounts.
    // Compute the identity without consulting mutable order lines so an exact
    // replay can find the original invoice even after later order changes.
    const requested = selectedOrderLineQuantities(dto.lines);
    const identity = orderConversionIdentity(dto, requested);
    const previous = await tx.salesInvoice.findFirst({
      where: { companyId, salesOrderId: id, orderConversionKey: identity.key },
    });
    if (previous) {
      if (previous.orderConversionHash !== identity.hash) throw new ConflictException('The idempotency key was used for a different request');
      if (previous.deletedAt || previous.status === 'REVERSED') throw new ConflictException('The invoice for this idempotency key is no longer active');
      return previous.id;
    }
    selectedOrderLineQuantities(dto.lines, order.lines);
      if (order.status === OrderStatus.CANCELLED) throw new BadRequestException('A cancelled order cannot be invoiced');
      if (order.status === OrderStatus.DRAFT) throw new BadRequestException('Approve the order before invoicing it');

    const invoiceLines: Array<{ itemId: string; description: string; quantity: string; unitPrice: string; taxRate: string; discountPercent: string; unitName?: string }> = [];
    const consumed: Array<{ lineId: string; quantity: Prisma.Decimal }> = [];
    const orderUnits: TrustedOrderUnit[] = [];

    for (const line of order.lines) {
      const quantity = requested.get(line.id);
      if (!quantity) continue;
      const outstanding = line.quantity.minus(line.invoicedQuantity);
      if (quantity.lessThanOrEqualTo(0)) continue;
      if (quantity.greaterThan(outstanding)) {
        throw new BadRequestException(
          `Line ${line.lineNumber}: only ${outstanding.toFixed(MONEY_SCALE)} is still outstanding, ` +
            `${quantity.toFixed(MONEY_SCALE)} was asked for`,
        );
      }
      const historical = historicalOrderUnit({
        label: `Line ${line.lineNumber}`,
        unitName: line.unitName ?? null,
        unitFactor: line.unitFactor ?? null,
        baseQuantity: quantity,
      });
      const invoiceQuantity = historical.snapshot.unitQuantity ?? quantity;
      orderUnits.push({ itemId: line.itemId, resolved: historical });
      invoiceLines.push({
        itemId: line.itemId,
        description: line.description,
        quantity: invoiceQuantity.toFixed(MONEY_SCALE),
        unitPrice: line.unitPrice.toFixed(MONEY_SCALE),
        taxRate: line.taxRate.toFixed(MONEY_SCALE),
        discountPercent: line.discountPercent.toFixed(MONEY_SCALE),
        unitName: line.unitName ?? undefined,
      });
      consumed.push({ lineId: line.id, quantity });
    }

    if (invoiceLines.length === 0) {
      throw new BadRequestException('This order is fully invoiced; nothing is outstanding');
    }


      const invoice = await this.invoices.createInTransaction(companyId, branchId, userId, {
        invoiceDate: String(dto.invoiceDate ?? new Date().toISOString().slice(0, 10)),
        customerId: order.customerId, notes: `From sales order ${order.orderNumber}`, lines: invoiceLines,
      } as never, tx, orderUnits);
      await tx.salesInvoice.update({
        where: { id: invoice.id },
        data: { salesOrderId: id, orderConversionKey: identity.key, orderConversionHash: identity.hash },
      });
      if (invoice.lines.length !== consumed.length) throw new Error('Order invoice allocation mismatch');
      for (const [index, entry] of consumed.entries()) {
        await tx.salesInvoiceLine.update({
          where: { id: invoice.lines[index].id }, data: { orderLineId: entry.lineId },
        });
        await tx.salesOrderLine.update({
          where: { id: entry.lineId }, data: { invoicedQuantity: { increment: entry.quantity } },
        });
      }
      const lines = await tx.salesOrderLine.findMany({ where: { orderId: id } });
      const complete = lines.every((line) => line.invoicedQuantity.greaterThanOrEqualTo(line.quantity));
      await tx.salesOrder.update({ where: { id }, data: { status: complete ? OrderStatus.FULFILLED : OrderStatus.PARTIALLY_FULFILLED } });
      await this.audit.recordRequired({ companyId, userId, action: 'CREATE', entity: 'sales_invoices',
        entityId: invoice.id, after: { invoiceNumber: invoice.invoiceNumber, totalAmount: invoice.totalAmount.toFixed(MONEY_SCALE) } }, tx);
      await this.audit.recordRequired({ companyId, userId, action: 'INVOICE', entity: 'sales_orders',
        entityId: id, after: { orderNumber: order.orderNumber, invoiceId: invoice.id, lines: consumed.length } }, tx);
      return invoice.id;
    }, { maxWait: 10000, timeout: 30000 });
    return { order: await this.findOne(companyId, id), invoice: await this.invoices.findOne(companyId, invoiceId, mayReadCost) };
  }

  // ------------------------------------------------------------------ helpers

  private async prepareLines(
    companyId: string,
    customerId: string,
    rawLines: OrderLineInput[],
  ) {
    const settings = await this.settings.get(companyId);
    const lines: Array<{
      itemId: string;
      description: string;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      discountPercent: Prisma.Decimal;
      taxRate: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
      notes: string | null;
      unitName: string | null;
      unitFactor: Prisma.Decimal | null;
      unitQuantity: Prisma.Decimal | null;
    }> = [];
    let subTotal = new Prisma.Decimal(0);
    let taxAmount = new Prisma.Decimal(0);

    for (const [index, raw] of rawLines.entries()) {
      const itemId = this.text(raw.itemId, `Line ${index + 1} itemId`);
      const item = await this.prisma.item.findFirst({
        where: { id: itemId, companyId, deletedAt: null },
        select: { id: true, code: true, nameEn: true, unit: true, isActive: true, salePrice: true, taxRate: true, units: true },
      });
      if (!item) throw new BadRequestException(`Line ${index + 1}: the item does not exist`);
      if (!item.isActive) throw new BadRequestException(`Line ${index + 1}: item ${item.code} is inactive`);

      const enteredQuantity = parseDocumentQuantity(raw.quantity, `Line ${index + 1} quantity`);
      if (enteredQuantity.lessThanOrEqualTo(0)) throw new BadRequestException(`Line ${index + 1} quantity must be greater than zero`);
      const resolved = resolveUnitSelection({
        lineLabel: `Line ${index + 1}`,
        requestedUnitId: raw.unitId,
        requestedUnitName: raw.unitName,
        enteredQuantity,
        baseUnitName: item.unit,
        units: (item as { units?: ItemUnitLike[] }).units ?? [],
      });
      const quantity = resolved.baseQuantity;
      const discountPercent = this.percent(raw.discountPercent, `Line ${index + 1} discountPercent`);

      let unitPrice = raw.unitPrice === undefined || raw.unitPrice === null || raw.unitPrice === ''
        ? null
        : this.nonNegative(raw.unitPrice, `Line ${index + 1} unitPrice`);
      if (unitPrice === null) {
        const chosenUnitName = resolved.snapshot.unitName ?? item.unit;
        const listed = await this.prices.resolvePrice(this.prisma, companyId, {
          partyId: customerId,
          partyKind: 'CUSTOMER',
          itemId: item.id,
          unit: chosenUnitName,
          quantity: enteredQuantity,
        });
        unitPrice = listed
          ? listed.price
          : defaultUnitPrice('sale', resolved.row, item.salePrice);
      }

      // An explicitly cleared rate means zero; omission still inherits the
      // item or company setting. Keep this consistent with invoice lines.
      const taxRate = raw.taxRate === undefined
        ? item.taxRate ?? new Prisma.Decimal(settings.taxRate)
        : raw.taxRate === null || (typeof raw.taxRate === 'string' && raw.taxRate.trim() === '')
          ? new Prisma.Decimal(0)
          : this.percent(raw.taxRate, `Line ${index + 1} taxRate`);

      // Money follows the entered quantity in the chosen unit.
      const net = enteredQuantity.mul(unitPrice).toDecimalPlaces(MONEY_SCALE);
      const discount = net.mul(discountPercent).div(100).toDecimalPlaces(MONEY_SCALE);
      const taxable = net.minus(discount);
      const tax = taxable.mul(taxRate).div(100).toDecimalPlaces(MONEY_SCALE);
      const lineTotal = taxable.plus(tax).toDecimalPlaces(MONEY_SCALE);

      subTotal = subTotal.plus(taxable);
      taxAmount = taxAmount.plus(tax);
      lines.push({
        itemId: item.id,
        description: raw.description?.trim() || `${item.code} ${item.nameEn}`,
        quantity,
        unitPrice,
        discountPercent,
        taxRate,
        lineTotal,
        notes: raw.notes?.trim() || null,
        unitName: resolved.snapshot.unitName,
        unitFactor: resolved.snapshot.unitFactor,
        unitQuantity: resolved.snapshot.unitQuantity,
      });
    }

    return {
      lines,
      subTotal: subTotal.toDecimalPlaces(MONEY_SCALE),
      taxAmount: taxAmount.toDecimalPlaces(MONEY_SCALE),
      totalAmount: subTotal.plus(taxAmount).toDecimalPlaces(MONEY_SCALE),
    };
  }

  private summary(row: {
    id: string;
    orderNumber: string;
    orderDate: Date;
    deliveryDate: Date | null;
    status: OrderStatus;
    currency: string;
    subTotal: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    notes: string | null;
    customer?: { code: string; nameEn: string; nameAr: string } | null;
  }) {
    return {
      id: row.id,
      orderNumber: row.orderNumber,
      orderDate: row.orderDate.toISOString().slice(0, 10),
      deliveryDate: row.deliveryDate?.toISOString().slice(0, 10) ?? null,
      status: row.status,
      currency: row.currency,
      customerCode: row.customer?.code ?? null,
      customerNameEn: row.customer?.nameEn ?? null,
      customerNameAr: row.customer?.nameAr ?? null,
      subTotal: row.subTotal.toFixed(MONEY_SCALE),
      taxAmount: row.taxAmount.toFixed(MONEY_SCALE),
      totalAmount: row.totalAmount.toFixed(MONEY_SCALE),
      notes: row.notes,
    };
  }

  private date(value: unknown, field: string): Date {
    const text = this.text(value, field);
    const date = new Date(`${text.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} is not a date`);
    return date;
  }

  private positive(value: unknown, field: string): Prisma.Decimal {
    const decimal = this.nonNegative(value, field);
    if (decimal.isZero()) throw new BadRequestException(`${field} must be greater than zero`);
    return decimal;
  }

  private nonNegative(value: unknown, field: string): Prisma.Decimal {
    let decimal: Prisma.Decimal;
    try {
      decimal = new Prisma.Decimal(String(value ?? '').trim() || '0');
    } catch {
      throw new BadRequestException(`${field} is not a valid number`);
    }
    if (decimal.isNegative()) throw new BadRequestException(`${field} cannot be negative`);
    return decimal.toDecimalPlaces(MONEY_SCALE);
  }

  private percent(value: unknown, field: string): Prisma.Decimal {
    if (value === undefined || value === null || value === '') return new Prisma.Decimal(0);
    const decimal = this.nonNegative(value, field);
    if (decimal.greaterThan(100)) throw new BadRequestException(`${field} cannot exceed 100`);
    return decimal;
  }

  private text(value: unknown, field: string): string {
    const text = String(value ?? '').trim();
    if (!text) throw new BadRequestException(`${field} is required`);
    return text;
  }
}
