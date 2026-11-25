'use strict';
// Isolated native PostgreSQL source-lock acceptance. No production connections.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {Client} = require('pg');
const {PrismaClient} = require('@prisma/client');
const {PrismaPg} = require('@prisma/adapter-pg');
const {BatchesService} = require('../dist/src/modules/inventory/batches.service.js');
const {StockLedgerService} = require('../dist/src/common/warehouse/stock-ledger.service.js');
const {DocumentNumberService} = require('../dist/src/modules/accounting/document-number.service.js');
const {AccountMapService} = require('../dist/src/modules/accounting/account-map.service.js');
const {FiscalPeriodsService} = require('../dist/src/modules/accounting/fiscal-periods.service.js');
const {CostCentersService} = require('../dist/src/modules/accounting/cost-centers.service.js');
const {PostingService} = require('../dist/src/modules/accounting/posting.service.js');
const root = process.env.KAYAN_ISOLATED_PG_ROOT;
const port = Number(process.env.KAYAN_ISOLATED_PG_PORT);
if (!root || !path.isAbsolute(root) || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Explicit isolated PG root and port are required.');
const cfg = {host:path.join(root,'socket'),port,user:'kayan_test'};
const database = 'source_lock_' + randomUUID().replaceAll('-','');
const C=randomUUID(), B=randomUUID(), U=randomUUID(), W=randomUUID(), L=randomUUID(), L2=randomUUID();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const admin=new Client({...cfg,database:'postgres'});await admin.connect();
 const identity=(await admin.query("SELECT version(),current_setting('listen_addresses') AS listen,current_setting('data_directory') AS dir")).rows[0];
 assert.equal(identity.listen,'');assert.equal(identity.dir,path.join(root,'data'));
 assert.equal(fs.readFileSync(path.join(root,'data/KAYAN-ISOLATED-TEST-ONLY'),'utf8').trim(),'KAYAN ISOLATED TEST CLUSTER - NO CUSTOMER DATA');
 await admin.query(`CREATE DATABASE ${database}`);await admin.end();
 const sql=new Client({...cfg,database});await sql.connect();
 for(const dir of fs.readdirSync(path.join(__dirname,'../prisma/migrations')).sort()){
  const file=path.join(__dirname,'../prisma/migrations',dir,'migration.sql');if(fs.existsSync(file))await sql.query(fs.readFileSync(file,'utf8'));
 }
 const clients=['A','B'].map(label=>new PrismaClient({adapter:new PrismaPg({...cfg,database,application_name:'source-lock-'+label})}));
 const [p,q]=clients; await Promise.all(clients.map(x=>x.$connect()));
 const audit={record:async()=>{},recordRequired:async()=>{}};
 function service(prisma){const numbers=new DocumentNumberService();return new BatchesService(prisma,{},new PostingService(numbers,new FiscalPeriodsService(prisma,audit),new CostCentersService(prisma,audit)),new AccountMapService(),numbers,audit,new StockLedgerService());}
 const [a,b]=clients.map(service);
 await p.company.create({data:{id:C,code:'SYNTH',nameEn:'Synthetic',nameAr:'Synthetic'}});
 await p.branch.create({data:{id:B,companyId:C,code:'B',nameEn:'Branch',nameAr:'Branch'}});
 await p.warehouse.create({data:{id:W,companyId:C,branchId:B,code:'W',nameEn:'Warehouse',nameAr:'Warehouse'}});
 await p.user.create({data:{id:U,companyId:C,username:'test',fullNameEn:'Synthetic',fullNameAr:'Synthetic',passwordHash:'not-a-real-hash'}});
 for(const [id,code] of [[L,'A'],[L2,'B']])await p.storageLocation.create({data:{id,companyId:C,branchId:B,warehouseId:W,kind:'SHELF',code,nameEn:code,nameAr:code}});
 for(const [code,type] of [['1104','ASSET'],['5107','EXPENSE']])await p.account.create({data:{companyId:C,code,nameEn:code,nameAr:code,type,isPostable:true,isActive:true}});
 const reports=[];
 for(const mode of ['issue','writeOff','mixed']){
  const I=randomUUID();await p.item.create({data:{id:I,companyId:C,code:mode,nameEn:mode,nameAr:mode,unit:'piece',requiresBatch:true,isStockTracked:true,useFefo:true}});
  const receipt=await a.receive(C,U,{branchId:B,warehouseId:W,itemId:I,batchNumber:mode,quantity:6,unitCost:2,storageLocationId:L,expiryDate:'2027-03-01'});
  // Move half to another shelf so the lot total cannot itself prevent overspending source A.
  const {StorageLocationsService}=require('../dist/src/modules/inventory/storage-locations.service.js');
  await new StorageLocationsService(p,audit).move(C,U,{fromLocationId:L,toLocationId:L2,itemId:I,batchId:receipt.batchId,quantity:3,reason:'synthetic setup'},null);
  let release; const locked=new Promise(r=>release=r);let acquired;
  const ready=new Promise(r=>acquired=r);const original=a.lockItemStock.bind(a);
  a.lockItemStock=async(tx,w,i)=>{await original(tx,w,i);acquired();await locked;};
  const body={branchId:B,warehouseId:W,itemId:I,batchId:receipt.batchId,storageLocationId:L,quantity:2,reason:'damaged synthetic'};
  const first=a[mode === 'mixed' ? 'issue' : mode](C,U,body);await ready;
  const second=b[mode === 'mixed' ? 'writeOff' : mode](C,U,body);await sleep(250);
  const waits=(await sql.query("SELECT application_name,wait_event_type,wait_event FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'",[database])).rows;
  assert.ok(waits.length>0,'independent second connection must visibly wait on a PostgreSQL lock');release();
  const results=await Promise.allSettled([first,second]);a.lockItemStock=original;
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const rejected=results.find(r=>r.status==='rejected');assert.ok(rejected);
  const source=Number((await sql.query('SELECT SUM(CASE WHEN direction=\'IN\' THEN quantity ELSE -quantity END)::text q FROM stock_movements WHERE "itemId"=$1 AND "storageLocationId"=$2',[I,L])).rows[0].q);
  assert.equal(source,1);
  const batch=await p.itemBatch.findUnique({where:{id:receipt.batchId}});assert.equal(Number(batch.remainingQuantity),4);
  reports.push({mode,successes:1,sourceRemaining:source,lotRemaining:Number(batch.remainingQuantity),waits,error:rejected.reason.response??String(rejected.reason)});
 }
 // Native-driver checks for assignment and explicit historical-deficit reconciliation.
 const {StorageLocationsService}=require('../dist/src/modules/inventory/storage-locations.service.js');
 const locations=new StorageLocationsService(p,audit);
 const J=randomUUID();await p.item.create({data:{id:J,companyId:C,code:'assign',nameEn:'assign',nameAr:'assign',unit:'piece',requiresBatch:true,isStockTracked:true}});
 const r=await a.receive(C,U,{branchId:B,warehouseId:W,itemId:J,batchNumber:'unlocated',quantity:4,unitCost:2});
 await locations.assignUnlocated(C,U,{warehouseId:W,toLocationId:L,itemId:J,batchId:r.batchId,quantity:3,reason:'physical placement'},null);
 // Simulate the exact legacy discrepancy with value-neutral paired ledger entries.
 for(const [storageLocationId,direction] of [[null,'OUT'],[L,'IN']])await p.stockMovement.create({data:{companyId:C,branchId:B,warehouseId:W,itemId:J,batchId:r.batchId,storageLocationId,direction,quantity:2,unitCost:2,totalCost:4,movementDate:new Date(),referenceType:'SYNTHETIC_LEGACY_DEFICIT'}});
 await locations.reconcileUnlocated(C,U,{warehouseId:W,fromLocationId:L,itemId:J,batchId:r.batchId,quantity:1,reason:'verified legacy discrepancy'},null);
 const corrected=(await sql.query('SELECT \"storageLocationId\",SUM(CASE WHEN direction=\'IN\' THEN quantity ELSE -quantity END)::text q FROM stock_movements WHERE \"itemId\"=$1 GROUP BY \"storageLocationId\"',[J])).rows;
 assert.equal(Number(corrected.find(x=>x.storageLocationId===null).q),0);
 assert.equal(Number(corrected.find(x=>x.storageLocationId===L).q),4);
 const correctedBalance=await p.warehouseStockBalance.findFirst({where:{warehouseId:W,itemId:J}});assert.equal(Number(correctedBalance.quantity),4);assert.equal(Number(correctedBalance.value),8);
 reports.push({mode:'native move/assign/reconcile',success:true,unlocated:0,located:4,warehouseQuantity:4,warehouseValue:8});
 // Opposite-order sales invoices with a deliberate lock overlap on independent clients.
 const {SalesInvoicesService}=require('../dist/src/modules/sales/sales-invoices.service.js');
 const {WarehouseService}=require('../dist/src/common/warehouse/warehouse.service.js');
 const {AuditService}=require('../dist/src/common/audit/audit.service.js');
 for(const [code,type] of [['1103','ASSET'],['4101','REVENUE'],['2103','LIABILITY'],['5101','EXPENSE']])await p.account.create({data:{companyId:C,code,nameEn:code,nameAr:code,type,isPostable:true,isActive:true}});
 const customer=await p.customer.create({data:{companyId:C,code:'BUYER',nameEn:'Synthetic',nameAr:'Synthetic'}});
 const items=[randomUUID(),randomUUID()];
 for(const id of items){await p.item.create({data:{id,companyId:C,code:id,nameEn:'Two item',nameAr:'Two item',unit:'piece',requiresBatch:true,isStockTracked:true}});await a.receive(C,U,{branchId:B,warehouseId:W,itemId:id,batchNumber:id,quantity:10,unitCost:2,storageLocationId:L});}
 function sales(prisma,batches){const au=new AuditService(prisma),numbers=new DocumentNumberService();return new SalesInvoicesService(prisma,numbers,new PostingService(numbers,new FiscalPeriodsService(prisma,au),new CostCentersService(prisma,au)),new AccountMapService(),{get:async()=>({defaultTaxRate:0,taxRate:'0',maxDiscountPercent:'100',pricesIncludeTax:false})},new WarehouseService(prisma,au),{},au,batches,new StockLedgerService(),{assertCanPost:async()=>{}});}
 const sa=sales(p,a),sb=sales(q,b);
 const inv=[];
 for(const order of [items,[...items].reverse()]){
  const id=randomUUID();
  await sql.query(`INSERT INTO sales_invoices (id,"companyId","branchId","warehouseId","invoiceNumber","invoiceDate","customerId",status,currency,"subTotal","taxAmount","totalAmount","paidAmount","costOfGoods","documentType","updatedAt") VALUES ($1,$2,$3,$4,$5,'2026-11-25',$6,'DRAFT','EGP',20,0,20,0,0,'INVOICE',now())`,[id,C,B,W,id,customer.id]);
  for(const [index,item] of order.entries())await sql.query(`INSERT INTO sales_invoice_lines (id,"invoiceId","lineNumber","itemId",description,quantity,"unitPrice","taxRate","taxAmount","lineTotal","unitCost","costTotal","locationAllocations") VALUES ($1,$2,$3,$4,'Synthetic',1,10,0,0,10,0,0,$5::jsonb)`,[randomUUID(),id,index+1,item,JSON.stringify([{storageLocationId:L,quantity:'1'}])]);
  inv.push(id);
 }
 let unlock,signal;const gated=new Promise(r=>unlock=r),entered=new Promise(r=>signal=r);const original=a.lockItemStock.bind(a);let once=true;
 a.lockItemStock=async(tx,w,i)=>{await original(tx,w,i);if(once){once=false;signal();await gated;}};
 const f=sa.post(C,U,inv[0]);await entered;const g=sb.post(C,U,inv[1]);await sleep(250);
 const waits=(await sql.query("SELECT application_name,wait_event_type,wait_event FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'",[database])).rows;assert.ok(waits.length);unlock();
 const saleResults=await Promise.allSettled([f,g]);a.lockItemStock=original;
 assert.deepEqual(saleResults.map(x=>x.status),['fulfilled','fulfilled'],JSON.stringify(saleResults));
 for(const id of items){const balance=await p.warehouseStockBalance.findFirst({where:{warehouseId:W,itemId:id}});assert.equal(Number(balance.quantity),8);}
 reports.push({mode:'sales A/B vs B/A',posted:2,eachItemRemaining:8,waits});

 const {PurchaseInvoicesService}=require('../dist/src/modules/purchases/purchase-invoices.service.js');
 const {ReturnsService}=require('../dist/src/modules/returns/returns.service.js');
 for(const [code,type] of [['2101','LIABILITY'],['1105','ASSET']])await p.account.create({data:{companyId:C,code,nameEn:code,nameAr:code,type,isPostable:true,isActive:true}});
 const supplier=await p.supplier.create({data:{companyId:C,code:'SUP',nameEn:'Synthetic',nameAr:'Synthetic'}});
 function purchase(prisma,batches){const au=new AuditService(prisma),numbers=new DocumentNumberService();const post=new PostingService(numbers,new FiscalPeriodsService(prisma,au),new CostCentersService(prisma,au));return {service:new PurchaseInvoicesService(prisma,numbers,post,new AccountMapService(),{get:async()=>({defaultTaxRate:0,taxRate:'0',maxDiscountPercent:'100',pricesIncludeTax:false})},new WarehouseService(prisma,au),new StockLedgerService(),{resolvePrice:async()=>null},au,batches),returns:new ReturnsService(prisma,numbers,post,new AccountMapService(),au,new WarehouseService(prisma,au))};}
 const pa=purchase(p,a),pb=purchase(q,b);
 for(const mode of ['purchase-receive-pair','purchase-reverse-v-issue','purchase-return-v-issue']){
  const I=randomUUID();await p.item.create({data:{id:I,companyId:C,code:mode,nameEn:mode,nameAr:mode,unit:'piece',requiresBatch:true,isStockTracked:true}});
  const dto=qty=>({supplierId:supplier.id,invoiceDate:'2026-11-25',warehouseId:W,lines:[{itemId:I,quantity:String(qty),unitPrice:'2',taxRate:'0',storageLocationId:L,batchNumber:mode}]});
  const first=await pa.service.create(C,B,U,dto(mode==='purchase-receive-pair'?5:3));
  if(mode!=='purchase-receive-pair')await pa.service.post(C,U,first.id);
  let primary,secondary;
  let unlock,signal;const gated=new Promise(r=>unlock=r),entered=new Promise(r=>signal=r);const orig=a.lockItemStock.bind(a);let once=true;
  a.lockItemStock=async(tx,w,i)=>{await orig(tx,w,i);if(once){once=false;signal();await gated;}};
  if(mode==='purchase-receive-pair'){
   const second=await pb.service.create(C,B,U,dto(5));primary=()=>pa.service.post(C,U,first.id);secondary=()=>pb.service.post(C,U,second.id);
  }else if(mode==='purchase-reverse-v-issue'){
   primary=()=>pa.service.reverse(C,U,first.id);secondary=()=>b.issue(C,U,{branchId:B,warehouseId:W,itemId:I,quantity:1,storageLocationId:L});
  }else{
   const line=await p.purchaseInvoiceLine.findFirst({where:{invoiceId:first.id}});
   const ret=await pb.returns.createPurchaseReturn(C,B,U,{originalInvoiceId:first.id,returnDate:'2026-11-25',lines:[{originalLineId:line.id,quantity:'2'}]});
   primary=()=>a.issue(C,U,{branchId:B,warehouseId:W,itemId:I,quantity:2,storageLocationId:L});secondary=()=>pb.returns.postPurchaseReturn(C,U,ret.id);
  }
  const f=primary();await entered;const g=secondary();await sleep(250);
  const waits=(await sql.query("SELECT application_name,wait_event_type,wait_event FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'",[database])).rows;
  assert.ok(waits.length,mode+' must wait on independent PostgreSQL lock');unlock();const results=await Promise.allSettled([f,g]);a.lockItemStock=orig;
  const count=results.filter(x=>x.status==='fulfilled').length;assert.equal(count,mode==='purchase-receive-pair'?2:1,JSON.stringify(results));
  const lots=await p.itemBatch.findMany({where:{itemId:I}});assert.equal(lots.length,1);const remaining=Number(lots[0].remainingQuantity);assert.equal(remaining,mode==='purchase-receive-pair'?10:mode==='purchase-reverse-v-issue'?0:1);
  const bal=await p.warehouseStockBalance.findFirst({where:{warehouseId:W,itemId:I}});assert.equal(Number(bal.quantity),remaining);
  const placed=Number((await sql.query('SELECT SUM(CASE WHEN direction=\'IN\' THEN quantity ELSE -quantity END)::text q FROM stock_movements WHERE "itemId"=$1 AND "storageLocationId"=$2',[I,L])).rows[0].q);assert.equal(placed,remaining);
  reports.push({mode,successes:count,lotRemaining:remaining,warehouseRemaining:Number(bal.quantity),sourceRemaining:placed,waits,errors:results.filter(x=>x.status==='rejected').map(x=>x.reason.response??String(x.reason))});
 }

 const targetW=randomUUID(),targetL=randomUUID();await p.warehouse.create({data:{id:targetW,companyId:C,branchId:B,code:'TARGET',nameEn:'Target',nameAr:'Target'}});await p.storageLocation.create({data:{id:targetL,companyId:C,branchId:B,warehouseId:targetW,kind:'SHELF',code:'T',nameEn:'Target',nameAr:'Target'}});
 const TI=randomUUID();await p.item.create({data:{id:TI,companyId:C,code:'transfer-race',nameEn:'Transfer race',nameAr:'Transfer race',unit:'piece',requiresBatch:true,isStockTracked:true}});
 const tr=await a.receive(C,U,{branchId:B,warehouseId:W,itemId:TI,batchNumber:'TR',quantity:3,unitCost:2,storageLocationId:L});
 let releaseT,enterT;const gateT=new Promise(r=>releaseT=r),readyT=new Promise(r=>enterT=r);const originalT=a.lockItemStock.bind(a);let firstT=true;
 a.lockItemStock=async(tx,w,i)=>{await originalT(tx,w,i);if(firstT && w===W){firstT=false;enterT();await gateT;}};
 const tf=a.transfer(C,U,{branchId:B,fromWarehouseId:W,toWarehouseId:targetW,itemId:TI,batchId:tr.batchId,quantity:2,fromStorageLocationId:L,toStorageLocationId:targetL});await readyT;
 const ti=b.issue(C,U,{branchId:B,warehouseId:W,itemId:TI,quantity:2,storageLocationId:L});await sleep(250);
 const tw=(await sql.query("SELECT application_name,wait_event_type,wait_event FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'",[database])).rows;assert.ok(tw.length);releaseT();const tres=await Promise.allSettled([tf,ti]);a.lockItemStock=originalT;assert.equal(tres.filter(x=>x.status==='fulfilled').length,1);
 const sourceT=await p.itemBatch.findUnique({where:{id:tr.batchId}});assert.equal(Number(sourceT.remainingQuantity),1);const targetT=await p.itemBatch.findFirst({where:{warehouseId:targetW,itemId:TI}});assert.equal(Number(targetT.remainingQuantity),2);
 const balanceT=await p.stockBalance.findFirst({where:{companyId:C,branchId:B,itemId:TI}});assert.equal(Number(balanceT.quantity),3);assert.equal(Number(balanceT.value),6);
 reports.push({mode:'crosswarehouse lot transfer vs source issue',successes:1,sourceLot:1,targetLot:2,branchQuantity:3,branchValue:6,waits:tw});

 const RI=randomUUID();await p.item.create({data:{id:RI,companyId:C,code:'return-reverse-race',nameEn:'Return reverse',nameAr:'Return reverse',unit:'piece',requiresBatch:true,isStockTracked:true}});
 const rd=await pa.service.create(C,B,U,{supplierId:supplier.id,invoiceDate:'2026-11-25',warehouseId:W,lines:[{itemId:RI,quantity:'3',unitPrice:'2',taxRate:'0',storageLocationId:L,batchNumber:'RR'}]});await pa.service.post(C,U,rd.id);
 const rl=await p.purchaseInvoiceLine.findFirst({where:{invoiceId:rd.id}});const rr=await pa.returns.createPurchaseReturn(C,B,U,{originalInvoiceId:rd.id,returnDate:'2026-11-25',lines:[{originalLineId:rl.id,quantity:'2'}]});await pa.returns.postPurchaseReturn(C,U,rr.id);
 let releaseR,enterR;const gateR=new Promise(r=>releaseR=r),readyR=new Promise(r=>enterR=r);const originalR=a.lockItemStock.bind(a);a.lockItemStock=async(tx,w,i)=>{await originalR(tx,w,i);enterR();await gateR;};
 const rf=a.issue(C,U,{branchId:B,warehouseId:W,itemId:RI,quantity:1,storageLocationId:L});await readyR;const rg=pb.returns.reverse(C,U,'purchases',rr.id);await sleep(250);releaseR();const rres=await Promise.allSettled([rf,rg]);a.lockItemStock=originalR;
 reports.push({mode:'purchase return reversal vs issue',results:rres.map(x=>x.status==='fulfilled'?{status:x.status}:{status:x.status,error:String(x.reason),response:x.reason.response})});
 console.log('RETURN_REVERSE_RACE',JSON.stringify(reports[reports.length-1]));assert.equal(rres.filter(x=>x.status==='fulfilled').length,2,'both disjoint-cost compatible writes should serialize without deadlock');

 await p.account.create({data:{companyId:C,code:'4102',nameEn:'Returns',nameAr:'Returns',type:'REVENUE',isPostable:true,isActive:true}});
 const SI=randomUUID();await p.item.create({data:{id:SI,companyId:C,code:'sales-return-reverse',nameEn:'Sales reverse',nameAr:'Sales reverse',unit:'piece',requiresBatch:true,isStockTracked:true}});await a.receive(C,U,{branchId:B,warehouseId:W,itemId:SI,batchNumber:'SRR',quantity:6,unitCost:2,storageLocationId:L});
 const sinv=await sa.create(C,B,U,{customerId:customer.id,invoiceDate:'2026-11-25',warehouseId:W,lines:[{itemId:SI,quantity:'2',unitPrice:'10',taxRate:'0',locationAllocations:[{storageLocationId:L,quantity:'2'}]}]});await sa.post(C,U,sinv.id);
 const sl=await p.salesInvoiceLine.findFirst({where:{invoiceId:sinv.id}});const sr=await pa.returns.createSalesReturn(C,B,U,{originalInvoiceId:sinv.id,returnDate:'2026-11-25',lines:[{originalLineId:sl.id,quantity:'2'}]});await pa.returns.postSalesReturn(C,U,sr.id);
 let releaseS,enterS;const gateS=new Promise(r=>releaseS=r),readyS=new Promise(r=>enterS=r);const origS=a.lockItemStock.bind(a);a.lockItemStock=async(tx,w,i)=>{await origS(tx,w,i);enterS();await gateS;};
 const sf=a.issue(C,U,{branchId:B,warehouseId:W,itemId:SI,quantity:1,storageLocationId:L});await readyS;const sg=pb.returns.reverse(C,U,'sales',sr.id);await sleep(250);releaseS();const sres=await Promise.allSettled([sf,sg]);a.lockItemStock=origS;
 const rs={mode:'sales return reversal vs issue',results:sres.map(x=>x.status==='fulfilled'?{status:x.status}:{status:x.status,error:String(x.reason),response:x.reason.response})};reports.push(rs);console.log('SALES_RETURN_REVERSE_RACE',JSON.stringify(rs));assert.equal(sres.filter(x=>x.status==='fulfilled').length,2,'compatible issue and return reversal should serialize without deadlock');

 const {StockDocumentsService}=require('../dist/src/modules/inventory/stock-documents.service.js');
 function docs(prisma){const au=new AuditService(prisma),n=new DocumentNumberService(),cc=new CostCentersService(prisma,au);return new StockDocumentsService(prisma,n,new PostingService(n,new FiscalPeriodsService(prisma,au),cc),new AccountMapService(),au,{get:async()=>({allowNegativeStock:false})},new WarehouseService(prisma,au),cc,new StockLedgerService());}
 const da=docs(p),db=docs(q);const DI=randomUUID();await p.item.create({data:{id:DI,companyId:C,code:'doc-race',nameEn:'Doc race',nameAr:'Doc race',unit:'piece',requiresBatch:true,isStockTracked:true}});const dr=await a.receive(C,U,{branchId:B,warehouseId:W,itemId:DI,batchNumber:'DOC',quantity:3,unitCost:2,storageLocationId:L});
 const dd=await db.create(C,B,U,{kind:'transfer',documentDate:'2026-11-25',fromBranchId:B,fromWarehouseId:W,toWarehouseId:targetW,lines:[{itemId:DI,quantity:2,batchId:dr.batchId,storageLocationId:L,toStorageLocationId:targetL}]});
 let releaseD,enterD;const gateD=new Promise(r=>releaseD=r),readyD=new Promise(r=>enterD=r);const origD=a.lockItemStock.bind(a);a.lockItemStock=async(tx,w,i)=>{await origD(tx,w,i);enterD();await gateD;};
 const df=a.issue(C,U,{branchId:B,warehouseId:W,itemId:DI,quantity:2,storageLocationId:L});await readyD;const dg=db.post(C,U,dd.id);await sleep(250);releaseD();const dres=await Promise.allSettled([df,dg]);a.lockItemStock=origD;
 const dreport={mode:'stock document transfer vs source issue',results:dres.map(x=>x.status==='fulfilled'?{status:x.status}:{status:x.status,error:String(x.reason),response:x.reason.response})};console.log('STOCK_DOC_RACE',JSON.stringify(dreport));reports.push(dreport);assert.equal(dres.filter(x=>x.status==='fulfilled').length,1);assert.ok(!String(dres.find(x=>x.status==='rejected').reason).includes('deadlock')); 
 const dl=await p.itemBatch.findUnique({where:{id:dr.batchId}});assert.equal(Number(dl.remainingQuantity),1);

 const EI=randomUUID();await p.item.create({data:{id:EI,companyId:C,code:'doc-enough',nameEn:'Enough',nameAr:'Enough',unit:'piece',requiresBatch:true,isStockTracked:true}});const er=await a.receive(C,U,{branchId:B,warehouseId:W,itemId:EI,batchNumber:'ENOUGH',quantity:6,unitCost:2,storageLocationId:L});const ed=await db.create(C,B,U,{kind:'transfer',documentDate:'2026-11-25',fromBranchId:B,fromWarehouseId:W,toWarehouseId:targetW,lines:[{itemId:EI,quantity:2,batchId:er.batchId,storageLocationId:L,toStorageLocationId:targetL}]});
 let releaseE,enterE;const gateE=new Promise(r=>releaseE=r),readyE=new Promise(r=>enterE=r);const origE=a.lockItemStock.bind(a);a.lockItemStock=async(tx,w,i)=>{await origE(tx,w,i);enterE();await gateE;};const ef=a.issue(C,U,{branchId:B,warehouseId:W,itemId:EI,quantity:2,storageLocationId:L});await readyE;const eg=db.post(C,U,ed.id);await sleep(250);releaseE();const eres=await Promise.allSettled([ef,eg]);a.lockItemStock=origE;assert.equal(eres.filter(x=>x.status==='fulfilled').length,2,JSON.stringify(eres));const eLot=await p.itemBatch.findUnique({where:{id:er.batchId}});assert.equal(Number(eLot.remainingQuantity),2);reports.push({mode:'stock document transfer vs issue sufficient stock',successes:2,sourceLot:2});
 const OI=randomUUID();await p.item.create({data:{id:OI,companyId:C,code:'opposite-docs',nameEn:'Opposite',nameAr:'Opposite',unit:'piece',requiresBatch:true,isStockTracked:true}});const orA=await a.receive(C,U,{branchId:B,warehouseId:W,itemId:OI,batchNumber:'OP',quantity:5,unitCost:2,storageLocationId:L});const orB=await a.receive(C,U,{branchId:B,warehouseId:targetW,itemId:OI,batchNumber:'OP',quantity:5,unitCost:2,storageLocationId:targetL});
 const od=[];for(const [from,to,src,dst,lot] of [[W,targetW,L,targetL,orA.batchId],[targetW,W,targetL,L,orB.batchId]])od.push(await da.create(C,B,U,{kind:'transfer',documentDate:'2026-11-25',fromBranchId:B,fromWarehouseId:from,toWarehouseId:to,lines:[{itemId:OI,quantity:1,batchId:lot,storageLocationId:src,toStorageLocationId:dst}]}));
 const ores=await Promise.allSettled([da.post(C,U,od[0].id),db.post(C,U,od[1].id)]);assert.equal(ores.filter(x=>x.status==='fulfilled').length,2,JSON.stringify(ores));for(const wh of [W,targetW])assert.equal(Number((await p.itemBatch.findFirst({where:{warehouseId:wh,itemId:OI}})).remainingQuantity),5);reports.push({mode:'opposite warehouse stock document transfers',posted:2,eachLot:5});



 if(process.env.KAYAN_GENERIC_REVERSE==='1'){
  for(const mode of ['adjust-positive','count-negative','count-positive','positive-issue-overlap']){
   const item=randomUUID();await p.item.create({data:{id:item,companyId:C,code:'GEN-'+mode,nameEn:mode,nameAr:mode,unit:'piece',requiresBatch:true,isStockTracked:true}});const lot=await a.receive(C,U,{branchId:B,warehouseId:W,itemId:item,batchNumber:'GEN',quantity:10,unitCost:12,storageLocationId:L});const count=mode.startsWith('count');const doc=await da.create(C,B,U,{kind:count?'count':'adjustment',documentDate:'2026-11-25',toWarehouseId:W,lines:[{itemId:item,quantity:count?0:2,...(count?{countedQuantity:mode==='count-negative'?8:12}:{}),unitCost:12,batchId:lot.batchId,storageLocationId:L}]});await da.post(C,U,doc.id);
   const full=async()=>({lot:await p.itemBatch.findUnique({where:{id:lot.batchId},select:{remainingQuantity:true,receivedQuantity:true,unitCost:true,status:true}}),w:await p.warehouseStockBalance.findFirst({where:{itemId:item,warehouseId:W},select:{quantity:true,value:true}})});
   if(mode==='positive-issue-overlap'){
    let release,enter;const ready=new Promise(r=>enter=r),gate=new Promise(r=>release=r),orig=a.lockItemStock.bind(a);a.lockItemStock=async(tx,w,i)=>{await orig(tx,w,i);enter();await gate;};const issue=a.issue(C,U,{branchId:B,warehouseId:W,itemId:item,batchId:lot.batchId,quantity:11,storageLocationId:L});await ready;const reverse=db.reverse(C,U,doc.id);await sleep(200);release();const result=await Promise.allSettled([issue,reverse]);a.lockItemStock=orig;const end=await full();const ledger=await sql.query(`SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN quantity ELSE -quantity END),0)::text q FROM stock_movements WHERE "batchId"=$1`,[lot.batchId]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(Number(end.lot.remainingQuantity),Number(ledger.rows[0].q));assert.equal(Number(end.w.quantity),Number(end.lot.remainingQuantity));reports.push({mode:'native generic reverse issue overlap',results:result.map(r=>r.status),end});
   }else{await da.reverse(C,U,doc.id);const end=await full();assert.equal(Number(end.lot.remainingQuantity),10);assert.equal(Number(end.lot.receivedQuantity),10);assert.equal(Number(end.lot.unitCost),12);assert.equal(end.lot.status,'OPEN');assert.equal(Number(end.w.quantity),10);assert.equal(Number(end.w.value),120);reports.push({mode:'native generic reverse '+mode,end});}
  }
 }
 if(process.env.KAYAN_DOC_REVERSE==='1'){
  const results=[];
  for(const mode of ['lot-shelf-short','source-reprice','target-reprice','issue-overlap']){
   const item=randomUUID(),otherShelf=randomUUID();await p.item.create({data:{id:item,companyId:C,code:'REV-'+mode,nameEn:mode,nameAr:mode,unit:'piece',requiresBatch:true,isStockTracked:true}});await p.storageLocation.create({data:{id:otherShelf,companyId:C,branchId:B,warehouseId:targetW,kind:'SHELF',code:'REV-'+mode,nameEn:mode,nameAr:mode}});
   const src=await a.receive(C,U,{branchId:B,warehouseId:W,itemId:item,batchNumber:'REV',quantity:10,unitCost:12,storageLocationId:L});const dst=await a.receive(C,U,{branchId:B,warehouseId:targetW,itemId:item,batchNumber:'REV',quantity:5,unitCost:6,storageLocationId:targetL});
   const doc=await da.create(C,B,U,{kind:'transfer',documentDate:'2026-11-25',fromBranchId:B,fromWarehouseId:W,toWarehouseId:targetW,lines:[{itemId:item,quantity:3,batchId:src.batchId,storageLocationId:L,toStorageLocationId:targetL}]});await da.post(C,U,doc.id);console.log('DOC_REVERSE_BIND',JSON.stringify({mode,src:src.batchId,dst:dst.batchId,moves:await p.stockMovement.findMany({where:{referenceId:doc.id},select:{batchId:true,storageLocationId:true,warehouseId:true,quantity:true,createdAt:true}})}));
   if(mode==='lot-shelf-short'){
    const {StorageLocationsService}=require('../dist/src/modules/inventory/storage-locations.service.js');await new StorageLocationsService(p,audit).move(C,U,{fromLocationId:targetL,toLocationId:otherShelf,itemId:item,batchId:dst.batchId,quantity:7,reason:'synthetic depleted exact lot'},null);
    await a.receive(C,U,{branchId:B,warehouseId:targetW,itemId:item,batchNumber:'UNRELATED',quantity:3,unitCost:6,storageLocationId:targetL});
   }
   if(mode==='source-reprice'||mode==='target-reprice')await a.receive(C,U,{branchId:B,warehouseId:mode==='source-reprice'?W:targetW,itemId:item,batchNumber:'REV',quantity:2,unitCost:24,storageLocationId:mode==='source-reprice'?L:targetL});
   const snapshot=async()=>({lots:await p.itemBatch.findMany({where:{itemId:item},orderBy:{id:'asc'},select:{id:true,remainingQuantity:true,unitCost:true}}),balances:await p.warehouseStockBalance.findMany({where:{itemId:item},orderBy:{warehouseId:'asc'},select:{warehouseId:true,quantity:true,value:true}}),movements:await p.stockMovement.count({where:{itemId:item}})});let before=await snapshot(),outcome;
   if(mode==='issue-overlap'){
    let release,enter;const gate=new Promise(r=>release=r),ready=new Promise(r=>enter=r),orig=a.lockItemStock.bind(a);a.lockItemStock=async(tx,w,i)=>{await orig(tx,w,i);enter();await gate;};const issue=a.issue(C,U,{branchId:B,warehouseId:targetW,itemId:item,batchId:dst.batchId,quantity:6,storageLocationId:targetL,allowExpired:true});await ready;const reverse=db.reverse(C,U,doc.id);await sleep(250);const waits=(await sql.query("SELECT wait_event_type FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'",[database])).rows;release();const settled=await Promise.allSettled([issue,reverse]);a.lockItemStock=orig;outcome={settled:settled.map(x=>x.status==='fulfilled'?{status:x.status}:{status:x.status,error:String(x.reason)}),waits:waits.length};const live=await p.itemBatch.findUnique({where:{id:dst.batchId}});const ledger=await sql.query(`SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN quantity ELSE -quantity END),0)::text q FROM stock_movements WHERE "companyId"=$1 AND "warehouseId"=$2 AND "itemId"=$3 AND "batchId"=$4`,[C,targetW,item,dst.batchId]);outcome.destinationLot=Number(live.remainingQuantity);outcome.destinationLotLedger=Number(ledger.rows[0].q);outcome.consistent=outcome.destinationLot===outcome.destinationLotLedger;assert.equal(outcome.consistent,true);console.log('DOC_REVERSE_OVERLAP',JSON.stringify(outcome));assert.equal(settled.filter(x=>x.status==='fulfilled').length,1);
   }else{
    let error;try{await da.reverse(C,U,doc.id);}catch(e){error=e.response?.code||String(e);}const after=await snapshot();outcome={error:error||null,unchanged:JSON.stringify(before)===JSON.stringify(after),status:(await p.stockDocument.findUnique({where:{id:doc.id}})).status};if(mode==='lot-shelf-short'){assert.equal(error,'STOCK_DOC_REVERSE_LOT_SHELF_SHORT');assert.equal(outcome.unchanged,true);}else{assert.equal(error,undefined);const sourceLot=after.lots.find(l=>l.id===src.batchId),targetLot=after.lots.find(l=>l.id===dst.batchId);assert.equal(Number(sourceLot.remainingQuantity),mode==='source-reprice'?12:10);assert.equal(Number(targetLot.remainingQuantity),mode==='target-reprice'?7:5);assert.ok(Math.abs(Number(sourceLot.unitCost)-(mode==='source-reprice'?14:12))<0.0002);assert.ok(Math.abs(Number(targetLot.unitCost)-(mode==='target-reprice'?78/7:6))<0.0002);const sourceBalance=after.balances.find(l=>l.warehouseId===W),targetBalance=after.balances.find(l=>l.warehouseId===targetW);assert.equal(Number(sourceBalance.value),mode==='source-reprice'?168:120);assert.equal(Number(targetBalance.value),mode==='target-reprice'?78:30);outcome.exactCostAndBookAssertions=true;}
   }
   const result={mode:'native transfer reverse '+mode,...outcome};console.log('DOC_REVERSE_PROBE',JSON.stringify(result));results.push(result);
  }
  reports.push(...results);
 }
 for(const firstKind of ['edit','post']){
  const CI=randomUUID();await p.item.create({data:{id:CI,companyId:C,code:'correct-'+firstKind,nameEn:'Correction',nameAr:'Correction',unit:'piece',requiresBatch:true,isStockTracked:true}});const cr=await a.receive(C,U,{branchId:B,warehouseId:W,itemId:CI,batchNumber:'CORRECT',quantity:3,unitCost:2,storageLocationId:L});
  const cd=await da.create(C,B,U,{kind:'transfer',documentDate:'2026-11-25',fromBranchId:B,fromWarehouseId:W,toWarehouseId:targetW,lines:[{itemId:CI,quantity:1,batchId:cr.batchId,storageLocationId:L}]});
  let entered,release;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);const original=p.$transaction.bind(p);
  p.$transaction=(fn,...args)=>original(async tx=>{const model=tx.stockDocument,update=model.updateMany.bind(model);model.updateMany=async arg=>{const result=await update(arg);if(arg.where.id===cd.id){entered();await gate;}return result;};return fn(tx);},...args);
  const change={expectedVersion:0,lines:[{lineNumber:1,storageLocationId:L,toStorageLocationId:targetL}]};
  const f=firstKind==='edit'?da.updateDraftLocations(C,U,cd.id,change):da.post(C,U,cd.id);await ready;
  const g=firstKind==='edit'?db.post(C,U,cd.id):db.updateDraftLocations(C,U,cd.id,change);await sleep(250);release();const rr=await Promise.allSettled([f,g]);p.$transaction=original;
  const row=await p.stockDocument.findUnique({where:{id:cd.id}});assert.equal(row.status,'POSTED');
  if(firstKind==='edit')assert.equal(rr.filter(x=>x.status==='fulfilled').length,2,JSON.stringify(rr));else assert.equal(rr.filter(x=>x.status==='fulfilled').length,1,JSON.stringify(rr));
  const line=await p.stockDocumentLine.findFirst({where:{documentId:cd.id}});assert.equal(line.toStorageLocationId,firstKind==='edit'?targetL:null);reports.push({mode:'draft correction vs post '+firstKind+' first',results:rr.map(x=>x.status),status:row.status,version:row.editVersion,target:line.toStorageLocationId});
 }

 for(const firstKind of ['edit','post']){
  const CI=randomUUID();await p.item.create({data:{id:CI,companyId:C,code:'split-correct-'+firstKind,nameEn:'Correction',nameAr:'Correction',unit:'piece',requiresBatch:true,isStockTracked:true}});const cr=await a.receive(C,U,{branchId:B,warehouseId:W,itemId:CI,batchNumber:'CORRECT',quantity:6,unitCost:2,storageLocationId:L});
  const cd=await da.create(C,B,U,{kind:'transfer',documentDate:'2026-11-25',fromBranchId:B,fromWarehouseId:W,toWarehouseId:targetW,lines:[1,2].map(()=>({itemId:CI,quantity:3,batchId:cr.batchId,storageLocationId:L}))});
  let entered,release;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);const original=p.$transaction.bind(p);
  p.$transaction=(fn,...args)=>original(async tx=>{const model=tx.stockDocument,update=model.updateMany.bind(model);model.updateMany=async arg=>{const result=await update(arg);if(arg.where.id===cd.id){entered();await gate;}return result;};return fn(tx);},...args);
  const change={expectedVersion:0,lines:[1,2].map(lineNumber=>({lineNumber,splits:[{batchId:cr.batchId,quantity:'2',storageLocationId:L,toStorageLocationId:targetL},{batchId:cr.batchId,quantity:'1',storageLocationId:L,toStorageLocationId:targetL}]}))};
  const f=firstKind==='edit'?da.updateDraftLocations(C,U,cd.id,change):da.post(C,U,cd.id);await ready;
  const g=firstKind==='edit'?db.post(C,U,cd.id):db.updateDraftLocations(C,U,cd.id,change);await sleep(250);release();const rr=await Promise.allSettled([f,g]);p.$transaction=original;
  const row=await p.stockDocument.findUnique({where:{id:cd.id}});assert.equal(row.status,'POSTED');
  if(firstKind==='edit')assert.equal(rr.filter(x=>x.status==='fulfilled').length,2,JSON.stringify(rr));else assert.equal(rr.filter(x=>x.status==='fulfilled').length,1,JSON.stringify(rr));
  const line=await p.stockDocumentLine.findFirst({where:{documentId:cd.id}});assert.equal(line.toStorageLocationId,firstKind==='edit'?targetL:null);assert.equal(await p.stockDocumentLine.count({where:{documentId:cd.id}}),firstKind==='edit'?4:2);reports.push({mode:'draft TWO ORIGINAL SPLIT vs post '+firstKind+' first',results:rr.map(x=>x.status),status:row.status,version:row.editVersion,target:line.toStorageLocationId});
 }

 const {ItemsService}=require('../dist/src/modules/inventory/items.service.js');
 await p.account.create({data:{companyId:C,code:'3103',nameEn:'Opening equity',nameAr:'Opening equity',type:'EQUITY',isPostable:true,isActive:true}});
 await p.warehouse.update({where:{id:W},data:{isDefault:true}});
 const nums=new DocumentNumberService();const itemOpeningService=new ItemsService(p,audit,new AccountMapService(),new PostingService(nums,new FiscalPeriodsService(p,audit),new CostCentersService(p,audit)),new (require('../dist/src/common/warehouse/warehouse.service.js').WarehouseService)(p,audit),new StockLedgerService());
 for(const mode of ['located','unlocated','inactive','deleted','wrong']){
   const sl=mode==='wrong'?targetL:L;
   if(mode==='inactive')await p.storageLocation.update({where:{id:L},data:{isActive:false}});
   if(mode==='deleted')await p.storageLocation.update({where:{id:L},data:{isActive:true,deletedAt:new Date()}});
   const input={code:'OPEN-'+mode,nameEn:'Opening '+mode,nameAr:'Opening',unit:'piece',openingQuantity:'5',openingUnitCost:'2',...(mode==='unlocated'?{}:{openingStorageLocationId:sl})};
   let fail;try{await itemOpeningService.create(C,U,input,B);}catch(e){fail=e;}
   const saved=await p.item.findFirst({where:{companyId:C,code:input.code}});
   if(['located','unlocated'].includes(mode)){assert.ok(!fail,String(fail));const m=await p.stockMovement.findFirst({where:{itemId:saved.id,referenceType:'ITEM_OPENING_STOCK'}});assert.equal(m.storageLocationId,mode==='located'?L:null);assert.equal(Number(m.quantity),5);assert.equal(Number(m.totalCost),10);}
   else {assert.ok(fail);assert.equal(saved,null);}
   reports.push({mode:'actual item opening '+mode,result:fail?'refused atomic':'persisted'});
   await p.storageLocation.update({where:{id:L},data:{isActive:true,deletedAt:null}});
 }

 const {StockTakesService}=require('../dist/src/modules/inventory/stock-takes.service.js');
 function countSvc(prisma){return new StockTakesService(prisma,new WarehouseService(prisma,audit),new StockLedgerService(),new DocumentNumberService(),docs(prisma),audit);}
 const ca=countSvc(p),cb=countSvc(q);
 for(const mode of ['add-add','add-finish','record-finish']){
  const I=randomUUID();await p.item.create({data:{id:I,companyId:C,code:'COUNT-'+mode,nameEn:'Count',nameAr:'Count',unit:'piece',requiresBatch:false,isStockTracked:true}});
  const st=await ca.start(C,U,{warehouseId:W,scope:'PARTIAL',itemIds:[I]});
  let entered,release;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r),old=ca.lockSession.bind(ca);
  ca.lockSession=async(tx,id)=>{await old(tx,id);entered();await gate;};
  const add={itemId:I,storageLocationId:L};const record={lines:[{lineId:st.lines[0].id,countedQuantity:0}],finish:true};
  const first=mode==='add-add'?ca.addLocation(C,U,st.id,add):ca.record(C,U,st.id,record);await ready;
  const second=mode==='add-add'?cb.addLocation(C,U,st.id,add):mode==='add-finish'?cb.addLocation(C,U,st.id,add):cb.record(C,U,st.id,{lines:[{lineId:st.lines[0].id,countedQuantity:9}]});
  await sleep(250);release();const r=await Promise.allSettled([first,second]);ca.lockSession=old;
  const final=await ca.findOne(C,st.id);reports.push({mode:'count '+mode,results:r.map(x=>x.status==='fulfilled'?{status:x.status}:{status:x.status,error:String(x.reason)}),status:final.status,counts:final.lines.map(l=>l.countedQuantity)});
  console.log('COUNT_RACE',JSON.stringify(reports[reports.length-1]));
  assert.equal(r.filter(x=>x.status==='fulfilled').length,1,JSON.stringify(reports[reports.length-1]));
  if(mode==='record-finish')assert.equal(final.lines[0].countedQuantity,'0.0000');
 }

 const {OpeningBalancesService}=require('../dist/src/modules/accounting/opening-balances.service.js');
 const obnum=new DocumentNumberService();const ob=new OpeningBalancesService(p,obnum,new PostingService(obnum,new FiscalPeriodsService(p,audit),new CostCentersService(p,audit)),new AccountMapService(),audit,new WarehouseService(p,audit),new StockLedgerService());
 const OB=randomUUID();await p.branch.create({data:{id:OB,companyId:C,code:'OB',nameEn:'Opening test',nameAr:'Opening'}});const OW=randomUUID();await p.warehouse.create({data:{id:OW,companyId:C,branchId:OB,code:'OBW',nameEn:'Opening warehouse',nameAr:'Opening',isDefault:true}});const OL=randomUUID();await p.storageLocation.create({data:{id:OL,companyId:C,branchId:OB,warehouseId:OW,kind:'SHELF',code:'OB-A',nameEn:'Opening shelf',nameAr:'Opening'}});const OI2=randomUUID();await p.item.create({data:{id:OI2,companyId:C,code:'OB-ITEM',nameEn:'Opening item',nameAr:'Opening',unit:'piece',isStockTracked:true,requiresBatch:false}});
 const inventory=await p.account.findFirst({where:{companyId:C,code:'1104'}}),equity=await p.account.findFirst({where:{companyId:C,code:'3103'}});
 const odraft=await ob.create(C,OB,U,{asOfDate:'2026-11-25',warehouseId:OW,lines:[{accountId:inventory.id,itemId:OI2,quantity:'5',unitCost:'2',debit:'10',storageLocationId:OL},{accountId:equity.id,credit:'10'}]});
 await ob.post(C,U,odraft.id,OB);
 const branchbal=await p.stockBalance.findFirst({where:{itemId:OI2}}),whbal=await p.warehouseStockBalance.findFirst({where:{itemId:OI2}});const om=await p.stockMovement.findFirst({where:{referenceId:odraft.id,referenceType:'OPENING_BALANCE'}});
 assert.equal(Number(whbal.quantity),5);assert.equal(Number(whbal.value),10);
 reports.push({mode:'actual opening document post',branchQuantity:Number(branchbal.quantity),warehouseQuantity:whbal?Number(whbal.quantity):null,movementShelf:om.storageLocationId});console.log('OB_PROOF',JSON.stringify(reports[reports.length-1]));
 await ob.reverse(C,U,odraft.id,OB);const rb=await p.stockBalance.findFirst({where:{itemId:OI2}});reports.push({mode:'actual opening document reverse',branchQuantity:Number(rb.quantity),warehouseRows:await p.warehouseStockBalance.count({where:{itemId:OI2}})});assert.equal(Number((await p.warehouseStockBalance.findFirst({where:{itemId:OI2}})).quantity),0);

 for(const mode of ['duplicate','issue-short','issue-compatible']){
   const branch=randomUUID(),warehouse=randomUUID(),loc=randomUUID(),item=randomUUID();await p.branch.create({data:{id:branch,companyId:C,code:'OB-'+mode,nameEn:mode,nameAr:mode}});await p.warehouse.create({data:{id:warehouse,companyId:C,branchId:branch,code:'OBW-'+mode,nameEn:mode,nameAr:mode,isDefault:true}});await p.storageLocation.create({data:{id:loc,companyId:C,branchId:branch,warehouseId:warehouse,kind:'SHELF',code:'A',nameEn:'A',nameAr:'A'}});await p.item.create({data:{id:item,companyId:C,code:'OBI-'+mode,nameEn:mode,nameAr:mode,unit:'piece',isStockTracked:true,requiresBatch:false}});
   function os(prisma){const n=new DocumentNumberService();return new OpeningBalancesService(prisma,n,new PostingService(n,new FiscalPeriodsService(prisma,audit),new CostCentersService(prisma,audit)),new AccountMapService(),audit,new WarehouseService(prisma,audit),new StockLedgerService());}
   const oa=os(p),ob2=os(q);const d=await oa.create(C,branch,U,{asOfDate:'2026-11-25',warehouseId:warehouse,lines:[{accountId:inventory.id,itemId:item,quantity:'5',unitCost:'2',debit:'10',storageLocationId:loc},{accountId:equity.id,credit:'10'}]});
   const posts=await Promise.allSettled([oa.post(C,U,d.id,branch),ob2.post(C,U,d.id,branch)]);assert.equal(posts.filter(x=>x.status==='fulfilled').length,1);
   if(mode==='issue-compatible'){
    const {StorageLocationsService}=require('../dist/src/modules/inventory/storage-locations.service.js');
    await itemOpeningService.create(C,U,{code:'unused-'+mode,nameEn:'unused',nameAr:'unused'},branch);
    await p.$transaction(tx=>new StockLedgerService().post(tx,{companyId:C,branchId:branch,warehouseId:warehouse,itemId:item,quantity:2,value:4}));
    await p.stockMovement.create({data:{companyId:C,branchId:branch,warehouseId:warehouse,itemId:item,movementDate:new Date(),direction:'IN',quantity:2,unitCost:2,totalCost:4,storageLocationId:loc,referenceType:'TEST_RECEIPT',referenceId:randomUUID(),createdBy:U}});
   }
   let r;
   if(mode==='duplicate')r=await Promise.allSettled([oa.reverse(C,U,d.id,branch),ob2.reverse(C,U,d.id,branch)]);
   else {
    let entered,release;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r),old=a.lockItemStock.bind(a);a.lockItemStock=async(tx,w,i)=>{await old(tx,w,i);entered();await gate;};
    const issue=a.issue(C,U,{branchId:branch,warehouseId:warehouse,itemId:item,quantity:1,storageLocationId:loc});await ready;const rev=ob2.reverse(C,U,d.id,branch);await sleep(250);release();r=await Promise.allSettled([issue,rev]);a.lockItemStock=old;
   }
   const balance=await p.warehouseStockBalance.findFirst({where:{itemId:item}}),doc=await p.openingBalance.findUnique({where:{id:d.id}});console.log('OB_RACE',JSON.stringify({mode,results:r.map(x=>x.status==='fulfilled'?{status:x.status}:{status:x.status,error:String(x.reason)}),quantity:Number(balance.quantity),value:Number(balance.value),status:doc.status}));
   assert.equal(r.filter(x=>x.status==='fulfilled').length,mode==='issue-compatible'?2:1);assert.equal(Number(balance.quantity),mode==='duplicate'?0:mode==='issue-compatible'?1:4);assert.equal(doc.status,mode==='issue-short'?'POSTED':'REVERSED');reports.push({mode:'opening '+mode,results:r.map(x=>x.status),quantity:Number(balance.quantity)});
 }

 // Batch-required opening must either create traceable lot stock or refuse; probe issue interoperability.
 const TB=randomUUID(),TW=randomUUID(),OTI=randomUUID(),TL=randomUUID();await p.branch.create({data:{id:TB,companyId:C,code:'OB-TRACK',nameEn:'Tracked',nameAr:'Tracked'}});await p.warehouse.create({data:{id:TW,companyId:C,branchId:TB,code:'OB-TRACK-W',nameEn:'Tracked',nameAr:'Tracked',isDefault:true}});await p.storageLocation.create({data:{id:TL,companyId:C,branchId:TB,warehouseId:TW,kind:'SHELF',code:'A',nameEn:'A',nameAr:'A'}});await p.item.create({data:{id:OTI,companyId:C,code:'OB-TRACK-I',nameEn:'Tracked',nameAr:'Tracked',unit:'piece',requiresBatch:true,useFefo:true,isStockTracked:true}});let trackedIssue;try{const td=await ob.create(C,TB,U,{asOfDate:'2026-11-25',warehouseId:TW,lines:[{accountId:inventory.id,itemId:OTI,quantity:'5',unitCost:'2',debit:'10',storageLocationId:TL},{accountId:equity.id,credit:'10'}]});await ob.post(C,U,td.id,TB);trackedIssue='unexpected post';}catch(e){trackedIssue={error:String(e),response:e.response};}console.log('OB_TRACKED',JSON.stringify({lots:await p.itemBatch.count({where:{itemId:OTI}}),result:trackedIssue}));assert.equal(trackedIssue.response.code,'OPENING_LOT_CONTROLLED_ITEM');

 // Historical branch-only opening: original had no warehouse and no warehouse ledger.
 const HB=randomUUID(),HI=randomUUID(),HD=randomUUID();await p.branch.create({data:{id:HB,companyId:C,code:'OB-HIST',nameEn:'Historical',nameAr:'Historical'}});await p.item.create({data:{id:HI,companyId:C,code:'OB-HIST-I',nameEn:'Historical',nameAr:'Historical',unit:'piece',isStockTracked:true}});
 const hn=new DocumentNumberService();const hj=await p.$transaction(tx=>new PostingService(hn,new FiscalPeriodsService(p,audit),new CostCentersService(p,audit)).post(tx,{companyId:C,branchId:HB,userId:U,entryDate:new Date('2026-11-25'),description:'Historical opening',sourceType:'OPENING_BALANCE',sourceId:HD,lines:[{accountId:inventory.id,debit:10,credit:0},{accountId:equity.id,debit:0,credit:10}]}));
 await p.openingBalance.create({data:{id:HD,companyId:C,branchId:HB,documentNumber:'HIST-1',asOfDate:new Date('2026-11-25'),status:'POSTED',journalEntryId:hj.id,totalDebit:10,totalCredit:10,createdBy:U,lines:{create:[{lineNumber:1,accountId:inventory.id,itemId:HI,quantity:5,unitCost:2,debit:10,credit:0},{lineNumber:2,accountId:equity.id,debit:0,credit:10}]}}});await p.stockBalance.create({data:{companyId:C,branchId:HB,itemId:HI,quantity:5,value:10}});await p.stockMovement.create({data:{companyId:C,branchId:HB,itemId:HI,movementDate:new Date('2026-11-25'),direction:'IN',quantity:5,unitCost:2,totalCost:10,referenceType:'OPENING_BALANCE',referenceId:HD,createdBy:U}});
 let hist;try{await ob.reverse(C,U,HD,HB);hist='reversed';}catch(e){hist=String(e);}console.log('OB_HISTORICAL',JSON.stringify({result:hist,branchQuantity:Number((await p.stockBalance.findFirst({where:{itemId:HI}})).quantity),warehouseRows:await p.warehouseStockBalance.count({where:{itemId:HI}}),warehouses:await p.warehouse.count({where:{branchId:HB}}),status:(await p.openingBalance.findUnique({where:{id:HD}})).status}));


 // New historical fixture with under-covered original quantity, not mutation of a posted journal.
 const IB=randomUUID(),II=randomUUID(),ID=randomUUID();await p.branch.create({data:{id:IB,companyId:C,code:'OB-INCOMP',nameEn:'Incomplete',nameAr:'Incomplete'}});await p.item.create({data:{id:II,companyId:C,code:'OB-INCOMP-I',nameEn:'Incomplete',nameAr:'Incomplete',unit:'piece',isStockTracked:true}});
 const ij=await p.$transaction(tx=>new PostingService(hn,new FiscalPeriodsService(p,audit),new CostCentersService(p,audit)).post(tx,{companyId:C,branchId:IB,userId:U,entryDate:new Date('2026-11-25'),description:'Incomplete historical opening',sourceType:'OPENING_BALANCE',sourceId:ID,lines:[{accountId:inventory.id,debit:10,credit:0},{accountId:equity.id,debit:0,credit:10}]}));
 await p.openingBalance.create({data:{id:ID,companyId:C,branchId:IB,documentNumber:'INCOMP-1',asOfDate:new Date('2026-11-25'),status:'POSTED',journalEntryId:ij.id,totalDebit:10,totalCredit:10,createdBy:U,lines:{create:[{lineNumber:1,accountId:inventory.id,itemId:II,quantity:5,unitCost:2,debit:10,credit:0},{lineNumber:2,accountId:equity.id,debit:0,credit:10}]}}});await p.stockBalance.create({data:{companyId:C,branchId:IB,itemId:II,quantity:5,value:10}});await p.stockMovement.create({data:{companyId:C,branchId:IB,itemId:II,movementDate:new Date('2026-11-25'),direction:'IN',quantity:1,unitCost:2,totalCost:2,referenceType:'OPENING_BALANCE',referenceId:ID,createdBy:U}});
 let incomplete;try{await ob.reverse(C,U,ID,IB);incomplete='reversed whole5 from original1';}catch(e){incomplete=String(e);}console.log('OB_INCOMPLETE_ORIGIN',JSON.stringify({result:incomplete,status:(await p.openingBalance.findUnique({where:{id:ID}})).status,quantity:Number((await p.stockBalance.findFirst({where:{itemId:II}})).quantity)}));assert.equal((await p.openingBalance.findUnique({where:{id:ID}})).status,'POSTED');assert.equal(Number((await p.stockBalance.findFirst({where:{itemId:II}})).quantity),5);

 await p.stockMovement.updateMany({where:{referenceId:ID,referenceType:'OPENING_BALANCE'},data:{quantity:5,totalCost:10}});await p.stockMovement.create({data:{companyId:C,branchId:IB,itemId:II,movementDate:new Date('2026-11-25'),direction:'IN',quantity:5,unitCost:2,totalCost:10,referenceType:'OPENING_BALANCE',referenceId:ID,createdBy:U}});
 let ambiguous;try{await ob.reverse(C,U,ID,IB);ambiguous='unexpected';}catch(e){ambiguous=e.response?.code??String(e);}assert.equal((await p.openingBalance.findUnique({where:{id:ID}})).status,'POSTED');assert.equal(Number((await p.stockBalance.findFirst({where:{itemId:II}})).quantity),5);console.log('OB_AMBIGUOUS',JSON.stringify({result:ambiguous,quantity:5,status:'POSTED'}));
 const invalidReversals=await p.journalEntry.count({where:{sourceId:ID,reversalOfId:{not:null}}});assert.equal(invalidReversals,0);
 const journalBalance=await sql.query('SELECT COALESCE(SUM(debit-credit),0)::text AS difference FROM journal_lines');assert.equal(Number(journalBalance.rows[0].difference),0);reports.push({mode:'all synthetic journals balanced',difference:0});


 if(process.env.KAYAN_STOCKDOC_LOT_UI==='1'||process.env.KAYAN_STOCKDOC_SPLIT_UI==='1'){
  const {createServer}=require('node:http'),{execFile}=require('node:child_process'),{promisify}=require('node:util');const {StorageLocationsService}=require('../dist/src/modules/inventory/storage-locations.service.js');const locations=new StorageLocationsService(p,audit);const item=randomUUID();await p.item.create({data:{id:item,companyId:C,code:'UI-LOT-I',nameEn:'Lot UI item',nameAr:'Lot UI item',unit:'piece',requiresBatch:true,isStockTracked:true}});const original=await a.receive(C,U,{branchId:B,warehouseId:W,itemId:item,batchNumber:'LOT-UI',quantity:10,unitCost:2,storageLocationId:L});const calls=[];let saved;let refusedSplit=false;const splitMode=process.env.KAYAN_STOCKDOC_SPLIT_UI==='1';if(splitMode)saved=(await da.create(C,B,U,{kind:'transfer',documentDate:'2026-11-25',fromBranchId:B,fromWarehouseId:W,toWarehouseId:targetW,lines:[{itemId:item,quantity:3,storageLocationId:L,toStorageLocationId:targetL}]})).id;
  const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),route=url.pathname;let data;
   if(route.endsWith('/warehouses'))data={items:[{id:W,code:'W',nameEn:'Lot UI source',isDefault:true},{id:targetW,code:'T',nameEn:'Lot UI target'}]};
   else if(route.endsWith('/items'))data={items:[await p.item.findUnique({where:{id:item}})]};
   else if(route.endsWith('/stock')||route.endsWith('/stock/by-warehouse'))data={items:[]};
   else if(route.includes('/image/presence'))data={itemIds:[]};
   else if(route.includes('/items/by-barcode/'))data={matched:'item',item:await p.item.findUnique({where:{id:item}})};
   else if(route.endsWith('/batches'))data=await a.list(C,{itemId:item,warehouseId:url.searchParams.get('warehouseId'),pageSize:200});
   else if(route.endsWith('/locations'))data=await locations.list(C,{warehouseId:url.searchParams.get('warehouseId')});
   else if(req.method==='PUT'){let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);calls.push({route,body});if(splitMode&&!refusedSplit){refusedSplit=true;res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({message:'Synthetic refusal: choose available lot quantities. Your input is kept.'}));return;}data=await da.updateDraftLocations(C,U,saved,body);}
   else if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};calls.push({route,body});if(route.endsWith('/post'))data=await da.post(C,U,saved);else if(route.endsWith('/reverse'))data=await da.reverse(C,U,saved);else{data=await da.create(C,B,U,body);saved=data.id;}}
   else if(route.endsWith('/stock-documents'))data={items:saved?[await da.findOne(C,saved)]:[]};else data=await da.findOne(C,saved);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));
  }catch(e){console.log('LOT_UI_ERROR',e);res.statusCode=400;res.end(JSON.stringify({message:e.message,...(typeof e.response==='object'?e.response:{})}));}});await new Promise(r=>server.listen(3227,'127.0.0.1',r));
  try{const out=await promisify(execFile)('/tmp/flutter/bin/flutter',['test',splitMode?'test/widget/stock_document_lot_split_http_test.dart':'test/widget/stock_document_lot_create_http_test.dart'],{cwd:path.join(__dirname,'../..'),timeout:90000,maxBuffer:4*1024*1024}).catch(e=>{console.log(e.stdout,e.stderr);throw e;});console.log(out.stdout);assert.equal(calls.length,splitMode?4:3);if(splitMode){assert.equal(calls[0].body.lines[0].splits.length,2);assert.equal(calls[0].body.lines[0].splits[0].batchId,original.batchId);assert.equal(await p.stockDocumentLine.count({where:{documentId:saved}}),2);}else{assert.equal(calls[0].body.lines[0].batchId,original.batchId);assert.equal(calls[0].body.lines[0].quantity,'3');}assert.equal((await p.stockDocument.findUnique({where:{id:saved}})).status,'REVERSED');assert.equal(Number((await p.itemBatch.findUnique({where:{id:original.batchId}})).remainingQuantity),10);const destination=await p.itemBatch.findFirst({where:{itemId:item,warehouseId:targetW}});assert.equal(Number(destination.remainingQuantity),0);reports.push({mode:splitMode?'actual existing transfer Flutter draft split retained refusal save post reverse native SQL':(process.env.KAYAN_DIRECT_ITEM==='1'?'actual generic direct item picker Flutter explicit lot create post reverse native SQL':'actual generic barcode Flutter explicit lot create post reverse native SQL'),sourceLot:10,targetLot:0});}finally{await new Promise(r=>server.close(r));}
 }
 if(process.env.KAYAN_OB_LOCATION_UI==='1'){
  const {createServer}=require('node:http'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
  const ub=randomUUID(),uw=randomUUID(),ui=randomUUID(),ul=randomUUID();await p.branch.create({data:{id:ub,companyId:C,code:'UIB',nameEn:'Opening UI branch',nameAr:'Opening UI branch'}});await p.warehouse.create({data:{id:uw,companyId:C,branchId:ub,code:'UIW',nameEn:'Opening UI warehouse',nameAr:'Opening UI warehouse',isDefault:true}});await p.item.create({data:{id:ui,companyId:C,code:'UII',nameEn:'Opening UI item',nameAr:'Opening UI item',unit:'piece',isStockTracked:true,requiresBatch:false}});await p.storageLocation.create({data:{id:ul,companyId:C,branchId:ub,warehouseId:uw,kind:'SHELF',code:'A-UI',nameEn:'Opening UI shelf',nameAr:'Opening UI shelf'}});
  const {OpeningBalancesController}=require('../dist/src/modules/accounting/opening-balances.controller.js');const ctl=new OpeningBalancesController(ob),user={companyId:C,userId:U,branchId:ub,isSuperAdmin:true,permissions:[]};const calls=[];
  const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),path=url.pathname;let data;
   if(path.endsWith('/company/profile'))data={currency:'EGP'};
   else if(path.endsWith('/company/branches'))data={items:[await p.branch.findUnique({where:{id:ub}})]};
   else if(path.endsWith('/chart-of-accounts'))data={items:await p.account.findMany({where:{id:{in:[inventory.id,equity.id]}}})};
   else if(path.endsWith('/inventory/items'))data={items:[await p.item.findUnique({where:{id:ui}})]};
   else if(path.endsWith('/inventory/warehouses'))data={items:[await p.warehouse.findUnique({where:{id:uw}})]};
   else if(path.endsWith('/inventory/locations'))data={items:[await p.storageLocation.findUnique({where:{id:ul}})]};
   else if(path.includes('/cash/accounts')||path.includes('/parties/'))data={items:[]};
   else if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};calls.push(path);data=path.endsWith('/post')?await ctl.post(user,path.split('/').at(-2)):await ctl.create(user,body);}
   else if(path.endsWith('/opening-balances')){data=await ctl.findAll(user);const only=await p.openingBalance.findFirst({where:{branchId:ub}});data.items=data.items.filter(x=>x.id===only?.id);}
   else data=await ctl.findOne(user,path.split('/').at(-1));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));
  }catch(e){console.log('OB_UI_ERROR',e);res.statusCode=400;res.end(JSON.stringify({message:String(e)}));}});await new Promise(r=>server.listen(3225,'127.0.0.1',r));
  try{const out=await promisify(execFile)('/tmp/flutter/bin/flutter',['test','test/widget/opening_locations_http_test.dart'],{cwd:path.join(__dirname,'../..'),timeout:90000,maxBuffer:4*1024*1024}).catch(e=>{console.log(e.stdout,e.stderr);throw e;});console.log(out.stdout);assert.equal(calls.length,2);const doc=await p.openingBalance.findFirst({where:{branchId:ub}});assert.equal(doc.status,'POSTED');const balance=await p.warehouseStockBalance.findFirst({where:{itemId:ui}});assert.equal(Number(balance.quantity),5);assert.equal(Number(balance.value),10);const m=await p.stockMovement.findFirst({where:{referenceId:doc.id}});assert.equal(m.storageLocationId,ul);reports.push({mode:'actual Flutter opening draft read post controller service SQL',quantity:5,value:10});}
  finally{await new Promise(r=>server.close(r));}
 }

 if(process.env.KAYAN_OB_AUTH==='1'){
  require('reflect-metadata');const {Module}=require('@nestjs/common'),{NestFactory,APP_GUARD,Reflector}=require('@nestjs/core');
  const {JwtAuthGuard}=require('../dist/src/common/guards/jwt-auth.guard.js'),{PermissionsGuard}=require('../dist/src/common/guards/permissions.guard.js'),{BranchWriteGuard}=require('../dist/src/common/guards/branch-write.guard.js');const {OpeningBalancesController}=require('../dist/src/modules/accounting/opening-balances.controller.js'),{OpeningBalancesService}=require('../dist/src/modules/accounting/opening-balances.service.js');const {StockDocumentsController}=require('../dist/src/modules/inventory/stock-documents.controller.js');
  await p.userBranch.create({data:{userId:U,branchId:B}});const hash='b'.repeat(64);await p.refreshToken.create({data:{userId:U,tokenHash:hash,expiresAt:new Date(Date.now()+3600000)}});
  const perms={};for(const code of ['accounting.openingbalances.read','accounting.openingbalances.manage','inventory.cost.read','inventory.stock.read','inventory.stock.adjust']){perms[code]=await p.permission.upsert({where:{code},create:{code,nameEn:code,nameAr:code,module:'synthetic'},update:{}});await p.userPermission.create({data:{userId:U,permissionId:perms[code].id}});}
  // Signature decoder fixture only. No production token or signing material is created/read.
  const verifier={verifyAsync:async token=>{if(token!=='synthetic-fixture')throw Error('invalid fixture');return{sub:U,companyId:C,branchId:B,tokenVersion:0,sessionHash:hash};}};
  class Probe{};Module({controllers:[OpeningBalancesController,StockDocumentsController],providers:[{provide:StockDocumentsService,useValue:da},{provide:OpeningBalancesService,useValue:ob},{provide:APP_GUARD,useValue:new JwtAuthGuard(new Reflector(),verifier,p)},{provide:APP_GUARD,useValue:new PermissionsGuard(new Reflector())},{provide:APP_GUARD,useValue:new BranchWriteGuard(p)}]})(Probe);
  const app=await NestFactory.create(Probe,{logger:false});app.setGlobalPrefix('api/v1');await app.listen(3226,'127.0.0.1');
  const call=async(method,route,body,token='synthetic-fixture')=>{const r=await fetch('http://127.0.0.1:3226/api/v1/accounting/opening-balances'+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};};
  try{
   assert.equal((await call('GET','',null,'')).status,401);assert.equal((await call('GET','',null,'bad')).status,401);assert.equal((await call('GET','')).status,200);
   const denied=perms['accounting.openingbalances.manage'];await p.userPermission.update({where:{userId_permissionId:{userId:U,permissionId:denied.id}},data:{isDenied:true}});const count=await p.openingBalance.count();assert.equal((await call('POST','',{})).status,403);assert.equal(await p.openingBalance.count(),count);await p.userPermission.update({where:{userId_permissionId:{userId:U,permissionId:denied.id}},data:{isDenied:false}});
   const other=await p.branch.findFirst({where:{companyId:C,id:{not:B}}});assert.equal((await call('POST','',{branchId:other.id})).status,403);
   await p.userPermission.update({where:{userId_permissionId:{userId:U,permissionId:perms['inventory.cost.read'].id}},data:{isDenied:true}});assert.equal((await call('POST','',{branchId:B,lines:[{itemId:randomUUID()}]})).status,403);
   const detail=await call('GET','/'+ID);assert.equal(detail.status,200);assert.equal(detail.body.totalDebit,null);assert.ok(detail.body.lines.every(l=>l.unitCost===null&&l.debit===null&&l.credit===null));

   const authItem=randomUUID();await p.item.create({data:{id:authItem,companyId:C,code:'AUTH-SPLIT',nameEn:'Split guard',nameAr:'Split guard',unit:'piece',requiresBatch:true,isStockTracked:true}});const authLot=await a.receive(C,U,{branchId:B,warehouseId:W,itemId:authItem,batchNumber:'AUTH',quantity:4,unitCost:2,storageLocationId:L});const authDoc=await da.create(C,B,U,{kind:'transfer',documentDate:'2026-11-25',fromBranchId:B,fromWarehouseId:W,toWarehouseId:targetW,lines:[{itemId:authItem,quantity:3,storageLocationId:L,toStorageLocationId:targetL}]});
   const splitBody={expectedVersion:0,lines:[{lineNumber:1,splits:[{batchId:authLot.batchId,quantity:'2',storageLocationId:L,toStorageLocationId:targetL},{batchId:authLot.batchId,quantity:'1',storageLocationId:L,toStorageLocationId:targetL}]}]};
   const httpSplit=async()=>{const r=await fetch('http://127.0.0.1:3226/api/v1/inventory/stock-documents/'+authDoc.id+'/draft-locations',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic-fixture'},body:JSON.stringify(splitBody)});return{status:r.status,body:await r.json()};};
   const adjust=perms['inventory.stock.adjust'];await p.userPermission.update({where:{userId_permissionId:{userId:U,permissionId:adjust.id}},data:{isDenied:true}});assert.equal((await httpSplit()).status,403);assert.equal(await p.stockDocumentLine.count({where:{documentId:authDoc.id}}),1);await p.userPermission.update({where:{userId_permissionId:{userId:U,permissionId:adjust.id}},data:{isDenied:false}});
   const splitResponse=await httpSplit();assert.equal(splitResponse.status,200,JSON.stringify(splitResponse));assert.equal(splitResponse.body.lines.length,2);assert.equal(splitResponse.body.editVersion,1);assert.ok(splitResponse.body.lines.every(l=>l.batchId===authLot.batchId));assert.equal((await httpSplit()).status,409);assert.equal(await p.stockDocumentLine.count({where:{documentId:authDoc.id}}),2);reports.push({mode:'Nest JWT fixture session permissions branch controller actual split DTO SQL',checks:['adjust denial403 unchanged','entered parts2+1 preserved batch identity','refreshed2 lines/version1','stale version409 no duplicate']});
   await p.refreshToken.update({where:{tokenHash:hash},data:{revokedAt:new Date()}});assert.equal((await call('GET','')).status,401);reports.push({mode:'Nest HTTP production JWT session guard permissions controller SQL; signature decoder fixture',checks:['missing/invalid credential401','live permission deny403 no write','other branch403','no cost stock create403','detail money redacted','revoked session401']});
  }finally{await app.close();}
 }
 console.log(JSON.stringify({postgres:identity.version,database,reports},null,2));
 await Promise.all(clients.map(x=>x.$disconnect()));await sql.end();
})().catch(e=>{console.error(e);process.exit(1)});
