import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, JournalStatus, Prisma, StockDirection } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccountMapService } from '../accounting/account-map.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { PostingService } from '../accounting/posting.service';
import {
  CreateSalesInvoiceDto,
  ListInvoicesDto,
  SalesInvoiceLineDto,
} from './dto/sales-invoice.dto';

const MONEY_SCALE = 4;
const RATE_SCALE = 4;

interface PreparedLine {
  lineNumber: number;
  itemId: string | null;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
}

@Injectable()
export class SalesInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: DocumentNumberService,
    private readonly posting: PostingService,
    private readonly accounts: AccountMapService,
    private readonly audit: AuditService,
  ) {}

  async findAll(companyId: string, query: ListInvoicesDto) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);

    const where: Prisma.SalesInvoiceWhereInput = { companyId, deletedAt: null };
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
      items: items.map((i) => this.toSummary(i)),
      total,
      page,
      pageSize,
    };
  }

  async findOne(companyId: string, id: string) {
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        customer: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        branch: { select: { code: true, nameEn: true, nameAr: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: { item: { select: { code: true, nameEn: true, nameAr: true, unit: true } } },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Sales invoice not found');

    return {
      ...this.toSummary(invoice),
      branch: invoice.branch,
      notes: invoice.notes,
      journalEntryId: invoice.journalEntryId,
      postedAt: invoice.postedAt?.toISOString() ?? null,
      lines: invoice.lines.map((l) => ({
        id: l.id,
        lineNumber: l.lineNumber,
        itemId: l.itemId,
        itemCode: l.item?.code ?? null,
        itemNameEn: l.item?.nameEn ?? null,
        itemNameAr: l.item?.nameAr ?? null,
        unit: l.item?.unit ?? null,
        description: l.description,
        quantity: l.quantity.toFixed(MONEY_SCALE),
        unitPrice: l.unitPrice.toFixed(MONEY_SCALE),
        taxRate: l.taxRate.toFixed(RATE_SCALE),
        taxAmount: l.taxAmount.toFixed(MONEY_SCALE),
        lineTotal: l.lineTotal.toFixed(MONEY_SCALE),
        unitCost: l.unitCost.toFixed(MONEY_SCALE),
        costTotal: l.costTotal.toFixed(MONEY_SCALE),
      })),
    };
  }

  /** Creates a DRAFT invoice. Nothing reaches the ledger or the stock ledger. */
  async create(
    companyId: string,
    branchId: string | null,
    userId: string,
    dto: CreateSalesInvoiceDto,
  ) {
    if (!branchId) {
      throw new BadRequestException('The signed-in user is not assigned to a branch');
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, companyId, deletedAt: null },
      select: { id: true, nameEn: true, isActive: true },
    });
    if (!customer) throw new BadRequestException('The customer does not exist');
    if (!customer.isActive) throw new BadRequestException('The customer is inactive');

    const lines = await this.prepareLines(companyId, dto.lines);
    const totals = this.totalsOf(lines);

    const created = await this.prisma.$transaction(async (tx) => {
      const invoiceNumber = await this.numbers.next(
        tx,
        companyId,
        'SALES_INVOICE',
        'SI',
      );

      return tx.salesInvoice.create({
        data: {
          companyId,
          branchId,
          invoiceNumber,
          invoiceDate: new Date(dto.invoiceDate),
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          customerId: dto.customerId,
          status: InvoiceStatus.DRAFT,
          subTotal: totals.subTotal,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          notes: dto.notes ?? null,
          createdBy: userId,
          lines: {
            create: lines.map((l) => ({
              lineNumber: l.lineNumber,
              itemId: l.itemId,
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              taxRate: l.taxRate,
              taxAmount: l.taxAmount,
              lineTotal: l.lineTotal,
            })),
          },
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
    });

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

    return this.findOne(companyId, created.id);
  }

  /**
   * Posts a draft invoice.
   *
   * Everything happens in one transaction: the stock is issued at the current
   * weighted average cost, the cost lines are written onto the invoice, and the
   * journal entry is created. If any of it fails, none of it happened.
   */
  async post(companyId: string, userId: string, id: string) {
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        lines: { orderBy: { lineNumber: 'asc' } },
        customer: { select: { code: true, nameEn: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Sales invoice not found');
    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException(
        `Only draft invoices can be posted (current status: ${invoice.status})`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const accounts = await this.accounts.resolve(tx, companyId, [
        'accountsReceivable',
        'salesRevenue',
        'vatPayable',
        'inventory',
        'costOfGoodsSold',
      ]);

      // ---- stock issue, valued at the weighted average cost
      let costOfGoods = new Prisma.Decimal(0);
      const costByLine = new Map<string, { unitCost: Prisma.Decimal; costTotal: Prisma.Decimal }>();

      for (const line of invoice.lines) {
        if (!line.itemId) continue;

        const item = await tx.item.findFirst({
          where: { id: line.itemId, companyId, deletedAt: null },
          select: { id: true, code: true, nameEn: true, unit: true, isStockTracked: true },
        });
        if (!item) throw new BadRequestException('An invoice line references a missing item');
        if (!item.isStockTracked) continue;

        const balance = await tx.stockBalance.findUnique({
          where: {
            companyId_branchId_itemId: {
              companyId,
              branchId: invoice.branchId,
              itemId: item.id,
            },
          },
        });

        const qtyOnHand = balance?.quantity ?? new Prisma.Decimal(0);
        const valueOnHand = balance?.value ?? new Prisma.Decimal(0);

        if (qtyOnHand.lessThan(line.quantity)) {
          throw new BadRequestException(
            `Not enough stock for ${item.code} ${item.nameEn}: ` +
              `${qtyOnHand.toFixed(MONEY_SCALE)} available, ` +
              `${line.quantity.toFixed(MONEY_SCALE)} requested. ` +
              'Record a purchase invoice first.',
          );
        }

        const unitCost = qtyOnHand.isZero()
          ? new Prisma.Decimal(0)
          : valueOnHand.div(qtyOnHand).toDecimalPlaces(MONEY_SCALE);
        const costTotal = unitCost.mul(line.quantity).toDecimalPlaces(MONEY_SCALE);

        costOfGoods = costOfGoods.plus(costTotal);
        costByLine.set(line.id, { unitCost, costTotal });

        await tx.stockMovement.create({
          data: {
            companyId,
            branchId: invoice.branchId,
            itemId: item.id,
            movementDate: invoice.invoiceDate,
            direction: StockDirection.OUT,
            quantity: line.quantity,
            unitCost,
            totalCost: costTotal,
            referenceType: 'SALES_INVOICE',
            referenceId: invoice.id,
            referenceNumber: invoice.invoiceNumber,
            createdBy: userId,
          },
        });

        await tx.stockBalance.upsert({
          where: {
            companyId_branchId_itemId: {
              companyId,
              branchId: invoice.branchId,
              itemId: item.id,
            },
          },
          create: {
            companyId,
            branchId: invoice.branchId,
            itemId: item.id,
            quantity: line.quantity.negated(),
            value: costTotal.negated(),
          },
          update: {
            quantity: { decrement: line.quantity },
            value: { decrement: costTotal },
          },
        });
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
          { accountId: accounts.salesRevenue, credit: invoice.subTotal, description: 'Sales revenue' },
          { accountId: accounts.vatPayable, credit: invoice.taxAmount, description: 'VAT on sales' },
          { accountId: accounts.costOfGoodsSold, debit: costOfGoods, description: 'Cost of goods sold' },
          { accountId: accounts.inventory, credit: costOfGoods, description: 'Inventory issued' },
        ],
      });

      const updated = await tx.salesInvoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.POSTED,
          costOfGoods,
          journalEntryId: journal.id,
          postedAt: new Date(),
          postedBy: userId,
        },
      });

      return { updated, journal, costOfGoods };
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'POST',
      entity: 'sales_invoices',
      entityId: id,
      before: { status: InvoiceStatus.DRAFT },
      after: {
        status: InvoiceStatus.POSTED,
        journalEntryId: result.journal.id,
        journalNumber: result.journal.entryNumber,
        costOfGoods: result.costOfGoods.toFixed(MONEY_SCALE),
      },
    });

    return this.findOne(companyId, id);
  }

  /**
   * Reverses a posted invoice.
   *
   * Nothing is edited or deleted. A reversing journal entry is written, the
   * stock goes back in at exactly the cost it left at, and the invoice is
   * marked REVERSED so it can never be posted twice.
   */
  async reverse(companyId: string, userId: string, id: string) {
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!invoice) throw new NotFoundException('Sales invoice not found');
    if (invoice.status !== InvoiceStatus.POSTED) {
      throw new BadRequestException('Only posted invoices can be reversed');
    }
    if (!invoice.journalEntryId) {
      throw new BadRequestException('This invoice has no journal entry to reverse');
    }

    const original = await this.prisma.journalEntry.findFirst({
      where: { id: invoice.journalEntryId, companyId },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!original) throw new NotFoundException('The original journal entry is missing');
    if (original.status === JournalStatus.REVERSED) {
      throw new BadRequestException('This invoice has already been reversed');
    }

    const journal = await this.prisma.$transaction(async (tx) => {
      for (const line of invoice.lines) {
        if (!line.itemId || line.costTotal.isZero()) continue;

        await tx.stockMovement.create({
          data: {
            companyId,
            branchId: invoice.branchId,
            itemId: line.itemId,
            movementDate: new Date(),
            direction: StockDirection.IN,
            quantity: line.quantity,
            unitCost: line.unitCost,
            totalCost: line.costTotal,
            referenceType: 'SALES_INVOICE_REVERSAL',
            referenceId: invoice.id,
            referenceNumber: invoice.invoiceNumber,
            notes: `Reversal of ${invoice.invoiceNumber}`,
            createdBy: userId,
          },
        });

        await tx.stockBalance.upsert({
          where: {
            companyId_branchId_itemId: {
              companyId,
              branchId: invoice.branchId,
              itemId: line.itemId,
            },
          },
          create: {
            companyId,
            branchId: invoice.branchId,
            itemId: line.itemId,
            quantity: line.quantity,
            value: line.costTotal,
          },
          update: {
            quantity: { increment: line.quantity },
            value: { increment: line.costTotal },
          },
        });
      }

      const entryNumber = await this.numbers.next(tx, companyId, 'JOURNAL', 'JV');
      const reversal = await tx.journalEntry.create({
        data: {
          companyId,
          branchId: original.branchId,
          entryNumber,
          entryDate: new Date(),
          description: `Reversal of sales invoice ${invoice.invoiceNumber}`,
          status: JournalStatus.POSTED,
          currency: original.currency,
          totalDebit: original.totalCredit,
          totalCredit: original.totalDebit,
          reversalOfId: original.id,
          postedAt: new Date(),
          postedBy: userId,
          createdBy: userId,
          lines: {
            create: original.lines.map((l) => ({
              lineNumber: l.lineNumber,
              accountId: l.accountId,
              debit: l.credit,
              credit: l.debit,
              description: l.description,
              costCenterId: l.costCenterId,
            })),
          },
        },
        select: { id: true, entryNumber: true },
      });

      await tx.journalEntry.update({
        where: { id: original.id },
        data: { status: JournalStatus.REVERSED },
      });

      await tx.salesInvoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.REVERSED },
      });

      return reversal;
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'REVERSE',
      entity: 'sales_invoices',
      entityId: id,
      after: { reversalJournalNumber: journal.entryNumber },
    });

    return this.findOne(companyId, id);
  }

  // ------------------------------------------------------------------ helpers

  private async prepareLines(
    companyId: string,
    input: SalesInvoiceLineDto[],
  ): Promise<PreparedLine[]> {
    const prepared: PreparedLine[] = [];

    for (const [index, raw] of input.entries()) {
      const quantity = this.positive(raw.quantity, `Line ${index + 1} quantity`);
      const unitPrice = this.nonNegative(raw.unitPrice, `Line ${index + 1} unitPrice`);

      // A line needs to identify itself: either an item, or free text for a
      // service that is not stocked.
      let item: {
        code: string;
        nameEn: string;
        taxRate: Prisma.Decimal;
      } | null = null;

      if (raw.itemId) {
        item = await this.prisma.item.findFirst({
          where: { id: raw.itemId, companyId, deletedAt: null },
          select: { code: true, nameEn: true, taxRate: true, isActive: true },
        });
        if (!item) throw new BadRequestException(`Line ${index + 1}: the item does not exist`);
        if (!(item as any).isActive) {
          throw new BadRequestException(`Line ${index + 1}: the item is inactive`);
        }
      }

      const description = raw.description?.trim() || (item ? `${item.code} ${item.nameEn}` : '');
      if (!description) {
        throw new BadRequestException(
          `Line ${index + 1}: give either an item or a description`,
        );
      }

      const taxRate =
        raw.taxRate !== undefined
          ? this.rate(raw.taxRate, `Line ${index + 1} taxRate`)
          : (item?.taxRate ?? new Prisma.Decimal(0));

      const lineTotal = quantity.mul(unitPrice).toDecimalPlaces(MONEY_SCALE);
      const taxAmount = lineTotal
        .mul(taxRate)
        .div(100)
        .toDecimalPlaces(MONEY_SCALE);

      prepared.push({
        lineNumber: index + 1,
        itemId: raw.itemId ?? null,
        description,
        quantity,
        unitPrice,
        taxRate,
        taxAmount,
        lineTotal,
      });
    }

    return prepared;
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
      throw new BadRequestException(`${field} must be greater than zero`);
    }
    return d;
  }

  private nonNegative(value: string, field: string): Prisma.Decimal {
    const d = this.decimal(value, field);
    if (d.isNegative()) throw new BadRequestException(`${field} cannot be negative`);
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
      return new Prisma.Decimal(value).toDecimalPlaces(scale);
    } catch {
      throw new BadRequestException(`${field} is not a valid number: ${value}`);
    }
  }

  private toSummary(invoice: {
    id: string;
    invoiceNumber: string;
    invoiceDate: Date;
    dueDate: Date | null;
    status: InvoiceStatus;
    currency: string;
    subTotal: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    paidAmount: Prisma.Decimal;
    costOfGoods: Prisma.Decimal;
    createdAt: Date;
    customer?: { id?: string; code: string; nameEn: string; nameAr: string };
  }) {
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
      dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
      status: invoice.status.toLowerCase(),
      currency: invoice.currency,
      customer: invoice.customer,
      subTotal: invoice.subTotal.toFixed(MONEY_SCALE),
      taxAmount: invoice.taxAmount.toFixed(MONEY_SCALE),
      totalAmount: invoice.totalAmount.toFixed(MONEY_SCALE),
      paidAmount: invoice.paidAmount.toFixed(MONEY_SCALE),
      balanceDue: invoice.totalAmount.minus(invoice.paidAmount).toFixed(MONEY_SCALE),
      costOfGoods: invoice.costOfGoods.toFixed(MONEY_SCALE),
      grossProfit: invoice.subTotal.minus(invoice.costOfGoods).toFixed(MONEY_SCALE),
      createdAt: invoice.createdAt.toISOString(),
    };
  }
}
