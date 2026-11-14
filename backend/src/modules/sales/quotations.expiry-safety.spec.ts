import { QuotationsService } from './quotations.service';

describe('quotation expiry race safety', () => {
  function fixture(updatedIds: string[]) {
    const tx = {
      $queryRaw: jest.fn(async () => updatedIds.map(id => ({id}))),
      quotation: {
        findMany: jest.fn(async () => [{id:'q1'},{id:'q2'}]),
        updateMany: jest.fn(async () => ({count:updatedIds.length})),
      },
      quotationEvent: {createMany:jest.fn(async () => ({}))},
    };
    const prisma = {
      quotation: {findMany:jest.fn(async () => [{id:'q1'},{id:'q2'}])},
      $transaction: jest.fn(async (work: (tx: unknown) => unknown) => work(tx)),
    };
    const service = new QuotationsService(prisma as never, {} as never, {} as never, {} as never, {} as never);
    return {service,tx};
  }

  it('never records expiry for a quotation accepted before the conditional update', async () => {
    const {service,tx} = fixture([]);
    await (service as any).expireOverdue('co');
    expect(tx.quotationEvent.createMany).not.toHaveBeenCalled();
  });

  it('records expiry only for rows actually changed in the same transaction', async () => {
    const {service,tx} = fixture(['q2']);
    await (service as any).expireOverdue('co');
    expect(tx.quotationEvent.createMany).toHaveBeenCalledWith({data:[expect.objectContaining({quotationId:'q2',type:'EXPIRED'})]});
  });
});
