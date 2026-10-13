import { BadRequestException } from '@nestjs/common';
import { JournalEntriesService } from './journal-entries.service';

describe('JournalEntriesService reverse concurrency', () => {
  it('rejects a reversal when another request has already claimed the posted entry', async () => {
    const original = {
      id: 'entry-1',
      companyId: 'company-1',
      branchId: 'branch-1',
      entryNumber: 'JV-0001',
      status: 'POSTED',
      lines: [
        {
          lineNumber: 1,
          accountId: 'account-1',
          debit: { toString: () => '10.0000' },
          credit: { toString: () => '0.0000' },
        },
      ],
    };
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(null);
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const tx = { journalEntry: { updateMany, create: jest.fn() } };
    const prisma = {
      journalEntry: { findFirst },
      $transaction: jest.fn(async (callback: (transaction: any) => unknown) =>
        callback(tx),
      ),
    };
    const numbers = { next: jest.fn() };
    const audit = { record: jest.fn() };
    const periods = {};
    const service = new JournalEntriesService(
      prisma as any,
      numbers as any,
      audit as any,
      periods as any,
    );

    await expect(
      service.reverse('company-1', 'user-1', 'entry-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'entry-1',
        companyId: 'company-1',
        status: 'POSTED',
      },
      data: { status: 'REVERSED' },
    });
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
    expect(numbers.next).not.toHaveBeenCalled();
  });
});
