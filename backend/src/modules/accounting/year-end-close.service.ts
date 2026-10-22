import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountType, JournalStatus, PeriodStatus, Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccountMapService } from './account-map.service';
import { PostingService } from './posting.service';

const MONEY_SCALE = 4;

/**
 * Closing a year.
 *
 * Closing is two things that a reader expects to be one:
 *
 *  1. the profit or loss of the year is moved out of the revenue and expense
 *     accounts into retained earnings, so the new year starts with revenue and
 *     expenses at zero while the balance sheet carries the result forward;
 *  2. the year is locked, so nothing can be posted into it again.
 *
 * The closing entry is a normal journal entry with its own number. It is not
 * an adjustment to any document, and it can be reversed like anything else if
 * a company closes a year too early - by an administrator, with a reason, and
 * with the reversal visible in the ledger.
 */
@Injectable()
export class YearEndCloseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
    private readonly accounts: AccountMapService,
    private readonly audit: AuditService,
  ) {}

  /** What closing this period would do, without doing any of it. */
  async preview(companyId: string, periodId: string) {
    const period = await this.requirePeriod(companyId, periodId);
    const balances = await this.accountBalances(companyId, period.startDate, period.endDate);

    const revenue = balances.filter((row) => row.type === AccountType.REVENUE);
    const expenses = balances.filter((row) => row.type === AccountType.EXPENSE);
    const totalRevenue = revenue.reduce((sum, row) => sum.plus(row.balance), new Prisma.Decimal(0));
    const totalExpenses = expenses.reduce((sum, row) => sum.plus(row.balance), new Prisma.Decimal(0));
    const result = totalRevenue.minus(totalExpenses);

    return {
      period: this.periodResponse(period),
      revenue: revenue.map((row) => this.balanceResponse(row)),
      expenses: expenses.map((row) => this.balanceResponse(row)),
      totals: {
        revenue: totalRevenue.toFixed(MONEY_SCALE),
        expenses: totalExpenses.toFixed(MONEY_SCALE),
        result: result.toFixed(MONEY_SCALE),
        resultLabel: result.isNegative() ? 'loss' : 'profit',
      },
      blockers: await this.blockers(companyId, period),
      warnings: await this.warnings(companyId, period),
    };
  }

  /**
   * Closes the year: posts the closing entry and locks the period.
   *
   * Anything that is still only a draft inside the period blocks the close,
   * because a draft that can never be posted would leave figures that can
   * never be corrected inside a locked year.
   */
  async close(companyId: string, userId: string, periodId: string, reason?: string) {
    const period = await this.requirePeriod(companyId, periodId);

    const blockers = await this.blockers(companyId, period);
    if (blockers.length > 0) {
      throw new BadRequestException({
        message: 'The year cannot be closed yet',
        errors: { blockers },
      });
    }

    if (period.status === PeriodStatus.CLOSED) {
      throw new BadRequestException('This period is already closed');
    }

    const balances = await this.accountBalances(companyId, period.startDate, period.endDate);
    const revenue = balances.filter((row) => row.type === AccountType.REVENUE);
    const expenses = balances.filter((row) => row.type === AccountType.EXPENSE);

    const totalRevenue = revenue.reduce((sum, row) => sum.plus(row.balance), new Prisma.Decimal(0));
    const totalExpenses = expenses.reduce((sum, row) => sum.plus(row.balance), new Prisma.Decimal(0));
    const result = totalRevenue.minus(totalExpenses);

    if (revenue.length === 0 && expenses.length === 0) {
      // Nothing to close. Locking the year is still meaningful, so it is done,
      // but no empty entry is written: a ledger should not gain a document
      // that says nothing.
      const closed = await this.lock(companyId, userId, period.id);
      await this.audit.record({
        companyId,
        userId,
        action: 'fiscal_year.close_empty',
        entity: 'fiscal_periods',
        entityId: period.id,
        after: { code: period.code, reason: reason ?? null },
      });
      return {
        period: this.periodResponse(closed),
        closingEntry: null,
        totals: { revenue: '0.0000', expenses: '0.0000', result: '0.0000' },
        note: 'There was no revenue or expense in this period, so no closing entry was needed.',
      };
    }

    // The branch the closing entry belongs to: the one that holds the
    // company's accounting. Manual entries need a branch, and the closing
    // entry is a manual entry in every respect except who wrote it.
    const branch = await this.prisma.branch.findFirst({
      where: { companyId, deletedAt: null, isActive: true },
      orderBy: [{ kind: 'asc' }, { code: 'asc' }],
      select: { id: true },
    });
    if (!branch) {
      throw new BadRequestException('This company has no active branch to post the closing entry to');
    }

    const lines: Array<{
      accountId: string;
      debit?: Prisma.Decimal;
      credit?: Prisma.Decimal;
      description: string;
    }> = [];

    // Revenue accounts carry credit balances: they are debited to zero them.
    for (const row of revenue) {
      if (row.balance.isZero()) continue;
      lines.push(
        row.balance.greaterThan(0)
          ? { accountId: row.accountId, debit: row.balance, description: 'Closing revenue' }
          : { accountId: row.accountId, credit: row.balance.negated(), description: 'Closing revenue' },
      );
    }
    // Expenses carry debit balances: they are credited to zero them.
    for (const row of expenses) {
      if (row.balance.isZero()) continue;
      lines.push(
        row.balance.greaterThan(0)
          ? { accountId: row.accountId, credit: row.balance, description: 'Closing expense' }
          : { accountId: row.accountId, debit: row.balance.negated(), description: 'Closing expense' },
      );
    }

    const result2 = await this.prisma.$transaction(async (tx) => {
      const accounts = await this.accounts.resolve(tx, companyId, ['retainedEarnings']);
      // The other side: profit is a credit to retained earnings, a loss a debit.
      if (!result.isZero()) {
        lines.push(
          result.greaterThan(0)
            ? {
                accountId: accounts.retainedEarnings,
                credit: result,
                description: 'Result of the year transferred to retained earnings',
              }
            : {
                accountId: accounts.retainedEarnings,
                debit: result.negated(),
                description: 'Loss of the year transferred to retained earnings',
              },
        );
      }

      const journal = await this.posting.post(tx, {
        companyId,
        branchId: branch.id,
        userId,
        entryDate: period.endDate,
        description: `Closing entry for ${period.code}`,
        sourceType: 'YEAR_END_CLOSE',
        sourceId: period.id,
        sourceNumber: period.code,
        entryDescription: reason
          ? `Closing entry for ${period.code} — ${reason}`
          : `Closing entry for ${period.code}`,
        lines,
      });

      const closed = await tx.fiscalPeriod.update({
        where: { id: period.id },
        data: {
          status: PeriodStatus.CLOSED,
          closedAt: new Date(),
          closedBy: userId,
        },
      });

      return { journal, closed };
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'fiscal_year.close',
      entity: 'fiscal_periods',
      entityId: period.id,
      after: {
        code: period.code,
        closingEntry: result2.journal.entryNumber,
        result: result.toFixed(MONEY_SCALE),
        reason: reason ?? null,
      },
    });

    return {
      period: this.periodResponse(result2.closed),
      closingEntry: result2.journal,
      totals: {
        revenue: totalRevenue.toFixed(MONEY_SCALE),
        expenses: totalExpenses.toFixed(MONEY_SCALE),
        result: result.toFixed(MONEY_SCALE),
        resultLabel: result.isNegative() ? 'loss' : 'profit',
      },
    };
  }

  /** Locks a period without writing a closing entry. */
  private async lock(companyId: string, userId: string, periodId: string) {
    const period = await this.prisma.fiscalPeriod.findFirst({
      where: { id: periodId, companyId },
    });
    if (!period) throw new NotFoundException('Fiscal period not found');
    return this.prisma.fiscalPeriod.update({
      where: { id: periodId },
      data: { status: PeriodStatus.CLOSED, closedAt: new Date(), closedBy: userId },
    });
  }

  private async requirePeriod(companyId: string, periodId: string) {
    const period = await this.prisma.fiscalPeriod.findFirst({
      where: { id: periodId, companyId },
    });
    if (!period) throw new NotFoundException('Fiscal period not found');
    return period;
  }

  /** Everything that would make closing this year a mistake. */
  private async blockers(
    companyId: string,
    period: { id: string; startDate: Date; endDate: Date },
  ): Promise<string[]> {
    const blockers: string[] = [];

    const notPosted = await this.prisma.journalEntry.groupBy({
      by: ['status'],
      where: {
        companyId,
        status: { in: [JournalStatus.DRAFT, JournalStatus.PENDING_APPROVAL, JournalStatus.APPROVED] },
        entryDate: { gte: period.startDate, lte: period.endDate },
      },
      _count: { _all: true },
    });
    for (const row of notPosted) {
      blockers.push(`${row._count._all} journal entr(ies) with status ${row.status} fall inside this period`);
    }

    const draftInvoices = await this.prisma.salesInvoice.count({
      where: {
        companyId,
        deletedAt: null,
        status: { in: ['DRAFT'] },
        invoiceDate: { gte: period.startDate, lte: period.endDate },
      },
    });
    if (draftInvoices > 0) {
      blockers.push(`${draftInvoices} draft sales invoice(s) fall inside this period`);
    }

    const draftPurchases = await this.prisma.purchaseInvoice.count({
      where: {
        companyId,
        deletedAt: null,
        status: { in: ['DRAFT'] },
        invoiceDate: { gte: period.startDate, lte: period.endDate },
      },
    });
    if (draftPurchases > 0) {
      blockers.push(`${draftPurchases} draft purchase invoice(s) fall inside this period`);
    }

    const draftVouchers = await this.prisma.cashVoucher.count({
      where: {
        companyId,
        deletedAt: null,
        status: 'DRAFT',
        voucherDate: { gte: period.startDate, lte: period.endDate },
      },
    });
    if (draftVouchers > 0) {
      blockers.push(`${draftVouchers} draft cash voucher(s) fall inside this period`);
    }

    const draftStock = await this.prisma.stockDocument.count({
      where: {
        companyId,
        deletedAt: null,
        status: 'DRAFT',
        documentDate: { gte: period.startDate, lte: period.endDate },
      },
    });
    if (draftStock > 0) {
      blockers.push(`${draftStock} draft stock document(s) fall inside this period`);
    }

    const draftOpening = await this.prisma.openingBalance.count({
      where: {
        companyId,
        deletedAt: null,
        status: 'DRAFT',
        asOfDate: { gte: period.startDate, lte: period.endDate },
      },
    });
    if (draftOpening > 0) {
      blockers.push(`${draftOpening} draft opening balance(s) fall inside this period`);
    }

    return blockers;
  }

  /**
   * Things an accountant should look at before closing, which do not by
   * themselves make the close wrong: closing stays possible, informed.
   * Kept separate from blockers on purpose — a warning that blocks is a
   * blocker that lies about its name.
   */
  private async warnings(
    companyId: string,
    period: { id: string; startDate: Date; endDate: Date },
  ): Promise<string[]> {
    const warnings: string[] = [];

    // Cash-flow classification still undecided for accounts that moved
    // cash in this period: they will sit in "unclassified" on the
    // statement until the accountant decides. Worth knowing before the
    // year is locked, not worth blocking for.
    const cashAccounts = await this.prisma.cashAccount.findMany({
      where: { companyId, deletedAt: null },
      select: { accountId: true },
    });
    const cashIds = cashAccounts.map((row) => row.accountId);
    if (cashIds.length > 0) {
      const unclassified = await this.prisma.$queryRaw<
        Array<{ code: string; nameEn: string }>
      >(Prisma.sql`
        SELECT DISTINCT a.code, a."nameEn"
          FROM journal_entries e
          JOIN journal_lines cl
            ON cl."journalEntryId" = e.id
           AND cl."accountId" IN (${Prisma.join(cashIds.map((id) => Prisma.sql`${id}::uuid`))})
          JOIN journal_lines l
            ON l."journalEntryId" = e.id
           AND l."accountId" NOT IN (${Prisma.join(cashIds.map((id) => Prisma.sql`${id}::uuid`))})
          JOIN accounts a ON a.id = l."accountId"
         WHERE e."companyId" = ${companyId}::uuid
           AND e.status IN ('POSTED', 'REVERSED')
           AND e."entryDate" >= ${period.startDate}::date
           AND e."entryDate" <= ${period.endDate}::date
           AND a."cashFlowClass" IS NULL
         ORDER BY a.code
      `);
      if (unclassified.length > 0) {
        warnings.push(
          `${unclassified.length} account(s) with cash movements have no cash-flow classification ` +
            `(${unclassified.slice(0, 3).map((a) => a.code).join(', ')}${unclassified.length > 3 ? ', …' : ''}); ` +
            'they will appear as "unclassified" on the cash-flow statement',
        );
      }
    }

    // Assets still depreciating that were not charged in the final
    // month of the period: closing now understates the year's expense.
    const lastMonth = period.endDate.toISOString().slice(0, 7);
    const activeAssets = await this.prisma.fixedAsset.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: 'ACTIVE',
        inServiceDate: { lte: period.endDate },
      },
      select: { id: true, code: true, cost: true, salvageValue: true },
    });
    if (activeAssets.length > 0) {
      const [chargedLastMonth, accumulatedRows] = await Promise.all([
        this.prisma.assetDepreciation.findMany({
          where: {
            companyId,
            periodKey: lastMonth,
            assetId: { in: activeAssets.map((a) => a.id) },
          },
          select: { assetId: true },
        }),
        this.prisma.assetDepreciation.groupBy({
          by: ['assetId'],
          where: { companyId, assetId: { in: activeAssets.map((a) => a.id) } },
          _sum: { amount: true },
        }),
      ]);
      const charged = new Set(chargedLastMonth.map((r) => r.assetId));
      const accumulatedBy = new Map(
        accumulatedRows.map((r) => [r.assetId, new Prisma.Decimal(r._sum.amount ?? 0)]),
      );
      const missing = activeAssets.filter(
        (asset) =>
          !charged.has(asset.id) &&
          (accumulatedBy.get(asset.id) ?? new Prisma.Decimal(0)).lessThan(
            asset.cost.minus(asset.salvageValue),
          ),
      );
      if (missing.length > 0) {
        warnings.push(
          `${missing.length} active asset(s) have no depreciation charge for ${lastMonth} ` +
            `(${missing.slice(0, 3).map((a) => a.code).join(', ')}${missing.length > 3 ? ', …' : ''}); ` +
            'run depreciation for the final month or close knowing the expense is understated',
        );
      }
    }

    return warnings;
  }

  /** Money in each revenue and expense account over the period, by account type. */
  private async accountBalances(companyId: string, from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<
      Array<{ accountId: string; code: string; nameEn: string; nameAr: string; type: AccountType; balance: Prisma.Decimal }>
    >(Prisma.sql`
      SELECT a.id                                  AS "accountId",
             a.code                                AS code,
             a."nameEn"                            AS "nameEn",
             a."nameAr"                            AS "nameAr",
             a.type                                AS type,
             COALESCE(SUM(l.debit - l.credit), 0)  AS balance
        FROM accounts a
        JOIN journal_lines l ON l."accountId" = a.id
        JOIN journal_entries e ON e.id = l."journalEntryId"
       WHERE a."companyId" = ${companyId}::uuid
         AND a."deletedAt" IS NULL
         AND a.type IN ('REVENUE', 'EXPENSE')
         AND e.status IN ('POSTED', 'REVERSED')
         AND e."entryDate" >= ${from}::date
         AND e."entryDate" <= ${to}::date
       GROUP BY a.id, a.code, a."nameEn", a."nameAr", a.type
       ORDER BY a.code ASC
    `);

    return rows.map((row) => ({
      accountId: row.accountId,
      code: row.code,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      type: row.type,
      // Revenue balances are naturally negative (credit) in a debit-minus-credit
      // ledger, so they are flipped here to read the way an accountant says them.
      balance:
        row.type === AccountType.REVENUE
          ? new Prisma.Decimal(row.balance).negated()
          : new Prisma.Decimal(row.balance),
    }));
  }

  private balanceResponse(row: {
    accountId: string;
    code: string;
    nameEn: string;
    nameAr: string;
    balance: Prisma.Decimal;
  }) {
    return {
      accountId: row.accountId,
      code: row.code,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      balance: row.balance.toFixed(MONEY_SCALE),
    };
  }

  private periodResponse(period: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
    startDate: Date;
    endDate: Date;
    status: PeriodStatus;
  }) {
    return {
      id: period.id,
      code: period.code,
      nameEn: period.nameEn,
      nameAr: period.nameAr,
      startDate: period.startDate.toISOString().slice(0, 10),
      endDate: period.endDate.toISOString().slice(0, 10),
      status: period.status.toLowerCase(),
      isClosed: period.status === PeriodStatus.CLOSED,
    };
  }
}
