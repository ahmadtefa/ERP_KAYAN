import { Prisma } from '@prisma/client';
import { DocumentsService } from './documents.service';
import { applyPriceVisibility } from './price-visibility';
import { toPrintHtml } from './writers';
const D = (n:string) => new Prisma.Decimal(n);
describe('stock voucher print and cost redaction', () => {
  it('builds a tenant-scoped bilingual document and removes cost from print', async () => {
    const findFirst=jest.fn().mockResolvedValue({id:'doc',documentNumber:'SA-1',voucherKind:'ISSUE',
      documentDate:new Date('2026-11-04T00:00:00Z'),status:'POSTED',counterpartyName:'Synthetic department',
      reason:'Synthetic reason',notes:null,reviewedAt:null,approvedAt:null,
      branch:{nameAr:'فرع',nameEn:'Branch'},toWarehouse:{nameAr:'مخزن',nameEn:'Warehouse'},costCenter:null,
      lines:[{lineNumber:1,unitName:'carton',unitQuantity:D('-2'),quantity:D('-20'),unitCost:D('7.5'),
        item:{code:'IT',nameAr:'صنف',nameEn:'Item',unit:'piece'}}]});
    const service=new DocumentsService({stockDocument:{findFirst}} as never);
    expect(service.spec('stock-voucher')).toEqual({kind:'stock-voucher',readPermission:'inventory.stock.read',exportPermission:'inventory.export'});
    const table=await service.build('stock-voucher','company','doc','ar');
    expect(findFirst.mock.calls[0][0].where).toEqual({id:'doc',companyId:'company',deletedAt:null,voucherKind:{not:null}});
    expect(table.rows[0]).toEqual(expect.objectContaining({unit:'carton',quantity:'-2.0000',unitCost:'7.5000'}));
    await service.build('stock-voucher','company','doc','ar','branch');
    expect(findFirst.mock.calls[1][0].where).toEqual({id:'doc',companyId:'company',deletedAt:null,voucherKind:{not:null},branchId:'branch'});
    await expect(service.build('stock-voucher','company','doc','ar',null)).rejects.toThrow(/not found/i);
    const hidden=applyPriceVisibility(table,{showCost:false});
    expect(hidden.columns.some(column => column.key === 'unitCost')).toBe(false);
    expect(hidden.rows[0]).not.toHaveProperty('unitCost');
    const html=toPrintHtml(hidden,'ar','شركة تجريبية',{autoPrint:false});
    expect(html).toContain('إذن صرف'); expect(html).toContain('Synthetic department');
    expect(html).not.toContain('7.5000');
  });
});
