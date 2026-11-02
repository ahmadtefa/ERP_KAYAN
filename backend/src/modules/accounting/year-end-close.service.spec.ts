import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccountType, PeriodStatus, Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccountMapService } from './account-map.service';
import { PostingService } from './posting.service';
import { YearEndCloseService } from './year-end-close.service';

/**
 * Unit tests (classification A) for YearEndCloseService. Every Prisma call is
 * mocked: these pin down the service's own decisions (blocker rules, empty-year
 * handling, closing-line direction and retained-earnings side) without proving
 * anything about the database. The real PostgreSQL behaviour of the same flows
 * is exercised by scripts/pg-year-end-close.mjs (classification B).
 */
describe('YearEndCloseService', () => {
  const companyId = 'company-1';
  const userId = 'user-1';
  const periodId = 'period-1';
  const retainedId = 'account-retained';

  const openPeriod = {
    id: periodId,
    code: '2026',
    nameEn: 'FY 2026',
    nameAr: 'سنة 2026',
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    endDate: new Date('2026-12-31T00:00:00.000Z'),
    status: PeriodStatus.OPEN,
  };

  // These mimic the RAW ledger rows the service receives from $queryRaw:
  // revenue is credit-normal, so its raw debit-minus-credit balance is
  // negative; the service itself flips the sign in accountBalances().
  const revenueRow = (id: string, displayedBalance: string) => ({
    accountId: id,
    code: id === 'rev-1' ? '4101' : '4102',
    nameEn: `Revenue ${id}`,
    nameAr: 'إيراد',
    type: AccountType.REVENUE,
    balance: new Prisma.Decimal(displayedBalance).negated(),
  });

  const expenseRow = (id: string, balance: string) => ({
    accountId: id,
    code: id === 'exp-1' ? '5101' : '5102',
    nameEn: `Expense ${id}`,
    nameAr: 'مصروف',
    type: AccountType.EXPENSE,
    balance: new Prisma.Decimal(balance),
  });

  function buildService(overrides: {
    period?: any;
    balances?: any[];
    noActiveBranch?: boolean;
    txError?: Error;
  } = {}) {
    const period = 'period' in overrides ? overrides.period : openPeriod;
    const balances = overrides.balances ?? [];

    const tx = {
      fiscalPeriod: {
        update: jest.fn().mockImplementation(async ({ data }) => ({ ...period, ...data })),
      },
    };
    const prisma = {
      fiscalPeriod: {
        findFirst: jest.fn().mockResolvedValue(period),
        update: jest.fn().mockImplementation(async ({ data }) => ({ ...period, ...data })),
      },
      journalEntry: { groupBy: jest.fn().mockResolvedValue([]) },
      salesInvoice: { count: jest.fn().mockResolvedValue(0) },
      purchaseInvoice: { count: jest.fn().mockResolvedValue(0) },
      cashVoucher: { count: jest.fn().mockResolvedValue(0) },
      stockDocument: { count: jest.fn().mockResolvedValue(0) },
      openingBalance: { count: jest.fn().mockResolvedValue(0) },
      cashAccount: { findMany: jest.fn().mockResolvedValue([]) },
      fixedAsset: { findMany: jest.fn().mockResolvedValue([]) },
      branch: {
        findFirst: jest
          .fn()
          .mockResolvedValue(overrides.noActiveBranch ? null : { id: 'branch-1' }),
      },
      $queryRaw: jest.fn().mockResolvedValue(balances),
      $transaction: jest.fn().mockImplementation(async (fn: (t: unknown) => unknown) => {
        if (overrides.txError) throw overrides.txError;
        return fn(tx);
      }),
    } as unknown as PrismaService;

    const posting = {
      post: jest
        .fn()
        .mockResolvedValue({ id: 'je-1', entryNumber: 'JV-0001' }),
    } as unknown as PostingService;

    const accounts = {
      resolve: jest.fn().mockResolvedValue({ retainedEarnings: retainedId }),
    } as unknown as AccountMapService;

    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

    const service = new YearEndCloseService(prisma, posting, accounts, audit);
    return { service, prisma, posting, accounts, audit, tx };
  }

  describe('preview', () => {
    it('reports revenue, expenses and a profit result', async () => {
      const { service } = buildService({
        balances: [revenueRow('rev-1', '1000'), expenseRow('exp-1', '400')],
      });

      const result = await service.preview(companyId, periodId);

      expect(result.totals).toMatchObject({
        revenue: '1000.0000',
        expenses: '400.0000',
        result: '600.0000',
        resultLabel: 'profit',
      });
      expect(result.period.id).toBe(periodId);
      expect(result.blockers).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('labels a negative result as a loss', async () => {
      const { service } = buildService({
        balances: [revenueRow('rev-1', '300'), expenseRow('exp-1', '500')],
      });

      const result = await service.preview(companyId, periodId);

      expect(result.totals.result).toBe('-200.0000');
      expect(result.totals.resultLabel).toBe('loss');
    });
  });

  describe('close blockers', () => {
    it('refuses to close while draft journal entries exist and writes nothing', async () => {
      const { service, prisma } = buildService();
      (prisma.journalEntry.groupBy as jest.Mock).mockResolvedValue([
        { status: 'DRAFT', _count: { _all: 2 } },
      ]);

      await expect(service.close(companyId, userId, periodId)).rejects.toMatchObject({
        message: 'The year cannot be closed yet',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.fiscalPeriod.update).not.toHaveBeenCalled();
    });

    it('refuses an already closed period with the dedicated message', async () => {
      const { service, prisma } = buildService({
        period: { ...openPeriod, status: PeriodStatus.CLOSED },
      });

      await expect(service.close(companyId, userId, periodId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.close(companyId, userId, periodId)).rejects.toMatchObject({
        message: 'This period is already closed',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFound when the period does not belong to the company', async () => {
      const { service, prisma } = buildService({ period: null });

      await expect(service.close(companyId, userId, 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('empty year', () => {
    it('locks the period but posts no entry and audits close_empty', async () => {
      const { service, prisma, posting, audit } = buildService({ balances: [] });

      const result = await service.close(companyId, userId, periodId, 'no movement');

      expect(result.closingEntry).toBeNull();
      expect(result.period.isClosed).toBe(true);
      expect(result.note).toContain('no closing entry');
      expect(posting.post).not.toHaveBeenCalled();
      expect(prisma.fiscalPeriod.update).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'fiscal_year.close_empty' }),
      );
    });
  });

  describe('closing entry for a profitable year', () => {
    const balances = [
      revenueRow('rev-1', '1000'),
      revenueRow('rev-2', '250'),
      expenseRow('exp-1', '400'),
    ];

    it('zeroes revenue/expense accounts and credits retained earnings with the result', async () => {
      const { service, posting, audit } = buildService({ balances });

      const result = await service.close(companyId, userId, periodId);

      expect(posting.post).toHaveBeenCalledTimes(1);
      const request = (posting.post as jest.Mock).mock.calls[0][1];
      expect(request).toMatchObject({
        companyId,
        sourceType: 'YEAR_END_CLOSE',
        sourceId: periodId,
        sourceNumber: '2026',
      });

      const lines = request.lines as Array<{
        accountId: string;
        debit?: Prisma.Decimal;
        credit?: Prisma.Decimal;
      }>;
      // Revenue 1250 is debited away, expense 400 is credited away, profit 850
      // lands on retained earnings as a credit.
      const byAccount = new Map(lines.map((l) => [l.accountId, l]));
      expect(byAccount.get('rev-1')?.debit?.toString()).toBe('1000');
      expect(byAccount.get('rev-2')?.debit?.toString()).toBe('250');
      expect(byAccount.get('exp-1')?.credit?.toString()).toBe('400');
      const retained = byAccount.get(retainedId)!;
      expect(retained.credit?.toString()).toBe('850');
      expect(retained.debit).toBeUndefined();

      const totalDebit = lines.reduce((s, l) => s.plus(l.debit ?? 0), new Prisma.Decimal(0));
      const totalCredit = lines.reduce((s, l) => s.plus(l.credit ?? 0), new Prisma.Decimal(0));
      expect(totalDebit.equals(totalCredit)).toBe(true);

      expect(result.totals).toMatchObject({
        revenue: '1250.0000',
        expenses: '400.0000',
        result: '850.0000',
      });
      expect(result.period.status).toBe('closed');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'fiscal_year.close' }),
      );
    });

    it('rolls the whole close back when the inner transaction fails', async () => {
      const failure = new BadRequestException('Account 3102 is inactive');
      const { service, prisma, audit } = buildService({ balances, txError: failure });

      await expect(service.close(companyId, userId, periodId)).rejects.toThrow(failure);
      // No lock outside the transaction, no success audit.
      expect(prisma.fiscalPeriod.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('closing entry for a loss-making year', () => {
    it('debits retained earnings with the loss', async () => {
      const { service, posting } = buildService({
        balances: [revenueRow('rev-1', '300'), expenseRow('exp-1', '500')],
      });

      await service.close(companyId, userId, periodId);

      const request = (posting.post as jest.Mock).mock.calls[0][1];
      const retained = request.lines.find((l: any) => l.accountId === retainedId);
      expect(retained.debit.toString()).toBe('200');
      expect(retained.credit).toBeUndefined();
    });

    it('reverses the side of an abnormal debit balance on a revenue account', async () => {
      const { service, posting } = buildService({
        balances: [revenueRow('rev-1', '-100'), expenseRow('exp-1', '50')],
      });

      await service.close(companyId, userId, periodId);

      const request = (posting.post as jest.Mock).mock.calls[0][1];
      const revenueLine = request.lines.find((l: any) => l.accountId === 'rev-1');
      expect(revenueLine.credit.toString()).toBe('100');
      expect(revenueLine.debit).toBeUndefined();
    });
  });

  describe('branch requirement', () => {
    it('refuses to post a closing entry without an active branch', async () => {
      const { service, posting } = buildService({
        balances: [revenueRow('rev-1', '1000'), expenseRow('exp-1', '400')],
        noActiveBranch: true,
      });

      await expect(service.close(companyId, userId, periodId)).rejects.toMatchObject({
        message: 'This company has no active branch to post the closing entry to',
      });
      expect(posting.post).not.toHaveBeenCalled();
    });
  });
});
