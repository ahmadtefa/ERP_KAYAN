'use strict';
// HTTP integration for returns and cost redaction on the isolated PG fixture.
// Identity is injected: no signed JWT, licensed product or Flutter claims.
const assert=require('node:assert/strict');
const {Module}=require('@nestjs/common');
const {NestFactory,Reflector}=require('@nestjs/core');
const {PermissionsGuard}=require('../src/common/guards/permissions.guard');
const {ProblemDetailsFilter}=require('../src/common/filters/problem-details.filter');
const {ReturnsController}=require('../src/modules/returns/returns.controller');
const {ReturnsService}=require('../src/modules/returns/returns.service');

module.exports=async function verifyReturnHttp({prisma,returns,company,user,branch,item,date,kind,invoiceId,lineId}) {
  const url=new URL(process.env.DATABASE_URL||'');
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||
      url.hostname!=='127.0.0.1'||url.port!=='5432'||!/^\/kayan_upgrade_[0-9a-f]{16}$/.test(url.pathname)||
      process.env.KAYAN_STOCK_DISPOSABLE_DATABASE!==url.pathname.slice(1)||
      process.env.PRISMA_SCHEMA_ENGINE_BINARY||process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
    throw new Error('Return HTTP test requires the isolated native PostgreSQL CI fixture');
  }
  class FixtureModule {}
  Module({controllers:[ReturnsController],providers:[{provide:ReturnsService,useValue:returns}]})(FixtureModule);
  const app=await NestFactory.create(FixtureModule,{logger:false});
  const side=kind==='sales'?'sales':'purchases';
  app.use((req,_res,next)=>{req.user={companyId:company,userId:user,branchId:branch,isSuperAdmin:false,
    permissions:[`${side}.invoices.read`,`${side}.invoices.create`,`${side}.invoices.post`,
      ...(req.headers['x-cost']==='yes'?['inventory.cost.read']:[])]};next();});
  app.useGlobalGuards(new PermissionsGuard(new Reflector()));app.useGlobalFilters(new ProblemDetailsFilter());
  const model=kind==='sales'?prisma.salesInvoice:prisma.purchaseInvoice;
  const lineModel=kind==='sales'?prisma.salesInvoiceLine:prisma.purchaseInvoiceLine;
  const balance=async()=>await prisma.stockBalance.findUniqueOrThrow({where:{companyId_branchId_itemId:{companyId:company,branchId:branch,itemId:item}}});
  const checkHidden=body=>{
    assert.equal(body.landedCostAmount,null);
    assert.equal(body.lines.length,1);
    if(kind==='sales'){assert.equal(body.lines[0].unitCost,null);assert.equal(body.lines[0].costTotal,null);}
    else {assert.equal(body.lines[0].landedCostAmount,null);assert.equal(body.lines[0].inventoryCostTotal,null);}
    assert.ok(body.lines[0].unitPrice!==null);
  };
  try {
    await app.listen(0,'127.0.0.1');
    const base=`http://127.0.0.1:${app.getHttpServer().address().port}/returns/${side}`;
    const send=(method,path='',data,mayReadCost=false)=>fetch(base+path,{method,
      headers:{'content-type':'application/json','x-cost':mayReadCost?'yes':'no'},
      ...(data===undefined?{}:{body:JSON.stringify(data)})});
    const before=await balance();
    assert.equal((await lineModel.findUniqueOrThrow({where:{id:lineId}})).returnedQuantity.toFixed(4),'0.0000');
    const created=await send('POST','',{originalInvoiceId:invoiceId,returnDate:date,reason:'Synthetic return',
      lines:[{originalLineId:lineId,quantity:'1',unitName:'carton'}]});
    assert.equal(created.status,201);
    const draft=await created.json();checkHidden(draft);
    assert.equal(draft.lines[0].quantity,'10.0000');assert.equal(draft.lines[0].unitFactor,'10.000000');
    const posted=await send('POST',`/${draft.id}/post`,{});assert.equal(posted.status,201);
    const postedBody=await posted.json();checkHidden(postedBody);
    const movement=await prisma.stockMovement.findFirstOrThrow({where:{referenceId:draft.id}});
    assert.equal(movement.quantity.toFixed(4),'10.0000');
    assert.equal(movement.direction,kind==='sales'?'IN':'OUT');
    const during=await balance();
    assert.equal(Number(during.quantity.toString()),Number(before.quantity.toString())+(kind==='sales'?10:-10));
    assert.equal((await lineModel.findUniqueOrThrow({where:{id:lineId}})).returnedQuantity.toFixed(4),'10.0000');
    const full=await send('GET',`/${draft.id}`,undefined,true);assert.equal(full.status,200);
    const fullBody=await full.json();
    assert.ok(Number(kind==='sales'?fullBody.lines[0].costTotal:fullBody.lines[0].inventoryCostTotal)>0);
    const reversed=await send('POST',`/${draft.id}/reverse`,{});assert.equal(reversed.status,201);
    const reversedBody=await reversed.json();checkHidden(reversedBody);
    assert.equal((await model.findUniqueOrThrow({where:{id:draft.id}})).status,'REVERSED');
    assert.equal((await lineModel.findUniqueOrThrow({where:{id:lineId}})).returnedQuantity.toFixed(4),'0.0000');
    const after=await balance();
    assert.equal(after.quantity.toFixed(4),before.quantity.toFixed(4));
    assert.equal(after.value.toFixed(4),before.value.toFixed(4));
    assert.equal(await prisma.stockMovement.count({where:{referenceId:draft.id}}),2);
    console.log(`PASS: ${kind} return HTTP create/post/reverse, historical unit, stock and permission-dependent cost response on real PG; principal injected.`);
  } finally {await app.close();}
};
