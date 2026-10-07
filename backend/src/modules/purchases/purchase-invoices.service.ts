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
  CreatePurchaseInvoiceDto,
  ListPurchaseInvoicesDto,
  PurchaseInvoiceLineDto,
} from './dto/purchase-invoice.dto';

const MONEY_SCALE = 4;
const RATE_SCALE = 4;

interface PreparedLine {
  lineNumber: number;
  itemId: string;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
}

@Injectable()
export class PurchaseInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: DocumentNumberService,
    private readonly posting: PostingService,
    private readonly accounts: AccountMapService,
    private readonly audit: AuditService,
  ) {}

  async findAll(companyId: string, query: ListPurchaseInvoicesDto) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);

    const where: Prisma.PurchaseInvoiceWhereInput = { companyId, deletedAt: null };
    if (query.supplierId) where.supplierId = query.supplierId;
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
      this.prisma.purchaseInvoice.findMany({
        where,
        orderBy: [{ invoiceDate: 'desc' }, { invoiceNumber: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { supplier: { select: { code: true, nameEn: true, nameAr: true } } },
      }),
      this.prisma.purchaseInvoice.count({ where }),
    ]);

    return { items: items.map((i) => this.toSummary(i)), total, page, pageSize };
  }

  async findOne(companyId: string, id: string) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        supplier: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        branch: { select: { code: true, nameEn: true, nameAr: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: { item: { select: { code: true, nameEn: true, nameAr: true, unit: true } } },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Purchase invoice not found');

    return {
      ...this.toSummary(invoice),
      branch: invoice.branch,
      notes: invoice.notes,
      supplierReference: invoice.supplierReference,
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
      })),
    };
  }

  async create(
    companyId: string,
    branchId: string | null,
    userId: string,
    dto: CreatePurchaseInvoiceDto,
  ) {
    if (!branchId) {
      throw new BadRequestException('The signed-in user is not assigned to a branch');
    }

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, companyId, deletedAt: null },
      select: { id: true, isActive: true },
    });
    if (!supplier) throw new BadRequestException('The supplier does not exist');
    if (!supplier.isActive) throw new BadRequestException('The supplier is inactive');

    const lines = await this.prepareLines(companyId, dto.lines);
    const subTotal = lines.reduce((s, l) => s.plus(l.lineTotal), new Prisma.Decimal(0));
    const taxAmount = lines.reduce((s, l) => s.plus(l.taxAmount), new Prisma.Decimal(0));
    const totalAmount = subTotal.plus(taxAmount);

    const created = await this.prisma.$transaction(async (tx) => {
      const invoiceNumber = await this.numbers.next(
        tx,
        companyId,
        'PURCHASE_INVOICE',
        'PI',
      );

      return tx.purchaseInvoice.create({
        data: {
          companyId,
          branchId,
          invoiceNumber,
          supplierReference: dto.supplierReference ?? null,
          invoiceDate: new Date(dto.invoiceDate),
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          supplierId: dto.supplierId,
          status: InvoiceStatus.DRAFT,
          subTotal,
          taxAmount,
          totalAmount,
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
      });
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'purchase_invoices',
      entityId: created.id,
      after: {
        invoiceNumber: created.invoiceNumber,
        totalAmount: created.totalAmount.toFixed(MONEY_SCALE),
      },
    });

    return this.findOne(companyId, created.id);
  }

  async post(companyId: string, userId: string, id: string) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        lines: { orderBy: { lineNumber: 'asc' } },
        supplier: { select: { code: true, nameEn: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Purchase invoice not found');
    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException(
        `Only draft invoices can be posted (current status: ${invoice.status})`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const accounts = await this.accounts.resolve(tx, companyId, [
        'accountsPayable',
        'inventory',
        'vatReceivable',
      ]);

      for (const line of invoice.lines) {
        if (!line.itemId) {
          throw new BadRequestException(
            'A purchase invoice line has no item, so it cannot be posted to stock',
          );
        }
        const item = await tx.item.findFirst({
          where: { id: line.itemId, companyId, deletedAt: null },
          select: { id: true, code: true, isStockTracked: true },
        });
        if (!item) throw new BadRequestException('An invoice line references a missing item');
        if (!item.isStockTracked) {
          throw new BadRequestException(
            `Item ${item.code} is not stock-tracked, so it cannot be purchased through a ` +
              'purchase invoice. Record a journal entry for it instead.',
          );
        }

        // The purchase price becomes the cost of what is received.
        const unitCost = line.unitPrice;
        const costTotal = unitCost.mul(line.quantity).toDecimalPlaces(MONEY_SCALE);

        await tx.stockMovement.create({
          data: {
            companyId,
            branchId: invoice.branchId,
            itemId: item.id,
            movementDate: invoice.invoiceDate,
            direction: StockDirection.IN,
            quantity: line.quantity,
            unitCost,
            totalCost: costTotal,
            referenceType: 'PURCHASE_INVOICE',
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
            quantity: line.quantity,
            value: costTotal,
          },
          update: {
            quantity: { increment: line.quantity },
            value: { increment: costTotal },
          },
        });
      }

      const journal = await this.posting.post(tx, {
        companyId,
        branchId: invoice.branchId,
        userId,
        entryDate: invoice.invoiceDate,
        description: `Purchase invoice from ${invoice.supplier.nameEn} (${invoice.supplier.code})`,
        sourceType: 'PURCHASE_INVOICE',
        sourceId: invoice.id,
        sourceNumber: invoice.invoiceNumber,
        lines: [
          { accountId: accounts.inventory, debit: invoice.subTotal, description: 'Inventory received' },
          { accountId: accounts.vatReceivable, debit: invoice.taxAmount, description: 'VAT on purchases' },
          { accountId: accounts.accountsPayable, credit: invoice.totalAmount, description: 'Supplier balance' },
        ],
      });

      await tx.purchaseInvoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.POSTED,
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
      entity: 'purchase_invoices',
      entityId: id,
      before: { status: InvoiceStatus.DRAFT },
      after: {
        status: InvoiceStatus.POSTED,
        journalEntryId: result.id,
        journalNumber: result.entryNumber,
      },
    });

    return this.findOne(companyId, id);
  }

  async reverse(companyId: string, userId: string, id: string) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!invoice) throw new NotFoundException('Purchase invoice not found');
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

    const reversal = await this.prisma.$transaction(async (tx) => {
      for (const line of invoice.lines) {
        if (!line.itemId) {
          throw new BadRequestException(
            'A purchase invoice line has no item, so its stock cannot be returned',
          );
        }
        const balance = await tx.stockBalance.findUnique({
          where: {
            companyId_branchId_itemId: {
              companyId,
              branchId: invoice.branchId,
              itemId: line.itemId,
            },
          },
        });
        const qtyOnHand = balance?.quantity ?? new Prisma.Decimal(0);
        if (qtyOnHand.lessThan(line.quantity)) {
          throw new BadRequestException(
            'Cannot reverse this purchase: part of the stock has already been sold or ' +
              'moved, so returning it would leave a negative balance.',
          );
        }

        await tx.stockMovement.create({
          data: {
            companyId,
            branchId: invoice.branchId,
            itemId: line.itemId,
            movementDate: new Date(),
            direction: StockDirection.OUT,
            quantity: line.quantity,
            unitCost: line.unitPrice,
            totalCost: line.lineTotal,
            referenceType: 'PURCHASE_INVOICE_REVERSAL',
            referenceId: invoice.id,
            referenceNumber: invoice.invoiceNumber,
            notes: `Reversal of ${invoice.invoiceNumber}`,
            createdBy: userId,
          },
        });

        await tx.stockBalance.update({
          where: {
            companyId_branchId_itemId: {
              companyId,
              branchId: invoice.branchId,
              itemId: line.itemId,
            },
          },
          data: {
            quantity: { decrement: line.quantity },
            value: { decrement: line.lineTotal },
          },
        });
      }

      const entryNumber = await this.numbers.next(tx, companyId, 'JOURNAL', 'JV');
      const mirror = await tx.journalEntry.create({
        data: {
          companyId,
          branchId: original.branchId,
          entryNumber,
          entryDate: new Date(),
          description: `Reversal of purchase invoice ${invoice.invoiceNumber}`,
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

      await tx.purchaseInvoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.REVERSED },
      });

      return mirror;
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'REVERSE',
      entity: 'purchase_invoices',
      entityId: id,
      after: { reversalJournalNumber: reversal.entryNumber },
    });

    return this.findOne(companyId, id);
  }

  private async prepareLines(
    companyId: string,
    input: PurchaseInvoiceLineDto[],
  ): Promise<PreparedLine[]> {
    const prepared: PreparedLine[] = [];

    for (const [index, raw] of input.entries()) {
      const item = await this.prisma.item.findFirst({
        where: { id: raw.itemId, companyId, deletedAt: null },
        select: { code: true, nameEn: true, nameAr: true, taxRate: true, isActive: true },
      });
      if (!item) {
        throw new BadRequestException(`Line ${index + 1}: the item does not exist`);
      }
      if (!item.isActive) {
        throw new BadRequestException(`Line ${index + 1}: the item is inactive`);
      }

      const quantity = this.positive(raw.quantity, `Line ${index + 1} quantity`);
      const unitPrice = this.nonNegative(raw.unitPrice, `Line ${index + 1} unitPrice`);
      const taxRate =
        raw.taxRate !== undefined
          ? this.rate(raw.taxRate, `Line ${index + 1} taxRate`)
          : item.taxRate;

      const lineTotal = quantity.mul(unitPrice).toDecimalPlaces(MONEY_SCALE);
      const taxAmount = lineTotal.mul(taxRate).div(100).toDecimalPlaces(MONEY_SCALE);

      prepared.push({
        lineNumber: index + 1,
        itemId: raw.itemId,
        description: raw.description ?? `${item.code} ${item.nameEn}`,
        quantity,
        unitPrice,
        taxRate,
        taxAmount,
        lineTotal,
      });
    }

    return prepared;
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

  private decimal(value: string, field: string, scale = MONEY_SCALE): Prisma.Decimal {
    try {
      return new Prisma.Decimal(value).toDecimalPlaces(scale);
    } catch {
      throw new BadRequestException(`${field} is not a valid number: ${value}`);
    }
  }

  private toSummary(invoice: {
    id: string;
    invoiceNumber: string;
    supplierReference: string | null;
    invoiceDate: Date;
    dueDate: Date | null;
    status: InvoiceStatus;
    currency: string;
    subTotal: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    paidAmount: Prisma.Decimal;
    createdAt: Date;
    supplier?: { id?: string; code: string; nameEn: string; nameAr: string };
  }) {
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      supplierReference: invoice.supplierReference,
      invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
      dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
      status: invoice.status.toLowerCase(),
      currency: invoice.currency,
      supplier: invoice.supplier,
      subTotal: invoice.subTotal.toFixed(MONEY_SCALE),
      taxAmount: invoice.taxAmount.toFixed(MONEY_SCALE),
      totalAmount: invoice.totalAmount.toFixed(MONEY_SCALE),
      paidAmount: invoice.paidAmount.toFixed(MONEY_SCALE),
      balanceDue: invoice.totalAmount.minus(invoice.paidAmount).toFixed(MONEY_SCALE),
      createdAt: invoice.createdAt.toISOString(),
    };
  }
}
