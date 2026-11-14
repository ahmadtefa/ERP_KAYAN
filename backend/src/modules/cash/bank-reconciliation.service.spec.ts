import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BankReconciliationService } from './bank-reconciliation.service';

/**
 * Unit tests (classification A) for BankReconciliationService. The database is
 * mocked here, so these tests pin the service's arithmetic and validation only.
 * Real PostgreSQL ledger reads and transaction rollback are covered by
 * scripts/pg-bank-reconciliation.mjs (classification B).
 *
 * Design fact asserted below: reconciliation never writes journal entries — it
 * records the statement, the independently read ledger balance and the
 * difference, and links vouchers. A non-zero difference is reported, never
 * hidden or auto-posted away.
 */
describe('BankReconciliationService', () => {
  const companyId = 'company-1';
  const userId = 'user-1';
  const cashAccountId = 'cash-1';
  const accountId = 'gl-cash';

  const cashAccount = {
    id: cashAccountId,
    accountId,
    currency: 'EGP',
    kind: 'BANK',
    code: 'BANK-01',
  };

  function buildService(overrides: {
    bookBalance?: string;
    cashAccount?: any;
    vouchers?: any[];
    createError?: Error;
    lockedVouchers?: any[];
    claimCount?: number;
  } = {}) {
    const created = {
      id: 'rec-1',
      companyId,
      cashAccountId,
      statementDate: new Date('2026-09-30T00:00:00.000Z'),
      periodFrom: new Date('2026-09-01T00:00:00.000Z'),
      periodTo: new Date('2026-09-30T00:00:00.000Z'),
      statementBalance: new Prisma.Decimal(0),
      bookBalance: new Prisma.Decimal(overrides.bookBalance ?? '0'),
      difference: new Prisma.Decimal(0),
      status: 'FINAL',
      notes: null,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    };

    let lastCreated: any = null;
    const tx = {
      bankReconciliation: {
        create: jest.fn().mockImplementation(async ({ data }) => {
          if (overrides.createError) throw overrides.createError;
          lastCreated = { ...created, ...data };
          return lastCreated;
        }),
      },
      // The authoritative post-lock state. Defaults to the same rows the
      // pre-transaction check saw; races override it with lockedVouchers.
      $queryRaw: jest
        .fn()
        .mockResolvedValue(overrides.lockedVouchers ?? overrides.vouchers ?? []),
      cashVoucher: {
        updateMany: jest
          .fn()
          .mockResolvedValue({ count: overrides.claimCount ?? (overrides.vouchers?.length ?? 1) }),
      },
    };

    const prisma = {
      cashAccount: {
        findFirst: jest
          .fn()
          .mockResolvedValue('cashAccount' in overrides ? overrides.cashAccount : cashAccount),
      },
      cashVoucher: {
        findMany: jest.fn().mockResolvedValue(overrides.vouchers ?? []),
      },
      bankReconciliation: {
        // create() re-reads the row through findOne(); echo the persisted row.
        findFirst: jest.fn().mockImplementation(async () => ({
          ...(lastCreated ?? created),
          cashAccount: { code: 'BANK-01', nameEn: 'Main bank', nameAr: 'البنك الرئيسي' },
          vouchers: [],
        })),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ net: new Prisma.Decimal(overrides.bookBalance ?? '0') }]),
      $transaction: jest.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
    } as unknown as PrismaService;

    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const service = new BankReconciliationService(prisma, audit);
    return { service, prisma, tx, audit };
  }

  const dto = (extra: Record<string, unknown> = {}) => ({
    cashAccountId,
    statementDate: '2026-09-30',
    periodFrom: '2026-09-01',
    periodTo: '2026-09-30',
    statementBalance: '1000',
    ...extra,
  });

  describe('difference arithmetic (book balance minus statement balance)', () => {
    it('is balanced when ledger and statement agree', async () => {
      const { service } = buildService({ bookBalance: '1000' });

      const result = await service.create(companyId, userId, dto());

      expect(result.bookBalance).toBe('1000.0000');
      expect(result.statementBalance).toBe('1000.0000');
      expect(result.difference).toBe('0.0000');
      expect(result.isBalanced).toBe(true);
      expect(result.status).toBe('final');
    });

    it('reports a positive difference instead of hiding it', async () => {
      const { service } = buildService({ bookBalance: '1000' });

      const result = await service.create(companyId, userId, dto({ statementBalance: '900' }));

      expect(result.difference).toBe('100.0000');
      expect(result.isBalanced).toBe(false);
    });

    it('reports a negative difference as well', async () => {
      const { service } = buildService({ bookBalance: '800' });

      const result = await service.create(companyId, userId, dto({ statementBalance: '950' }));

      expect(result.difference).toBe('-150.0000');
      expect(result.isBalanced).toBe(false);
    });

    it('reads the book balance from the ledger, not from the matched vouchers', async () => {
      const { service, prisma } = buildService({ bookBalance: '1000' });

      await service.create(companyId, userId, dto());

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const sql = (prisma.$queryRaw as jest.Mock).mock.calls[0][0];
      // Prisma.sql returns a tagged Sql object; its SQL text lives on .sql.
      expect(sql.sql).toContain('journal_lines');
    });
  });

  describe('validation', () => {
    it('rejects a blank cashAccountId', async () => {
      const { service } = buildService();
      await expect(
        service.create(companyId, userId, dto({ cashAccountId: '  ' })),
      ).rejects.toMatchObject({ message: 'cashAccountId is required' });
    });

    it('rejects a cash account that does not exist in the company', async () => {
      const { service } = buildService({ cashAccount: null });
      await expect(service.create(companyId, userId, dto())).rejects.toMatchObject({
        message: 'The cash account does not exist',
      });
    });

    it('rejects a period ending before it starts', async () => {
      const { service } = buildService();
      await expect(
        service.create(
          companyId,
          userId,
          dto({ periodFrom: '2026-09-20', periodTo: '2026-09-01' }),
        ),
      ).rejects.toMatchObject({ message: 'periodTo must not be before periodFrom' });
    });

    it('rejects a malformed date and a non-numeric statement balance', async () => {
      const { service } = buildService();
      await expect(
        service.create(companyId, userId, dto({ statementDate: 'not-a-date' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create(companyId, userId, dto({ statementBalance: 'lots' })),
      ).rejects.toMatchObject({ message: 'statementBalance is not a valid amount' });
    });

    it('rejects vouchers that do not exist in this company', async () => {
      const { service, prisma } = buildService({ bookBalance: '1000' });
      (prisma.cashVoucher.findMany as jest.Mock).mockResolvedValue([{ id: 'v-1' }]);

      await expect(
        service.create(companyId, userId, dto({ voucherIds: ['v-1', 'v-2'] })),
      ).rejects.toMatchObject({
        message: 'One or more vouchers do not exist in this company',
      });
    });

    it('rejects a voucher belonging to another cash account', async () => {
      const { service, prisma } = buildService({ bookBalance: '1000' });
      (prisma.cashVoucher.findMany as jest.Mock).mockResolvedValue([
        { id: 'v-1', cashAccountId: 'other-cash', status: 'POSTED', reconciliationId: null, voucherNumber: 'PV-9' },
      ]);

      await expect(
        service.create(companyId, userId, dto({ voucherIds: ['v-1'] })),
      ).rejects.toMatchObject({ message: expect.stringContaining('belongs to another cash account') });
    });

    it('rejects a voucher that is not posted', async () => {
      const { service, prisma } = buildService({ bookBalance: '1000' });
      (prisma.cashVoucher.findMany as jest.Mock).mockResolvedValue([
        { id: 'v-1', cashAccountId, status: 'DRAFT', reconciliationId: null, voucherNumber: 'PV-9' },
      ]);

      await expect(
        service.create(companyId, userId, dto({ voucherIds: ['v-1'] })),
      ).rejects.toMatchObject({ message: expect.stringContaining('is not posted') });
    });

    it('rejects a voucher already matched to another reconciliation', async () => {
      const { service, prisma } = buildService({ bookBalance: '1000' });
      (prisma.cashVoucher.findMany as jest.Mock).mockResolvedValue([
        { id: 'v-1', cashAccountId, status: 'POSTED', reconciliationId: 'rec-old', voucherNumber: 'PV-9' },
      ]);

      await expect(
        service.create(companyId, userId, dto({ voucherIds: ['v-1'] })),
      ).rejects.toMatchObject({ message: expect.stringContaining('already matched') });
    });
  });

  describe('persistence and audit', () => {
    it('stores DRAFT when finalise is false and links vouchers inside the transaction', async () => {
      const { service, tx, audit } = buildService({
        bookBalance: '1000',
        vouchers: [
          { id: 'v-1', cashAccountId, status: 'POSTED', reconciliationId: null, voucherNumber: 'PV-9' },
        ],
      });

      await service.create(companyId, userId, dto({ finalise: false, voucherIds: ['v-1'] }));

      expect(tx.bankReconciliation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'DRAFT', cashAccountId }),
        }),
      );
      expect(tx.cashVoucher.updateMany).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RECONCILE', entity: 'bank_reconciliations' }),
      );
    });

    it('never creates journal entries: only the reconciliation row and voucher links', async () => {
      const { service, tx, prisma } = buildService({ bookBalance: '1000' });

      await service.create(companyId, userId, dto());

      expect(tx.bankReconciliation.create).toHaveBeenCalledTimes(1);
      expect((prisma as any).journalEntry).toBeUndefined();
      expect(tx.cashVoucher.updateMany).not.toHaveBeenCalled();
    });

    it('stops before the audit when the transaction fails (rollback path)', async () => {
      const failure = new Error('statement balance check violation');
      const { service, audit } = buildService({ bookBalance: '1000', createError: failure });

      await expect(service.create(companyId, userId, dto())).rejects.toThrow(failure);
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('transactional voucher claim (R9 race guard)', () => {
    const validVoucher = {
      id: 'v-1',
      cashAccountId,
      status: 'POSTED',
      reconciliationId: null,
      voucherNumber: 'PV-9',
    };

    it('locks the voucher rows inside the transaction with FOR UPDATE', async () => {
      const { service, tx } = buildService({ bookBalance: '1000', vouchers: [validVoucher] });

      await service.create(companyId, userId, dto({ voucherIds: ['v-1'] }));

      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      const sql = tx.$queryRaw.mock.calls[0][0];
      expect(sql.sql).toContain('FOR UPDATE');
      expect(sql.sql).toContain('cash_vouchers');
    });

    it('re-validates the locked rows: a voucher claimed between the two checks is rejected', async () => {
      const claimedOnLock = [{ ...validVoucher, reconciliationId: 'rec-race' }];
      const { service, tx } = buildService({
        bookBalance: '1000',
        vouchers: [validVoucher],
        lockedVouchers: claimedOnLock,
      });

      await expect(
        service.create(companyId, userId, dto({ voucherIds: ['v-1'] })),
      ).rejects.toMatchObject({ message: expect.stringContaining('already matched') });
      expect(tx.bankReconciliation.create).not.toHaveBeenCalled();
    });

    it('rolls back when the conditional claim touches fewer rows than were locked', async () => {
      const { service, tx, audit } = buildService({
        bookBalance: '1000',
        vouchers: [validVoucher],
        lockedVouchers: [validVoucher],
        claimCount: 0, // another transaction won the row between lock and update
      });

      await expect(
        service.create(companyId, userId, dto({ voucherIds: ['v-1'] })),
      ).rejects.toMatchObject({
        message: expect.stringContaining('already matched by another reconciliation'),
      });
      // The update itself only claims still-unclaimed rows.
      const updateWhere = tx.cashVoucher.updateMany.mock.calls[0][0].where;
      expect(updateWhere).toMatchObject({ reconciliationId: null });
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('reads', () => {
    it('throws NotFound for an unknown reconciliation', async () => {
      const { service, prisma } = buildService();
      (prisma.bankReconciliation.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne(companyId, 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('lists only posted, unlinked vouchers up to the cutoff date', async () => {
      const { service, prisma } = buildService();
      (prisma.cashVoucher.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'v-1',
          voucherNumber: 'RC-1',
          voucherDate: new Date('2026-09-10T00:00:00.000Z'),
          amount: new Prisma.Decimal('250.5'),
          kind: 'RECEIPT',
          description: 'Customer payment',
          reference: null,
        },
      ]);

      const result = await service.unmatched(companyId, cashAccountId, '2026-09-30');

      const where = (prisma.cashVoucher.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where).toMatchObject({
        companyId,
        cashAccountId,
        status: 'POSTED',
        reconciliationId: null,
      });
      expect(result.items[0]).toMatchObject({
        voucherNumber: 'RC-1',
        amount: '250.5000',
      });
      expect(result.items[0]).not.toHaveProperty('reconciled');
    });
  });
});
