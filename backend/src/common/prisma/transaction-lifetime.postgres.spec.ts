import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { ClosedDatabaseTransactionError } from './transaction-lifetime';
import { createPgAdapter } from './prisma.service';

// Dedicated migrated acceptance database only. Fixtures are isolated by company.
const run = process.env.KAYAN_TX_LIFETIME_PG === '1';
(run ? describe : describe.skip)('nested writes cannot continue after transaction rollback', () => {
  const co='f1000000-0000-4000-8000-000000000001';
  const br='f1000000-0000-4000-8000-000000000002';
  const customer='f1000000-0000-4000-8000-000000000003';
  const item='f1000000-0000-4000-8000-000000000004';
  const account='f1000000-0000-4000-8000-000000000005';
  let prisma: PrismaClient;
  let blocker: Client;
  beforeAll(async()=>{
    if(process.env.NODE_ENV!=='test'||new URL(process.env.DATABASE_URL??'').pathname!=='/erp_kayan_acceptance')throw new Error('Isolated acceptance database required');
    prisma=new PrismaClient({adapter:createPgAdapter()});
    blocker=new Client({connectionString:process.env.DATABASE_URL});await blocker.connect();
    await prisma.company.create({data:{id:co,code:'TXL',nameEn:'Synthetic TX lifetime',nameAr:'اختبار',isActive:false,deletedAt:new Date()}});
    await prisma.branch.create({data:{id:br,companyId:co,code:'TXL',nameEn:'TXL',nameAr:'اختبار'}});
    await prisma.customer.create({data:{id:customer,companyId:co,code:'TXL',nameEn:'TXL',nameAr:'اختبار'}});
    await prisma.item.create({data:{id:item,companyId:co,code:'TXL',nameEn:'TXL',nameAr:'اختبار',unit:'piece'}});
    await prisma.account.create({data:{id:account,companyId:co,code:'TXL',nameEn:'TXL',nameAr:'اختبار',type:'ASSET'}});
  });
  afterAll(async()=>{
    await blocker?.query('ROLLBACK');await blocker?.end();
    if(prisma){
      await prisma.salesInvoice.deleteMany({where:{companyId:co}});
      await prisma.journalEntry.deleteMany({where:{companyId:co}});
      await prisma.item.deleteMany({where:{companyId:co}});await prisma.customer.deleteMany({where:{companyId:co}});
      await prisma.account.deleteMany({where:{companyId:co}});await prisma.branch.deleteMany({where:{companyId:co}});await prisma.company.deleteMany({where:{id:co}});await prisma.$disconnect();
    }
  });
  const invoice=(number:string)=>({companyId:co,branchId:br,customerId:customer,invoiceNumber:number,invoiceDate:new Date('2026-11-24'),lines:{create:[{lineNumber:1,itemId:item,description:'Synthetic',quantity:1,unitPrice:1,lineTotal:1}]}});
  async function blocked(table:'customers'|'items'|'branches',id:string,write:(tx:any)=>Promise<unknown>){
    await blocker.query('BEGIN');await blocker.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`,[id]);
    // Keep a real parent/child FK check blocked longer than the timeout.
    const pending=prisma.$transaction(write,{timeout:500,maxWait:2000}).then(()=>null,error=>error);
    try{await new Promise(resolve=>setTimeout(resolve,1400));}finally{await blocker.query('ROLLBACK');}
    const error=await pending;expect(error).toBeTruthy();expect(error.code).not.toBe('P2003');expect(error).not.toBeInstanceOf(TypeError);if(table!=='items')expect(error).toBeInstanceOf(ClosedDatabaseTransactionError);
    await new Promise(resolve=>setTimeout(resolve,100));
    expect(await prisma.salesInvoice.count({where:{companyId:co}})).toBe(0);
    expect(await prisma.salesInvoiceLine.count({where:{invoice:{companyId:co}}})).toBe(0);
    expect(await prisma.journalEntry.count({where:{companyId:co}})).toBe(0);
    expect(await prisma.journalLine.count({where:{entry:{companyId:co}}})).toBe(0);
  }
  it('blocks invoice child continuation after parent FK wait times out',async()=>{await blocked('customers',customer,tx=>tx.salesInvoice.create({data:invoice('TXL-parent')}));},15000);
  it('rolls back parent and child when child FK wait times out',async()=>{await blocked('items',item,tx=>tx.salesInvoice.create({data:invoice('TXL-child')}));},15000);
  it('blocks journal children after journal parent FK wait times out',async()=>{await blocked('branches',br,tx=>tx.journalEntry.create({data:{companyId:co,branchId:br,entryNumber:'TXL-journal',entryDate:new Date('2026-11-24'),totalDebit:1,totalCredit:1,lines:{create:[{lineNumber:1,accountId:account,debit:1,credit:0},{lineNumber:2,accountId:account,debit:0,credit:1}]}}}));},15000);
  it('still commits normal nested invoice and journal writes',async()=>{
    await prisma.$transaction(async tx=>{await tx.salesInvoice.create({data:invoice('TXL-ok')});await tx.journalEntry.create({data:{companyId:co,branchId:br,entryNumber:'TXL-ok',entryDate:new Date('2026-11-24'),totalDebit:1,totalCredit:1,lines:{create:[{lineNumber:1,accountId:account,debit:1,credit:0},{lineNumber:2,accountId:account,debit:0,credit:1}]}}});});
    expect(await prisma.salesInvoice.count({where:{companyId:co}})).toBe(1);expect(await prisma.salesInvoiceLine.count({where:{invoice:{companyId:co}}})).toBe(1);
    expect(await prisma.journalEntry.count({where:{companyId:co}})).toBe(1);expect(await prisma.journalLine.count({where:{entry:{companyId:co}}})).toBe(2);
  });
});
