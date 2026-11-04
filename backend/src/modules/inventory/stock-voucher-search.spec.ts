import { StockDocumentsService } from './stock-documents.service';

describe('stock voucher search scope', () => {
  it('keeps company, branch and voucher filters alongside a bounded search', async () => {
    const findMany = jest.fn(async (_args:{where:unknown}) => []);
    const count = jest.fn(async (_args:{where:unknown}) => 0);
    const prisma = { stockDocument:{findMany,count}, $transaction: async (queries:unknown[]) => Promise.all(queries) };
    const service = new StockDocumentsService(prisma as never,{} as never,{} as never,{} as never,
      {} as never,{} as never,{} as never,{} as never);
    await service.findAll('company',{branchId:'branch',voucherOnly:true,q:'  Department  '});
    expect(findMany.mock.calls[0][0].where).toEqual({companyId:'company',deletedAt:null,branchId:'branch',voucherKind:{not:null},OR:[
      {documentNumber:{contains:'Department',mode:'insensitive'}},
      {counterpartyName:{contains:'Department',mode:'insensitive'}},
      {reason:{contains:'Department',mode:'insensitive'}},
    ]});
    await expect(service.findAll('company',{q:'x'.repeat(121)})).rejects.toThrow(/at most 120/);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
