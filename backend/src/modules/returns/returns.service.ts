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
import { WarehouseService } from '../../common/warehouse/warehouse.service';
import { AccountMapService } from '../accounting/account-map.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { attributedLines } from '../accounting/cost-center-attribution';
import { PostingService } from '../accounting/posting.service';

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
  ) {
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
  ) {
    if (side === 'sales') {
      const invoice = await this.prisma.salesInvoice.findFirst({
        where: { id, companyId, deletedAt: null, documentType: InvoiceDocumentType.CREDIT_NOTE },
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
      where: { id, companyId, deletedAt: null, documentType: InvoiceDocumentType.DEBIT_NOTE },
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
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
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

    return this.findOne(companyId, 'sales', created.id);
  }

  async postSalesReturn(companyId: string, userId: string, id: string) {
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
            await tx.stockMovement.create({
              data: {
                companyId,
                branchId: document.branchId,
                warehouseId,
                itemId: item.id,
                movementDate: document.invoiceDate,
                direction: StockDirection.IN,
                quantity: line.quantity,
                unitCost,
                totalCost: returnedCost,
                referenceType: 'SALES_RETURN',
                referenceId: document.id,
                referenceNumber: document.invoiceNumber,
                notes: `Return of ${document.originalInvoice?.invoiceNumber ?? ''}`,
                createdBy: userId,
              },
            });
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

    return this.findOne(companyId, 'sales', id);
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
  ) {
    if (!branchId) {
      throw new BadRequestException('The signed-in user is not assigned to a branch');
    }
    const originalInvoiceId = this.requiredId(dto.originalInvoiceId, 'originalInvoiceId');
    const original = await this.prisma.purchaseInvoice.findFirst({
      where: { id: originalInvoiceId, companyId, deletedAt: null },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
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

    return this.findOne(companyId, 'purchases', created.id);
  }

  async postPurchaseReturn(companyId: string, userId: string, id: string) {
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

          await tx.stockMovement.create({
            data: {
              companyId,
              branchId: document.branchId,
              warehouseId,
              itemId: item.id,
              movementDate: document.invoiceDate,
              direction: StockDirection.OUT,
              quantity: line.quantity,
              unitCost,
              totalCost: returnedCost,
              referenceType: 'PURCHASE_RETURN',
              referenceId: document.id,
              referenceNumber: document.invoiceNumber,
              notes: `Return of ${document.originalInvoice?.invoiceNumber ?? ''}`,
              createdBy: userId,
            },
          });
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

    return this.findOne(companyId, 'purchases', id);
  }

  /** Reverses a posted return: the mirror entry, and the stock back the way it came. */
  async reverse(companyId: string, userId: string, side: 'sales' | 'purchases', id: string) {
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
      return this.findOne(companyId, 'sales', id);
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
    return this.findOne(companyId, 'purchases', id);
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
    },
    raw: ReturnLineInput,
  ): {
    baseQuantity: Prisma.Decimal;
    unitName: string | null;
    unitFactor: Prisma.Decimal | null;
    unitQuantity: Prisma.Decimal | null;
  } {
    const entered = this.positive(raw.quantity, `${field} quantity`);
    const hasSnapshot =
      originalLine.unitFactor !== null && originalLine.unitFactor !== undefined;

    if (!hasSnapshot) {
      return { baseQuantity: entered, unitName: null, unitFactor: null, unitQuantity: null };
    }

    if (raw.unitName && originalLine.unitName) {
      const asked = String(raw.unitName).trim().toLowerCase();
      const stored = String(originalLine.unitName).trim().toLowerCase();
      if (asked !== stored) {
        throw new BadRequestException(
          `${field}: a return must use the original document's unit (${originalLine.unitName})`,
        );
      }
    }

    const factor = new Prisma.Decimal(originalLine.unitFactor as Prisma.Decimal);
    const baseQuantity = entered.mul(factor).toDecimalPlaces(MONEY_SCALE);
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
