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
  // Simulate a different connection changing status after the draft read and
  // before the deletion claim. Never hide an issued/accepted quotation.
  const {PrismaService} = require('../src/common/prisma/prisma.service');
  const other = new PrismaService();
  await other.$connect();
  try {
    const stale = await accepted('SYN-QUOTE-REMOVE-RACE');
    await prisma.quotation.update({where:{id:stale.id},data:{status:'DRAFT'}});
    const readDraft = service.draft.bind(service);
    service.draft = async (...args) => {
      const snapshot = await readDraft(...args);
      await other.quotation.update({where:{id:stale.id},data:{status:'ACCEPTED'}});
      return snapshot;
    };
    try {
      await assert.rejects(service.remove(company,user,stale.id), /Only a draft quotation can be deleted/);
    } finally { service.draft = readDraft; }
    let retained = await prisma.quotation.findUniqueOrThrow({where:{id:stale.id}});
    assert.equal(retained.status,'ACCEPTED'); assert.equal(retained.deletedAt,null);
    assert.equal(await prisma.auditLog.count({where:{entity:'quotations',entityId:stale.id,action:'DELETE'}}),0);

    const rollback = await accepted('SYN-QUOTE-REMOVE-AUDIT');
    await prisma.quotation.update({where:{id:rollback.id},data:{status:'DRAFT'}});
    const record = audit.recordRequired;
    audit.recordRequired = async function(input,tx) {
      if (input.entityId === rollback.id && input.action === 'DELETE') throw new Error('synthetic delete audit failure');
      return record.call(this,input,tx);
    };
    try {
      await assert.rejects(service.remove(company,user,rollback.id),/synthetic delete audit failure/);
    } finally { audit.recordRequired = record; }
    retained = await prisma.quotation.findUniqueOrThrow({where:{id:rollback.id}});
    assert.equal(retained.status,'DRAFT'); assert.equal(retained.deletedAt,null);
    assert.equal(await prisma.auditLog.count({where:{entity:'quotations',entityId:rollback.id,action:'DELETE'}}),0);
    await service.remove(company,user,rollback.id);
    retained = await prisma.quotation.findUniqueOrThrow({where:{id:rollback.id}});
    assert.ok(retained.deletedAt);
    assert.equal(await prisma.auditLog.count({where:{entity:'quotations',entityId:rollback.id,action:'DELETE'}}),1);

    const defer = () => { let resolve; const promise=new Promise(r=>{resolve=r;}); return {promise,resolve}; };
    for (const action of ['send','accept','reject']) {
      const draft = await accepted(`SYN-QUOTE-ISSUE-${action.toUpperCase()}`);
      await prisma.quotation.update({where:{id:draft.id},data:{status:'DRAFT'}});
      const entered=defer(), release=defer(), attempted=defer();
      const snapshot = service.snapshotContent.bind(service);
      service.snapshotContent = async (...args) => {
        const content=await snapshot(...args);
        entered.resolve();
        await release.promise;
        return content;
      };
      const observedOther=new Proxy(other,{get(target,key) {
        if (key === '$transaction') return (work,options) => target.$transaction(tx => work(new Proxy(tx,{get(inner,property) {
          if (property !== 'quotation') return Reflect.get(inner,property,inner);
          return new Proxy(inner.quotation,{get(delegate,method) {
            if (method !== 'updateMany') return Reflect.get(delegate,method,delegate);
            return (...args) => { attempted.resolve(); return delegate.updateMany(...args); };
          }});
        }})),options);
        const value=Reflect.get(target,key,target);
        return typeof value === 'function' ? value.bind(target) : value;
      }});
      const editor=new QuotationsService(observedOther,numbers,settings,invoices,audit);
      let editSettled=false, issuing, editing;
      try {
        issuing=service[action](company,user,draft.id);
        await Promise.race([entered.promise,issuing.then(()=>{throw new Error('issuance skipped snapshot barrier');},err=>{throw err;})]);
        editing=editor.update(company,user,draft.id,{
          quotationDate:date,customerId:customer,subject:'Competing edit',
          tables:[{title:'Synthetic',lines:[{description:'Changed service',quantity:'1',unitPrice:'200'}]}],
        }).then(value=>{editSettled=true;return {value};},error=>{editSettled=true;return {error};});
        await Promise.race([attempted.promise,editing.then(()=>{throw new Error('edit did not reach transaction claim');})]);
        await new Promise(resolve=>setTimeout(resolve,100));
        assert.equal(editSettled,false,'edit must wait while issued snapshot is being made');
        release.resolve();
        const [,result]=await Promise.all([issuing,editing]);
        assert.match(String(result.error?.message),/Only a draft quotation can be edited/);
        const frozen=await prisma.quotation.findUniqueOrThrow({where:{id:draft.id},include:{tables:{include:{lines:true}}}});
        assert.equal(frozen.status,{send:'SENT',accept:'ACCEPTED',reject:'REJECTED'}[action]);
        assert.equal(frozen.contentSnapshot.tables[0].lines[0].description,'Synthetic service');
        assert.equal(frozen.tables[0].lines[0].description,'Synthetic service');
      } finally {
        release.resolve();
        service.snapshotContent=snapshot;
        await Promise.allSettled([issuing,editing].filter(Boolean));
      }
    }

    const issueFailure=await accepted('SYN-QUOTE-ISSUE-AUDIT');
    await prisma.quotation.update({where:{id:issueFailure.id},data:{status:'DRAFT'}});
    const auditFn=audit.recordRequired;
    audit.recordRequired=async function(input,tx) {
      if(input.entityId===issueFailure.id && input.action==='POST') throw new Error('synthetic issue audit failure');
      return auditFn.call(this,input,tx);
    };
    try { await assert.rejects(service.send(company,user,issueFailure.id),/synthetic issue audit failure/); }
    finally { audit.recordRequired=auditFn; }
    const afterIssueFailure=await prisma.quotation.findUniqueOrThrow({where:{id:issueFailure.id}});
    assert.equal(afterIssueFailure.status,'DRAFT'); assert.equal(afterIssueFailure.contentSnapshot,null);
    assert.equal(await prisma.quotationEvent.count({where:{quotationId:issueFailure.id}}),0);
  } finally { await other.$disconnect(); }
  console.log('PASS: quotation invoice conversion and deletion and issuance audit rollback, stale status, snapshot and concurrency on real PostgreSQL (no UI or JWT).');
};
