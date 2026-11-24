import { Prisma, PrismaClient } from '@prisma/client';
import { createPgAdapter } from '../../common/prisma/prisma.service';
import { DashboardService } from './dashboard.service';

const run = process.env.KAYAN_DASHBOARD_PG === '1';
(run ? describe : describe.skip)('dashboard database open-balance aggregate matches legacy decimals', () => {
  const co='f3000000-0000-4000-8000-000000000001', other='f3000000-0000-4000-8000-000000000002';
  const br1='f3000000-0000-4000-8000-000000000003', br2='f3000000-0000-4000-8000-000000000004', br3='f3000000-0000-4000-8000-000000000005';
  const party='f3000000-0000-4000-8000-000000000006', otherParty='f3000000-0000-4000-8000-000000000007';
  let prisma:PrismaClient;let service:DashboardService;
  const boundary=new Date('2026-11-24T23:59:59.999Z');
  beforeAll(async()=>{
    if(process.env.NODE_ENV!=='test'||new URL(process.env.DATABASE_URL??'').pathname!=='/erp_kayan_acceptance')throw new Error('Isolated acceptance database required');
    prisma=new PrismaClient({adapter:createPgAdapter()});service=new DashboardService(prisma as never);
    for(const [id,code] of [[co,'DAG'],[other,'DAGO']]){
      await prisma.company.create({data:{id,code,nameEn:code,nameAr:'اختبار',isActive:false,deletedAt:new Date()}});
      await prisma.customer.create({data:{id:id===co?party:otherParty,companyId:id,code,nameEn:code,nameAr:'اختبار'}});
      await prisma.supplier.create({data:{id:id===co?party:otherParty,companyId:id,code,nameEn:code,nameAr:'اختبار'}});
    }
    for(const [id,companyId] of [[br1,co],[br2,co],[br3,other]])await prisma.branch.create({data:{id,companyId,code:id,nameEn:'Synthetic',nameAr:'اختبار'}});
    let n=0;
    const add=async(total:string,paid:string,opts:Record<string,unknown>={})=>{
      n++;const data={companyId:co,branchId:br1,invoiceNumber:`DAG-${n}`,invoiceDate:new Date('2026-11-24'),status:'POSTED' as const,totalAmount:total,paidAmount:paid,...opts};
      await prisma.salesInvoice.create({data:{...data,customerId:data.companyId===co?party:otherParty} as any});
      await prisma.purchaseInvoice.create({data:{...data,supplierId:data.companyId===co?party:otherParty} as any});
    };
    await add('123.4567','20.0001');await add('10','10');await add('2.0001','5.0002',{branchId:br2});
    await add('7','0',{documentType:'CREDIT_NOTE',currency:'USD'});await add('9','1',{documentType:'DEBIT_NOTE',branchId:br2});
    await add('500','0',{status:'DRAFT'});await add('600','0',{status:'REVERSED'});await add('700','0',{deletedAt:new Date()});
    await add('800','0',{invoiceDate:new Date('2026-11-25')});await add('900','0',{companyId:other,branchId:br3});
  },30000);
  afterAll(async()=>{if(!prisma)return;for(const companyId of [co,other]){await prisma.salesInvoice.deleteMany({where:{companyId}});await prisma.purchaseInvoice.deleteMany({where:{companyId}});await prisma.customer.deleteMany({where:{companyId}});await prisma.supplier.deleteMany({where:{companyId}});await prisma.branch.deleteMany({where:{companyId}});await prisma.company.deleteMany({where:{id:companyId}});}await prisma.$disconnect();});
  for(const side of ['sales','purchases'] as const){
    for(const [dateLabel,asOf] of [['boundary',boundary],['future',new Date('2026-11-25T23:59:59.999Z')],['empty',new Date('2026-11-23T23:59:59.999Z')]] as const){
    for(const [label,branches] of [['all',null],['one',[br1]],['two',[br1,br2]],['none',[]],['foreign',[br3]]] as const){
      it(`${side}: ${dateLabel} ${label} scope matches exact legacy total and nonzero invoice count`,async()=>{
        const scope=branches===null?null:[...branches];
        const where={companyId:co,deletedAt:null,status:'POSTED' as const,invoiceDate:{lte:asOf},...(scope?{branchId:{in:scope}}:{})};
        const rows=side==='sales'?await prisma.salesInvoice.findMany({where,select:{totalAmount:true,paidAmount:true}}):await prisma.purchaseInvoice.findMany({where,select:{totalAmount:true,paidAmount:true}});
        const total=rows.reduce((sum,row)=>sum.plus(row.totalAmount).minus(row.paidAmount),new Prisma.Decimal(0));
        const expected={total:total.toFixed(4),invoices:rows.filter(row=>!row.totalAmount.minus(row.paidAmount).isZero()).length};
        expect(await (service as any).openBalances(co,side,asOf,scope)).toEqual(expected);
        if(label==='all'&&dateLabel==='boundary'){expect(expected.invoices).toBe(4);expect(expected.total).toBe('115.4565');}
      });
    }
    }
  }
});
