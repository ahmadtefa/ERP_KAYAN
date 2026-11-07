import { Prisma } from '@prisma/client';
import { ItemsService } from './items.service';

const D = (n:string) => new Prisma.Decimal(n);
const base = {id:'item',companyId:'company',code:'SYN',nameEn:'Item',nameAr:'صنف',unit:'piece',barcode:null,
  salePrice:D('1'),purchasePrice:D('0'),reorderLevel:D('0'),taxRate:D('7'),isStockTracked:true,
  isActive:true,categoryId:null,notes:null,createdAt:new Date()};
function harness() {
  const create=jest.fn(async ({data}:{data:Record<string,unknown>}) => ({...base,...data}));
  const update=jest.fn(async ({data}:{data:Record<string,unknown>}) => ({...base,...data}));
  const tx={item:{create,update},itemUnit:{create:jest.fn()}};
  const prisma={
  itemUnit: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },item:{findFirst:jest.fn(),update},$transaction:jest.fn(async (fn:(client:typeof tx)=>Promise<unknown>) => fn(tx))};
  const service=new ItemsService(prisma as never,{record:jest.fn()} as never,{} as never,{} as never,{} as never, {} as never);
  return {service,prisma,create,update};
}
describe('item blank tax', () => {
  it.each([[undefined,'0'],[null,'0'],['','0'],['   ','0'],['0','0'],['7','7']])
    ('creates with %s as %s, defaulting an omitted tax to zero', async (tax,expected) => {
      const h=harness(); h.prisma.item.findFirst.mockResolvedValue(null);
      await h.service.create('company','user',{code:'SYN',nameEn:'Item',nameAr:'صنف',...(tax === undefined ? {} : {taxRate:tax})});
      const actual=h.create.mock.calls[0][0].data.taxRate as Prisma.Decimal | null;
      expect(actual === null ? null : actual.toString()).toBe(expected);
    });
  it.each([[null,'0'],['','0'],['   ','0'],['0','0'],['7','7']])
    ('updates %s to %s while omission leaves historical choice untouched', async (tax,expected) => {
      const h=harness(); h.prisma.item.findFirst.mockResolvedValue(base);
      await h.service.update('company','user','item',{taxRate:tax});
      expect((h.update.mock.calls[0][0].data.taxRate as Prisma.Decimal).toString()).toBe(expected);
      await h.service.update('company','user','item',{nameEn:'Updated'});
      expect(h.update.mock.calls[1][0].data).not.toHaveProperty('taxRate');
    });
});
