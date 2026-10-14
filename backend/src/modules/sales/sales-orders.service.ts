import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanySettingsService } from '../../common/settings/company-settings.module';
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
        invoices: { select: { id: true, invoiceNumber: true, status: true, totalAmount: true } },
      },
    });
    if (!order) throw new NotFoundException('Sales order not found');

    return {
      ...this.summary(order),
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
        unit: line.item.unit,
        description: line.description,
        quantity: line.quantity.toFixed(MONEY_SCALE),
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

    const created = await this.prisma.$transaction(async (tx) => {
      const orderNumber = await this.numbers.next(tx, companyId, 'sales_order', 'SO');
      return tx.salesOrder.create({
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
            })),
          },
        },
      });
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'sales_orders',
      entityId: created.id,
      after: { orderNumber: created.orderNumber, total: created.totalAmount.toFixed(MONEY_SCALE) },
    });

    return this.findOne(companyId, created.id);
  }

  async approve(companyId: string, userId: string, id: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true, status: true, createdBy: true, orderNumber: true },
    });
    if (!order) throw new NotFoundException('Sales order not found');
    if (order.status !== OrderStatus.DRAFT) {
      throw new BadRequestException(`Only a draft order can be approved (it is ${order.status})`);
    }

    const settings = await this.settings.get(companyId);
    if (settings.segregationOfDuties && order.createdBy === userId) {
      throw new BadRequestException(
        'Segregation of duties is on: the person who raised this order may not approve it',
      );
    }

    const claimed = await this.prisma.salesOrder.updateMany({
      where: { id, companyId, status: OrderStatus.DRAFT, deletedAt: null },
      data: { status: OrderStatus.APPROVED, approvedAt: new Date(), approvedBy: userId },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException('This order was approved by someone else a moment ago.');
    }

    await this.audit.record({
      companyId,
      userId,
      action: 'APPROVE',
      entity: 'sales_orders',
      entityId: id,
      after: { orderNumber: order.orderNumber },
    });

    return this.findOne(companyId, id);
  }

  async cancel(companyId: string, userId: string, id: string, reason?: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { _count: { select: { invoices: true } } },
    });
    if (!order) throw new NotFoundException('Sales order not found');
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('This order is already cancelled');
    }
    if (order._count.invoices > 0) {
      throw new BadRequestException(
        'This order has invoices against it; cancel or reverse those instead of the order',
      );
    }

    await this.prisma.salesOrder.update({
      where: { id },
      data: { status: OrderStatus.CANCELLED, notes: reason ? `${order.notes ?? ''}\n${reason}`.trim() : order.notes },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CANCEL',
      entity: 'sales_orders',
      entityId: id,
      before: { status: order.status },
      after: { status: OrderStatus.CANCELLED, reason: reason ?? null },
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
  ) {
    if (!branchId) throw new BadRequestException('The signed-in user is not assigned to a branch');
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!order) throw new NotFoundException('Sales order not found');
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('A cancelled order cannot be invoiced');
    }
    if (order.status === OrderStatus.DRAFT) {
      throw new BadRequestException('Approve the order before invoicing it');
    }

    // Which lines, and how much of each. Naming none invoices everything that
    // is still outstanding.
    const requested = new Map<string, Prisma.Decimal>();
    if (Array.isArray(dto.lines) && (dto.lines as unknown[]).length > 0) {
      for (const raw of dto.lines as Array<{ orderLineId?: string; quantity?: string }>) {
        const lineId = String(raw.orderLineId ?? '');
        const line = order.lines.find((candidate) => candidate.id === lineId);
        if (!line) throw new BadRequestException(`Order line ${lineId} does not belong to this order`);
        requested.set(lineId, this.positive(raw.quantity, 'quantity'));
      }
    }

    const invoiceLines: Array<{ itemId: string; description: string; quantity: string; unitPrice: string; taxRate: string }> = [];
    const consumed: Array<{ lineId: string; quantity: Prisma.Decimal }> = [];

    for (const line of order.lines) {
      const outstanding = line.quantity.minus(line.invoicedQuantity);
      const quantity = requested.get(line.id) ?? outstanding;
      if (quantity.lessThanOrEqualTo(0)) continue;
      if (quantity.greaterThan(outstanding)) {
        throw new BadRequestException(
          `Line ${line.lineNumber}: only ${outstanding.toFixed(MONEY_SCALE)} is still outstanding, ` +
            `${quantity.toFixed(MONEY_SCALE)} was asked for`,
        );
      }
      invoiceLines.push({
        itemId: line.itemId,
        description: line.description,
        quantity: quantity.toFixed(MONEY_SCALE),
        unitPrice: line.unitPrice.toFixed(MONEY_SCALE),
        taxRate: line.taxRate.toFixed(MONEY_SCALE),
      });
      consumed.push({ lineId: line.id, quantity });
    }

    if (invoiceLines.length === 0) {
      throw new BadRequestException('This order is fully invoiced; nothing is outstanding');
    }

    const invoice = await this.invoices.create(companyId, branchId, userId, {
      invoiceDate: String(dto.invoiceDate ?? new Date().toISOString().slice(0, 10)),
      customerId: order.customerId,
      notes: `From sales order ${order.orderNumber}`,
      lines: invoiceLines,
    } as never);

    const invoiceId = String((invoice as { id?: string }).id ?? '');

    await this.prisma.$transaction(async (tx) => {
      for (const entry of consumed) {
        await tx.salesOrderLine.update({
          where: { id: entry.lineId },
          data: { invoicedQuantity: { increment: entry.quantity } },
        });
      }
      if (invoiceId) {
        await tx.salesInvoice.update({
          where: { id: invoiceId },
          data: { salesOrderId: order.id },
        });
      }
      const lines = await tx.salesOrderLine.findMany({ where: { orderId: order.id } });
      const complete = lines.every((line) => line.invoicedQuantity.greaterThanOrEqualTo(line.quantity));
      await tx.salesOrder.update({
        where: { id: order.id },
        data: {
          status: complete ? OrderStatus.FULFILLED : OrderStatus.PARTIALLY_FULFILLED,
        },
      });
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'INVOICE',
      entity: 'sales_orders',
      entityId: order.id,
      after: {
        orderNumber: order.orderNumber,
        invoiceId: invoiceId || null,
        lines: consumed.length,
      },
    });

    return { order: await this.findOne(companyId, id), invoice };
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
    }> = [];
    let subTotal = new Prisma.Decimal(0);
    let taxAmount = new Prisma.Decimal(0);

    for (const [index, raw] of rawLines.entries()) {
      const itemId = this.text(raw.itemId, `Line ${index + 1} itemId`);
      const item = await this.prisma.item.findFirst({
        where: { id: itemId, companyId, deletedAt: null },
        select: { id: true, code: true, nameEn: true, unit: true, isActive: true, salePrice: true, taxRate: true },
      });
      if (!item) throw new BadRequestException(`Line ${index + 1}: the item does not exist`);
      if (!item.isActive) throw new BadRequestException(`Line ${index + 1}: item ${item.code} is inactive`);

      const quantity = this.positive(raw.quantity, `Line ${index + 1} quantity`);
      const discountPercent = this.percent(raw.discountPercent, `Line ${index + 1} discountPercent`);

      let unitPrice = raw.unitPrice === undefined || raw.unitPrice === null || raw.unitPrice === ''
        ? null
        : this.nonNegative(raw.unitPrice, `Line ${index + 1} unitPrice`);
      if (unitPrice === null) {
        const listed = await this.prices.resolvePrice(this.prisma, companyId, {
          partyId: customerId,
          partyKind: 'SUPPLIER',
          itemId: item.id,
          unit: item.unit,
          quantity,
        });
        unitPrice = listed?.price ?? item.salePrice;
      }

      const taxRate = raw.taxRate === undefined || raw.taxRate === null || raw.taxRate === ''
        ? item.taxRate ?? new Prisma.Decimal(settings.taxRate)
        : this.percent(raw.taxRate, `Line ${index + 1} taxRate`);

      const net = quantity.mul(unitPrice).toDecimalPlaces(MONEY_SCALE);
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
