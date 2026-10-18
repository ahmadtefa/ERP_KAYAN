import { BadRequestException } from '@nestjs/common';
import { ReportsService } from './reports.service';

describe('ReportsService date validation', () => {
  const service = new ReportsService({} as any);

  it('accepts a valid date-only value', () => {
    const parsed = (service as any).parseDate('2026-02-28', 'from') as Date;
    expect(parsed.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('rejects an impossible calendar date', () => {
    expect(() => (service as any).parseDate('2026-02-31', 'from')).toThrow(
      BadRequestException,
    );
  });

  it('rejects an impossible date inside an ISO timestamp', () => {
    expect(() =>
      (service as any).parseDate('2026-02-31T00:00:00Z', 'asOf'),
    ).toThrow(BadRequestException);
  });

  it('accepts a valid ISO timestamp', () => {
    const parsed = (service as any).parseDate('2026-02-28T12:30:00Z', 'asOf') as Date;
    expect(parsed.toISOString()).toBe('2026-02-28T12:30:00.000Z');
  });

  it('rejects an unparseable date', () => {
    expect(() => (service as any).parseDate('not-a-date', 'asOf')).toThrow(
      BadRequestException,
    );
  });

  it('rejects a period whose start is after its end', () => {
    expect(() =>
      (service as any).period({ from: '2026-10-02', to: '2026-10-01' }),
    ).toThrow(BadRequestException);
  });
});

describe('account ledger manual journal navigation', () => {
  it('links a source-less movement to its own journal entry instead of a null document', async () => {
    const d = (value: number) => new (require('@prisma/client').Prisma.Decimal)(value);
    const prisma = {
      account: { findFirst: jest.fn().mockResolvedValue({ id: 'account' }) },
      $queryRaw: jest.fn().mockResolvedValue([{ net: d(0) }]),
      journalLine: { findMany: jest.fn().mockResolvedValue([{
        journalEntryId: 'journal', debit: d(100), credit: d(0), description: null,
        entry: { entryNumber: 'JV-1', entryDate: new Date('2026-10-18'), description: 'Manual', sourceType: null, sourceId: null, sourceNumber: null, reversalOfId: null },
      }]) },
    };
    const result = await new ReportsService(prisma as any).accountLedger('company', 'account', { from: '2026-10-01', to: '2026-10-18' });
    expect(result.movements[0].source).toEqual({ type: 'JOURNAL_ENTRY', id: 'journal', number: 'JV-1' });
    expect(result.closing).toBe('100.0000');
  });
});
