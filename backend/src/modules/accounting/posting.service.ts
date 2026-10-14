import { BadRequestException, Injectable } from '@nestjs/common';
import { JournalStatus, Prisma } from '@prisma/client';
import { DocumentNumberService } from './document-number.service';
import { FiscalPeriodsService } from './fiscal-periods.service';

const MONEY_SCALE = 4;

export interface PostingLine {
  accountId: string;
  debit?: Prisma.Decimal | string;
  credit?: Prisma.Decimal | string;
  description?: string;
  /// The analytical dimension, when the document knows one. An invoice line
  /// that names a cost center carries it through to the ledger.
  costCenterId?: string | null;
}

export interface PostingRequest {
  companyId: string;
  branchId: string;
  userId: string;
  entryDate: Date;
  description: string;
  lines: PostingLine[];
  /** Where the entry came from, kept for tracing an entry back to its document. */
  sourceType:
    | 'SALES_INVOICE'
    | 'PURCHASE_INVOICE'
    | 'SALES_RETURN'
    | 'PURCHASE_RETURN'
    | 'CASH_VOUCHER'
    | 'CASH_TRANSFER'
    | 'STOCK_DOCUMENT'
    | 'OPENING_BALANCE'
    | 'YEAR_END_CLOSE'
    | 'MANUAL';
  sourceId: string;
  sourceNumber: string;
  /// Overrides the description written on the entry. Defaults to the
  /// document's own description plus its number in brackets, which is what
  /// makes a ledger line traceable back to the document that caused it.
  entryDescription?: string;
  /// Overrides the period code used when a message has to name the period.
  currency?: string;
}

/**
 * Writes a POSTED journal entry from a business document.
 *
 * Sales and purchase invoices both need exactly this, and both must do it in
 * the same transaction as their own rows and their stock movements: a posted
 * invoice without its accounting, or accounting without the invoice, would be
 * a ledger that cannot be reconciled.
 */
@Injectable()
export class PostingService {
  constructor(
    private readonly numbers: DocumentNumberService,
    private readonly periods: FiscalPeriodsService,
  ) {}

  async post(
    tx: Prisma.TransactionClient,
    request: PostingRequest,
  ): Promise<{ id: string; entryNumber: string }> {
    const lines = request.lines
      .map((l) => ({
        accountId: l.accountId,
        debit: this.amount(l.debit),
        credit: this.amount(l.credit),
        description: l.description ?? null,
        costCenterId: l.costCenterId ?? null,
      }))
      // A zero line carries no information and would only clutter the ledger.
      .filter((l) => !l.debit.isZero() || !l.credit.isZero());

    if (lines.length < 2) {
      throw new BadRequestException(
        'A posting needs at least one debit and one credit',
      );
    }

    const totalDebit = lines.reduce(
      (sum, l) => sum.plus(l.debit),
      new Prisma.Decimal(0),
    );
    const totalCredit = lines.reduce(
      (sum, l) => sum.plus(l.credit),
      new Prisma.Decimal(0),
    );

    if (!totalDebit.equals(totalCredit)) {
      throw new BadRequestException({
        message: 'The document does not balance, so it was not posted',
        errors: {
          totalDebit: totalDebit.toFixed(MONEY_SCALE),
          totalCredit: totalCredit.toFixed(MONEY_SCALE),
          difference: totalDebit.minus(totalCredit).toFixed(MONEY_SCALE),
        },
      });
    }

    // Accounts must exist, be postable and belong to this company. A document
    // is rejected rather than posted to a grouping account.
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const accounts = await tx.account.findMany({
      where: { id: { in: accountIds }, companyId: request.companyId, deletedAt: null },
      select: { id: true, code: true, isPostable: true, isActive: true },
    });
    if (accounts.length !== accountIds.length) {
      throw new BadRequestException('One or more accounts do not exist');
    }
    const invalid = accounts.filter((a) => !a.isPostable || !a.isActive);
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Accounts cannot receive postings: ${invalid.map((a) => a.code).join(', ')}`,
      );
    }
    // A closed period is a finished year. Nothing may be added to it.
    const entryDate = request.entryDate;
    const period = await this.periods.periodFor(tx, request.companyId, entryDate);
    if (period && period.status === 'CLOSED') {
      throw new BadRequestException(
        `Period ${period.code} is closed, so nothing can be posted on ${entryDate
          .toISOString()
          .slice(0, 10)}`,
      );
    }


    const entryNumber = await this.numbers.next(
      tx,
      request.companyId,
      'JOURNAL',
      'JV',
    );

    const entry = await tx.journalEntry.create({
      data: {
        companyId: request.companyId,
        branchId: request.branchId,
        entryNumber,
        entryDate: request.entryDate,
        description:
          request.entryDescription ?? `${request.description} [${request.sourceNumber}]`,
        status: JournalStatus.POSTED,
        totalDebit,
        totalCredit,
        currency: request.currency ?? 'EGP',
        postedAt: new Date(),
        postedBy: request.userId,
        createdBy: request.userId,
        // The document this entry came from, so a report can drill down into
        // it instead of leaving the reader with a number and no explanation.
        sourceType: request.sourceType,
        sourceId: request.sourceId,
        sourceNumber: request.sourceNumber,
        lines: {
          create: lines.map((l, index) => ({
            lineNumber: index + 1,
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            description: l.description,
            costCenterId: l.costCenterId,
          })),
        },
      },
      select: { id: true, entryNumber: true },
    });

    return entry;
  }

  /**
   * Writes the mirror entry that cancels a posted one.
   *
   * Nothing is ever edited or deleted: the original stays in the books and a
   * second entry, with its own number, takes it back. That is the only way a
   * reader of the ledger can see both what happened and that it was undone.
   *
   * Runs inside the caller's transaction so a document that reverses its
   * accounting and its stock together cannot half-succeed.
   */
  async reverse(
    tx: Prisma.TransactionClient,
    companyId: string,
    userId: string,
    journalEntryId: string,
    description: string,
    entryDate: Date = new Date(),
  ): Promise<{ id: string; entryNumber: string }> {
    const original = await tx.journalEntry.findFirst({
      where: { id: journalEntryId, companyId },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!original) {
      throw new BadRequestException('The journal entry to reverse was not found');
    }
    if (original.status === JournalStatus.REVERSED) {
      throw new BadRequestException('This journal entry has already been reversed');
    }
    if (original.status !== JournalStatus.POSTED) {
      throw new BadRequestException('Only a posted journal entry can be reversed');
    }

    const claimed = await tx.journalEntry.updateMany({
      where: { id: original.id, companyId, status: JournalStatus.POSTED },
      data: { status: JournalStatus.REVERSED },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException('This journal entry has already been reversed');
    }

    const entryNumber = await this.numbers.next(tx, companyId, 'JOURNAL', 'JV');
    const reversal = await tx.journalEntry.create({
      data: {
        companyId,
        branchId: original.branchId,
        entryNumber,
        entryDate,
        description,
        status: JournalStatus.POSTED,
        currency: original.currency,
        totalDebit: original.totalCredit,
        totalCredit: original.totalDebit,
        reversalOfId: original.id,
        // A reversal points at the same document as what it reverses: the
        // reader who drills down wants the invoice, not the mirror entry.
        sourceType: original.sourceType,
        sourceId: original.sourceId,
        sourceNumber: original.sourceNumber,
        postedAt: new Date(),
        postedBy: userId,
        createdBy: userId,
        lines: {
          create: original.lines.map((line) => ({
            lineNumber: line.lineNumber,
            accountId: line.accountId,
            debit: line.credit,
            credit: line.debit,
            description: line.description,
            costCenterId: line.costCenterId,
          })),
        },
      },
      select: { id: true, entryNumber: true },
    });

    return reversal;
  }

  private amount(value: Prisma.Decimal | string | undefined): Prisma.Decimal {
    if (value === undefined) return new Prisma.Decimal(0);
    try {
      const d = new Prisma.Decimal(value).toDecimalPlaces(MONEY_SCALE);
      if (d.isNegative()) {
        throw new BadRequestException('Posting amounts cannot be negative');
      }
      return d;
    } catch {
      throw new BadRequestException(`Invalid posting amount: ${String(value)}`);
    }
  }
}
