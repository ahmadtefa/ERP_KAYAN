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
 console.log(JSON.stringify({postgres:identity.version,database,reports},null,2));
 await Promise.all(clients.map(x=>x.$disconnect()));await sql.end();
})().catch(e=>{console.error(e);process.exit(1)});
