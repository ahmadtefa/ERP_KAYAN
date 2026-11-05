'use strict';
// Loopback HTTP -> real order controllers/services -> disposable PostgreSQL.
// Identity is injected; no JWT signature, licence, Flutter or installed app.
const assert=require('node:assert/strict');
const {Module,ValidationPipe}=require('@nestjs/common');
const {NestFactory,Reflector}=require('@nestjs/core');
const {PermissionsGuard}=require('../src/common/guards/permissions.guard');
const {ProblemDetailsFilter}=require('../src/common/filters/problem-details.filter');
const {SalesOrdersController}=require('../src/modules/sales/sales-orders.controller');
const {SalesOrdersService}=require('../src/modules/sales/sales-orders.service');
const {PurchaseOrdersController}=require('../src/modules/purchases/purchase-orders.controller');
const {PurchaseOrdersService}=require('../src/modules/purchases/purchase-orders.service');

module.exports=async function verifyOrdersHttp({prisma,audit,sales,purchases,company,branch,user,item,customer,supplier,date}) {
  const url=new URL(process.env.DATABASE_URL||'');
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||
     url.hostname!=='127.0.0.1'||url.port!=='5432'||!/^\/kayan_upgrade_[0-9a-f]{16}$/.test(url.pathname)||
     process.env.KAYAN_STOCK_DISPOSABLE_DATABASE!==url.pathname.slice(1)||
     process.env.PRISMA_SCHEMA_ENGINE_BINARY||process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
    throw new Error('Order HTTP test requires the isolated native PostgreSQL CI fixture');
  }
  class FixtureModule {}
  Module({controllers:[SalesOrdersController,PurchaseOrdersController],providers:[
    {provide:SalesOrdersService,useValue:sales},{provide:PurchaseOrdersService,useValue:purchases},
  ]})(FixtureModule);
  const app=await NestFactory.create(FixtureModule,{logger:false});
  let permissions=[];
  app.use((req,_res,next)=>{req.user={companyId:company,userId:user,branchId:branch,isSuperAdmin:false,permissions};next();});
  app.useGlobalGuards(new PermissionsGuard(new Reflector()));
  app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
  app.useGlobalFilters(new ProblemDetailsFilter());
  try {
    await app.listen(0,'127.0.0.1');
    const origin=`http://127.0.0.1:${app.getHttpServer().address().port}`;
    for (const spec of [
      {kind:'sales',path:'/sales/orders',partyField:'customerId',party:customer,model:prisma.salesOrder,
        line:prisma.salesOrderLine,invoice:prisma.salesInvoice,permission:'sales'},
      {kind:'purchase',path:'/purchases/orders',partyField:'supplierId',party:supplier,model:prisma.purchaseOrder,
        line:prisma.purchaseOrderLine,invoice:prisma.purchaseInvoice,permission:'purchases'},
    ]) {
      const req=(method,path,body)=>fetch(origin+spec.path+path,{method,headers:{'content-type':'application/json'},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      const orderPayload={[spec.partyField]:spec.party,orderDate:date,idempotencyKey:`http-${spec.kind}-order-0001`,
        lines:[{itemId:item,quantity:'4',unitPrice:'2',taxRate:'0'}]};
      permissions=[`${spec.permission}.orders.create`];
      const orderCount=await spec.model.count({where:{companyId:company}});
      const created=await req('POST','',orderPayload); assert.equal(created.status,201);
      const order=await created.json();
      assert.equal((await (await req('POST','',orderPayload)).json()).id,order.id);
      assert.equal(await spec.model.count({where:{companyId:company}}),orderCount+1);
      assert.equal((await req('POST',`/${order.id}/approve`,{})).status,403);
      assert.equal((await spec.model.findUniqueOrThrow({where:{id:order.id}})).status,'DRAFT');
      permissions=[...permissions,`${spec.permission}.orders.approve`,`${spec.permission}.orders.read`];
      assert.equal((await req('POST',`/${order.id}/approve`,{})).status,201);
      const orderLine=await spec.line.findFirstOrThrow({where:{orderId:order.id}});
      const body={idempotencyKey:`http-${spec.kind}-partial-0001`,invoiceDate:date,
        lines:[{orderLineId:orderLine.id,quantity:'2'}]};
      const beforeInvoices=await spec.invoice.count({where:{companyId:company}});
      const beforeMovements=await prisma.stockMovement.count({where:{companyId:company}});
      const beforeJournals=await prisma.journalEntry.count({where:{companyId:company}});
      assert.equal((await req('POST',`/${order.id}/invoice`,body)).status,403);
      assert.equal(await spec.invoice.count({where:{companyId:company}}),beforeInvoices);
      permissions=[...permissions,`${spec.permission}.invoices.create`];
      const missingKey={invoiceDate:date,lines:body.lines};
      assert.equal((await req('POST',`/${order.id}/invoice`,missingKey)).status,400);
      const realAudit=audit.recordRequired.bind(audit);
      audit.recordRequired=async (input,tx)=>{
        if(input.entity===`${spec.kind}_orders`&&input.action==='INVOICE'&&input.entityId===order.id) throw new Error('synthetic order audit failure');
        return realAudit(input,tx);
      };
      try { assert.equal((await req('POST',`/${order.id}/invoice`,body)).status,500); }
      finally {audit.recordRequired=realAudit;}
      assert.equal(await spec.invoice.count({where:{companyId:company}}),beforeInvoices);
      assert.equal((await spec.line.findUniqueOrThrow({where:{id:orderLine.id}})).invoicedQuantity.toFixed(4),'0.0000');
      const retries=await Promise.all([req('POST',`/${order.id}/invoice`,body),req('POST',`/${order.id}/invoice`,body)]);
      assert.ok(retries.every(r=>r.status===201));
      const results=await Promise.all(retries.map(r=>r.json()));
      assert.equal(results[0].invoice.id,results[1].invoice.id);
      assert.equal(await spec.invoice.count({where:{companyId:company}}),beforeInvoices+1);
      assert.equal((await spec.line.findUniqueOrThrow({where:{id:orderLine.id}})).invoicedQuantity.toFixed(4),'2.0000');
      assert.equal((await spec.model.findUniqueOrThrow({where:{id:order.id}})).status,'PARTIALLY_FULFILLED');
      assert.equal((await req('POST',`/${order.id}/invoice`,{...body,lines:[{orderLineId:orderLine.id,quantity:'1'}]})).status,409);
      const rest={...body,idempotencyKey:`http-${spec.kind}-final-0001`};
      const final=await req('POST',`/${order.id}/invoice`,rest);assert.equal(final.status,201);
      assert.notEqual((await final.json()).invoice.id,results[0].invoice.id);
      assert.equal((await spec.model.findUniqueOrThrow({where:{id:order.id}})).status,'FULFILLED');
      assert.equal((await spec.line.findUniqueOrThrow({where:{id:orderLine.id}})).invoicedQuantity.toFixed(4),'4.0000');
      assert.equal(await spec.invoice.count({where:{companyId:company}}),beforeInvoices+2);
      assert.equal(await prisma.stockMovement.count({where:{companyId:company}}),beforeMovements);
      assert.equal(await prisma.journalEntry.count({where:{companyId:company}}),beforeJournals);
      assert.equal(await prisma.auditLog.count({where:{companyId:company,entity:`${spec.kind}_orders`,entityId:order.id,action:'INVOICE'}}),2);
    }
    console.log('PASS: real HTTP and PostgreSQL sale/purchase order partial/full conversion, permissions, retry, conflict and audit rollback; drafts do not post stock. Identity injected, no JWT or Flutter.');
  } finally {await app.close();}
};
