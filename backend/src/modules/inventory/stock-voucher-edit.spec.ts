import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { StockDocumentsService } from './stock-documents.service';

const D = (n: string) => new Prisma.Decimal(n);
const doc = () => ({id:'doc',voucherKind:'RECEIPT',status:InvoiceStatus.DRAFT,editVersion:2,
  reviewedAt:new Date(),approvedAt:new Date(),documentDate:new Date('2026-10-28'),toWarehouseId:'warehouse',
  counterpartyName:'supplier',reason:'receipt',notes:null,costCenterId:null,
  lines:[{id:'line',itemId:'item',quantity:D('4'),unitCost:D('3'),unitName:'box',unitFactor:D('2'),unitQuantity:D('2'),notes:null}]});
const input = () => ({idempotencyKey:'stock-voucher-edit-key-00001',expectedVersion:2,documentDate:'2026-10-28',
  toWarehouseId:'warehouse',counterpartyName:'supplier',reason:'receipt',
  lines:[{id:'line',itemId:'item',unitName:'box',quantity:'3',unitCost:'3'}]});
function harness() {
  const original = doc();
  const tx = {$queryRaw:jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{id:'doc'}]).mockResolvedValueOnce([]),
    $executeRaw:jest.fn(),stockDocument:{findUniqueOrThrow:jest.fn().mockResolvedValue(original),update:jest.fn(async (_arg:unknown) => undefined)},
    stockDocumentLine:{deleteMany:jest.fn(),createMany:jest.fn(async (_arg:{data:Array<{id?:string;quantity:Prisma.Decimal;unitCost:Prisma.Decimal;unitFactor:Prisma.Decimal | null}>}) => undefined)},
    warehouse:{findFirst:jest.fn().mockResolvedValue({id:'warehouse'})},
    item:{findFirst:jest.fn().mockResolvedValue({id:'item',isStockTracked:true,unit:'piece',units:[{unit:'box',factor:D('5'),isActive:false}]})}};
  const prisma = {$transaction:jest.fn(async (fn:(arg:typeof tx)=>Promise<void>) => fn(tx))};
  const audit = {recordRequired:jest.fn()};
  const service = new StockDocumentsService(prisma as never,{} as never,{} as never,{} as never,audit as never,{} as never,{} as never,{assertPostable:jest.fn()} as never);
  jest.spyOn(service,'findOne').mockResolvedValue({id:'doc'} as never);
  return {tx,service,audit,original};
}
describe('stock voucher draft edit', () => {
  it('uses the historical unit factor, clears approval, writes the ledger and audit', async () => {
    const h = harness();
    await h.service.updateVoucher('company','branch','user','doc',input(),true);
    const line = h.tx.stockDocumentLine.createMany.mock.calls[0][0].data[0];
    expect(line.id).toBe('line'); expect(line.quantity.toString()).toBe('6'); expect(line.unitFactor?.toString()).toBe('2');
    expect((h.tx.stockDocument.update.mock.calls[0][0] as {data:unknown}).data).toEqual(expect.objectContaining({reviewedAt:null,approvedAt:null,editVersion:3}));
    expect(h.tx.$executeRaw).toHaveBeenCalledTimes(1); expect(h.audit.recordRequired).toHaveBeenCalledTimes(1);
  });
  it('refuses stale edits and cost access before modifying lines', async () => {
    const h = harness();
    await expect(h.service.updateVoucher('company','branch','user','doc',{...input(),expectedVersion:1},true)).rejects.toBeInstanceOf(ConflictException);
    expect(h.tx.stockDocumentLine.deleteMany).not.toHaveBeenCalled();
    const h2 = harness();
    await expect(h2.service.updateVoucher('company','branch','user','doc',input(),false)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h2.tx.stockDocumentLine.deleteMany).not.toHaveBeenCalled();
  });
  it('does not let an issue editor without cost access overwrite a saved cost', async () => {
    const h = harness();
    Object.assign(h.original,{voucherKind:'ISSUE'});
    const request = {...input(), costCenterId:'44444444-4444-4444-8444-444444444444'}; request.lines[0].quantity='-3'; request.lines[0].unitCost='999';
    await h.service.updateVoucher('company','branch','user','doc',request,false);
    const line = h.tx.stockDocumentLine.createMany.mock.calls[0][0].data[0];
    expect(line.unitCost.toString()).toBe('3');
  });
  it('rejects editing an issue without a cost centre before touching lines', async () => {
    const h = harness();
    Object.assign(h.original,{voucherKind:'ISSUE'});
    const request = input(); request.lines[0].quantity='-3';
    await expect(h.service.updateVoucher('company','branch','user','doc',request,false)).rejects.toThrow(/cost center is required/i);
    expect(h.tx.stockDocumentLine.deleteMany).not.toHaveBeenCalled();
    expect(h.audit.recordRequired).not.toHaveBeenCalled();
  });
  it('rejects an inconsistent historical snapshot and inactive newly selected units', async () => {
    const h = harness(); h.original.lines[0].quantity = D('5');
    await expect(h.service.updateVoucher('company','branch','user','doc',input(),true)).rejects.toBeInstanceOf(BadRequestException);
    const h2 = harness(); const data = input(); data.lines[0].id = '';
    await expect(h2.service.updateVoucher('company','branch','user','doc',data,true)).rejects.toThrow(/inactive/);
  });
});
