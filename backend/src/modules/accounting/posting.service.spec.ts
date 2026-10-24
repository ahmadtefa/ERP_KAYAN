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
  } = {}) {
    const created: Array<Record<string, unknown>> = [];
    const tx = {
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
});
