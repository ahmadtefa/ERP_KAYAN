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
    const posted = { status: JournalStatus.POSTED, totalDebit: new Prisma.Decimal(10),
      totalCredit: new Prisma.Decimal(10), reversalOfId: null, lines: [
        {accountId:'a',debit:new Prisma.Decimal(10),credit:new Prisma.Decimal(0)},
        {accountId:'b',debit:new Prisma.Decimal(0),credit:new Prisma.Decimal(10)},
      ] };
    const tx = { journalEntry: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(posted),
    }, $queryRaw:jest.fn().mockResolvedValue([]), account:{findMany:jest.fn().mockResolvedValue([
      {id:'a',code:'1000',isActive:true,isPostable:true},
      {id:'b',code:'2000',isActive:true,isPostable:true},
    ])} };
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
    return { service, prisma, tx, audit, posted };
  }

  it.each([
    ['post', JournalStatus.DRAFT, JournalStatus.POSTED, 'POST'],
    ['submitForApproval', JournalStatus.DRAFT, JournalStatus.PENDING_APPROVAL, 'SUBMIT'],
    ['approve', JournalStatus.PENDING_APPROVAL, JournalStatus.APPROVED, 'APPROVE'],
    ['cancel', JournalStatus.APPROVED, JournalStatus.CANCELLED, 'CANCEL'],
  ] as const)('%s compares company and observed status and requires the audit in its transaction', async (method, before, after, action) => {
    const { service, tx, audit, posted } = setup(before);
    tx.journalEntry.findUniqueOrThrow.mockResolvedValue({...posted,status:after});
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

  it('checks actual line amounts inside the write transaction, not just balanced headers', async () => {
    const {service,tx,audit,posted} = setup(JournalStatus.DRAFT);
    tx.journalEntry.findUniqueOrThrow.mockResolvedValue({...posted,lines:[posted.lines[0],
      {...posted.lines[1],credit:new Prisma.Decimal(7)}]});
    await expect(service.post(company,user,id)).rejects.toThrow(/lines do not balance/i);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(audit.recordRequired).not.toHaveBeenCalled();
  });

  it.each([
    {debit:'10',credit:'1'}, {debit:'0',credit:'0'}, {debit:'-1',credit:'0'},
  ])('rejects invalid posted line sides: $debit / $credit', async ({debit,credit}) => {
    const {service,tx,audit,posted} = setup(JournalStatus.DRAFT);
    tx.journalEntry.findUniqueOrThrow.mockResolvedValue({...posted,lines:[
      {...posted.lines[0],debit:new Prisma.Decimal(debit),credit:new Prisma.Decimal(credit)},posted.lines[1],
    ]});
    await expect(service.post(company,user,id)).rejects.toThrow(/one positive debit or credit/i);
    expect(audit.recordRequired).not.toHaveBeenCalled();
  });

  it('rejects balanced lines which disagree with balanced headers', async () => {
    const {service,tx,audit,posted} = setup(JournalStatus.DRAFT);
    tx.journalEntry.findUniqueOrThrow.mockResolvedValue({...posted,totalDebit:new Prisma.Decimal(20),totalCredit:new Prisma.Decimal(20)});
    await expect(service.post(company,user,id)).rejects.toThrow(/do not match/i);
    expect(audit.recordRequired).not.toHaveBeenCalled();
  });

  it('locks accounts then refuses a deactivated account before auditing', async () => {
    const {service,tx,audit} = setup(JournalStatus.DRAFT);
    tx.account.findMany.mockResolvedValue([
      {id:'a',code:'1000',isActive:false,isPostable:true},
      {id:'b',code:'2000',isActive:true,isPostable:true},
    ]);
    await expect(service.post(company,user,id)).rejects.toThrow(/accounts are unavailable/i);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(audit.recordRequired).not.toHaveBeenCalled();
  });

  it('propagates a required audit failure rather than returning success', async () => {
    const {service,audit} = setup(JournalStatus.DRAFT);
    audit.recordRequired.mockRejectedValue(new Error('synthetic audit failure'));
    await expect(service.cancel(company,user,id)).rejects.toThrow('synthetic audit failure');
  });
});

describe('manual journal creation and reversal audit', () => {
  const debit = new Prisma.Decimal(10);
  const zero = new Prisma.Decimal(0);
  function setup() {
    const original = {id:'entry',companyId:'company',branchId:'branch',entryNumber:'JV-1',
      entryDate:new Date('2026-01-01'),status:JournalStatus.POSTED,currency:'EGP',
      totalDebit:debit,totalCredit:debit,lines:[
        {lineNumber:1,accountId:'a',debit,credit:zero,description:null,costCenterId:null,allocations:[]},
        {lineNumber:2,accountId:'b',debit:zero,credit:debit,description:null,costCenterId:null,allocations:[]},
      ]};
    const created = {id:'new-entry',entryNumber:'JV-2',totalDebit:debit,totalCredit:debit};
    const tx = {journalEntry:{create:jest.fn().mockResolvedValue(created),updateMany:jest.fn().mockResolvedValue({count:1})}};
    const prisma = {
      account:{findMany:jest.fn().mockResolvedValue([
        {id:'a',code:'1000',isPostable:true,isActive:true},
        {id:'b',code:'2000',isPostable:true,isActive:true},
      ])},
      journalEntry:{findFirst:jest.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(null)},
      $transaction:jest.fn(async (work:(tx:unknown)=>unknown)=>work(tx)),
    };
    const audit = {recordRequired:jest.fn().mockResolvedValue(undefined)};
    const service = new JournalEntriesService(prisma as never,
      {next:jest.fn().mockResolvedValue('JV-2')} as never, audit as never,
      {periodFor:jest.fn().mockResolvedValue(null)} as never, {} as never,
      {assertPostable:jest.fn().mockResolvedValue(undefined)} as never);
    jest.spyOn(service as any,'toResponse').mockImplementation((value:unknown)=>value);
    return {service,prisma,tx,audit};
  }

  it('writes create audit inside the transaction with the new entry', async () => {
    const {service,tx,audit}=setup();
    await service.create('company','branch','user',{entryDate:'2026-01-01',lines:[
      {accountId:'a',debit:'10'}, {accountId:'b',credit:'10'},
    ]});
    expect(audit.recordRequired).toHaveBeenCalledWith(expect.objectContaining({
      action:'CREATE',entity:'journal_entries',entityId:'new-entry',
    }),tx);
  });

  it('requires reversal audit with the claim and mirror entry in one transaction', async () => {
    const {service,tx,audit}=setup();
    await service.reverse('company','user','entry');
    expect(tx.journalEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where:{id:'entry',companyId:'company',status:JournalStatus.POSTED},
    }));
    expect(audit.recordRequired).toHaveBeenCalledWith(expect.objectContaining({
      action:'REVERSE',entity:'journal_entries',entityId:'entry',
      after:{reversalId:'new-entry',reversalNumber:'JV-2'},
    }),tx);
  });

  it('propagates reversal audit failure instead of reporting success', async () => {
    const {service,audit}=setup();
    audit.recordRequired.mockRejectedValue(new Error('synthetic audit failure'));
    await expect(service.reverse('company','user','entry')).rejects.toThrow('synthetic audit failure');
  });
});
