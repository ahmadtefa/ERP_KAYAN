import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, Prisma, StockDirection } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StockLedgerService } from '../../common/warehouse/stock-ledger.service';
import { WarehouseService } from '../../common/warehouse/warehouse.service';
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
  /// Optional shelf of the opening warehouse that receives this item's opening quantity. Omitted = unlocated.
  storageLocationId?: string;
  quantity?: string | number;
  unitCost?: string | number;
  description?: string;
}

interface OpeningBalanceDraftInput {
  asOfDate: string;
  branchId?: string;
  description?: string;
  lines: OpeningBalanceLineInput[];
  autoBalanceToEquity?: boolean;
  warehouseId?: string;
  importFingerprint?: string;
  currency?: string;
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
    private readonly warehouses: WarehouseService,
    private readonly ledger: StockLedgerService,
  ) {}

  /// Per-item advisory keys, sorted, taken FIRST in the transaction (before any
  /// branch, warehouse, balance or journal lock) so stock documents and issues
  /// of the same item queue instead of deadlocking. Same key as batches/issues.
  private async lockItems(tx: Prisma.TransactionClient, warehouseId: string | null, itemIds: Array<string | null>) {
    if (!warehouseId) return;
    for (const id of [...new Set(itemIds.filter((x): x is string => !!x))].sort()) {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${warehouseId}:${id}`}, 0))`);
    }
  }

  async findAll(companyId: string, mayReadCost = true) {
    const items = await this.prisma.openingBalance.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { asOfDate: 'desc' },
      include: {
        branch: { select: { code: true, nameEn: true, nameAr: true } },
        _count: { select: { lines: { where: { itemId: { not: null } } } } },
      },
    });
    return {
      items: items.map((document) => this.toSummary(document, !mayReadCost && document._count.lines > 0)),
      total: items.length,
    };
  }

  async findOne(companyId: string, id: string, mayReadCost = true) {
    const document = await this.prisma.openingBalance.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        branch: { select: { code: true, nameEn: true, nameAr: true } },
        warehouse: { select: { id: true, code: true, nameEn: true, nameAr: true } },
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
    if (!document) throw new NotFoundException({ code: 'OPENING_BALANCE_DOCUMENT_NOT_FOUND', message: 'Opening balance document not found' });

    const hasRestrictedCosts = !mayReadCost && document.lines.some(line => line.itemId !== null);
    return {
      ...this.toSummary(document, hasRestrictedCosts),
      hasRestrictedCosts,
      branchId: document.branchId,
      warehouse: document.warehouse,
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
        storageLocationId: (line as { storageLocationId?: string | null }).storageLocationId ?? null,
        item: line.item,
        debit: hasRestrictedCosts ? null : line.debit.toFixed(MONEY_SCALE),
        credit: hasRestrictedCosts ? null : line.credit.toFixed(MONEY_SCALE),
        quantity: line.quantity?.toFixed(MONEY_SCALE) ?? null,
        unitCost: mayReadCost ? line.unitCost?.toFixed(MONEY_SCALE) ?? null : null,
        description: line.description,
      })),
    };
  }

  /** Creates the document as a DRAFT. Nothing reaches the ledger yet. */
  async create(
    companyId: string,
    branchId: string | null,
    userId: string,
    dto: OpeningBalanceDraftInput,
    draftId?: string,
    mayReadCost = true,
  ) {
    if (dto.importFingerprint !== undefined && !/^[0-9a-f]{64}$/.test(dto.importFingerprint)) {
      throw new BadRequestException('The import fingerprint must be a SHA-256 hex digest');
    }
    const targetBranch = dto.branchId ?? branchId;
    if (!targetBranch) {
      throw new BadRequestException({ code: 'BRANCH_REQUIRED', message: 'Select the branch these opening figures belong to' });
    }
    const asOfDate = this.date(dto.asOfDate);
    const minimum = dto.autoBalanceToEquity === true ? 1 : 2;
    if (!Array.isArray(dto.lines) || dto.lines.length < minimum || dto.lines.length > 1000) {
      throw new BadRequestException(`An opening balance needs between ${minimum} and 1,000 lines`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const branch = await tx.branch.findFirst({
        where: { id: targetBranch, companyId, deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (!branch) {
        throw new BadRequestException({ code: 'BRANCH_MISSING', message: 'The branch does not exist in this company' });
      }

      // Resolve every reference and calculate the document inside the same
      // transaction that persists it. In particular, AccountMapService
      // requires a transaction client; using the root PrismaService here
      // would split a dry read from the write and bypass that contract.
      let currency: string | undefined;
      if (dto.currency !== undefined) {
        const company = await tx.company.findUnique({
          where: { id: companyId },
          select: { currency: true },
        });
        if (!company || dto.currency !== company.currency) {
          throw new BadRequestException('Opening balances must use the company currency');
        }
        currency = company.currency;
      }
      const prepared = await this.prepareLines(tx, companyId, dto.lines, currency);
      let totalDebit = prepared.reduce(
        (sum, line) => sum.plus(line.debit),
        new Prisma.Decimal(0),
      );
      let totalCredit = prepared.reduce(
        (sum, line) => sum.plus(line.credit),
        new Prisma.Decimal(0),
      );
      const lines = [...prepared];

      if (dto.autoBalanceToEquity === true && !totalDebit.equals(totalCredit)) {
        // Make the balancing figure visible on the designated equity account;
        // never force a one-sided balance into the ledger silently.
        const equity = await this.accounts.resolve(tx, companyId, [
          'openingBalanceEquity',
        ]);
        const difference = totalDebit.minus(totalCredit);
        lines.push({
          accountId: equity.openingBalanceEquity,
          debit: difference.isNegative()
              ? difference.negated()
              : new Prisma.Decimal(0),
          credit: difference.isNegative()
              ? new Prisma.Decimal(0)
              : difference,
          customerId: null,
          supplierId: null,
          itemId: null,
          quantity: null,
          unitCost: null,
          description: 'Opening balance equity',
        });
        totalDebit = lines.reduce(
          (sum, line) => sum.plus(line.debit),
          new Prisma.Decimal(0),
        );
        totalCredit = lines.reduce(
          (sum, line) => sum.plus(line.credit),
          new Prisma.Decimal(0),
        );
      }

      if (totalDebit.greaterThanOrEqualTo('1000000000000000') ||
          totalCredit.greaterThanOrEqualTo('1000000000000000')) {
        throw new BadRequestException('Opening balance totals are outside the supported range');
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

      const warehouseId = await this.warehouses.resolve(
        tx,
        companyId,
        targetBranch,
        dto.warehouseId,
      );
      await this.assertLineShelvesInWarehouse(tx, companyId, warehouseId, lines as Array<{ storageLocationId?: string | null }>);
      const details = {
        branchId: targetBranch,
        warehouseId,
        asOfDate,
        description: dto.description ?? null,
        totalDebit,
        totalCredit,
      };
      const newLines = lines.map((line, index) => ({ ...line, lineNumber: index + 1 }));
      if (draftId) {
        const existing = await tx.openingBalance.findFirst({
          where: { id: draftId, companyId, deletedAt: null },
          select: { id: true, branchId: true, status: true, updatedAt: true },
        });
        if (!existing) throw new NotFoundException({ code: 'OPENING_BALANCE_DOCUMENT_NOT_FOUND', message: 'Opening balance document not found' });
        if (!mayReadCost && await tx.openingBalanceLine.count({
          where: { openingBalanceId: draftId, itemId: { not: null } },
        })) {
          throw new ForbiddenException('Stock opening balances require inventory cost permission');
        }
        if (existing.branchId !== targetBranch) {
          throw new BadRequestException('A saved opening balance cannot change branches');
        }
        const updated = await tx.openingBalance.updateMany({
          where: { id: draftId, companyId, status: InvoiceStatus.DRAFT, deletedAt: null, updatedAt: existing.updatedAt },
          data: { ...details, importFingerprint: null },
        });
        if (updated.count !== 1) {
          throw new BadRequestException('This opening balance changed or is no longer a draft');
        }
        await tx.openingBalanceLine.deleteMany({ where: { openingBalanceId: draftId } });
        await tx.openingBalanceLine.createMany({
          data: newLines.map((line) => ({ ...line, openingBalanceId: draftId })),
        });
        await this.audit.recordRequired({
          companyId, userId, action: 'UPDATE', entity: 'opening_balances', entityId: draftId,
          after: { totalDebit: totalDebit.toFixed(MONEY_SCALE), lines: newLines.length },
        }, tx);
        return null;
      }

      const documentNumber = await this.numbers.next(tx, companyId, 'OPENING_BALANCE', 'OB');
      const created = await tx.openingBalance.create({
        data: {
          ...details,
          companyId,
          documentNumber,
          importFingerprint: dto.importFingerprint ?? null,
          status: InvoiceStatus.DRAFT,
          createdBy: userId,
          lines: { create: newLines },
        },
      });

      return { created, totalDebit, lineCount: lines.length };
    });

    if (!result && draftId) return this.findOne(companyId, draftId);
    if (!result) throw new Error('Opening balance creation did not return a document');

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'opening_balances',
      entityId: result.created.id,
      after: {
        documentNumber: result.created.documentNumber,
        totalDebit: result.totalDebit.toFixed(MONEY_SCALE),
        lines: result.lineCount,
      },
    });

    return this.findOne(companyId, result.created.id);
  }

  async removeDraft(companyId: string, userId: string, id: string, branchId?: string | null, mayReadCost = true) {
    if (branchId === null) throw new BadRequestException({ code: 'BRANCH_REQUIRED', message: 'Select a branch before deleting a draft' });
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.openingBalance.updateMany({
        where: {
          id, companyId, branchId, status: InvoiceStatus.DRAFT, deletedAt: null,
          ...(mayReadCost ? {} : { lines: { none: { itemId: { not: null } } } }),
        },
        data: { deletedAt: new Date(), importFingerprint: null },
      });
      if (removed.count !== 1) {
        throw new BadRequestException('Only an existing draft opening balance can be deleted');
      }
      await this.audit.recordRequired({
        companyId, userId, action: 'DELETE', entity: 'opening_balances', entityId: id,
      }, tx);
    });
    return { deleted: true };
  }

  /**
   * Posts the document: one journal entry, plus a stock movement for every
   * stocked item line, all in the same transaction.
   */
  async post(companyId: string, userId: string, id: string, branchId?: string | null, mayReadCost = true) {
    if (branchId === null) throw new BadRequestException({ code: 'BRANCH_REQUIRED', message: 'Select a branch first' });
    const document = await this.prisma.openingBalance.findFirst({
      where: { id, companyId, branchId, deletedAt: null },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!document) throw new NotFoundException({ code: 'OPENING_BALANCE_DOCUMENT_NOT_FOUND', message: 'Opening balance document not found' });
    if (!mayReadCost && document.lines.some(line => line.itemId !== null)) {
      throw new ForbiddenException('Stock opening balances require inventory cost permission');
    }
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
      await this.lockItems(
        tx,
        await this.warehouses.resolve(tx, companyId, document.branchId, document.warehouseId),
        document.lines.map((line) => line.itemId),
      );
      // Serialize posts for this branch. The duplicate check outside the
      // transaction is a useful early error, but only this lock closes the
      // race where two drafts are posted at the same time.
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM branches
         WHERE id = ${document.branchId}::uuid
           AND "companyId" = ${companyId}::uuid
         FOR UPDATE
      `);

      // Claim this exact draft before writing any stock or ledger rows. The
      // branch lock serializes competing opening documents; this conditional
      // update also serializes two requests posting the same document. If a
      // later step fails, the transaction rolls this claim back with it.
      const claimed = await tx.openingBalance.updateMany({
        where: {
          id: document.id,
          companyId,
          updatedAt: document.updatedAt,
          status: InvoiceStatus.DRAFT,
          deletedAt: null,
        },
        data: {
          status: InvoiceStatus.POSTED,
          postedAt: new Date(),
          postedBy: userId,
        },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException(
          'This opening balance changed. Refresh the document before posting.',
        );
      }

      const alreadyPostedInTransaction = await tx.openingBalance.findFirst({
        where: {
          companyId,
          branchId: document.branchId,
          status: InvoiceStatus.POSTED,
          deletedAt: null,
          id: { not: document.id },
        },
        select: { documentNumber: true },
      });
      if (alreadyPostedInTransaction) {
        throw new BadRequestException(
          `This branch already has a posted opening balance (${alreadyPostedInTransaction.documentNumber}).`,
        );
      }

      const warehouseId = await this.warehouses.resolve(
        tx,
        companyId,
        document.branchId,
        document.warehouseId,
      );
      if (!document.warehouseId && warehouseId) {
        await tx.openingBalance.update({
          where: { id: document.id },
          data: { warehouseId },
        });
      }

      // ---- stock: quantities are opened as movements, at the cost the
      // document states, so the stock ledger and the inventory account agree.
      for (const line of document.lines) {
        if (!line.itemId) continue;
        const item = await tx.item.findFirst({
          where: { id: line.itemId, companyId, deletedAt: null },
          select: { id: true, isStockTracked: true, code: true, requiresBatch: true, requiresProductionDate: true, requiresExpiryDate: true },
        });
        if (!item) throw new BadRequestException('An opening line references a missing item');
        if (!item.isStockTracked) continue;
        this.assertNoLotControl(item, line.lineNumber);
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

        // An item created with its own opening stock already carries that
        // quantity. Counting it again through this document would double the
        // stock and the inventory account.
        const openingStockAtCreate = await tx.stockMovement.findFirst({
          where: {
            companyId,
            itemId: item.id,
            referenceType: 'ITEM_OPENING_STOCK',
          },
          select: { id: true },
        });
        if (openingStockAtCreate) {
          throw new BadRequestException(
            `Item ${item.code} already has opening stock recorded when it was created. ` +
              'Remove that opening stock or leave the item out of this document.',
          );
        }

        const openShelf = (line as { storageLocationId?: string | null }).storageLocationId ?? null;
        if (openShelf) {
          await this.assertLineShelvesInWarehouse(tx, companyId, warehouseId, [{ storageLocationId: openShelf, lineNumber: line.lineNumber } as never], true);
        }
        await tx.stockMovement.create({
          data: {
            companyId,
            branchId: document.branchId,
            warehouseId,
            itemId: item.id,
            ...({ storageLocationId: openShelf } as object),
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

        // Branch book and the warehouse book move together, in one ledger call.
        await this.ledger.post(tx, {
          companyId,
          branchId: document.branchId,
          warehouseId,
          itemId: item.id,
          quantity: line.quantity,
          value: line.debit,
        });
      }

      const journal = await this.posting.post(tx, {
        companyId,
        branchId: document.branchId,
        userId,
        entryDate: document.asOfDate,
        description: document.description ?? 'Opening balances',
        currency: (await tx.company.findUnique({ where: { id: companyId }, select: { currency: true } }))?.currency,
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
  async reverse(companyId: string, userId: string, id: string, branchId?: string | null, mayReadCost = true) {
    if (branchId === null) throw new BadRequestException({ code: 'BRANCH_REQUIRED', message: 'Select a branch first' });
    const document = await this.prisma.openingBalance.findFirst({
      where: { id, companyId, branchId, deletedAt: null },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!document) throw new NotFoundException({ code: 'OPENING_BALANCE_DOCUMENT_NOT_FOUND', message: 'Opening balance document not found' });
    if (!mayReadCost && document.lines.some(line => line.itemId !== null)) {
      throw new ForbiddenException('Stock opening balances require inventory cost permission');
    }
    if (document.status !== InvoiceStatus.POSTED || !document.journalEntryId) {
      throw new BadRequestException('Only a posted opening balance can be reversed');
    }

    const journal = await this.prisma.$transaction(async (tx) => {
      // The reversal must take the stock back out of exactly where it went in.
      // The original movement is the evidence: a historical document may have
      // been posted branch-only (no warehouse), and a fresh default warehouse
      // today would be a place the goods never entered.
      const originals = await tx.stockMovement.findMany({
        where: { companyId, referenceType: 'OPENING_BALANCE', referenceId: document.id },
        select: { itemId: true, warehouseId: true, direction: true, quantity: true, totalCost: true, storageLocationId: true },
      } as never) as unknown as Array<{ itemId: string; warehouseId: string | null; direction: string; quantity: Prisma.Decimal; totalCost: Prisma.Decimal; storageLocationId: string | null }>;
      // Complete, provable coverage only: exactly one original IN movement per
      // stock line, with the same quantity, value and shelf as the line. Repeated
      // items, several origins, a changed quantity or value or a different shelf
      // are historical ambiguity: refuse, and never pick "the last" one.
      const originWarehouse = new Map<string, string | null>();
      const stockLines = document.lines.filter((l) => l.itemId && l.quantity !== null);
      const ambiguous = (lineNumber: number, why: string) =>
        new BadRequestException({
          code: 'OPENING_REVERSE_ORIGIN_AMBIGUOUS',
          message:
            `لا يمكن عكس الرصيد الافتتاحي (سطر ${lineNumber}): حركة المخزون الأصلية لا تطابق السطر بشكل قاطع (${why}). لم يُنفَّذ أي شيء ولم يُعدَّل المستند؛ راجع المحاسب أو المدير للتحقق من المخزن والموقع والتكلفة الأصلية قبل أي تصحيح. / ` +
            `Cannot reverse the opening balance (line ${lineNumber}): the original stock movement does not match the line with certainty (${why}). Nothing was changed and the document is untouched; ask the accountant or administrator to verify the original warehouse, location and cost before any correction.`,
          errors: { lineNumber: String(lineNumber), reason: why },
        });
      for (const line of stockLines) {
        if (stockLines.filter((l) => l.itemId === line.itemId).length > 1) {
          throw ambiguous(line.lineNumber, 'item repeated in the document');
        }
        const own = originals.filter((m) => m.itemId === line.itemId);
        if (own.length === 0) {
          throw new BadRequestException({
            code: 'OPENING_REVERSE_ORIGIN_UNKNOWN',
            message:
              `لا يمكن عكس الرصيد الافتتاحي (سطر ${line.lineNumber}): لا توجد حركة مخزون أصلية مسجلة لهذا الصنف تحدد المخزن الذي دخل إليه. لم يُنفَّذ أي شيء؛ راجع المحاسب أو المدير للتحقق قبل أي تصحيح. / ` +
              `Cannot reverse the opening balance (line ${line.lineNumber}): no original stock movement is recorded for this item to show which warehouse it entered. Nothing was changed; ask the accountant or administrator to verify before any correction.`,
            errors: { lineNumber: String(line.lineNumber) },
          });
        }
        if (own.length > 1) throw ambiguous(line.lineNumber, 'several original movements');
        const m = own[0];
        const lineShelf = (line as { storageLocationId?: string | null }).storageLocationId ?? null;
        if (m.direction !== 'IN') throw ambiguous(line.lineNumber, 'original movement is not a receipt');
        if (!new Prisma.Decimal(m.quantity).equals(line.quantity as Prisma.Decimal)) throw ambiguous(line.lineNumber, 'quantity differs');
        if (new Prisma.Decimal(m.totalCost).minus(line.debit).abs().greaterThan('0.01')) throw ambiguous(line.lineNumber, 'value differs');
        if ((m.storageLocationId ?? null) !== lineShelf) throw ambiguous(line.lineNumber, 'location differs');
        originWarehouse.set(line.itemId as string, m.warehouseId ?? null);
      }
      const keys = new Map<string, { warehouseId: string; itemId: string }>();
      for (const [itemId, wh] of originWarehouse) if (wh) keys.set(`${wh}:${itemId}`, { warehouseId: wh, itemId });
      for (const key of [...keys.keys()].sort()) {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
      }
      // Claim the posted document before touching the journal or stock: a second
      // reverse (or a concurrent one) finds it already claimed and stops.
      const claimed = await tx.openingBalance.updateMany({
        where: { id: document.id, companyId, status: InvoiceStatus.POSTED, deletedAt: null },
        data: { status: InvoiceStatus.REVERSED },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('This opening balance was already reversed or changed. Refresh the document.');
      }
      const reversal = await this.posting.reverse(
        tx,
        companyId,
        userId,
        document.journalEntryId as string,
        `Reversal of opening balance ${document.documentNumber}`,
      );

      for (const line of document.lines) {
        if (!line.itemId || line.quantity === null || line.unitCost === null) continue;
        const warehouseId = originWarehouse.get(line.itemId) ?? null;
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
        const valueOnHand = balance?.value ?? new Prisma.Decimal(0);
        if (onHand.lessThan(line.quantity) || valueOnHand.lessThan(line.debit)) {
          throw new BadRequestException(
            `Cannot reverse opening balance: ${onHand.toFixed(MONEY_SCALE)} units and ` +
              `${valueOnHand.toFixed(MONEY_SCALE)} of inventory value are available; ` +
              `${line.quantity.toFixed(MONEY_SCALE)} units and ${line.debit.toFixed(MONEY_SCALE)} of value are required.`,
          );
        }

        const openShelf = (line as { storageLocationId?: string | null }).storageLocationId ?? null;
        if (openShelf) {
          const [row] = await tx.$queryRaw<Array<{ q: Prisma.Decimal }>>(Prisma.sql`
            SELECT COALESCE(SUM(CASE WHEN "direction" = 'IN' THEN "quantity" ELSE -"quantity" END), 0) AS q
              FROM "stock_movements"
             WHERE "companyId" = ${companyId}::uuid AND "warehouseId" = ${warehouseId}::uuid
               AND "itemId" = ${line.itemId}::uuid AND "storageLocationId" = ${openShelf}::uuid
          `);
          const onShelf = new Prisma.Decimal(row?.q ?? 0);
          if (onShelf.lessThan(line.quantity)) {
            throw new BadRequestException({
              code: 'OPENING_REVERSE_SHELF_SHORT',
              message:
                `لا يمكن عكس الرصيد الافتتاحي (سطر ${line.lineNumber}): الموقع المسجل عليه يحمل ${onShelf.toFixed(MONEY_SCALE)} فقط من ${line.quantity.toFixed(MONEY_SCALE)} المطلوبة. أعد الكمية المنقولة إلى هذا الموقع (تحويل) ثم أعد العكس؛ لم يتغير أي رصيد. / ` +
                `Cannot reverse the opening balance (line ${line.lineNumber}): its location holds only ${onShelf.toFixed(MONEY_SCALE)} of the ${line.quantity.toFixed(MONEY_SCALE)} required. Transfer the moved quantity back to that location, then reverse again; no balance changed.`,
            });
          }
        }
        await tx.stockMovement.create({
          data: {
            companyId,
            branchId: document.branchId,
            warehouseId,
            itemId: line.itemId,
            ...({ storageLocationId: openShelf } as object),
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
        await this.ledger.post(tx, {
          companyId,
          branchId: document.branchId,
          warehouseId,
          itemId: line.itemId,
          quantity: line.quantity.neg(),
          value: line.debit.neg(),
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
    tx: Prisma.TransactionClient,
    companyId: string,
    input: OpeningBalanceLineInput[],
    currency?: string,
  ): Promise<
    Array<{
      accountId: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      customerId: string | null;
      supplierId: string | null;
      itemId: string | null;
      storageLocationId?: string | null;
      quantity: Prisma.Decimal | null;
      unitCost: Prisma.Decimal | null;
      description: string | null;
    }>
  > {
    const prepared = [];
    const seenStockItems = new Map<string, number>();

    for (const [index, raw] of input.entries()) {
      if (!raw || typeof raw.accountId !== 'string') {
        throw new BadRequestException(`Line ${index + 1}: choose a ledger account`);
      }
      if ([raw.customerId, raw.supplierId, raw.itemId].filter(Boolean).length > 1) {
        throw new BadRequestException(`Line ${index + 1}: choose a single customer, supplier or stock item`);
      }
      const debit = this.amount(raw.debit, `Line ${index + 1} debit`);
      const credit = this.amount(raw.credit, `Line ${index + 1} credit`);
      if (debit.isZero() && credit.isZero()) {
        throw new BadRequestException(`Line ${index + 1} needs either a debit or a credit`);
      }
      if (!debit.isZero() && !credit.isZero()) {
        throw new BadRequestException(`Line ${index + 1} cannot be both a debit and a credit`);
      }

      const account = await tx.account.findFirst({
        where: { id: raw.accountId, companyId, deletedAt: null },
        select: { id: true, code: true, isPostable: true, isActive: true, currency: true },
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

      if (currency && account.currency && account.currency !== currency) {
        throw new BadRequestException(`Line ${index + 1}: account ${account.code} uses ${account.currency}, expected ${currency}`);
      }
      if (currency && (raw.customerId || raw.supplierId)) {
        const key = raw.customerId ? 'accountsReceivable' : 'accountsPayable';
        const mapped = await this.accounts.resolve(tx, companyId, [key]);
        if (account.id !== mapped[key]) {
          throw new BadRequestException(`Line ${index + 1}: use the designated ${key} account`);
        }
      }

      let quantity: Prisma.Decimal | null = null;
      let unitCost: Prisma.Decimal | null = null;
      let storageLocationId: string | null = null;
      if (raw.storageLocationId) {
        if (!raw.itemId) {
          throw new BadRequestException({
            code: 'OPENING_LOCATION_WITHOUT_ITEM',
            message: `السطر ${index + 1}: موقع التخزين يخص سطر صنف فقط. احذف الموقع من هذا السطر؛ باقي بياناتك محفوظة. / Line ${index + 1}: a storage location belongs only on a stock item line. Remove it from this line; the rest of your data is kept.`,
          });
        }
        const shelf = await tx.storageLocation.findFirst({
          where: { id: raw.storageLocationId, companyId, deletedAt: null },
          select: { id: true, code: true, isActive: true },
        });
        const fix = 'اختر موقعًا نشطًا من مخزن الرصيد الافتتاحي أو اتركه فارغًا؛ بياناتك محفوظة. / Choose an active location of the opening warehouse or leave it empty; your data is kept.';
        if (!shelf) {
          throw new BadRequestException({ code: 'OPENING_LOCATION_NOT_FOUND', message: `السطر ${index + 1}: موقع التخزين غير موجود. ${fix}` });
        }
        if (!shelf.isActive) {
          throw new BadRequestException({ code: 'OPENING_LOCATION_INACTIVE', message: `السطر ${index + 1}: الموقع ${shelf.code} غير مفعّل ولا يستقبل رصيدًا. ${fix}`, errors: { lineNumber: String(index + 1), locationCode: shelf.code.slice(0, 64) } });
        }
        storageLocationId = shelf.id;
      }
      if (raw.itemId) {
        const item = await tx.item.findFirst({
          where: { id: raw.itemId, companyId, deletedAt: null },
          select: { id: true, code: true, isStockTracked: true, requiresBatch: true, requiresProductionDate: true, requiresExpiryDate: true },
        });
        if (!item) throw new BadRequestException(`Line ${index + 1}: the item does not exist`);
        if (item.isStockTracked) {
          this.assertNoLotControl(item, index + 1);
          const previousLine = seenStockItems.get(item.id);
          if (previousLine !== undefined) {
            throw new BadRequestException(
              `Line ${index + 1}: stock item ${item.id} is repeated from line ${previousLine}; combine its opening quantity and cost into one line.`,
            );
          }
          seenStockItems.set(item.id, index + 1);
          quantity = this.amount(raw.quantity, `Line ${index + 1} quantity`);
          unitCost = this.amount(raw.unitCost, `Line ${index + 1} unit cost`);
          if (quantity.isZero()) {
            throw new BadRequestException(`Line ${index + 1}: a stock item needs a quantity greater than zero`);
          }
          const stockValue = quantity.mul(unitCost).toDecimalPlaces(MONEY_SCALE);
          if (!debit.equals(stockValue)) {
            throw new BadRequestException(
              `Line ${index + 1}: quantity x unit cost (${stockValue.toFixed(MONEY_SCALE)}) ` +
                `must equal the debit (${debit.toFixed(MONEY_SCALE)}).`,
            );
          }
          const inventory = await this.accounts.resolve(tx, companyId, ['inventory']);
          if (account.id !== inventory.inventory) {
            throw new BadRequestException(
              `Line ${index + 1}: opening stock must be posted to the inventory account.`,
            );
          }
        } else if (
          (raw.quantity !== undefined && raw.quantity !== '') ||
          (raw.unitCost !== undefined && raw.unitCost !== '')
        ) {
          throw new BadRequestException(
            `Line ${index + 1}: non-stock items cannot carry an opening stock quantity or cost.`,
          );
        }
      }

      if (raw.customerId) {
        const customer = await tx.customer.findFirst({
          where: { id: raw.customerId, companyId, deletedAt: null },
          select: { id: true },
        });
        if (!customer) throw new BadRequestException(`Line ${index + 1}: the customer does not exist`);
      }
      if (raw.supplierId) {
        const supplier = await tx.supplier.findFirst({
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
        ...({ storageLocationId } as object),
        quantity,
        unitCost,
        description: raw.description?.trim() || null,
      });
    }

    return prepared;
  }

  /// Opening stock has no lot number or dates. A lot-controlled item (lot, production
  /// date or expiry date required) would post to the shelf and warehouse and
  /// still have NO lot, so a later issue would refuse for lack of a lot. Refuse
  /// before anything is written and invent no lot or date.
  private assertNoLotControl(
    item: { code?: string | null; requiresBatch?: boolean | null; requiresProductionDate?: boolean | null; requiresExpiryDate?: boolean | null },
    lineNumber: number,
  ) {
    if (!item.requiresBatch && !item.requiresProductionDate && !item.requiresExpiryDate) return;
    const code = String(item.code ?? '').slice(0, 64);
    throw new BadRequestException({
      code: 'OPENING_LOT_CONTROLLED_ITEM',
      message:
        `السطر ${lineNumber}: الصنف ${code} يتطلب رقم دفعة أو تواريخ (إنتاج/صلاحية)، والرصيد الافتتاحي هنا لا يحمل بيانات دفعة، فلن يمكن صرفه لاحقًا. احذف هذا السطر من المستند (باقي السطور محفوظة) وراجع المحاسب أو المدير لاعتماد طريقة إدخال رصيده الافتتاحي بدفعة وتواريخ يمكن تتبعها دون تكرار قيد المخزون. لم يُرحَّل أي شيء. / ` +
        `Line ${lineNumber}: item ${code} requires a lot number or dates (production/expiry), and an opening balance carries no lot data, so the stock could not be issued later. Remove this line (the other lines are kept) and ask the accountant or administrator to approve a traceable way to enter its opening stock with a lot and dates, without duplicating the stock or the journal entry. Nothing was posted.`,
      errors: { lineNumber: String(lineNumber), itemCode: code },
    });
  }

  /// The shelf must belong to the opening warehouse. At post it is also
  /// re-read, because a shelf may have been deleted or switched off since the
  /// draft was saved.
  private async assertLineShelvesInWarehouse(
    tx: Prisma.TransactionClient,
    companyId: string,
    warehouseId: string | null,
    lines: Array<{ storageLocationId?: string | null; lineNumber?: number }>,
    atPost = false,
  ) {
    for (const [index, line] of lines.entries()) {
      if (!line.storageLocationId) continue;
      const shelf = await tx.storageLocation.findFirst({
        where: { id: line.storageLocationId, companyId, deletedAt: null },
        select: { code: true, isActive: true, warehouseId: true },
      });
      const n = line.lineNumber ?? index + 1;
      const tail = atPost
        ? 'صحّح الموقع في المسودة أو اتركه فارغًا ثم رحّل من جديد؛ لم يتغير أي رصيد. / Correct the location on the draft or leave it empty, then post again; no balance changed.'
        : 'اختر موقعًا من مخزن الرصيد الافتتاحي أو اتركه فارغًا؛ بياناتك محفوظة. / Choose a location of the opening warehouse or leave it empty; your data is kept.';
      if (!shelf || !shelf.isActive) {
        throw new BadRequestException({ code: 'OPENING_LOCATION_INACTIVE', message: `السطر ${n}: ${shelf ? `الموقع ${shelf.code} غير مفعّل` : 'الموقع حُذف'}. ${tail}`, errors: { lineNumber: String(n) } });
      }
      if (warehouseId && shelf.warehouseId !== warehouseId) {
        throw new BadRequestException({ code: 'OPENING_LOCATION_WRONG_WAREHOUSE', message: `السطر ${n}: الموقع ${shelf.code} يتبع مخزنًا آخر غير مخزن الرصيد الافتتاحي. ${tail}`, errors: { lineNumber: String(n), locationCode: shelf.code.slice(0, 64) } });
      }
    }
  }

  private amount(value: unknown, field: string): Prisma.Decimal {
    if (value === undefined || value === null || value === '') return new Prisma.Decimal(0);
    try {
      const decimal = new Prisma.Decimal(String(value)).toDecimalPlaces(MONEY_SCALE);
      if (!decimal.isFinite() || decimal.greaterThanOrEqualTo('1000000000000000')) {
        throw new BadRequestException(`${field} is outside the supported range`);
      }
      if (decimal.isNegative()) throw new BadRequestException(`${field} cannot be negative`);
      return decimal;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`${field} is not a valid amount`);
    }
  }

  private date(value: string): Date {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
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
  }, redactTotals = false) {
    return {
      id: document.id,
      documentNumber: document.documentNumber,
      asOfDate: document.asOfDate.toISOString().slice(0, 10),
      description: document.description,
      status: document.status.toLowerCase(),
      totalDebit: redactTotals ? null : document.totalDebit.toFixed(MONEY_SCALE),
      totalCredit: redactTotals ? null : document.totalCredit.toFixed(MONEY_SCALE),
      journalEntryId: document.journalEntryId,
      postedAt: document.postedAt?.toISOString() ?? null,
      createdAt: document.createdAt.toISOString(),
      branch: document.branch,
    };
  }
}
