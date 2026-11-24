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
  // Fixture-only value-neutral move, avoiding the independently reported Prisma void-return bug in move().
  for (const [storageLocationId,direction] of [[L,'OUT'],[L2,'IN']]) await p.stockMovement.create({data:{companyId:C,branchId:B,warehouseId:W,itemId:I,batchId:receipt.batchId,storageLocationId,direction,quantity:3,unitCost:2,totalCost:6,movementDate:new Date(),referenceType:'SYNTHETIC_LOCATION_MOVE'}});
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
 console.log(JSON.stringify({postgres:identity.version,database,reports},null,2));
 await Promise.all(clients.map(x=>x.$disconnect()));await sql.end();
})().catch(e=>{console.error(e);process.exit(1)});
