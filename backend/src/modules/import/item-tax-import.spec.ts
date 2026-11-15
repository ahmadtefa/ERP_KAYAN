import { Prisma } from '@prisma/client';
import { ImportService } from './import.service';

const company = 'company', user = 'user';
function fixture() {
  const updates = jest.fn(async (_args: {data: Record<string, unknown>}) => ({count:1}));
  const tx = {item:{updateMany:updates,create:jest.fn(async () => ({}))}};
  const prisma = {item:{findMany:jest.fn(async () => [{id:'i1',code:'I1'},{id:'i2',code:'I2'}])},
    $transaction:jest.fn(async (fn:(arg:typeof tx)=>unknown) => fn(tx))};
  const service = new ImportService(prisma as never,{record:jest.fn()} as never,{} as never);
  const run = (csv:string, options:Record<string,unknown>) => service.run('items',company,user,
    {originalname:'items.csv',buffer:Buffer.from(csv)}, {dryRun:false,mode:'upsert',...options} as never);
  return {run,updates,prisma};
}
describe('item tax spreadsheet safety',()=>{
  it('leaves tax untouched when the column is absent or blank without explicit opt-in',async()=>{
    const f=fixture();
    await f.run('Code,Name (English),Name (Arabic)\nI1,A,أ\n',{});
    expect(f.updates.mock.calls[0][0].data).not.toHaveProperty('taxRate');
    await f.run('Code,Name (English),Name (Arabic),Tax rate %\nI1,A,أ,  \n',{});
    expect(f.updates.mock.calls[1][0].data).not.toHaveProperty('taxRate');
  });
  it('clears a blank cell only with explicit opt-in, reports it, and keeps an absent column untouched',async()=>{
    const f=fixture();
    const report=await f.run('Code,Name (English),Name (Arabic),Tax rate %\nI1,A,أ,  \nI2,B,ب,0\n',{clearBlankTaxRates:true});
    expect(report.errors).toEqual([]);
    expect(report.clearedBlankTaxRates).toBe(1);
    expect((f.updates.mock.calls[0][0].data.taxRate as Prisma.Decimal).toString()).toBe('0');
    expect((f.updates.mock.calls[1][0].data.taxRate as Prisma.Decimal).toString()).toBe('0');
    const omitted=await f.run('Code,Name (English),Name (Arabic)\nI1,A,أ\n',{clearBlankTaxRates:true});
    expect(omitted.clearedBlankTaxRates).toBe(0);
    expect(f.updates.mock.calls[2][0].data).not.toHaveProperty('taxRate');
  });
  it('rejects ambiguous multiple tax columns rather than overwriting one value',async()=>{
    const f=fixture();
    await expect(f.run('Code,Name (English),Name (Arabic),Tax rate %,VAT\nI1,A,أ,14,\n',{clearBlankTaxRates:true}))
      .rejects.toThrow(/multiple tax/i);
    expect(f.updates).not.toHaveBeenCalled();
  });
  it('rejects tax below zero or above 100 without writing any rows',async()=>{
    const f=fixture();
    const report=await f.run('Code,Name (English),Name (Arabic),Tax rate %\nI1,A,أ,-1\nI2,B,ب,101\n',{});
    expect(report.errors).toHaveLength(2);
    expect(f.updates).not.toHaveBeenCalled();
  });
});
