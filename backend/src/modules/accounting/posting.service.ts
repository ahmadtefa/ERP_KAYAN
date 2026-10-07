import { BadRequestException, Injectable } from '@nestjs/common';
import { JournalStatus, Prisma } from '@prisma/client';
import { DocumentNumberService } from './document-number.service';

const MONEY_SCALE = 4;

export interface PostingLine {
  accountId: string;
  debit?: Prisma.Decimal | string;
  credit?: Prisma.Decimal | string;
  description?: string;
}

export interface PostingRequest {
  companyId: string;
  branchId: string;
  userId: string;
  entryDate: Date;
  description: string;
  lines: PostingLine[];
  /** Where the entry came from, kept for tracing an entry back to its document. */
  sourceType: 'SALES_INVOICE' | 'PURCHASE_INVOICE';
  sourceId: string;
  sourceNumber: string;
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
  constructor(private readonly numbers: DocumentNumberService) {}

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
        description: `${request.description} [${request.sourceNumber}]`,
        status: JournalStatus.POSTED,
        totalDebit,
        totalCredit,
        postedAt: new Date(),
        postedBy: request.userId,
        createdBy: request.userId,
        lines: {
          create: lines.map((l, index) => ({
            lineNumber: index + 1,
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            description: l.description,
          })),
        },
      },
      select: { id: true, entryNumber: true },
    });

    return entry;
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
