'use strict';
// Invoked only by the guarded synthetic PG upgrade fixture; not a signature,
// JWT, UI, offline Windows, or production-data test.
const assert = require('node:assert/strict');
const {QuotationsService} = require('../src/modules/sales/quotations.service');
const url = new URL(process.env.DATABASE_URL || '');
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    url.hostname !== '127.0.0.1' || url.port !== '5432' ||
    !/^\/kayan_upgrade_[0-9a-f]{16}$/.test(url.pathname) ||
    process.env.KAYAN_STOCK_DISPOSABLE_DATABASE !== url.pathname.slice(1) ||
    process.env.PRISMA_SCHEMA_ENGINE_BINARY || process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
  throw new Error('Quotation conversion fixture requires the guarded disposable CI database');
}

module.exports = async ({prisma,numbers,settings,invoices,audit,company,branch,user,customer,date}) => {
  const service = new QuotationsService(prisma,numbers,settings,invoices,audit);
  async function accepted(number, taxRate = '0', taxAmount = '0', total = '100') {
    return prisma.quotation.create({data:{
      companyId:company, branchId:branch, customerId:customer, quotationNumber:number,
      quotationDate:new Date(`${date}T00:00:00.000Z`), status:'ACCEPTED',
      subTotal:'100', discountTotal:'0', taxRate, taxAmount, totalAmount:total,
      tables:{create:[{title:'Synthetic',sortOrder:1,subTotal:'100',netTotal:'100',
        lines:{create:[{lineNumber:1,description:'Synthetic service',quantity:'1',unitPrice:'100',lineTotal:'100'}]}}]},
    }});
  }
  const countInvoices = () => prisma.salesInvoice.count({where:{companyId:company}});
  const auditFailure = await accepted('SYN-QUOTE-ATOMIC-AUDIT');
  const beforeInvoices = await countInvoices();
  const beforeAudit = await prisma.auditLog.count({where:{companyId:company}});
  const original = audit.recordRequired;
  audit.recordRequired = async function(input, tx) {
    if (input.entity === 'quotations' && input.entityId === auditFailure.id && input.action === 'UPDATE') {
      throw new Error('synthetic quotation audit failure');
    }
    return original.call(this,input,tx);
  };
  try {
    await assert.rejects(service.convert(company,branch,user,auditFailure.id,{invoiceDate:date}), /synthetic quotation audit failure/);
  } finally { audit.recordRequired = original; }
  assert.equal(await countInvoices(),beforeInvoices);
  assert.equal(await prisma.auditLog.count({where:{companyId:company}}),beforeAudit);
  let saved = await prisma.quotation.findUniqueOrThrow({where:{id:auditFailure.id}});
  assert.equal(saved.status,'ACCEPTED');
  assert.equal(saved.convertedInvoiceId,null);
  assert.equal(await prisma.quotationEvent.count({where:{quotationId:auditFailure.id}}),0);

  const mismatch = await accepted('SYN-QUOTE-ATOMIC-MISMATCH','14','13','113');
  await assert.rejects(service.convert(company,branch,user,mismatch.id,{invoiceDate:date}), /totals differ/);
  assert.equal(await countInvoices(),beforeInvoices);
  saved = await prisma.quotation.findUniqueOrThrow({where:{id:mismatch.id}});
  assert.equal(saved.status,'ACCEPTED');
  assert.equal(saved.convertedInvoiceId,null);

  const competing = await accepted('SYN-QUOTE-ATOMIC-RACE');
  const results = await Promise.allSettled([
    service.convert(company,branch,user,competing.id,{invoiceDate:date}),
    service.convert(company,branch,user,competing.id,{invoiceDate:date}),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length,1);
  assert.equal(results.filter(result => result.status === 'rejected').length,1);
  saved = await prisma.quotation.findUniqueOrThrow({where:{id:competing.id}});
  assert.equal(saved.status,'CONVERTED');
  assert.ok(saved.convertedInvoiceId);
  assert.equal(await countInvoices(),beforeInvoices + 1);
  assert.equal(await prisma.quotationEvent.count({where:{quotationId:competing.id,type:'CONVERTED'}}),1);
  assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:'quotations',entityId:competing.id,action:'UPDATE'}}),1);
  assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:'sales_invoices',entityId:saved.convertedInvoiceId,action:'CREATE'}}),1);
  await assert.rejects(service.convert(company,branch,user,competing.id,{invoiceDate:date}), /already been converted/);
  assert.equal(await countInvoices(),beforeInvoices + 1);
  console.log('PASS: quotation invoice conversion rollback, totals mismatch and concurrent claim on real PostgreSQL (no UI or JWT).');
};
