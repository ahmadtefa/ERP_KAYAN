import { ConflictException } from '@nestjs/common';
import { JournalStatus, Prisma } from '@prisma/client';
import { JournalEntriesService } from './journal-entries.service';

describe('manual journal state transitions', () => {
  const company = 'company-1';
  const user = 'user-1';
  const id = 'journal-1';

  function setup(status: JournalStatus) {
    const before = {
      id, status, createdBy: user, approvedBy: null, reversalOfId: null,
      entryDate: new Date('2026-01-01'), totalDebit: new Prisma.Decimal(10),
      totalCredit: new Prisma.Decimal(10), lines: [],
    };
    const tx = { journalEntry: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ status: JournalStatus.POSTED }),
    } };
    const prisma = {
      journalEntry: { findFirst: jest.fn().mockResolvedValue(before) },
      account: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (f: (x: typeof tx) => unknown) => f(tx)),
    };
    const audit = { recordRequired: jest.fn().mockResolvedValue(undefined) };
    const service = new JournalEntriesService(
      prisma as never, {} as never, audit as never,
      { periodFor: jest.fn().mockResolvedValue(null) } as never,
      { get: jest.fn().mockResolvedValue({approvalRequiredForJournal:false,segregationOfDuties:false}) } as never,
      {} as never,
    );
    jest.spyOn(service as any, 'toResponse').mockImplementation((value: unknown) => value);
    return { service, prisma, tx, audit };
  }

  it.each([
    ['post', JournalStatus.DRAFT, JournalStatus.POSTED, 'POST'],
    ['submitForApproval', JournalStatus.DRAFT, JournalStatus.PENDING_APPROVAL, 'SUBMIT'],
    ['approve', JournalStatus.PENDING_APPROVAL, JournalStatus.APPROVED, 'APPROVE'],
    ['cancel', JournalStatus.APPROVED, JournalStatus.CANCELLED, 'CANCEL'],
  ] as const)('%s compares company and observed status and requires the audit in its transaction', async (method, before, after, action) => {
    const { service, tx, audit } = setup(before);
    tx.journalEntry.findUniqueOrThrow.mockResolvedValue({status:after});
    await service[method](company, user, id);
    expect(tx.journalEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id, companyId: company, status: before },
      data: expect.objectContaining({ status: after }),
    }));
    expect(audit.recordRequired).toHaveBeenCalledWith(expect.objectContaining({
      companyId:company, userId:user, entityId:id, action,
      before:{status:before}, after:expect.objectContaining({status:after}),
    }), tx);
  });

  it.each([
    ['post', JournalStatus.DRAFT], ['submitForApproval', JournalStatus.DRAFT],
    ['approve', JournalStatus.PENDING_APPROVAL], ['cancel', JournalStatus.APPROVED],
  ] as const)('%s rejects a stale transition without auditing it as successful', async (method, status) => {
    const {service, tx, audit} = setup(status);
    tx.journalEntry.updateMany.mockResolvedValue({count:0});
    await expect(service[method](company,user,id)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.journalEntry.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(audit.recordRequired).not.toHaveBeenCalled();
  });

  it('propagates a required audit failure rather than returning success', async () => {
    const {service,audit} = setup(JournalStatus.DRAFT);
    audit.recordRequired.mockRejectedValue(new Error('synthetic audit failure'));
    await expect(service.cancel(company,user,id)).rejects.toThrow('synthetic audit failure');
  });
});
