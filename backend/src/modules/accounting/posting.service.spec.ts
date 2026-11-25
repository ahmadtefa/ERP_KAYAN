import { BadRequestException } from '@nestjs/common';
import { JournalStatus } from '@prisma/client';

import { PostingService } from './posting.service';

/// The guarantees every business document relies on when it writes to the
/// ledger: the entry balances, it is written once, and neither it nor its
/// reversal can land in a closed period. Each caller claims its document
/// by status first; these are the locks at the ledger door itself.
describe('PostingService guards', () => {
  const companyId = 'company-1';

  function makeService(overrides: {
    existingEntry?: { entryNumber: string } | null;
    period?: { status: string; code: string } | null;
    original?: Record<string, unknown> | null;
    cashAccounts?: Array<Record<string, unknown>>;
    balance?: string;
    ledgerRows?: Array<{ d: string; net: string }>;
  } = {}) {
    const created: Array<Record<string, unknown>> = [];
    const tx = {
      $queryRaw: jest.fn(async (sql: { strings?: readonly string[] }) => {
        // The balance probe reads journal lines as per-day aggregates; every
        // other raw statement (account locks, the cash account row lock)
        // returns no rows.
        if (sql?.strings?.some((part) => part.includes('journal_lines'))) {
          return (
            overrides.ledgerRows ?? [{ d: '2026-01-01', net: overrides.balance ?? '0' }]
          ).map((row) => ({ d: new Date(row.d), net: row.net }));
        }
        return [];
      }),
      cashAccount: {
        findMany: jest.fn(async () => overrides.cashAccounts ?? []),
      },
      account: {
        findMany: jest.fn(async () => [
          { id: 'acc-cash', code: '1101', isPostable: true, isActive: true },
          { id: 'acc-revenue', code: '4101', isPostable: true, isActive: true },
        ]),
      },
      journalEntry: {
        findFirst: jest.fn(async (args: { where: Record<string, unknown> }) => {
          // The reversal path loads by id; the posting path probes by source.
          if ('id' in args.where) return overrides.original ?? null;
          return overrides.existingEntry ?? null;
        }),
        updateMany: jest.fn(async () => ({ count: 1 })),
        create: jest.fn(async (args: { data: Record<string, unknown> }) => {
          created.push(args.data);
          return { id: 'entry-1', entryNumber: 'JV-0001' };
        }),
      },
    };
    const periods = {
      periodFor: jest.fn(async () =>
        overrides.period === undefined
          ? { status: 'OPEN', code: 'FY2026' }
          : overrides.period,
      ),
    };
    const service = new PostingService(
      { next: jest.fn(async () => 'JV-0001') } as never,
      periods as never,
      { assertPostable: jest.fn(async () => undefined) } as never,
    );
    return { service, tx: tx as never, created };
  }

  const request = {
    companyId,
    branchId: 'branch-1',
    userId: 'user-1',
    entryDate: new Date('2026-03-01'),
    description: 'Sale',
    sourceType: 'SALES_INVOICE' as const,
    sourceId: 'invoice-1',
    sourceNumber: 'SI-1',
    lines: [
      { accountId: 'acc-cash', debit: '114' },
      { accountId: 'acc-revenue', credit: '114' },
    ],
  };

  it('posts a balanced document once', async () => {
    const { service, tx, created } = makeService();
    const entry = await service.post(tx, request);
    expect(entry.entryNumber).toBe('JV-0001');
    expect(created).toHaveLength(1);
  });

  it('locks accounts in deterministic order before validating and creating a journal', async () => {
    const { service, tx } = makeService();
    await service.post(tx, request);
    const mock = tx as unknown as {
      $queryRaw: jest.Mock;
      account: {findMany: jest.Mock};
      journalEntry: {create: jest.Mock};
    };
    expect(mock.$queryRaw).toHaveBeenCalledTimes(1);
    const query = mock.$queryRaw.mock.calls[0][0] as {sql: string; values: unknown[]};
    expect(query.sql).toMatch(/ORDER BY id FOR SHARE/i);
    // The local Prisma shim can retain nested SQL fragments; native Prisma
    // flattens them. Both must bind the same ordered account IDs.
    const bound = query.values.flatMap(value =>
      typeof value === 'object' && value !== null && 'values' in value
        ? (value as {values: unknown[]}).values : [value]);
    expect(bound).toEqual([companyId, 'acc-cash', 'acc-revenue']);
    expect(mock.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mock.account.findMany.mock.invocationCallOrder[0]);
    expect(mock.account.findMany.mock.invocationCallOrder[0]).toBeLessThan(mock.journalEntry.create.mock.invocationCallOrder[0]);
  });

  it('refuses an unbalanced document before anything is written', async () => {
    const { service, tx, created } = makeService();
    await expect(
      service.post(tx, {
        ...request,
        lines: [
          { accountId: 'acc-cash', debit: '100' },
          { accountId: 'acc-revenue', credit: '90' },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(created).toHaveLength(0);
  });

  it('refuses to post the same document a second time', async () => {
    const { service, tx, created } = makeService({
      existingEntry: { entryNumber: 'JV-0007' },
    });
    await expect(service.post(tx, request)).rejects.toThrow(
      /already been posted as journal entry JV-0007/,
    );
    expect(created).toHaveLength(0);
  });

  it('refuses a posting dated inside a closed period', async () => {
    const { service, tx, created } = makeService({
      period: { status: 'CLOSED', code: 'FY2026' },
    });
    await expect(service.post(tx, request)).rejects.toThrow(/is closed/);
    expect(created).toHaveLength(0);
  });

  const original = {
    id: 'entry-0',
    branchId: 'branch-1',
    status: JournalStatus.POSTED,
    currency: 'EGP',
    totalDebit: '114',
    totalCredit: '114',
    sourceType: 'SALES_INVOICE',
    sourceId: 'invoice-1',
    sourceNumber: 'SI-1',
    lines: [
      {
        lineNumber: 1,
        accountId: 'acc-cash',
        debit: '114',
        credit: '0',
        description: null,
        costCenterId: null,
        allocations: [],
      },
      {
        lineNumber: 2,
        accountId: 'acc-revenue',
        debit: '0',
        credit: '114',
        description: null,
        costCenterId: null,
        allocations: [],
      },
    ],
  };

  it('reverses a posted entry into an open period', async () => {
    const { service, tx, created } = makeService({ original });
    const reversal = await service.reverse(
      tx,
      companyId,
      'user-1',
      'entry-0',
      'Reversal',
      new Date('2026-03-02'),
    );
    expect(reversal.entryNumber).toBe('JV-0001');
    expect(created).toHaveLength(1);
  });

  it('refuses a reversal dated inside a closed period', async () => {
    const { service, tx, created } = makeService({
      original,
      period: { status: 'CLOSED', code: 'FY2026' },
    });
    await expect(
      service.reverse(
        tx,
        companyId,
        'user-1',
        'entry-0',
        'Reversal',
        new Date('2026-03-02'),
      ),
    ).rejects.toThrow(/reversal cannot be dated/);
    expect(created).toHaveLength(0);
  });

  describe('cash balance guard', () => {
    const box = {
      id: 'box-1',
      code: 'CASH',
      nameAr: 'الخزنة',
      nameEn: 'Main cash',
      accountId: 'acc-cash',
    };
    const paymentRequest = {
      ...request,
      sourceType: 'CASH_VOUCHER' as const,
      sourceNumber: 'PV-1',
      lines: [
        { accountId: 'acc-revenue', debit: '100' },
        { accountId: 'acc-cash', credit: '100' },
      ],
    };

    it('refuses a posting that takes more out of a box than it holds, and writes nothing', async () => {
      const { service, tx, created } = makeService({ cashAccounts: [box], balance: '40' });
      const failure = await service
        .post(tx, { ...paymentRequest, discloseBalance: true })
        .catch((error) => error);
      expect(failure).toBeInstanceOf(BadRequestException);
      expect(failure.response.code).toBe('CASH_BALANCE_NEGATIVE');
      expect(failure.response.errors).toEqual({
        cashAccountCode: 'CASH',
        requested: '100.0000',
        available: '40.0000',
      });
      expect(failure.response.message).toMatch(/بالسالب/);
      expect(failure.response.message).toMatch(/can never go negative/);
      expect(created).toHaveLength(0);
    });

    it('redacts the balance figures from a user who may not read them', async () => {
      // Default path: no discloseBalance flag, as every caller outside the
      // cash and journal controllers invokes it. The refusal names the box
      // (the user picked it) but no amounts leak in either language.
      const { service, tx, created } = makeService({ cashAccounts: [box], balance: '40' });
      const failure = await service.post(tx, paymentRequest).catch((error) => error);
      expect(failure).toBeInstanceOf(BadRequestException);
      expect(failure.response.code).toBe('CASH_BALANCE_NEGATIVE');
      expect(failure.response.errors).toEqual({ cashAccountCode: 'CASH' });
      expect(failure.response.message).toMatch(/بالسالب/);
      expect(failure.response.message).not.toMatch(/40/);
      expect(failure.response.message).not.toMatch(/100/);
      expect(created).toHaveLength(0);
    });

    it('refuses a backdated payment a later-dated receipt cannot cover', async () => {
      // The only funding is dated after the payment: the total is enough,
      // the timeline is not.
      const { service, tx, created } = makeService({
        cashAccounts: [box],
        ledgerRows: [{ d: '2026-03-20', net: '100' }],
      });
      const failure = await service
        .post(tx, { ...paymentRequest, entryDate: new Date('2026-03-10') })
        .catch((error) => error);
      expect(failure.response?.code).toBe('CASH_BALANCE_NEGATIVE');
      expect(created).toHaveLength(0);
    });

    it('allows a backdated payment the box covered at every date', async () => {
      const { service, tx, created } = makeService({
        cashAccounts: [box],
        ledgerRows: [
          { d: '2026-02-05', net: '100' },
          { d: '2026-03-20', net: '100' },
        ],
      });
      const entry = await service.post(tx, {
        ...paymentRequest,
        entryDate: new Date('2026-03-10'),
      });
      expect(entry.entryNumber).toBe('JV-0001');
      expect(created).toHaveLength(1);
    });

    it('refuses a payment that only dips below zero on a later date', async () => {
      // 100 in on day one, 80 out on day three: a payment of 50 dated day
      // two fits on its own date (100) but not on day three (20).
      const { service, tx, created } = makeService({
        cashAccounts: [box],
        ledgerRows: [
          { d: '2026-03-01', net: '100' },
          { d: '2026-03-03', net: '-80' },
        ],
      });
      const failure = await service
        .post(tx, {
          ...paymentRequest,
          entryDate: new Date('2026-03-02'),
          lines: [
            { accountId: 'acc-revenue', debit: '50' },
            { accountId: 'acc-cash', credit: '50' },
          ],
        })
        .catch((error) => error);
      expect(failure.response?.code).toBe('CASH_BALANCE_NEGATIVE');
      expect(created).toHaveLength(0);
    });

    it('never blocks an outflow dated after a pre-existing dip it cannot deepen', async () => {
      // Legacy books from before the guard: -80 then +100. A payment dated
      // after the dip runs against dates that are all covered.
      const { service, tx, created } = makeService({
        cashAccounts: [box],
        ledgerRows: [
          { d: '2026-02-05', net: '-80' },
          { d: '2026-02-10', net: '100' },
        ],
      });
      const entry = await service.post(tx, {
        ...paymentRequest,
        entryDate: new Date('2026-03-01'),
        lines: [
          { accountId: 'acc-revenue', debit: '10' },
          { accountId: 'acc-cash', credit: '10' },
        ],
      });
      expect(entry.entryNumber).toBe('JV-0001');
      expect(created).toHaveLength(1);
    });

    it('refuses a backdated outflow that would deepen a pre-existing dip', async () => {
      const { service, tx, created } = makeService({
        cashAccounts: [box],
        ledgerRows: [
          { d: '2026-02-05', net: '-80' },
          { d: '2026-02-10', net: '100' },
        ],
      });
      const failure = await service
        .post(tx, {
          ...paymentRequest,
          entryDate: new Date('2026-02-03'),
          lines: [
            { accountId: 'acc-revenue', debit: '10' },
            { accountId: 'acc-cash', credit: '10' },
          ],
        })
        .catch((error) => error);
      expect(failure.response?.code).toBe('CASH_BALANCE_NEGATIVE');
      expect(created).toHaveLength(0);
    });

    it('locks the box row before reading its balance, inside the same transaction', async () => {
      const { service, tx } = makeService({ cashAccounts: [box], balance: '100' });
      await service.post(tx, paymentRequest);
      const raw = tx as unknown as { $queryRaw: jest.Mock };
      const lockCall = raw.$queryRaw.mock.calls.find(([sql]: [{ strings: readonly string[] }]) =>
        sql.strings.some((part) => part.includes('FOR UPDATE')),
      );
      const balanceCall = raw.$queryRaw.mock.calls.find(([sql]: [{ strings: readonly string[] }]) =>
        sql.strings.some((part) => part.includes('journal_lines')),
      );
      expect(lockCall).toBeDefined();
      expect(balanceCall).toBeDefined();
      expect(raw.$queryRaw.mock.invocationCallOrder[raw.$queryRaw.mock.calls.indexOf(lockCall!)])
        .toBeLessThan(raw.$queryRaw.mock.invocationCallOrder[raw.$queryRaw.mock.calls.indexOf(balanceCall!)]);
    });

    it('accepts a payment equal to the whole balance: zero is not negative', async () => {
      const { service, tx, created } = makeService({ cashAccounts: [box], balance: '100' });
      const entry = await service.post(tx, paymentRequest);
      expect(entry.entryNumber).toBe('JV-0001');
      expect(created).toHaveLength(1);
    });

    it('nets several lines on one account before comparing', async () => {
      const { service, tx, created } = makeService({ cashAccounts: [box], balance: '40' });
      // 70 out and 40 in on the same box in one entry is a net 30 out, which 40 covers.
      const entry = await service.post(tx, {
        ...paymentRequest,
        lines: [
          { accountId: 'acc-revenue', debit: '30' },
          { accountId: 'acc-cash', credit: '70' },
          { accountId: 'acc-cash', debit: '40' },
        ],
      });
      expect(entry.entryNumber).toBe('JV-0001');
      expect(created).toHaveLength(1);
    });

    it('ignores accounts no box or bank is bound to', async () => {
      const { service, tx, created } = makeService({ cashAccounts: [], balance: '0' });
      await service.post(tx, paymentRequest);
      expect(created).toHaveLength(1);
    });

    it('refuses a reversal whose mirror would overdraw the box', async () => {
      // The original put 114 into the box; only 40 of it is still there.
      const { service, tx, created } = makeService({
        original,
        cashAccounts: [box],
        balance: '40',
      });
      const failure = await service
        .reverse(tx, companyId, 'user-1', 'entry-0', 'Reversal', new Date('2026-03-02'))
        .catch((error) => error);
      expect(failure).toBeInstanceOf(BadRequestException);
      expect(failure.response.code).toBe('CASH_BALANCE_NEGATIVE');
      expect(created).toHaveLength(0);
    });

    it('lets a reversal through while the money it returns is still in the box', async () => {
      const { service, tx, created } = makeService({
        original,
        cashAccounts: [box],
        balance: '114',
      });
      const reversal = await service.reverse(
        tx,
        companyId,
        'user-1',
        'entry-0',
        'Reversal',
        new Date('2026-03-02'),
      );
      expect(reversal.entryNumber).toBe('JV-0001');
      expect(created).toHaveLength(1);
    });
  });
});
