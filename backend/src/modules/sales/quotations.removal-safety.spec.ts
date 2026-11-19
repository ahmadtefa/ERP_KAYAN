import { QuotationsService } from './quotations.service';

describe('quotation removal concurrency', () => {
  function fixture(options: { stale?: boolean; failAudit?: boolean } = {}) {
    const state = { status: 'DRAFT', deletedAt: null as Date | null, audits: [] as string[] };
    const quotation = {
      findFirst: jest.fn(async () => {
        const snapshot = { id: 'q1', status: state.status, quotationNumber: 'Q1' };
        if (options.stale) state.status = 'ACCEPTED';
        return snapshot;
      }),
      update: jest.fn(async ({data}: any) => { state.deletedAt = data.deletedAt; }),
    };
    const audit = {
      record: jest.fn(async () => {}),
      recordRequired: jest.fn(async (_entry: any, tx: any) => {
        if (options.failAudit) throw new Error('synthetic audit failure');
        tx.pending.audits.push('DELETE');
      }),
    };
    const prisma = {
      quotation,
      $transaction: jest.fn(async (work: (tx: any) => Promise<any>) => {
        const pending = { ...state, audits: [...state.audits] };
        const tx = { pending, quotation: { updateMany: jest.fn(async ({where,data}: any) => {
          if (pending.status !== where.status || pending.deletedAt !== where.deletedAt) return {count:0};
          pending.deletedAt = data.deletedAt;
          return {count:1};
        }) } };
        const result = await work(tx);
        Object.assign(state,pending);
        return result;
      }),
    };
    const service = new QuotationsService(prisma as never, {} as never, {} as never, {} as never, audit as never);
    return {state, service, audit};
  }

  it('does not remove a quotation accepted after the draft was read', async () => {
    const {state, service} = fixture({stale:true});
    await expect(service.remove('co','user','q1')).rejects.toThrow();
    expect(state).toEqual({status:'ACCEPTED',deletedAt:null,audits:[]});
  });

  it('rolls back deletion if required audit fails', async () => {
    const {state, service} = fixture({failAudit:true});
    await expect(service.remove('co','user','q1')).rejects.toThrow('synthetic audit failure');
    expect(state).toEqual({status:'DRAFT',deletedAt:null,audits:[]});
  });

  it('removes only a draft and commits its audit', async () => {
    const {state, service, audit} = fixture();
    await expect(service.remove('co','user','q1')).resolves.toEqual({id:'q1',deleted:true});
    expect(state.deletedAt).toBeInstanceOf(Date);
    expect(state.audits).toEqual(['DELETE']);
    expect(audit.recordRequired).toHaveBeenCalledWith(expect.objectContaining({entity:'quotations',action:'DELETE'}),expect.any(Object));
  });
});
