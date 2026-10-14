import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, Prisma, StockDirection } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccountMapService } from './account-map.service';
import { DocumentNumberService } from './document-number.service';
import { PostingService } from './posting.service';

const MONEY_SCALE = 4;

export interface OpeningBalanceLineInput {
  accountId: string;
  debit?: string | number;
  credit?: string | number;
  customerId?: string;
  supplierId?: string;
  itemId?: string;
  quantity?: string | number;
  unitCost?: string | number;
  description?: string;
}

/**
 * Opening balances: the figures a company starts with.
 *
 * They are not typed straight into the ledger. They are a document with
 * lines, they must balance, and posting one writes both the accounting entry
 * and - for stocked items - the stock movements. That is the difference
 * between an opening receivable a collection call can chase and a number in a
 * ledger nobody can drill into.
 *
 * Only one opening document per branch is intended: a second one would double
 * the start of the books. The server allows a second document only for a
 * different branch, and refuses a second posting for the same branch unless
 * the first was reversed.
 */
@Injectable()
export class OpeningBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: DocumentNumberService,
    private readonly posting: PostingService,
    private readonly accounts: AccountMapService,
    private readonly audit: AuditService,
  ) {}

  async findAll(companyId: string) {
    const items = await this.prisma.openingBalance.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { asOfDate: 'desc' },
      include: { branch: { select: { code: true, nameEn: true, nameAr: true } } },
    });
    return {
      items: items.map((document) => this.toSummary(document)),
      total: items.length,
    };
  }

  async findOne(companyId: string, id: string) {
    const document = await this.prisma.openingBalance.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        branch: { select: { code: true, nameEn: true, nameAr: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: {
            account: { select: { code: true, nameEn: true, nameAr: true } },
            customer: { select: { code: true, nameEn: true, nameAr: true } },
            supplier: { select: { code: true, nameEn: true, nameAr: true } },
            item: { select: { code: true, nameEn: true, nameAr: true, unit: true } },
          },
        },
      },
    });
    if (!document) throw new NotFoundException('Opening balance document not found');

    return {
      ...this.toSummary(document),
      lines: document.lines.map((line) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        accountId: line.accountId,
        accountCode: line.account.code,
        accountNameEn: line.account.nameEn,
        accountNameAr: line.account.nameAr,
        customerId: line.customerId,
        customer: line.customer,
        supplierId: line.supplierId,
        supplier: line.supplier,
        itemId: line.itemId,
        item: line.item,
        debit: line.debit.toFixed(MONEY_SCALE),
        credit: line.credit.toFixed(MONEY_SCALE),
        quantity: line.quantity?.toFixed(MONEY_SCALE) ?? null,
        unitCost: line.unitCost?.toFixed(MONEY_SCALE) ?? null,
        description: line.description,
      })),
    };
  }

  /** Creates the document as a DRAFT. Nothing reaches the ledger yet. */
  async create(
    companyId: string,
    branchId: string | null,
    userId: string,
    dto: {
      asOfDate: string;
      branchId?: string;
      description?: string;
      lines: OpeningBalanceLineInput[];
      /** Put any difference on the opening-balance equity account instead of refusing. */
      autoBalanceToEquity?: boolean;
    },
  ) {
    const targetBranch = dto.branchId ?? branchId;
    if (!targetBranch) {
      throw new BadRequestException('Select the branch these opening figures belong to');
    }
    const asOfDate = this.date(dto.asOfDate);
    if (!Array.isArray(dto.lines) || dto.lines.length < 2) {
      throw new BadRequestException('An opening balance needs at least two lines');
    }

    const prepared = await this.prepareLines(companyId, dto.lines);

    let totalDebit = prepared.reduce((sum, l) => sum.plus(l.debit), new Prisma.Decimal(0));
    let totalCredit = prepared.reduce((sum, l) => sum.plus(l.credit), new Prisma.Decimal(0));

    const lines = [...prepared];
    if (dto.autoBalanceToEquity && !totalDebit.equals(totalCredit)) {
      // The other side of the opening figures - capital, an accumulated
      // surplus - has to sit somewhere. This puts it on the designated
      // equity account so the document balances and the accountant can see it,
      // instead of the entry being silently forced through.
      const equity = await this.accounts.resolve(this.prisma as never, companyId, [
        'openingBalanceEquity',
      ]);
      const difference = totalDebit.minus(totalCredit);
      lines.push({
        accountId: equity.openingBalanceEquity,
        debit: difference.isNegative() ? difference.negated() : new Prisma.Decimal(0),
        credit: difference.isNegative() ? new Prisma.Decimal(0) : difference,
        customerId: null,
        supplierId: null,
        itemId: null,
        quantity: null,
        unitCost: null,
        description: 'Opening balance equity',
      });
      totalDebit = lines.reduce((sum, l) => sum.plus(l.debit), new Prisma.Decimal(0));
      totalCredit = lines.reduce((sum, l) => sum.plus(l.credit), new Prisma.Decimal(0));
    }

    if (!totalDebit.equals(totalCredit)) {
      throw new BadRequestException({
        message: 'The opening balance does not balance',
        errors: {
          totalDebit: totalDebit.toFixed(MONEY_SCALE),
          totalCredit: totalCredit.toFixed(MONEY_SCALE),
          difference: totalDebit.minus(totalCredit).toFixed(MONEY_SCALE),
          hint: 'Send autoBalanceToEquity to put the difference on the opening-balance equity account.',
        },
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const documentNumber = await this.numbers.next(tx, companyId, 'OPENING_BALANCE', 'OB');
      return tx.openingBalance.create({
        data: {
          companyId,
          branchId: targetBranch,
          documentNumber,
          asOfDate,
          description: dto.description ?? null,
          status: InvoiceStatus.DRAFT,
          totalDebit,
          totalCredit,
          createdBy: userId,
          lines: {
            create: lines.map((line, index) => ({
              lineNumber: index + 1,
              accountId: line.accountId,
              customerId: line.customerId,
              supplierId: line.supplierId,
              itemId: line.itemId,
              debit: line.debit,
              credit: line.credit,
              quantity: line.quantity,
              unitCost: line.unitCost,
              description: line.description,
            })),
          },
        },
      });
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'opening_balances',
      entityId: created.id,
      after: {
        documentNumber: created.documentNumber,
        totalDebit: totalDebit.toFixed(MONEY_SCALE),
        lines: lines.length,
      },
    });

    return this.findOne(companyId, created.id);
  }

  /**
   * Posts the document: one journal entry, plus a stock movement for every
   * stocked item line, all in the same transaction.
   */
  async post(companyId: string, userId: string, id: string) {
    const document = await this.prisma.openingBalance.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!document) throw new NotFoundException('Opening balance document not found');
    if (document.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException(
        `Only a draft opening balance can be posted (current status: ${document.status})`,
      );
    }

    const alreadyPosted = await this.prisma.openingBalance.findFirst({
      where: {
        companyId,
        branchId: document.branchId,
        status: InvoiceStatus.POSTED,
        deletedAt: null,
        id: { not: document.id },
      },
      select: { documentNumber: true, asOfDate: true },
    });
    if (alreadyPosted) {
      throw new BadRequestException(
        `This branch already has an opening balance (${alreadyPosted.documentNumber}, ${alreadyPosted.asOfDate
          .toISOString()
          .slice(0, 10)}). Posting a second one would double the start of the books.`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // ---- stock: quantities are opened as movements, at the cost the
      // document states, so the stock ledger and the inventory account agree.
      for (const line of document.lines) {
        if (!line.itemId) continue;
        const item = await tx.item.findFirst({
          where: { id: line.itemId, companyId, deletedAt: null },
          select: { id: true, isStockTracked: true, code: true },
        });
        if (!item) throw new BadRequestException('An opening line references a missing item');
        if (!item.isStockTracked) continue;
        if (!line.quantity || !line.unitCost) {
          throw new BadRequestException(
            `Item line ${line.lineNumber} needs both a quantity and a unit cost`,
          );
        }
        if (!line.debit.equals(line.quantity.mul(line.unitCost).toDecimalPlaces(MONEY_SCALE))) {
          throw new BadRequestException(
            `Item line ${line.lineNumber}: quantity x unit cost (${line.quantity
              .mul(line.unitCost)
              .toDecimalPlaces(MONEY_SCALE)
              .toFixed(MONEY_SCALE)}) does not equal the debit on the line ` +
              `(${line.debit.toFixed(MONEY_SCALE)})`,
          );
        }

        await tx.stockMovement.create({
          data: {
            companyId,
            branchId: document.branchId,
            itemId: item.id,
            movementDate: document.asOfDate,
            direction: StockDirection.IN,
            quantity: line.quantity,
            unitCost: line.unitCost,
            totalCost: line.debit,
            referenceType: 'OPENING_BALANCE',
            referenceId: document.id,
            referenceNumber: document.documentNumber,
            notes: 'Opening balance',
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
            value: line.debit,
          },
          update: {
            quantity: { increment: line.quantity },
            value: { increment: line.debit },
          },
        });
      }

      const journal = await this.posting.post(tx, {
        companyId,
        branchId: document.branchId,
        userId,
        entryDate: document.asOfDate,
        description: document.description ?? 'Opening balances',
        sourceType: 'OPENING_BALANCE',
        sourceId: document.id,
        sourceNumber: document.documentNumber,
        lines: document.lines.map((line) => ({
          accountId: line.accountId,
          debit: line.debit,
          credit: line.credit,
          description: line.description ?? undefined,
        })),
      });

      const updated = await tx.openingBalance.update({
        where: { id: document.id },
        data: {
          status: InvoiceStatus.POSTED,
          journalEntryId: journal.id,
          postedAt: new Date(),
          postedBy: userId,
        },
      });

      return { journal, updated };
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'POST',
      entity: 'opening_balances',
      entityId: id,
      after: {
        status: 'POSTED',
        journalNumber: result.journal.entryNumber,
        totalDebit: document.totalDebit.toFixed(MONEY_SCALE),
      },
    });

    return this.findOne(companyId, id);
  }

  /** Reverses a posted opening balance: a mirror entry, plus stock back out. */
  async reverse(companyId: string, userId: string, id: string) {
    const document = await this.prisma.openingBalance.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!document) throw new NotFoundException('Opening balance document not found');
    if (document.status !== InvoiceStatus.POSTED || !document.journalEntryId) {
      throw new BadRequestException('Only a posted opening balance can be reversed');
    }

    const journal = await this.prisma.$transaction(async (tx) => {
      const reversal = await this.posting.reverse(
        tx,
        companyId,
        userId,
        document.journalEntryId as string,
        `Reversal of opening balance ${document.documentNumber}`,
      );

      for (const line of document.lines) {
        if (!line.itemId || !line.quantity || !line.unitCost) continue;
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
            `Cannot reverse opening balance: ${onHand.toFixed(MONEY_SCALE)} is available, ` +
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
            totalCost: line.debit,
            referenceType: 'OPENING_BALANCE_REVERSAL',
            referenceId: document.id,
            referenceNumber: document.documentNumber,
            notes: `Reversal of opening balance ${document.documentNumber}`,
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
            value: { decrement: line.debit },
          },
        });
      }

      await tx.openingBalance.update({
        where: { id: document.id },
        data: { status: InvoiceStatus.REVERSED },
      });

      return reversal;
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'REVERSE',
      entity: 'opening_balances',
      entityId: id,
      after: { reversalJournalNumber: journal.entryNumber },
    });

    return this.findOne(companyId, id);
  }

  // ------------------------------------------------------------------ helpers

  private async prepareLines(
    companyId: string,
    input: OpeningBalanceLineInput[],
  ): Promise<
    Array<{
      accountId: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      customerId: string | null;
      supplierId: string | null;
      itemId: string | null;
      quantity: Prisma.Decimal | null;
      unitCost: Prisma.Decimal | null;
      description: string | null;
    }>
  > {
    const prepared = [];

    for (const [index, raw] of input.entries()) {
      const debit = this.amount(raw.debit, `Line ${index + 1} debit`);
      const credit = this.amount(raw.credit, `Line ${index + 1} credit`);
      if (debit.isZero() && credit.isZero()) {
        throw new BadRequestException(`Line ${index + 1} needs either a debit or a credit`);
      }
      if (!debit.isZero() && !credit.isZero()) {
        throw new BadRequestException(`Line ${index + 1} cannot be both a debit and a credit`);
      }

      const account = await this.prisma.account.findFirst({
        where: { id: raw.accountId, companyId, deletedAt: null },
        select: { id: true, code: true, isPostable: true, isActive: true },
      });
      if (!account) throw new BadRequestException(`Line ${index + 1}: the account does not exist`);
      if (!account.isPostable) {
        throw new BadRequestException(
          `Line ${index + 1}: account ${account.code} is a grouping account and cannot carry a balance`,
        );
      }
      if (!account.isActive) {
        throw new BadRequestException(`Line ${index + 1}: account ${account.code} is inactive`);
      }

      let quantity: Prisma.Decimal | null = null;
      let unitCost: Prisma.Decimal | null = null;
      if (raw.itemId) {
        const item = await this.prisma.item.findFirst({
          where: { id: raw.itemId, companyId, deletedAt: null },
          select: { id: true },
        });
        if (!item) throw new BadRequestException(`Line ${index + 1}: the item does not exist`);
        quantity = this.amount(raw.quantity, `Line ${index + 1} quantity`);
        unitCost = this.amount(raw.unitCost, `Line ${index + 1} unit cost`);
        if (quantity.isZero()) {
          throw new BadRequestException(`Line ${index + 1}: an item line needs a quantity`);
        }
      }

      if (raw.customerId) {
        const customer = await this.prisma.customer.findFirst({
          where: { id: raw.customerId, companyId, deletedAt: null },
          select: { id: true },
        });
        if (!customer) throw new BadRequestException(`Line ${index + 1}: the customer does not exist`);
      }
      if (raw.supplierId) {
        const supplier = await this.prisma.supplier.findFirst({
          where: { id: raw.supplierId, companyId, deletedAt: null },
          select: { id: true },
        });
        if (!supplier) throw new BadRequestException(`Line ${index + 1}: the supplier does not exist`);
      }

      prepared.push({
        accountId: account.id,
        debit,
        credit,
        customerId: raw.customerId ?? null,
        supplierId: raw.supplierId ?? null,
        itemId: raw.itemId ?? null,
        quantity,
        unitCost,
        description: raw.description?.trim() || null,
      });
    }

    return prepared;
  }

  private amount(value: unknown, field: string): Prisma.Decimal {
    if (value === undefined || value === null || value === '') return new Prisma.Decimal(0);
    try {
      const decimal = new Prisma.Decimal(String(value)).toDecimalPlaces(MONEY_SCALE);
      if (decimal.isNegative()) throw new BadRequestException(`${field} cannot be negative`);
      return decimal;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`${field} is not a valid amount`);
    }
  }

  private date(value: string): Date {
    const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('asOfDate is not a valid date');
    }
    return parsed;
  }

  private toSummary(document: {
    id: string;
    documentNumber: string;
    asOfDate: Date;
    description: string | null;
    status: InvoiceStatus;
    totalDebit: Prisma.Decimal;
    totalCredit: Prisma.Decimal;
    journalEntryId: string | null;
    postedAt: Date | null;
    createdAt: Date;
    branch?: { code: string; nameEn: string; nameAr: string };
  }) {
    return {
      id: document.id,
      documentNumber: document.documentNumber,
      asOfDate: document.asOfDate.toISOString().slice(0, 10),
      description: document.description,
      status: document.status.toLowerCase(),
      totalDebit: document.totalDebit.toFixed(MONEY_SCALE),
      totalCredit: document.totalCredit.toFixed(MONEY_SCALE),
      journalEntryId: document.journalEntryId,
      postedAt: document.postedAt?.toISOString() ?? null,
      createdAt: document.createdAt.toISOString(),
      branch: document.branch,
    };
  }
}
