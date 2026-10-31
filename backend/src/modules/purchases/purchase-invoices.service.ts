import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceDocumentType,
  InvoiceStatus,
  JournalStatus,
  Prisma,
  StockDirection,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanySettingsService } from '../../common/settings/company-settings.module';
import { WarehouseService } from '../../common/warehouse/warehouse.service';
import {
  defaultUnitPrice,
  movementUnitSnapshot,
  resolveUnitSelection,
} from '../../common/units/unit-math';
import { PriceListsService } from '../sales/price-lists.service';
import { AccountMapService } from '../accounting/account-map.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { attributedLines } from '../accounting/cost-center-attribution';
import { PostingService } from '../accounting/posting.service';
import {
  allocateDocumentDiscount,
  assertDiscountLimit,
  DiscountError,
  DiscountInput,
  effectiveDiscountPercent,
  ResolvedDiscount,
  resolveDiscount,
} from '../../common/pricing/discount';
import { allocateLandedCostAmounts } from './landed-cost-allocation';
import {
  CreatePurchaseInvoiceDto,
  ListPurchaseInvoicesDto,
  PurchaseInvoiceLineDto,
} from './dto/purchase-invoice.dto';

const MONEY_SCALE = 4;
const RATE_SCALE = 4;

interface PreparedLandedCostCharge {
  description: string;
  amount: Prisma.Decimal;
}

interface PreparedLine {
  lineNumber: number;
  itemId: string;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  /// Net of both discounts: the taxable value and the inventory base.
  lineTotal: Prisma.Decimal;
  grossLineTotal: Prisma.Decimal;
  discountType: 'PERCENT' | 'AMOUNT' | null;
  discountPercent: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  invoiceDiscountAmount: Prisma.Decimal;
  landedCostAmount: Prisma.Decimal;
  inventoryCostTotal: Prisma.Decimal;
  costCenterId: string | null;
  // Multi-unit snapshot. All null on a legacy/base-unit line; `quantity` is
  // always the internal base-unit quantity stock actually receives.
  unitName: string | null;
  unitFactor: Prisma.Decimal | null;
  unitQuantity: Prisma.Decimal | null;
}

interface PreparedInvoice {
  lines: PreparedLine[];
  documentDiscount: ResolvedDiscount;
  lineDiscountTotal: Prisma.Decimal;
}

@Injectable()
export class PurchaseInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: DocumentNumberService,
    private readonly posting: PostingService,
    private readonly accounts: AccountMapService,
    private readonly settings: CompanySettingsService,
    private readonly warehouses: WarehouseService,
    private readonly prices: PriceListsService,
    private readonly audit: AuditService,
  ) {}

  async findAll(companyId: string, query: ListPurchaseInvoicesDto) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);

    const where: Prisma.PurchaseInvoiceWhereInput = {
      companyId,
      deletedAt: null,
      documentType: InvoiceDocumentType.INVOICE,
    };
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
      landedCostAmount: invoice.landedCostAmount.toFixed(MONEY_SCALE),
      journalEntryId: invoice.journalEntryId,
      postedAt: invoice.postedAt?.toISOString() ?? null,
      lines: invoice.lines.map((l) => ({
        id: l.id,
        lineNumber: l.lineNumber,
        itemId: l.itemId,
        itemCode: l.item?.code ?? null,
        itemNameEn: l.item?.nameEn ?? null,
        itemNameAr: l.item?.nameAr ?? null,
        // Chosen unit with legacy fallback to the item base unit.
        unit: l.unitName ?? l.item?.unit ?? null,
        unitName: l.unitName ?? null,
        unitFactor: l.unitFactor === null || l.unitFactor === undefined ? null : l.unitFactor.toFixed(6),
        // Entered quantity in the chosen unit; legacy rows fall back to stored.
        unitQuantity: (l.unitQuantity ?? l.quantity).toFixed(MONEY_SCALE),
        description: l.description,
        // Internal base-unit quantity received into stock.
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
        landedCostAmount: l.landedCostAmount.toFixed(MONEY_SCALE),
        inventoryCostTotal: l.inventoryCostTotal.toFixed(MONEY_SCALE),
        costCenterId: l.costCenterId ?? null,
        returnedCostTotal: l.returnedCostTotal.toFixed(MONEY_SCALE),
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

    const landedCosts = this.prepareLandedCosts(dto);
    const landedCostAmount = landedCosts.total;
    const prepared = await this.prepareLines(
      companyId,
      dto.lines,
      dto.supplierId,
      landedCostAmount,
      { type: dto.discountType, percent: dto.discountPercent, amount: dto.discountAmount },
    );
    const lines = prepared.lines;
    const subTotal = lines.reduce((s, l) => s.plus(l.lineTotal), new Prisma.Decimal(0));
    const taxAmount = lines.reduce((s, l) => s.plus(l.taxAmount), new Prisma.Decimal(0));
    const totalAmount = subTotal.plus(taxAmount).plus(landedCostAmount);

    const created = await this.prisma.$transaction(async (tx) => {
      const invoiceNumber = await this.numbers.next(
        tx,
        companyId,
        'PURCHASE_INVOICE',
        'PI',
      );

      return tx.purchaseInvoice.create({
        data: {
          warehouseId: dto.warehouseId ?? null,
          companyId,
          branchId,
          invoiceNumber,
          supplierReference: dto.supplierReference ?? null,
          invoiceDate: new Date(dto.invoiceDate),
          dueDate: dto.dueDate
            ? new Date(dto.dueDate)
            : (await this.dueDateFromTerms(companyId, dto.supplierId, new Date(dto.invoiceDate))),
          supplierId: dto.supplierId,
          status: InvoiceStatus.DRAFT,
          discountType: prepared.documentDiscount.type,
          discountPercent: prepared.documentDiscount.percent,
          discountAmount: prepared.documentDiscount.amount,
          lineDiscountTotal: prepared.lineDiscountTotal,
          subTotal,
          taxAmount,
          totalAmount,
          landedCostAmount,
          landedCostCharges: this.serializeLandedCosts(landedCosts.charges),
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
              grossLineTotal: l.grossLineTotal,
              discountType: l.discountType,
              discountPercent: l.discountPercent,
              discountAmount: l.discountAmount,
              invoiceDiscountAmount: l.invoiceDiscountAmount,
              landedCostAmount: l.landedCostAmount,
              inventoryCostTotal: l.inventoryCostTotal,
              costCenterId: l.costCenterId,
              unitName: l.unitName,
              unitFactor: l.unitFactor,
              unitQuantity: l.unitQuantity,
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

  /**
   * Replace a draft purchase invoice. Posted documents are immutable: changing
   * their cost after stock/accounting has been posted would silently change
   * inventory value without changing the ledger. For drafts, the line set and
   * header are replaced under a row lock in one transaction.
   */
  async updateDraft(
    companyId: string,
    branchId: string | null,
    userId: string,
    id: string,
    dto: CreatePurchaseInvoiceDto,
  ) {
    if (!branchId) {
      throw new BadRequestException('The signed-in user is not assigned to a branch');
    }
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!invoice) throw new NotFoundException('Purchase invoice not found');
    if (invoice.documentType !== InvoiceDocumentType.INVOICE) {
      throw new BadRequestException('Return documents cannot be edited as purchase invoices');
    }
    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Only a draft purchase invoice can be edited');
    }
    if (invoice.branchId !== branchId) {
      throw new BadRequestException('A draft can only be edited from its assigned branch');
    }

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, companyId, deletedAt: null },
      select: { id: true, isActive: true },
    });
    if (!supplier) throw new BadRequestException('The supplier does not exist');
    if (!supplier.isActive) throw new BadRequestException('The supplier is inactive');

    const landedCosts = this.prepareLandedCosts(dto);
    const landedCostAmount = landedCosts.total;
    const prepared = await this.prepareLines(
      companyId,
      dto.lines,
      dto.supplierId,
      landedCostAmount,
      { type: dto.discountType, percent: dto.discountPercent, amount: dto.discountAmount },
    );
    const lines = prepared.lines;
    const subTotal = lines.reduce((sum, line) => sum.plus(line.lineTotal), new Prisma.Decimal(0));
    const taxAmount = lines.reduce((sum, line) => sum.plus(line.taxAmount), new Prisma.Decimal(0));
    const totalAmount = subTotal.plus(taxAmount).plus(landedCostAmount);
    const invoiceDate = new Date(dto.invoiceDate);
    const dueDate = dto.dueDate
      ? new Date(dto.dueDate)
      : await this.dueDateFromTerms(companyId, dto.supplierId, invoiceDate);

    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: InvoiceStatus }>>(Prisma.sql`
        SELECT status
          FROM purchase_invoices
         WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid
         FOR UPDATE
      `);
      if (locked.length !== 1 || locked[0].status !== InvoiceStatus.DRAFT) {
        throw new BadRequestException(
          'This invoice was posted or changed by someone else. Reload it before editing.',
        );
      }

      await tx.purchaseInvoice.update({
        where: { id },
        data: {
          supplierId: dto.supplierId,
          supplierReference: dto.supplierReference ?? null,
          invoiceDate,
          dueDate,
          warehouseId: dto.warehouseId ?? invoice.warehouseId,
          discountType: prepared.documentDiscount.type,
          discountPercent: prepared.documentDiscount.percent,
          discountAmount: prepared.documentDiscount.amount,
          lineDiscountTotal: prepared.lineDiscountTotal,
          subTotal,
          taxAmount,
          totalAmount,
          landedCostAmount,
          landedCostCharges: this.serializeLandedCosts(landedCosts.charges),
          notes: dto.notes ?? null,
          lines: {
            deleteMany: {},
            create: lines.map((line) => ({
              lineNumber: line.lineNumber,
              itemId: line.itemId,
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
              landedCostAmount: line.landedCostAmount,
              inventoryCostTotal: line.inventoryCostTotal,
              costCenterId: line.costCenterId,
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
      action: 'UPDATE',
      entity: 'purchase_invoices',
      entityId: id,
      before: {
        status: invoice.status,
        totalAmount: invoice.totalAmount.toFixed(MONEY_SCALE),
        landedCostAmount: invoice.landedCostAmount.toFixed(MONEY_SCALE),
      },
      after: {
        status: InvoiceStatus.DRAFT,
        totalAmount: totalAmount.toFixed(MONEY_SCALE),
        landedCostAmount: landedCostAmount.toFixed(MONEY_SCALE),
      },
    });
    return this.findOne(companyId, id);
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
      // Claim the document before anything else happens: two simultaneous
      // posts must not both receive the same goods into stock.
      const claimed = await tx.purchaseInvoice.updateMany({
        where: { id: invoice.id, companyId, status: InvoiceStatus.DRAFT, deletedAt: null },
        data: { status: InvoiceStatus.POSTED, postedAt: new Date(), postedBy: userId },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException(
          'This invoice was posted by someone else a moment ago. Reload it to see the current state.',
        );
      }

      const accounts = await this.accounts.resolve(tx, companyId, [
        'accountsPayable',
        'inventory',
        'vatReceivable',
      ]);

      // Which pile the goods arrived in; the branch's default when the
      // document names none.
      const warehouseId = await this.warehouses.resolve(
        tx,
        companyId,
        invoice.branchId,
        invoice.warehouseId,
      );
      if (!invoice.warehouseId && warehouseId) {
        await tx.purchaseInvoice.update({
          where: { id: invoice.id },
          data: { warehouseId },
        });
      }

      for (const line of invoice.lines) {
        if (!line.itemId) {
          throw new BadRequestException(
            'A purchase invoice line has no item, so it cannot be posted to stock',
          );
        }
        const item = await tx.item.findFirst({
          where: { id: line.itemId, companyId, deletedAt: null },
          select: { id: true, code: true, unit: true, isStockTracked: true },
        });
        if (!item) throw new BadRequestException('An invoice line references a missing item');
        if (!item.isStockTracked) {
          throw new BadRequestException(
            `Item ${item.code} is not stock-tracked, so it cannot be purchased through a ` +
              'purchase invoice. Record a journal entry for it instead.',
          );
        }

        // The purchase price becomes the cost of what is received.
        const costTotal = line.inventoryCostTotal;
        const unitCost = costTotal.div(line.quantity).toDecimalPlaces(MONEY_SCALE);

        await tx.stockMovement.create({
          data: {
            companyId,
            branchId: invoice.branchId,
            warehouseId,
            itemId: item.id,
            movementDate: invoice.invoiceDate,
            direction: StockDirection.IN,
            quantity: line.quantity,
            // What was typed stays with the movement: ten cartons is how the
            // supplier's invoice arrived, however many pieces that is.
            ...movementUnitSnapshot({
              enteredUnit: line.unitName,
              enteredQuantity: line.unitQuantity,
              unitFactor: line.unitFactor,
              baseUnitName: item.unit,
              baseQuantity: line.quantity,
            }),
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
          // The received value (including landed cost) is attributed to the
          // centres named on the lines; anything unnamed stays unallocated.
          ...attributedLines(
            accounts.inventory,
            'debit',
            'Inventory and landed costs received',
            invoice.lines.map((line) => ({
              costCenterId: line.costCenterId,
              amount: line.inventoryCostTotal,
            })),
          ),
          { accountId: accounts.vatReceivable, debit: invoice.taxAmount, description: 'VAT on purchases' },
          { accountId: accounts.accountsPayable, credit: invoice.totalAmount, description: 'Supplier balance' },
        ],
      });

      // The transaction claimed the invoice as POSTED before touching stock.
      // Do not write its status a second time: the database transition guard
      // intentionally permits only DRAFT -> POSTED for purchase invoices.
      await tx.purchaseInvoice.update({
        where: { id: invoice.id },
        data: { journalEntryId: journal.id },
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

    const reversal = await this.prisma.$transaction(async (tx) => {
      const claimedInvoice = await tx.purchaseInvoice.updateMany({
        where: { id: invoice.id, companyId, status: InvoiceStatus.POSTED, deletedAt: null },
        data: { status: InvoiceStatus.REVERSED },
      });
      if (claimedInvoice.count !== 1) {
        throw new BadRequestException('This invoice has already been reversed');
      }
      const activeReturns = await tx.purchaseInvoice.count({
        where: {
          companyId,
          originalInvoiceId: invoice.id,
          documentType: InvoiceDocumentType.DEBIT_NOTE,
          status: InvoiceStatus.POSTED,
          deletedAt: null,
        },
      });
      if (activeReturns > 0) {
        throw new BadRequestException(
          'Reverse the posted purchase returns before reversing their source invoice.',
        );
      }
      const warehouseId = await this.warehouses.resolveForReversal(
        tx,
        companyId,
        invoice.branchId,
        invoice.warehouseId,
      );
      if (!invoice.warehouseId && warehouseId) {
        await tx.purchaseInvoice.update({
          where: { id: invoice.id },
          data: { warehouseId },
        });
      }
      // The journal claim itself happens inside PostingService.reverse,
      // below, in the same transaction as the stock going back out.

      // The reversal movement says "1 carton" the way the invoice did, so the
      // stock card reads the same in both directions. The base unit of each
      // item is read once here rather than per line.
      const reversalItems = await tx.item.findMany({
        where: { companyId, id: { in: [...new Set(invoice.lines.map((row) => row.itemId).filter((id): id is string => Boolean(id)))] } },
        select: { id: true, unit: true },
      });
      const reversalBaseName = new Map(reversalItems.map((row) => [row.id, row.unit]));

      for (const line of invoice.lines) {
        if (!line.itemId) {
          throw new BadRequestException(
            'A purchase invoice line has no item, so its stock cannot be returned',
          );
        }
        const lockedBalances = await tx.$queryRaw<
          Array<{ quantity: Prisma.Decimal; value: Prisma.Decimal }>
        >(Prisma.sql`
          SELECT "quantity", "value"
            FROM "stock_balances"
           WHERE "companyId" = ${companyId}::uuid
             AND "branchId" = ${invoice.branchId}::uuid
             AND "itemId" = ${line.itemId}::uuid
           FOR UPDATE
        `);
        const balance = lockedBalances[0] ?? null;
        const qtyOnHand = balance?.quantity ?? new Prisma.Decimal(0);
        const inventoryCostTotal = line.inventoryCostTotal.isZero() && !line.lineTotal.isZero()
          ? line.lineTotal
          : line.inventoryCostTotal;
        if (qtyOnHand.lessThan(line.quantity) || (balance && balance.value.lessThan(inventoryCostTotal))) {
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
            warehouseId,
            movementDate: new Date(),
            direction: StockDirection.OUT,
            quantity: line.quantity,
            ...movementUnitSnapshot({
              enteredUnit: line.unitName,
              enteredQuantity: line.unitQuantity,
              unitFactor: line.unitFactor,
              baseUnitName: reversalBaseName.get(line.itemId ?? '') ?? 'unit',
              baseQuantity: line.quantity,
            }),
            unitCost: inventoryCostTotal.div(line.quantity).toDecimalPlaces(MONEY_SCALE),
            totalCost: inventoryCostTotal,
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
            value: { decrement: inventoryCostTotal },
          },
        });
      }

      // One reversal path for the whole system: it claims the original,
      // refuses a closed period with a readable message (instead of the
      // database trigger surfacing as a 500), and stamps the mirror with
      // the invoice as its source so a ledger reader can drill back to it.
      return this.posting.reverse(
        tx,
        companyId,
        userId,
        original.id,
        `Reversal of purchase invoice ${invoice.invoiceNumber}`,
      );
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

  /// The due date the supplier's payment terms imply, or null when they have
  /// none.
  private async dueDateFromTerms(
    companyId: string,
    supplierId: string,
    invoiceDate: Date,
  ): Promise<Date | null> {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, companyId },
      select: { paymentTermDays: true },
    });
    const days = supplier?.paymentTermDays ?? 0;
    if (days <= 0) return null;
    const due = new Date(invoiceDate.getTime());
    due.setUTCDate(due.getUTCDate() + days);
    return due;
  }

  private prepareLandedCosts(dto: CreatePurchaseInvoiceDto): {
    total: Prisma.Decimal;
    charges: PreparedLandedCostCharge[];
  } {
    const legacyTotal = dto.landedCostAmount === undefined
      ? null
      : this.nonNegative(dto.landedCostAmount, 'landedCostAmount');

    if (dto.landedCostCharges !== undefined) {
      if (!Array.isArray(dto.landedCostCharges) || dto.landedCostCharges.length > 50) {
        throw new BadRequestException('A purchase invoice may contain at most 50 landed-cost charges');
      }
      const charges = dto.landedCostCharges.map((raw, index) => {
        const description = String(raw?.description ?? '').trim();
        if (!description || description.length > 120) {
          throw new BadRequestException(`Landed-cost charge ${index + 1} needs a description of 1–120 characters`);
        }
        return {
          description,
          amount: this.nonNegative(raw.amount, `Landed-cost charge ${index + 1} amount`),
        };
      });
      const total = charges.reduce(
        (sum, charge) => sum.plus(charge.amount),
        new Prisma.Decimal(0),
      );
      if (legacyTotal !== null && !legacyTotal.equals(total)) {
        throw new BadRequestException(
          `landedCostAmount (${legacyTotal.toFixed(MONEY_SCALE)}) must equal the sum of named charges (${total.toFixed(MONEY_SCALE)})`,
        );
      }
      return { total, charges };
    }

    const total = legacyTotal ?? new Prisma.Decimal(0);
    return {
      total,
      charges: total.isZero()
        ? []
        : [{ description: 'Other landed costs', amount: total }],
    };
  }

  private serializeLandedCosts(charges: PreparedLandedCostCharge[]): Prisma.InputJsonValue {
    return charges.map((charge) => ({
      description: charge.description,
      amount: charge.amount.toFixed(MONEY_SCALE),
    })) as Prisma.InputJsonValue;
  }

  private async prepareLines(
    companyId: string,
    input: PurchaseInvoiceLineDto[],
    supplierId: string | null | undefined,
    landedCostAmount: Prisma.Decimal,
    documentDiscount: DiscountInput,
  ): Promise<PreparedInvoice> {
    const prepared: PreparedLine[] = [];
    const settings = await this.settings.get(companyId);

    for (const [index, raw] of input.entries()) {
      const item = await this.prisma.item.findFirst({
        where: { id: raw.itemId, companyId, deletedAt: null },
        select: {
          code: true,
          nameEn: true,
          nameAr: true,
          taxRate: true,
          isActive: true,
          purchasePrice: true,
          unit: true,
          units: true,
        },
      });
      if (!item) {
        throw new BadRequestException(`Line ${index + 1}: the item does not exist`);
      }
      if (!item.isActive) {
        throw new BadRequestException(`Line ${index + 1}: the item is inactive`);
      }

      const quantity = this.positive(raw.quantity, `Line ${index + 1} quantity`);

      // Resolve the chosen unit. The entered quantity is expressed in it; the
      // base quantity is what is received into stock and drives unit cost.
      const resolved = resolveUnitSelection({
        lineLabel: `Line ${index + 1}`,
        requestedUnitId: raw.unitId,
        requestedUnitName: raw.unitName,
        enteredQuantity: quantity,
        baseUnitName: item.unit,
        units: (item as { units?: any[] }).units ?? [],
      });
      const enteredQuantity = resolved.snapshot.unitQuantity ?? quantity;

      // A price typed on the line is the cost of one CHOSEN unit. When nobody
      // typed one, the supplier's agreed list speaks (for the chosen unit),
      // then the unit's own purchase price, then the item's purchase price.
      let unitPrice =
        raw.unitPrice === undefined || raw.unitPrice === null || raw.unitPrice === ''
          ? null
          : this.nonNegative(raw.unitPrice, `Line ${index + 1} unitPrice`);
      if (unitPrice === null) {
        const chosenUnitName = resolved.snapshot.unitName ?? item.unit;
        const listed = await this.prices.resolvePrice(this.prisma, companyId, {
          partyId: supplierId ?? null,
          partyKind: 'SUPPLIER',
          itemId: raw.itemId,
          unit: chosenUnitName,
          quantity: enteredQuantity,
        });
        unitPrice = listed
          ? listed.price
          : defaultUnitPrice('purchase', resolved.row, item.purchasePrice);
      }

      // Line, then item, then the company's own rate - an item with no rate
      // of its own follows the company rather than silently becoming exempt.
      const taxRate: Prisma.Decimal =
        raw.taxRate !== undefined
          ? this.rate(raw.taxRate, `Line ${index + 1} taxRate`)
          : (item.taxRate ?? new Prisma.Decimal(settings.taxRate));

      // The discount is taken from the goods value, before tax, and the tax
      // is then charged on what is actually being paid for the goods. Money
      // follows the entered quantity in the chosen unit; stock uses the base
      // quantity computed above.
      const grossLineTotal = enteredQuantity.mul(unitPrice).toDecimalPlaces(MONEY_SCALE);
      const lineDiscount = this.lineDiscount(
        grossLineTotal,
        raw,
        index,
        new Prisma.Decimal(settings.maxDiscountPercent),
      );

      // The centre must exist, belong to this company and still be active.
      let costCenterId: string | null = raw.costCenterId ?? null;
      if (costCenterId) {
        const center = await this.prisma.costCenter.findFirst({
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
        itemId: raw.itemId,
        description: raw.description ?? `${item.code} ${item.nameEn}`,
        // Internal base-unit quantity received into stock.
        quantity: resolved.baseQuantity,
        unitPrice,
        taxRate,
        taxAmount: new Prisma.Decimal(0),
        lineTotal: lineDiscount.net,
        grossLineTotal,
        discountType: lineDiscount.type,
        discountPercent: lineDiscount.percent,
        discountAmount: lineDiscount.amount,
        invoiceDiscountAmount: new Prisma.Decimal(0),
        landedCostAmount: new Prisma.Decimal(0),
        inventoryCostTotal: lineDiscount.net,
        costCenterId,
        unitName: resolved.snapshot.unitName,
        unitFactor: resolved.snapshot.unitFactor,
        unitQuantity: resolved.snapshot.unitQuantity,
      });
    }

    let allocation: ReturnType<typeof allocateDocumentDiscount>;
    try {
      allocation = allocateDocumentDiscount(
        prepared.map((line) => line.lineTotal),
        documentDiscount,
      );
    } catch (error) {
      throw new BadRequestException(this.discountMessage(error, 'Invoice'));
    }

    const grossTotal = prepared.reduce(
      (sum, line) => sum.plus(line.grossLineTotal),
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
        new Prisma.Decimal(settings.maxDiscountPercent),
        'Document',
      );
    } catch (error) {
      throw new BadRequestException(this.discountMessage(error, 'Invoice'));
    }

    // The landed cost is spread over what the goods now cost after discounts:
    // freight does not become cheaper because the supplier gave a discount, it
    // is simply allocated over a smaller base.
    const discounted = prepared.map((line, index) => ({
      ...line,
      invoiceDiscountAmount: allocation.shares[index],
      lineTotal: line.lineTotal.minus(allocation.shares[index]),
    }));

    let allocated: string[];
    try {
      allocated = allocateLandedCostAmounts(
        discounted.map((line) => line.lineTotal.toFixed(MONEY_SCALE)),
        landedCostAmount.toFixed(MONEY_SCALE),
      );
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Landed costs could not be allocated',
      );
    }

    const lines = discounted.map((line, index) => {
      const lineLandedCost = new Prisma.Decimal(allocated[index]);
      return {
        ...line,
        taxAmount: line.lineTotal.mul(line.taxRate).div(100).toDecimalPlaces(MONEY_SCALE),
        landedCostAmount: lineLandedCost,
        inventoryCostTotal: line.lineTotal.plus(lineLandedCost),
      };
    });
    return { lines, documentDiscount: allocation.discount, lineDiscountTotal };
  }

  private lineDiscount(
    base: Prisma.Decimal,
    raw: PurchaseInvoiceLineDto,
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

  private toLandedCostCharges(value: Prisma.JsonValue): Array<{ description: string; amount: string }> {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const row = entry as Prisma.JsonObject;
      if (typeof row.description !== 'string') return [];
      if (typeof row.amount !== 'string' && typeof row.amount !== 'number') return [];
      try {
        return [{
          description: row.description,
          amount: new Prisma.Decimal(String(row.amount)).toFixed(MONEY_SCALE),
        }];
      } catch {
        return [];
      }
    });
  }

  private toSummary(invoice: {
    id: string;
    branchId: string;
    invoiceNumber: string;
    supplierReference: string | null;
    invoiceDate: Date;
    dueDate: Date | null;
    status: InvoiceStatus;
    currency: string;
    discountType?: string | null;
    discountPercent?: Prisma.Decimal;
    discountAmount?: Prisma.Decimal;
    lineDiscountTotal?: Prisma.Decimal;
    subTotal: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    landedCostAmount: Prisma.Decimal;
    landedCostCharges: Prisma.JsonValue;
    paidAmount: Prisma.Decimal;
    createdAt: Date;
    supplier?: { id?: string; code: string; nameEn: string; nameAr: string };
  }) {
    return {
      id: invoice.id,
      branchId: invoice.branchId,
      invoiceNumber: invoice.invoiceNumber,
      supplierReference: invoice.supplierReference,
      invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
      dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
      status: invoice.status.toLowerCase(),
      currency: invoice.currency,
      supplier: invoice.supplier,
      discountType: invoice.discountType ?? null,
      discountPercent: (invoice.discountPercent ?? new Prisma.Decimal(0)).toFixed(RATE_SCALE),
      discountAmount: (invoice.discountAmount ?? new Prisma.Decimal(0)).toFixed(MONEY_SCALE),
      lineDiscountTotal: (invoice.lineDiscountTotal ?? new Prisma.Decimal(0)).toFixed(MONEY_SCALE),
      subTotal: invoice.subTotal.toFixed(MONEY_SCALE),
      taxAmount: invoice.taxAmount.toFixed(MONEY_SCALE),
      totalAmount: invoice.totalAmount.toFixed(MONEY_SCALE),
      landedCostAmount: invoice.landedCostAmount.toFixed(MONEY_SCALE),
      landedCostCharges: this.toLandedCostCharges(invoice.landedCostCharges),
      paidAmount: invoice.paidAmount.toFixed(MONEY_SCALE),
      balanceDue: invoice.totalAmount.minus(invoice.paidAmount).toFixed(MONEY_SCALE),
      createdAt: invoice.createdAt.toISOString(),
    };
  }
}
