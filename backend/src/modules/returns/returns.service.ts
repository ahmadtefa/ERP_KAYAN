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
import { AccountMapService } from '../accounting/account-map.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { PostingService } from '../accounting/posting.service';

const MONEY_SCALE = 4;

export interface ReturnLineInput {
  originalLineId: string;
  quantity: string | number;
  /** Optional: defaults to the price on the original line. */
  unitPrice?: string | number;
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
  ) {}

  async findAll(
    companyId: string,
    side: 'sales' | 'purchases',
    query: { from?: string; to?: string; page?: number; pageSize?: number } = {},
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
        documentType: { in: [InvoiceDocumentType.CREDIT_NOTE, InvoiceDocumentType.DEBIT_NOTE] },
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
        items: items.map((invoice) => this.toSummary(invoice)),
        total,
        page,
        pageSize,
      };
    }

    const where: Prisma.PurchaseInvoiceWhereInput = {
      companyId,
      deletedAt: null,
      documentType: { in: [InvoiceDocumentType.CREDIT_NOTE, InvoiceDocumentType.DEBIT_NOTE] },
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
    return { items: items.map((invoice) => this.toSummary(invoice)), total, page, pageSize };
  }

  async findOne(companyId: string, side: 'sales' | 'purchases', id: string) {
    if (side === 'sales') {
      const invoice = await this.prisma.salesInvoice.findFirst({
        where: { id, companyId, deletedAt: null },
        include: {
          customer: { select: { id: true, code: true, nameEn: true, nameAr: true } },
          originalInvoice: { select: { id: true, invoiceNumber: true, invoiceDate: true } },
          lines: { orderBy: { lineNumber: 'asc' }, include: { item: { select: { code: true, nameEn: true, nameAr: true, unit: true } } } },
        },
      });
      if (!invoice) throw new NotFoundException('Return document not found');
      return {
        ...this.toSummary(invoice),
        lines: invoice.lines.map((line) => ({
          id: line.id,
          lineNumber: line.lineNumber,
          itemId: line.itemId,
          itemCode: line.item?.code ?? null,
          itemNameEn: line.item?.nameEn ?? null,
          itemNameAr: line.item?.nameAr ?? null,
          unit: line.item?.unit ?? null,
          description: line.description,
          quantity: line.quantity.toFixed(MONEY_SCALE),
          unitPrice: line.unitPrice.toFixed(MONEY_SCALE),
          taxRate: line.taxRate.toFixed(MONEY_SCALE),
          taxAmount: line.taxAmount.toFixed(MONEY_SCALE),
          lineTotal: line.lineTotal.toFixed(MONEY_SCALE),
          unitCost: line.unitCost.toFixed(MONEY_SCALE),
          costTotal: line.costTotal.toFixed(MONEY_SCALE),
        })),
      };
    }

    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        supplier: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        originalInvoice: { select: { id: true, invoiceNumber: true, invoiceDate: true } },
        lines: { orderBy: { lineNumber: 'asc' }, include: { item: { select: { code: true, nameEn: true, nameAr: true, unit: true } } } },
      },
    });
    if (!invoice) throw new NotFoundException('Return document not found');
    return {
      ...this.toSummary(invoice),
      lines: invoice.lines.map((line) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        itemId: line.itemId,
        itemCode: line.item?.code ?? null,
        itemNameEn: line.item?.nameEn ?? null,
        itemNameAr: line.item?.nameAr ?? null,
        unit: line.item?.unit ?? null,
        description: line.description,
        quantity: line.quantity.toFixed(MONEY_SCALE),
        unitPrice: line.unitPrice.toFixed(MONEY_SCALE),
        taxRate: line.taxRate.toFixed(MONEY_SCALE),
        taxAmount: line.taxAmount.toFixed(MONEY_SCALE),
        lineTotal: line.lineTotal.toFixed(MONEY_SCALE),
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
    const original = await this.prisma.salesInvoice.findFirst({
      where: { id: dto.originalInvoiceId, companyId, deletedAt: null },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!original) throw new BadRequestException('The original sales invoice does not exist');
    if (original.status !== InvoiceStatus.POSTED) {
      throw new BadRequestException('Only a posted sales invoice can be returned');
    }
    if (original.documentType !== InvoiceDocumentType.INVOICE) {
      throw new BadRequestException('A return document cannot itself be returned');
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
    }> = [];
    for (const [index, raw] of dto.lines.entries()) {
      const originalLine = original.lines.find((line) => line.id === raw.originalLineId);
      if (!originalLine) {
        throw new BadRequestException(`Line ${index + 1}: that line does not belong to the invoice`);
      }
      const remaining = originalLine.quantity.minus(originalLine.returnedQuantity);
      const quantity = this.positive(raw.quantity, `Line ${index + 1} quantity`);
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
      const lineTotal = unitPrice.mul(quantity).toDecimalPlaces(MONEY_SCALE);
      const taxAmount = originalLine.taxRate.isZero()
        ? new Prisma.Decimal(0)
        : lineTotal.mul(originalLine.taxRate).div(100).toDecimalPlaces(MONEY_SCALE);

      prepared.push({
        originalLineId: originalLine.id,
        itemId: originalLine.itemId,
        description: originalLine.description,
        quantity,
        unitPrice,
        taxRate: originalLine.taxRate,
        taxAmount,
        lineTotal,
        // What the goods cost when they were sold. The value is taken from the
        // original document so a return cannot move profit by itself.
        unitCost: originalLine.unitCost,
        costTotal: originalLine.unitCost.mul(quantity).toDecimalPlaces(MONEY_SCALE),
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
    if (document.documentType === InvoiceDocumentType.INVOICE) {
      throw new BadRequestException('This is a sales invoice, not a return. Post it as an invoice.');
    }
    if (document.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException(
        `Only a draft return can be posted (current status: ${document.status})`,
      );
    }
    if (!document.originalInvoiceId) {
      throw new BadRequestException('A return must name the invoice it returns');
    }

    const result = await this.prisma.$transaction(async (tx) => {
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

        await tx.salesInvoiceLine.update({
          where: { id: matching.id },
          data: { returnedQuantity: { increment: line.quantity } },
        });

        if (line.itemId) {
          const item = await tx.item.findFirst({
            where: { id: line.itemId, companyId, deletedAt: null },
            select: { id: true, isStockTracked: true },
          });
          if (item?.isStockTracked) {
            await tx.stockMovement.create({
              data: {
                companyId,
                branchId: document.branchId,
                itemId: item.id,
                movementDate: document.invoiceDate,
                direction: StockDirection.IN,
                quantity: line.quantity,
                unitCost: line.unitCost,
                totalCost: line.costTotal,
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
                value: line.costTotal,
              },
              update: {
                quantity: { increment: line.quantity },
                value: { increment: line.costTotal },
              },
            });
            costTotal = costTotal.plus(line.costTotal);
          }
        }
      }

      const journalLines = [
        // Revenue comes back down. It lands on the sales-returns account so a
        // report can show gross sales and returns separately.
        {
          accountId: accounts.salesReturns,
          debit: document.subTotal,
          description: `Sales return (${document.originalInvoice?.invoiceNumber ?? ''})`,
        },
        ...(document.taxAmount.isZero()
          ? []
          : [
              {
                accountId: accounts.vatPayable,
                debit: document.taxAmount,
                description: 'VAT on sales return',
              },
            ]),
        {
          accountId: accounts.accountsReceivable,
          credit: document.totalAmount,
          description: 'Customer credit note',
        },
      ];

      if (!costTotal.isZero()) {
        journalLines.push(
          {
            accountId: accounts.inventory,
            debit: costTotal,
            description: 'Stock returned to inventory',
          },
          {
            accountId: accounts.costOfGoodsSold,
            credit: costTotal,
            description: 'Cost of goods returned',
          },
        );
      }

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
        totalAmount: document.totalAmount.toFixed(MONEY_SCALE),
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
    const original = await this.prisma.purchaseInvoice.findFirst({
      where: { id: dto.originalInvoiceId, companyId, deletedAt: null },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!original) throw new BadRequestException('The original purchase invoice does not exist');
    if (original.status !== InvoiceStatus.POSTED) {
      throw new BadRequestException('Only a posted purchase invoice can be returned');
    }
    if (original.documentType !== InvoiceDocumentType.INVOICE) {
      throw new BadRequestException('A return document cannot itself be returned');
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
    }> = [];
    for (const [index, raw] of dto.lines.entries()) {
      const originalLine = original.lines.find((line) => line.id === raw.originalLineId);
      if (!originalLine) {
        throw new BadRequestException(`Line ${index + 1}: that line does not belong to the invoice`);
      }
      const remaining = originalLine.quantity.minus(originalLine.returnedQuantity);
      const quantity = this.positive(raw.quantity, `Line ${index + 1} quantity`);
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
      const lineTotal = unitPrice.mul(quantity).toDecimalPlaces(MONEY_SCALE);
      const taxAmount = originalLine.taxRate.isZero()
        ? new Prisma.Decimal(0)
        : lineTotal.mul(originalLine.taxRate).div(100).toDecimalPlaces(MONEY_SCALE);

      prepared.push({
        originalLineId: originalLine.id,
        itemId: originalLine.itemId,
        description: originalLine.description,
        quantity,
        unitPrice,
        taxRate: originalLine.taxRate,
        taxAmount,
        lineTotal,
      });
    }

    const subTotal = prepared.reduce((sum, line) => sum.plus(line.lineTotal), new Prisma.Decimal(0));
    const taxAmount = prepared.reduce((sum, line) => sum.plus(line.taxAmount), new Prisma.Decimal(0));

    const created = await this.prisma.$transaction(async (tx) => {
      const invoiceNumber = await this.numbers.next(tx, companyId, 'PURCHASE_RETURN', 'PR');
      return tx.purchaseInvoice.create({
        data: {
          companyId,
          branchId,
          invoiceNumber,
          invoiceDate: date,
          supplierId: original.supplierId,
          status: InvoiceStatus.DRAFT,
          currency: original.currency,
          documentType: InvoiceDocumentType.DEBIT_NOTE,
          originalInvoiceId: original.id,
          returnReason: dto.reason?.trim() || null,
          subTotal,
          taxAmount,
          totalAmount: subTotal.plus(taxAmount),
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
    if (document.documentType === InvoiceDocumentType.INVOICE) {
      throw new BadRequestException('This is a purchase invoice, not a return.');
    }
    if (document.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException(
        `Only a draft return can be posted (current status: ${document.status})`,
      );
    }
    if (!document.originalInvoiceId) {
      throw new BadRequestException('A return must name the invoice it returns');
    }

    const result = await this.prisma.$transaction(async (tx) => {
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

        await tx.purchaseInvoiceLine.update({
          where: { id: matching.id },
          data: { returnedQuantity: { increment: line.quantity } },
        });

        if (line.itemId) {
          const item = await tx.item.findFirst({
            where: { id: line.itemId, companyId, deletedAt: null },
            select: { id: true, isStockTracked: true },
          });
          if (item?.isStockTracked) {
            // Goods go back to the supplier at the price they were bought at -
            // the purchase line's own unit price, recorded when it was posted.
            const unitCost = matching.unitPrice;
            const costTotal = unitCost.mul(line.quantity).toDecimalPlaces(MONEY_SCALE);

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

            await tx.stockMovement.create({
              data: {
                companyId,
                branchId: document.branchId,
                itemId: item.id,
                movementDate: document.invoiceDate,
                direction: StockDirection.OUT,
                quantity: line.quantity,
                unitCost,
                totalCost: costTotal,
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
                value: { decrement: costTotal },
              },
            });
          }
        }
      }

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
            debit: document.totalAmount,
            description: 'Supplier debit note',
          },
          {
            accountId: accounts.inventory,
            credit: document.subTotal,
            description: 'Inventory returned to supplier',
          },
          ...(document.taxAmount.isZero()
            ? []
            : [
                {
                  accountId: accounts.vatReceivable,
                  credit: document.taxAmount,
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
        totalAmount: document.totalAmount.toFixed(MONEY_SCALE),
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
        for (const line of document.lines) {
          const originalLine = await this.findOriginalLineById(tx, line);
          if (originalLine) {
            await tx.salesInvoiceLine.update({
              where: { id: originalLine.id },
              data: { returnedQuantity: { decrement: line.quantity } },
            });
          }
          if (!line.itemId || line.costTotal.isZero()) continue;
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

          await tx.stockMovement.create({
            data: {
              companyId,
              branchId: document.branchId,
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

      for (const line of document.lines) {
        const originalLine = await this.findOriginalPurchaseLineById(tx, line);
        if (originalLine) {
          await tx.purchaseInvoiceLine.update({
            where: { id: originalLine.id },
            data: { returnedQuantity: { decrement: line.quantity } },
          });
        }
        if (!line.itemId) continue;
        const unitCost = originalLine?.unitPrice ?? line.unitPrice;
        const totalCost = unitCost.mul(line.quantity).toDecimalPlaces(MONEY_SCALE);
        await tx.stockMovement.create({
          data: {
            companyId,
            branchId: document.branchId,
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
        description: string;
        itemId: string | null;
      }>
    >(Prisma.sql`
      SELECT id, quantity, "returnedQuantity", "unitPrice", description, "itemId"
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
        description: string;
        itemId: string | null;
      }>
    >(Prisma.sql`
      SELECT id, quantity, "returnedQuantity", "unitPrice", description, "itemId"
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
    const decimal = this.positive(value, field);
    return decimal;
  }

  private date(value: string, field: string): Date {
    const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${field} is not a valid date`);
    return parsed;
  }

  private toSummary(invoice: {
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
    returnReason?: string | null;
    createdAt: Date;
    customer?: { code: string; nameEn: string; nameAr: string } | null;
    supplier?: { code: string; nameEn: string; nameAr: string } | null;
    originalInvoice?: { invoiceNumber: string } | null;
  }) {
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
