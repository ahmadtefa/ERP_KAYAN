'use strict';
// Called only by the disposable upgrade fixture, with an already-connected
// real Prisma service. No signing or license keys: JWT verification is a test
// double; the production JwtAuthGuard's database lookup and PermissionsGuard
// remain real. Nothing here is a substitute for a JWT or installed UI test.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory, Reflector } = require('@nestjs/core');
const { JwtAuthGuard } = require('../src/common/guards/jwt-auth.guard');
const { PermissionsGuard } = require('../src/common/guards/permissions.guard');
const { ProblemDetailsFilter } = require('../src/common/filters/problem-details.filter');
const { StockDocumentsController } = require('../src/modules/inventory/stock-documents.controller');
const { StockDocumentsService } = require('../src/modules/inventory/stock-documents.service');

module.exports = async function verifyVoucherHttp({prisma,audit,service,company,branch,item,centre,warehouse,date,otherVoucher,warehouseBalance}) {
  const url = new URL(process.env.DATABASE_URL || '');
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
      url.hostname !== '127.0.0.1' || url.port !== '5432' ||
      !/^\/kayan_upgrade_[0-9a-f]{16}$/.test(url.pathname) ||
      process.env.KAYAN_STOCK_DISPOSABLE_DATABASE !== url.pathname.slice(1) ||
      process.env.PRISMA_SCHEMA_ENGINE_BINARY || process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
    throw new Error('Voucher HTTP test requires the isolated native PostgreSQL CI fixture');
  }
  const account = await prisma.user.create({data:{companyId:company,username:'synthetic-http-stock-user',
    fullNameEn:'Synthetic stock user',fullNameAr:'مستخدم تجريبي',passwordHash:'invalid-synthetic-hash'}});
  await prisma.userBranch.create({data:{userId:account.id,branchId:branch}});
  const permissionIds = new Map();
  for (const code of ['inventory.stock.read','inventory.stock.adjust','inventory.stock.review',
    'inventory.stock.approve','inventory.cost.read']) {
    const permission = await prisma.permission.upsert({where:{code},update:{},
      create:{code,nameEn:code,nameAr:code,module:'inventory'}});
    permissionIds.set(code,permission.id);
  }
  const grant = async code => prisma.userPermission.create({data:{userId:account.id,permissionId:permissionIds.get(code)}});
  const revoke = async code => prisma.userPermission.delete({where:{userId_permissionId:{userId:account.id,permissionId:permissionIds.get(code)}}});
  await grant('inventory.stock.read');

  // This verifier accepts only in-memory random fixture credentials and returns
  // claims; it deliberately does NOT create or validate JWTs or signatures.
  const credential = randomBytes(32).toString('hex');
  const badCredential = randomBytes(32).toString('hex');
  const verifier = {verifyAsync: async value => {
    if (value !== credential) throw new Error('synthetic verification failure');
    return {sub:account.id,companyId:company,branchId:branch,tokenVersion:0,
      permissions:['inventory.stock.adjust','inventory.cost.read']};
  }};
  class FixtureModule {}
  Module({controllers:[StockDocumentsController],providers:[{provide:StockDocumentsService,useValue:service}]})(FixtureModule);
  const app = await NestFactory.create(FixtureModule,{logger:false});
  app.useGlobalGuards(new JwtAuthGuard(new Reflector(),verifier,prisma), new PermissionsGuard(new Reflector()));
  app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
  app.useGlobalFilters(new ProblemDetailsFilter());
  try {
    await app.listen(0,'127.0.0.1');
    const base=`http://127.0.0.1:${app.getHttpServer().address().port}/inventory/stock-documents`;
    const request=(method,path='',body,auth=credential) => fetch(base+path,{method,
      headers:{'content-type':'application/json',...(auth ? {authorization:`Bearer ${auth}`} : {})},
      ...(body === undefined ? {} : {body:JSON.stringify(body)})});
    assert.equal((await request('GET','',undefined,null)).status,401);
    assert.equal((await request('GET','',undefined,badCredential)).status,401);
    // Real principal and branch are loaded from PostgreSQL, not from claims.
    assert.equal((await request('GET',`/${otherVoucher.id}`)).status,404);
    const input={idempotencyKey:'http-voucher-receipt-create-0001',kind:'ADJUSTMENT',voucherKind:'RECEIPT',
      documentDate:date,toWarehouseId:warehouse,costCenterId:centre,reason:'Synthetic HTTP receipt',
      counterpartyName:'Synthetic party',lines:[{itemId:item,quantity:'2',unitCost:'7.5'}]};
    const beforeCount = await prisma.stockDocument.count({where:{companyId:company}});
    // The forged claims include permissions, but actual grants currently do not.
    assert.equal((await request('POST','',input)).status,403);
    assert.equal(await prisma.stockDocument.count({where:{companyId:company}}),beforeCount);
    await grant('inventory.stock.adjust');
    assert.equal((await request('POST','',input)).status,403); // receipt cost permission
    assert.equal(await prisma.stockDocument.count({where:{companyId:company}}),beforeCount);
    await grant('inventory.cost.read');
    const created=await request('POST','',input);
    assert.equal(created.status,201);
    const receipt=await created.json();
    assert.equal(receipt.status,'draft');
    assert.equal(receipt.editVersion,0);
    assert.equal((await (await request('POST','',input)).json()).id,receipt.id);
    assert.equal(await prisma.stockDocument.count({where:{companyId:company}}),beforeCount+1);
    assert.equal((await request('POST','',{...input,reason:'Different payload'})).status,409);

    // Review/approval are separate database grants, and versions prevent stale
    // HTTP requests from silently advancing the workflow.
    const id=receipt.id;
    assert.equal((await request('POST',`/${id}/review`,{expectedVersion:0})).status,403);
    await grant('inventory.stock.review');
    assert.equal((await request('POST',`/${id}/review`,{})).status,400);
    let response=await request('POST',`/${id}/review`,{expectedVersion:0});
    assert.equal(response.status,201);
    assert.equal((await response.json()).editVersion,1);
    assert.equal((await request('POST',`/${id}/approve`,{expectedVersion:1})).status,403);
    await grant('inventory.stock.approve');
    assert.equal((await request('POST',`/${id}/approve`,{expectedVersion:0})).status,409);
    response=await request('POST',`/${id}/approve`,{expectedVersion:1});
    assert.equal(response.status,201);
    assert.equal((await response.json()).editVersion,2);
    assert.equal((await request('POST',`/${id}/post`,{expectedVersion:1})).status,409);
    const beforeBalance=await warehouseBalance(warehouse);
    const beforeJournalCount=await prisma.journalEntry.count({where:{sourceId:id}});
    const previousAudit=audit.recordRequired.bind(audit);
    audit.recordRequired=async (entry,tx) => {
      if (entry.entity==='stock_documents' && entry.entityId===id && entry.action==='POST') throw new Error('synthetic audit failure');
      return previousAudit(entry,tx);
    };
    try { assert.equal((await request('POST',`/${id}/post`,{expectedVersion:2})).status,500); }
    finally { audit.recordRequired=previousAudit; }
    assert.equal((await prisma.stockDocument.findUniqueOrThrow({where:{id}})).status,'DRAFT');
    assert.equal(await prisma.stockMovement.count({where:{referenceId:id}}),0);
    assert.equal(await prisma.journalEntry.count({where:{sourceId:id}}),beforeJournalCount);
    assert.equal(await warehouseBalance(warehouse),beforeBalance);
    const postings=await Promise.all([request('POST',`/${id}/post`,{expectedVersion:2}),request('POST',`/${id}/post`,{expectedVersion:2})]);
    assert.equal(postings.filter(r=>r.status===201).length,1);
    assert.equal(postings.filter(r=>r.status>=400).length,1);
    const posted=await prisma.stockDocument.findUniqueOrThrow({where:{id}});
    assert.equal(posted.status,'POSTED');
    const movements=await prisma.stockMovement.findMany({where:{referenceId:id}});
    assert.equal(movements.length,1);
    assert.equal(movements[0].quantity.toFixed(4),'2.0000');
    assert.equal(movements[0].direction,'IN');
    assert.equal(await warehouseBalance(warehouse),beforeBalance+2);
    const journal=await prisma.journalEntry.findUniqueOrThrow({where:{id:posted.journalEntryId},include:{lines:true}});
    assert.equal(journal.totalDebit.toFixed(4),journal.totalCredit.toFixed(4));
    assert.equal(journal.totalDebit.toFixed(4),'15.0000');
    assert.ok(journal.lines.some(line=>line.costCenterId===centre));

    // Grant changes must take effect immediately despite unchanged claims.
    await revoke('inventory.cost.read');
    response=await request('GET',`/${id}`);
    assert.equal(response.status,200);
    assert.equal((await response.json()).lines[0].unitCost,null);
    await revoke('inventory.stock.adjust');
    assert.equal((await request('POST',`/${id}/reverse`,{})).status,403);
    assert.equal((await prisma.stockDocument.findUniqueOrThrow({where:{id}})).status,'POSTED');
    await grant('inventory.stock.adjust');
    const reversals=await Promise.all([request('POST',`/${id}/reverse`,{}),request('POST',`/${id}/reverse`,{})]);
    assert.equal(reversals.filter(r=>r.status===201).length,1);
    assert.equal(reversals.filter(r=>r.status>=400).length,1);
    assert.equal((await prisma.stockDocument.findUniqueOrThrow({where:{id}})).status,'REVERSED');
    assert.equal(await prisma.stockMovement.count({where:{referenceId:id}}),2);
    assert.equal(await warehouseBalance(warehouse),beforeBalance);
    for (const action of ['CREATE','REVIEW','APPROVE','POST','REVERSE']) {
      assert.equal(await prisma.auditLog.count({where:{entity:'stock_documents',entityId:id,action}}),1);
    }
    // The same caller can process an issue without cost permission. Editing
    // an approved draft resets both approvals; a retry with the same key is
    // stable while a stale version is rejected.
    const issueInput={idempotencyKey:'http-voucher-issue-create-0001',kind:'ADJUSTMENT',voucherKind:'ISSUE',
      documentDate:date,toWarehouseId:warehouse,costCenterId:centre,reason:'Synthetic HTTP issue',
      counterpartyName:'Synthetic department',lines:[{itemId:item,quantity:'-1'}]};
    const beforeIssueDocuments=await prisma.stockDocument.count({where:{companyId:company}});
    const missingCentre={...issueInput,idempotencyKey:'http-voucher-issue-no-centre-0001'};
    delete missingCentre.costCenterId;
    assert.equal((await request('POST','',missingCentre)).status,400);
    assert.equal(await prisma.stockDocument.count({where:{companyId:company}}),beforeIssueDocuments);
    response=await request('POST','',issueInput);
    assert.equal(response.status,201);
    const issue=await response.json();
    assert.equal(issue.lines[0].unitCost,null);
    assert.equal((await request('POST',`/${issue.id}/review`,{expectedVersion:0})).status,201);
    assert.equal((await request('POST',`/${issue.id}/approve`,{expectedVersion:1})).status,201);
    const edit={idempotencyKey:'http-voucher-issue-edit-0001',expectedVersion:2,documentDate:date,
      toWarehouseId:warehouse,costCenterId:centre,reason:'Updated HTTP issue',counterpartyName:'Synthetic department',
      lines:[{id:issue.lines[0].id,itemId:item,quantity:'-2'}]};
    response=await request('PUT',`/${issue.id}/voucher-draft`,edit);
    assert.equal(response.status,200);
    const edited=await response.json();
    assert.equal(edited.editVersion,3);
    assert.equal(edited.reviewedAt,null); assert.equal(edited.approvedAt,null);
    assert.equal(edited.lines[0].unitCost,null);
    response=await request('PUT',`/${issue.id}/voucher-draft`,edit);
    assert.equal(response.status,200); assert.equal((await response.json()).editVersion,3);
    assert.equal((await request('POST',`/${issue.id}/review`,{expectedVersion:2})).status,409);
    assert.equal((await request('POST',`/${issue.id}/post`,{expectedVersion:3})).status,400);
    assert.equal((await request('POST',`/${issue.id}/review`,{expectedVersion:3})).status,201);
    assert.equal((await request('POST',`/${issue.id}/approve`,{expectedVersion:4})).status,201);
    const beforeIssueBalance=await warehouseBalance(warehouse);
    await prisma.costCenter.update({where:{id:centre},data:{isActive:false}});
    try {
      assert.equal((await request('POST',`/${issue.id}/post`,{expectedVersion:5})).status,400);
      assert.equal((await prisma.stockDocument.findUniqueOrThrow({where:{id:issue.id}})).status,'DRAFT');
      assert.equal(await prisma.stockMovement.count({where:{referenceId:issue.id}}),0);
      assert.equal(await warehouseBalance(warehouse),beforeIssueBalance);
    } finally {await prisma.costCenter.update({where:{id:centre},data:{isActive:true}});}
    // Controlled race 1: a concurrent deactivation holds the centre's row
    // before posting. Observe the real PG lock wait rather than assuming that
    // two promises happened to overlap. The post must see inactive after the
    // update commits, and roll back its document claim and financial effects.
    const waitForLock = async (fragment, stillPending) => {
      const deadline=Date.now()+8000;
      while (Date.now()<deadline && stillPending()) {
        const rows=await prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname=current_database() AND pid<>pg_backend_pid()
          AND wait_event_type='Lock' AND query ILIKE ${'%' + fragment + '%'}`;
        if (rows[0].n>0) return;
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      throw new Error('Expected a PostgreSQL row-lock wait before the competing operation completed');
    };
    let releaseDisable, enteredDisable;
    const disableEntered=new Promise(resolve=>{enteredDisable=resolve;});
    const disableGate=new Promise(resolve=>{releaseDisable=resolve;});
    const disabling=prisma.$transaction(async tx=>{
      await tx.costCenter.update({where:{id:centre},data:{isActive:false}});
      enteredDisable(); await disableGate;
    },{timeout:20000});
    await Promise.race([disableEntered,disabling.then(()=>{throw new Error('Deactivation transaction ended before its barrier');})]);
    let pending=true;
    const rejectedPost=request('POST',`/${issue.id}/post`,{expectedVersion:5})
      .finally(()=>{pending=false;});
    try { await waitForLock('FOR SHARE',()=>pending); }
    finally { releaseDisable(); await disabling; }
    try {
      assert.equal((await rejectedPost).status,400);
      assert.equal((await prisma.stockDocument.findUniqueOrThrow({where:{id:issue.id}})).status,'DRAFT');
      assert.equal(await prisma.stockMovement.count({where:{referenceId:issue.id}}),0);
      assert.equal(await prisma.journalEntry.count({where:{sourceId:issue.id}}),0);
      assert.equal(await warehouseBalance(warehouse),beforeIssueBalance);
    } finally { await prisma.costCenter.update({where:{id:centre},data:{isActive:true}}); }

    // Controlled race 2: pause after the post validated the locked centre;
    // disabling must wait until the successful posting commits. No business
    // method is replaced: the wrapper calls the actual validation first.
    const originalAssert=service.costCenters.assertPostable;
    let releasePost, enteredPost;
    const postEntered=new Promise(resolve=>{enteredPost=resolve;});
    const postGate=new Promise(resolve=>{releasePost=resolve;});
    service.costCenters.assertPostable=async function (...args) {
      await originalAssert.apply(this,args); enteredPost(); await postGate;
    };
    let disablePending=true;
    const postFirst=request('POST',`/${issue.id}/post`,{expectedVersion:5});
    let disableSecond;
    try {
      await Promise.race([postEntered,postFirst.then(()=>{throw new Error('Post ended before its validation barrier');})]);
      disableSecond=prisma.costCenter.update({where:{id:centre},data:{isActive:false}})
        .finally(()=>{disablePending=false;});
      await waitForLock('UPDATE',()=>disablePending);
    } finally { releasePost(); service.costCenters.assertPostable=originalAssert; }
    response=await postFirst;
    assert.equal(response.status,201);
    await disableSecond;
    assert.equal((await prisma.costCenter.findUniqueOrThrow({where:{id:centre}})).isActive,false);
    await prisma.costCenter.update({where:{id:centre},data:{isActive:true}});
    assert.equal((await response.json()).lines[0].unitCost,null);
    const issueMovement=await prisma.stockMovement.findFirstOrThrow({where:{referenceId:issue.id}});
    assert.equal(issueMovement.direction,'OUT'); assert.equal(issueMovement.quantity.toFixed(4),'2.0000');
    assert.ok(issueMovement.unitCost.greaterThan(0));
    assert.equal(await warehouseBalance(warehouse),beforeIssueBalance-2);
    assert.equal((await request('POST',`/${issue.id}/reverse`,{})).status,201);
    assert.equal(await warehouseBalance(warehouse),beforeIssueBalance);
    assert.equal(await prisma.stockMovement.count({where:{referenceId:issue.id}}),2);
    assert.equal(await prisma.auditLog.count({where:{entity:'stock_documents',entityId:issue.id,action:'UPDATE'}}),1);

    await prisma.user.update({where:{id:account.id},data:{tokenVersion:{increment:1}}});
    assert.equal((await request('GET',`/${id}`)).status,401);
    console.log('PASS: stock receipt/issue HTTP, live PostgreSQL grants and branch isolation, versioned edit, centre deactivation/post row-lock races, concurrent post/reverse, audit rollback and cost redaction. JWT verifier is fake; no Flutter or licence.');
  } finally { await app.close(); }
};
