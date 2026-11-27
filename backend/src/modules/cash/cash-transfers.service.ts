import { branchWhere } from '../../common/auth/branch-read-scope';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { PostingService } from '../accounting/posting.service';

const MONEY_SCALE = 4;

/**
 * Money moved between the company's own boxes and banks.
 *
 * It is a voucher with no partner: the same amount leaves one account and
 * arrives in another, and the two lines are the whole entry. A transfer from
 * an account to itself is refused, because that is not a movement, it is a
 * mistake.
 */
@Injectable()
export class CashTransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: DocumentNumberService,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
  ) {}

  async findAll(
    companyId: string,
    query: { cashAccountId?: string; from?: string; to?: string; page?: number; pageSize?: number } = {},
    branchScope: string[] | null = null,
  ) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);

    const where: Prisma.CashTransferWhereInput = { companyId, deletedAt: null, ...branchWhere(branchScope) };
    if (query.cashAccountId) {
      where.OR = [
        { fromCashAccountId: query.cashAccountId },
        { toCashAccountId: query.cashAccountId },
      ];
    }
    if (query.from || query.to) {
      where.transferDate = {};
      if (query.from) (where.transferDate as Prisma.DateTimeFilter).gte = new Date(query.from);
      if (query.to) (where.transferDate as Prisma.DateTimeFilter).lte = new Date(query.to);
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.cashTransfer.findMany({
        where,
        orderBy: [{ transferDate: 'desc' }, { transferNumber: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          fromCashAccount: { select: { code: true, nameEn: true, nameAr: true } },
          toCashAccount: { select: { code: true, nameEn: true, nameAr: true } },
        },
      }),
      this.prisma.cashTransfer.count({ where }),
    ]);

    return { items: items.map((row) => this.toResponse(row)), total, page, pageSize };
  }

  async findOne(companyId: string, id: string, branchScope: string[] | null = null) {
    const transfer = await this.prisma.cashTransfer.findFirst({
      where: { id, companyId, deletedAt: null, ...branchWhere(branchScope) },
      include: {
        fromCashAccount: { select: { code: true, nameEn: true, nameAr: true } },
        toCashAccount: { select: { code: true, nameEn: true, nameAr: true } },
      },
    });
    if (!transfer) throw new NotFoundException({ code: 'TRANSFER_NOT_FOUND', message: 'Transfer not found' });
    return this.toResponse(transfer);
  }

  async create(
    companyId: string,
    branchId: string | null,
    userId: string,
    dto: {
      fromCashAccountId: string;
      toCashAccountId: string;
      transferDate: string;
      amount: string | number;
      description?: string;
    },
    options: { discloseBalance?: boolean } = {},
  ) {
    if (!branchId) {
      throw new BadRequestException({ code: 'USER_NO_BRANCH', message: 'The signed-in user is not assigned to a branch' });
    }
    if (dto.fromCashAccountId === dto.toCashAccountId) {
      throw new BadRequestException('A transfer needs two different accounts');
    }

    const amount = this.positive(dto.amount);
    const from = await this.requireAccount(companyId, dto.fromCashAccountId, 'from');
    const to = await this.requireAccount(companyId, dto.toCashAccountId, 'to');
    if (from.currency !== to.currency) {
      throw new BadRequestException(
        `The two accounts use different currencies (${from.currency} and ${to.currency}). ` +
          'A transfer between currencies needs an exchange rate and is not supported yet.',
      );
    }
    const date = this.date(dto.transferDate);

    // A transfer the source box cannot cover is refused at save, like a
    // payment voucher; posting re-checks under a row lock. The check is
    // against the lowest running balance from the transfer's date onward.
    // Balance figures leave only for a user confirmed to may read them.
    const available = await this.posting.lowestCashBalanceFrom(
      this.prisma as never,
      companyId,
      from.accountId,
      date,
    );
    if (amount.greaterThan(available)) {
      if (options.discloseBalance) {
        throw new BadRequestException({
          code: 'CASH_SAVE_BALANCE_SHORT',
          message:
            `لم يُحفظ التحويل: أدنى رصيد تصل إليه «${from.nameAr}» (${from.code}) من تاريخ التحويل فصاعدًا هو ${available.toFixed(MONEY_SCALE)} والمبلغ المطلوب ${amount.toFixed(MONEY_SCALE)}. ` +
            `قلّل المبلغ إلى الرصيد المتاح أو موّل الحساب بتاريخ لا يتأخر عن التحويل. لم يُنشأ أي تحويل. / ` +
            `The transfer was not saved: "${from.nameEn}" (${from.code}) runs as low as ${available.toFixed(MONEY_SCALE)} from the transfer's date onward and the transfer is ${amount.toFixed(MONEY_SCALE)}. ` +
            `Lower the amount to the available balance or fund the account with an entry dated no later than the transfer. No transfer was created.`,
          errors: {
            cashAccountCode: from.code,
            requested: amount.toFixed(MONEY_SCALE),
            available: available.toFixed(MONEY_SCALE),
          },
        });
      }
      throw new BadRequestException({
        code: 'CASH_SAVE_BALANCE_SHORT',
        message:
          `لم يُحفظ التحويل: رصيد (${from.code}) لا يكفي لهذا المبلغ في تاريخ التحويل. ` +
          `قلّل المبلغ أو موّل الحساب أولًا. لم يُنشأ أي تحويل. / ` +
          `The transfer was not saved: (${from.code}) cannot cover this amount at the transfer's date. ` +
          `Lower the amount or fund the account first. No transfer was created.`,
        errors: { cashAccountCode: from.code },
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const transferNumber = await this.numbers.next(tx, companyId, 'CASH_TRANSFER', 'TR');
      return tx.cashTransfer.create({
        data: {
          companyId,
          branchId,
          transferNumber,
          transferDate: date,
          fromCashAccountId: from.id,
          toCashAccountId: to.id,
          amount,
          currency: from.currency,
          description: dto.description?.trim() || null,
          status: InvoiceStatus.DRAFT,
          createdBy: userId,
        },
      });
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'cash_transfers',
      entityId: created.id,
      after: { transferNumber: created.transferNumber, amount: amount.toFixed(MONEY_SCALE) },
    });

    return this.findOne(companyId, created.id);
  }

  async post(
    companyId: string,
    userId: string,
    id: string,
    options: { discloseBalance?: boolean } = {},
  ) {
    const transfer = await this.prisma.cashTransfer.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        fromCashAccount: { select: { accountId: true, isActive: true, code: true } },
        toCashAccount: { select: { accountId: true, isActive: true, code: true } },
      },
    });
    if (!transfer) throw new NotFoundException({ code: 'TRANSFER_NOT_FOUND', message: 'Transfer not found' });
    if (transfer.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException(
        `Only a draft transfer can be posted (current status: ${transfer.status})`,
      );
    }

    const journal = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.cashTransfer.updateMany({
        where: { id: transfer.id, status: InvoiceStatus.DRAFT, deletedAt: null },
        data: { status: InvoiceStatus.POSTED, postedAt: new Date(), postedBy: userId },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('This transfer has just been posted by someone else.');
      }

      const entry = await this.posting.post(tx, {
        companyId,
        branchId: transfer.branchId,
        userId,
        entryDate: transfer.transferDate,
        description: transfer.description ?? 'Transfer between cash accounts',
        sourceType: 'CASH_TRANSFER',
        sourceId: transfer.id,
        sourceNumber: transfer.transferNumber,
        currency: transfer.currency,
        lines: [
          {
            accountId: transfer.toCashAccount.accountId,
            debit: transfer.amount,
            description: `Transfer from ${transfer.fromCashAccount.code}`,
          },
          {
            accountId: transfer.fromCashAccount.accountId,
            credit: transfer.amount,
            description: `Transfer to ${transfer.toCashAccount.code}`,
          },
        ],
        discloseBalance: options.discloseBalance,
      });

      await tx.cashTransfer.update({
        where: { id: transfer.id },
        data: { journalEntryId: entry.id },
      });

      return entry;
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'POST',
      entity: 'cash_transfers',
      entityId: id,
      after: { journalNumber: journal.entryNumber, amount: transfer.amount.toFixed(MONEY_SCALE) },
    });

    return this.findOne(companyId, id);
  }

  async reverse(
    companyId: string,
    userId: string,
    id: string,
    options: { discloseBalance?: boolean } = {},
  ) {
    const transfer = await this.prisma.cashTransfer.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!transfer) throw new NotFoundException({ code: 'TRANSFER_NOT_FOUND', message: 'Transfer not found' });
    if (transfer.status !== InvoiceStatus.POSTED || !transfer.journalEntryId) {
      throw new BadRequestException('Only a posted transfer can be reversed');
    }

    const journal = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.cashTransfer.updateMany({
        where: { id, status: InvoiceStatus.POSTED },
        data: { status: InvoiceStatus.REVERSED },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('This transfer has just been changed by someone else.');
      }
      return this.posting.reverse(
        tx,
        companyId,
        userId,
        transfer.journalEntryId as string,
        `Reversal of transfer ${transfer.transferNumber}`,
        new Date(),
        options.discloseBalance,
      );
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'REVERSE',
      entity: 'cash_transfers',
      entityId: id,
      after: { reversalJournalNumber: journal.entryNumber },
    });

    return this.findOne(companyId, id);
  }

  private async requireAccount(companyId: string, id: string, side: string) {
    // An absent id would be read by Prisma as "the first account", turning a
    // malformed transfer into a movement of money between two boxes the user
    // never chose.
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new BadRequestException(`The ${side} cash account is required`);
    }
    const cashAccount = await this.prisma.cashAccount.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true, accountId: true, currency: true, isActive: true, code: true, nameAr: true, nameEn: true },
    });
    if (!cashAccount) throw new BadRequestException(`The ${side} cash account does not exist`);
    if (!cashAccount.isActive) throw new BadRequestException(`The ${side} cash account is inactive`);
    return cashAccount;
  }

  private positive(value: unknown): Prisma.Decimal {
    let decimal: Prisma.Decimal;
    try {
      decimal = new Prisma.Decimal(String(value)).toDecimalPlaces(MONEY_SCALE);
    } catch {
      throw new BadRequestException('amount is not a valid amount');
    }
    if (decimal.lessThanOrEqualTo(0)) {
      throw new BadRequestException('amount must be greater than zero');
    }
    return decimal;
  }

  private date(value: string): Date {
    const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException('transferDate is not a valid date');
    return parsed;
  }

  private toResponse(transfer: {
    id: string;
    transferNumber: string;
    transferDate: Date;
    amount: Prisma.Decimal;
    currency: string;
    description: string | null;
    status: InvoiceStatus;
    journalEntryId: string | null;
    createdAt: Date;
    fromCashAccount?: { code: string; nameEn: string; nameAr: string };
    toCashAccount?: { code: string; nameEn: string; nameAr: string };
  }) {
    return {
      id: transfer.id,
      transferNumber: transfer.transferNumber,
      transferDate: transfer.transferDate.toISOString().slice(0, 10),
      amount: transfer.amount.toFixed(MONEY_SCALE),
      currency: transfer.currency,
      description: transfer.description,
      status: transfer.status.toLowerCase(),
      fromCashAccount: transfer.fromCashAccount,
      toCashAccount: transfer.toCashAccount,
      journalEntryId: transfer.journalEntryId,
      createdAt: transfer.createdAt.toISOString(),
    };
  }
}
