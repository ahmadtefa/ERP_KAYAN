import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanySettingsService } from '../../common/settings/company-settings.module';
import {
  defaultUnitPrice,
  resolveUnitSelection,
} from '../../common/units/unit-math';
import { DocumentNumberService } from '../accounting/document-number.service';
import { PurchaseInvoicesService } from './purchase-invoices.service';
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
 * Purchase orders: what the company has asked a supplier to send.
 *
 * An order is a promise and nothing else - no stock, no ledger, no tax. It
 * exists so that the delivery can be checked against what was agreed, and so
 * that a price agreed last month is not retyped from memory today. Turning an
 * order into an invoice hands the whole thing to the invoice service, which is
 * the only place that knows how to receive goods and write the accounting, so
 * the two can never disagree about what happened.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: DocumentNumberService,
    private readonly settings: CompanySettingsService,
    private readonly prices: PriceListsService,
    private readonly invoices: PurchaseInvoicesService,
    private readonly audit: AuditService,
  ) {}

  async findAll(
    companyId: string,
    query: {
      supplierId?: string;
      status?: string;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);

    const where: Prisma.PurchaseOrderWhereInput = { companyId, deletedAt: null };
    if (query.supplierId) where.supplierId = query.supplierId;
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
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy: [{ orderDate: 'desc' }, { orderNumber: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          supplier: { select: { code: true, nameEn: true, nameAr: true } },
          _count: { select: { lines: true, invoices: true } },
        },
      }),
      this.prisma.purchaseOrder.count({ where }),
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
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        supplier: { select: { code: true, nameEn: true, nameAr: true, paymentTermDays: true } },
        branch: { select: { code: true, nameEn: true, nameAr: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: { item: { select: { code: true, nameEn: true, nameAr: true, unit: true } } },
        },
        invoices: { select: { id: true, invoiceNumber: true, status: true, totalAmount: true } },
      },
    });
    if (!order) throw new NotFoundException('Purchase order not found');

    return {
      ...this.summary(order),
      supplierCode: order.supplier.code,
      supplierNameEn: order.supplier.nameEn,
      supplierNameAr: order.supplier.nameAr,
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
    const supplierId = this.text(dto.supplierId, 'supplierId');
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, companyId, deletedAt: null },
      select: { id: true, isActive: true, code: true },
    });
    if (!supplier) throw new BadRequestException('The supplier does not exist in this company');
    if (!supplier.isActive) throw new BadRequestException(`Supplier ${supplier.code} is inactive`);

    const orderDate = this.date(dto.orderDate, 'orderDate');
    const rawLines = Array.isArray(dto.lines) ? (dto.lines as OrderLineInput[]) : [];
    if (rawLines.length === 0) throw new BadRequestException('An order needs at least one line');

    const prepared = await this.prepareLines(companyId, supplierId, rawLines);

    const created = await this.prisma.$transaction(async (tx) => {
      const orderNumber = await this.numbers.next(tx, companyId, 'purchase_order', 'PO');
      return tx.purchaseOrder.create({
        data: {
          companyId,
          branchId,
          supplierId,
          orderNumber,
          orderDate,
          expectedDate: dto.expectedDate ? this.date(dto.expectedDate, 'expectedDate') : null,
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
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'purchase_orders',
      entityId: created.id,
      after: { orderNumber: created.orderNumber, total: created.totalAmount.toFixed(MONEY_SCALE) },
    });

    return this.findOne(companyId, created.id);
  }

  async approve(companyId: string, userId: string, id: string) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true, status: true, createdBy: true, orderNumber: true },
    });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (order.status !== OrderStatus.DRAFT) {
      throw new BadRequestException(`Only a draft order can be approved (it is ${order.status})`);
    }

    const settings = await this.settings.get(companyId);
    if (settings.segregationOfDuties && order.createdBy === userId) {
      throw new BadRequestException(
        'Segregation of duties is on: the person who raised this order may not approve it',
      );
    }

    const claimed = await this.prisma.purchaseOrder.updateMany({
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
      entity: 'purchase_orders',
      entityId: id,
      after: { orderNumber: order.orderNumber },
    });

    return this.findOne(companyId, id);
  }

  async cancel(companyId: string, userId: string, id: string, reason?: string) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { _count: { select: { invoices: true } } },
    });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('This order is already cancelled');
    }
    if (order._count.invoices > 0) {
      throw new BadRequestException(
        'This order has invoices against it; cancel or reverse those instead of the order',
      );
    }

    await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: OrderStatus.CANCELLED, notes: reason ? `${order.notes ?? ''}\n${reason}`.trim() : order.notes },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CANCEL',
      entity: 'purchase_orders',
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
   * are the receiver's business, and a draft is where they say so before the
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
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!order) throw new NotFoundException('Purchase order not found');
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

    const invoiceLines: Array<{ itemId: string; description: string; quantity: string; unitPrice: string; taxRate: string; unitName?: string }> = [];
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
      // The order stores base units; hand the invoice the quantity in the
      // chosen unit so it re-applies the same factor and lands on the same
      // base quantity. Legacy lines (no snapshot) pass through unchanged.
      const hasUnit = line.unitFactor !== null && line.unitFactor !== undefined;
      const invoiceQuantity = hasUnit
        ? quantity.div(line.unitFactor as Prisma.Decimal).toDecimalPlaces(MONEY_SCALE)
        : quantity;
      invoiceLines.push({
        itemId: line.itemId,
        description: line.description,
        quantity: invoiceQuantity.toFixed(MONEY_SCALE),
        unitPrice: line.unitPrice.toFixed(MONEY_SCALE),
        taxRate: line.taxRate.toFixed(MONEY_SCALE),
        unitName: line.unitName ?? undefined,
      });
      consumed.push({ lineId: line.id, quantity });
    }

    if (invoiceLines.length === 0) {
      throw new BadRequestException('This order is fully invoiced; nothing is outstanding');
    }

    const invoice = await this.invoices.create(companyId, branchId, userId, {
      invoiceDate: String(dto.invoiceDate ?? new Date().toISOString().slice(0, 10)),
      supplierId: order.supplierId,
      notes: `From purchase order ${order.orderNumber}`,
      lines: invoiceLines,
    } as never);

    const invoiceId = String((invoice as { id?: string }).id ?? '');

    await this.prisma.$transaction(async (tx) => {
      for (const entry of consumed) {
        await tx.purchaseOrderLine.update({
          where: { id: entry.lineId },
          data: { invoicedQuantity: { increment: entry.quantity } },
        });
      }
      if (invoiceId) {
        await tx.purchaseInvoice.update({
          where: { id: invoiceId },
          data: { purchaseOrderId: order.id },
        });
      }
      const lines = await tx.purchaseOrderLine.findMany({ where: { orderId: order.id } });
      const complete = lines.every((line) => line.invoicedQuantity.greaterThanOrEqualTo(line.quantity));
      await tx.purchaseOrder.update({
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
      entity: 'purchase_orders',
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
    supplierId: string,
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
        select: { id: true, code: true, nameEn: true, unit: true, isActive: true, purchasePrice: true, taxRate: true, units: true },
      });
      if (!item) throw new BadRequestException(`Line ${index + 1}: the item does not exist`);
      if (!item.isActive) throw new BadRequestException(`Line ${index + 1}: item ${item.code} is inactive`);

      const enteredQuantity = this.positive(raw.quantity, `Line ${index + 1} quantity`);
      const resolved = resolveUnitSelection({
        lineLabel: `Line ${index + 1}`,
        requestedUnitId: raw.unitId,
        requestedUnitName: raw.unitName,
        enteredQuantity,
        baseUnitName: item.unit,
        units: (item as { units?: any[] }).units ?? [],
        purpose: 'purchase',
      });
      // Internal base quantity; the entered quantity lives in the snapshot.
      const quantity = resolved.baseQuantity;
      const discountPercent = this.percent(raw.discountPercent, `Line ${index + 1} discountPercent`);

      let unitPrice = raw.unitPrice === undefined || raw.unitPrice === null || raw.unitPrice === ''
        ? null
        : this.nonNegative(raw.unitPrice, `Line ${index + 1} unitPrice`);
      if (unitPrice === null) {
        const chosenUnitName = resolved.snapshot.unitName ?? item.unit;
        const listed = await this.prices.resolvePrice(this.prisma, companyId, {
          partyId: supplierId,
          partyKind: 'SUPPLIER',
          itemId: item.id,
          unit: chosenUnitName,
          quantity: enteredQuantity,
        });
        unitPrice = listed
          ? listed.price
          : defaultUnitPrice('purchase', resolved.row, item.purchasePrice);
      }

      const taxRate = raw.taxRate === undefined || raw.taxRate === null || raw.taxRate === ''
        ? item.taxRate ?? new Prisma.Decimal(settings.taxRate)
        : this.percent(raw.taxRate, `Line ${index + 1} taxRate`);

      // Money is computed from the quantity the user entered in the chosen unit.
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
    expectedDate: Date | null;
    status: OrderStatus;
    currency: string;
    subTotal: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    notes: string | null;
    supplier?: { code: string; nameEn: string; nameAr: string } | null;
  }) {
    return {
      id: row.id,
      orderNumber: row.orderNumber,
      orderDate: row.orderDate.toISOString().slice(0, 10),
      expectedDate: row.expectedDate?.toISOString().slice(0, 10) ?? null,
      status: row.status,
      currency: row.currency,
      supplierCode: row.supplier?.code ?? null,
      supplierNameEn: row.supplier?.nameEn ?? null,
      supplierNameAr: row.supplier?.nameAr ?? null,
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
