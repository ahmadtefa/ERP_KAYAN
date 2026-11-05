import { QuotationsService } from './quotations.service';

describe('quotation issuance snapshot isolation', () => {
  function fixture() {
    const quotation = {
      id:'q1', quotationNumber:'Q1', status:'DRAFT', contentSnapshot:null,
      snapshotAt:null, issuedAt:null, acceptedAt:null, rejectedAt:null, showTaxId:true,
    };
    let inside = false;
    let locked = false;
    const tx = {
      quotation: {
        updateMany: jest.fn(async () => { locked = true; return {count:1}; }),
        findFirst: jest.fn(async () => quotation),
        update: jest.fn(async () => ({})),
      },
      quotationEvent: { create: jest.fn(async () => ({})) },
    };
    const prisma = {
      quotation: { findFirst: jest.fn(async () => quotation) },
      $transaction: jest.fn(async (work: (arg: typeof tx) => Promise<unknown>) => {
        inside = true;
        try { return await work(tx); } finally { inside = false; }
      }),
    };
    const audit = { record: jest.fn(), recordRequired: jest.fn(async () => {}) };
    const service = new QuotationsService(prisma as never, {} as never, {} as never, {} as never, audit as never);
    jest.spyOn(service as any,'snapshotContent').mockImplementation(async () => {
      expect(inside).toBe(true);
      expect(locked).toBe(true);
      return {showTaxId:true};
    });
    jest.spyOn(service,'findOne').mockResolvedValue({id:'q1'} as never);
    return {service,tx,audit};
  }

  it.each(['send','accept','reject'] as const)('%s snapshots only after locking the draft in the transaction', async operation => {
    const {service,tx,audit} = fixture();
    await service[operation]('co','user','q1');
    expect(tx.quotation.findFirst).toHaveBeenCalled();
    expect(audit.recordRequired).toHaveBeenCalledWith(expect.objectContaining({entity:'quotations'}),tx);
  });
});
