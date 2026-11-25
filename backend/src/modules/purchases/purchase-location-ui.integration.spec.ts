import {BatchesService} from '../inventory/batches.service';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';
import { PGlite } from '@electric-sql/pglite';

import { AccountMapService } from '../accounting/account-map.service';
import { CostCentersService } from '../accounting/cost-centers.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { FiscalPeriodsService } from '../accounting/fiscal-periods.service';
import { PostingService } from '../accounting/posting.service';
import { AuditService } from '../../common/audit/audit.service';
import { WarehouseService } from '../../common/warehouse/warehouse.service';
import { StockLedgerService } from '../../common/warehouse/stock-ledger.service';
import { pglitePrisma } from '../../testing/pglite-adapter';

import { PurchaseInvoicesService } from './purchase-invoices.service';

/// Opt-in actual Flutter form bridge into production purchase services over migrated SQL.
/// The bridge omits controllers, JWT, licence enforcement and installed Windows.
/// Posting is a service call after the actual UI draft update, not a UI Post click.

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const WAREHOUSE = '44444444-4444-4444-8444-444444444444';
const ITEM = '55555555-5555-4555-8555-555555555555';
const SHELF_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SHELF_OFF = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SHELF_W2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const WAREHOUSE_2 = '12121212-1212-4212-8212-121212121212';
const CUSTOMER = '66666666-6666-4666-8666-666666666666';

const D = (value: string | number) => new Prisma.Decimal(value);

const migrationsDir = join(process.cwd(), 'prisma', 'migrations');

/// Purchase posting account map.
const ACCOUNTS: Array<[string, string, string]> = [
  ['2101', 'Accounts payable', 'ap'],
  ['1104', 'Inventory', 'inventory'],
  ['1105', 'VAT receivable', 'vat'],
];

async function freshDatabase(): Promise<PGlite> {
  const db = new PGlite();
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const dir of dirs) {
    let sql: string;
    try {
      sql = readFileSync(join(migrationsDir, dir, 'migration.sql'), 'utf8');
    } catch {
      continue;
    }
    await db.exec(sql);
  }

  const accountRows = ACCOUNTS.map(
    ([code, nameEn], index) => `
    INSERT INTO accounts (id, "companyId", code, "nameEn", "nameAr", type, "isPostable", "isActive", "updatedAt")
    VALUES ('${accountId(code)}', '${COMPANY}', '${code}', '${nameEn}', '${nameEn}', '${index === 0 ? 'LIABILITY' : 'ASSET'}', true, true, now());`,
  ).join('');

  await db.exec(`
    INSERT INTO companies (id, code, "nameEn", "nameAr", "updatedAt")
    VALUES ('${COMPANY}', 'CO', 'Co', 'شركة', now());

    INSERT INTO branches (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
    VALUES ('${BRANCH}', '${COMPANY}', 'BR', 'Branch', 'فرع', now());

    INSERT INTO warehouses (id, "companyId", "branchId", code, "nameEn", "nameAr", "isDefault", "isActive", "updatedAt")
    VALUES ('${WAREHOUSE}', '${COMPANY}', '${BRANCH}', 'W1', 'Main', 'رئيسي', true, true, now());

    INSERT INTO suppliers (id, "companyId", code, "nameEn", "nameAr", "isActive", "updatedAt")
    VALUES ('${CUSTOMER}', '${COMPANY}', 'S-1', 'Seller', 'بائع', true, now());

    INSERT INTO storage_locations (id, "companyId", "branchId", "warehouseId", kind, code, "nameEn", "nameAr", "isActive", "updatedAt")
    VALUES ('${SHELF_A}', '${COMPANY}', '${BRANCH}', '${WAREHOUSE}', 'SHELF', 'A-01', 'A1', 'أ١', true, now()),
           ('${SHELF_OFF}', '${COMPANY}', '${BRANCH}', '${WAREHOUSE}', 'SHELF', 'X-01', 'X1', 'س١', false, now());
    INSERT INTO warehouses (id, "companyId", "branchId", code, "nameEn", "nameAr", "isDefault", "isActive", "updatedAt")
    VALUES ('${WAREHOUSE_2}', '${COMPANY}', '${BRANCH}', 'W2', 'Other', 'آخر', false, true, now());
    INSERT INTO storage_locations (id, "companyId", "branchId", "warehouseId", kind, code, "nameEn", "nameAr", "isActive", "updatedAt")
    VALUES ('${SHELF_W2}', '${COMPANY}', '${BRANCH}', '${WAREHOUSE_2}', 'SHELF', 'Z-01', 'Z1', 'ز١', true, now());

    -- The journal stamps createdBy, and that column carries a real foreign key
    -- to users. Without the row the posting would fail at the database, which
    -- is exactly the fidelity this suite is here for.
    INSERT INTO users (id, "companyId", username, "fullNameEn", "fullNameAr", "passwordHash", "updatedAt")
    VALUES ('${USER}', '${COMPANY}', 'tester', 'Tester', 'مختبِر', 'x', now());

    INSERT INTO items (id, "companyId", code, "nameEn", "nameAr", unit, "isStockTracked",
                       "requiresBatch", "useFefo", "allowExpiredIssue", "salePrice", "updatedAt")
    VALUES ('${ITEM}', '${COMPANY}', 'IT-1', 'Milk', 'حليب', 'piece', true,
            false, false, false, 10, now());

    ${accountRows}
  `);
  return db;
}

function accountId(code: string): string {
  // Deterministic test ids: readable when a failure prints one, and stable
  // enough that a second seeding attempt collides instead of hiding a bug.
  const suffix = code.padStart(12, '0');
  return `99999999-9999-4999-8999-${suffix}`;
}


function serviceWith(db: PGlite) {
  const prisma = pglitePrisma(db as never);
  const ledger = new StockLedgerService();
  const audit = new AuditService(prisma as never);
  const posting = new PostingService(
    new DocumentNumberService(),
    new FiscalPeriodsService(prisma as never, audit as never),
    new CostCentersService(prisma as never, audit as never),
  );
  return new PurchaseInvoicesService(
    prisma as never,
    new DocumentNumberService(),
    posting,
    new AccountMapService(),
    { get: async () => ({ defaultTaxRate: D(0), taxRate: '0.0000', maxDiscountPercent: '100.0000', pricesIncludeTax: false }) } as never,
    new WarehouseService(prisma as never, audit as never),
    ledger,
    { resolvePrice: async () => null } as never,
    audit as never,
    new BatchesService(prisma as never, {} as never, posting as never, new AccountMapService() as never, new DocumentNumberService() as never, audit as never, ledger),
  );
}

jest.setTimeout(180_000);
const vmReady =
  process.execArgv.includes('--experimental-vm-modules') ||
  (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules');

(vmReady && process.env.KAYAN_PURCHASE_LOCATION_UI === '1' ? describe : describe.skip)('purchase location actual Flutter bridge',()=>{
 it('changes persisted receipt destination through the real form, then posts onto it',async()=>{
  const db=await freshDatabase();const service=serviceWith(db);const shelfB='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  await db.query(`UPDATE items SET \"requiresBatch\"=true,\"requiresProductionDate\"=true,\"requiresExpiryDate\"=true WHERE id=$1`,[ITEM]);
  await db.query(`INSERT INTO storage_locations (id,"companyId","branchId","warehouseId",kind,code,"nameEn","nameAr","isActive","updatedAt") VALUES ($1,$2,$3,$4,'SHELF','B-01','Shelf B','رف ب',true,now())`,[shelfB,COMPANY,BRANCH,WAREHOUSE]);
  const draft=await service.create(COMPANY,BRANCH,USER,{supplierId:CUSTOMER,warehouseId:WAREHOUSE,invoiceDate:'2026-11-25',lines:[{itemId:ITEM,quantity:'5',unitPrice:'4',taxRate:'0',storageLocationId:SHELF_A}]} as never) as {id:string};
  const server=createServer(async(req,res)=>{try{
   const path=new URL(req.url!,'http://localhost').pathname.replace('/api/v1','');let data:unknown;
   if(path==='/purchases/invoices/current'&&req.method==='PUT'){let body='';for await(const chunk of req)body+=chunk;data=await service.updateDraft(COMPANY,BRANCH,USER,draft.id,JSON.parse(body));}
   else if(path==='/purchases/invoices/current')data=await service.findOne(COMPANY,draft.id);
   else if(path==='/inventory/items')data=[{id:ITEM,code:'IT-1',nameEn:'Milk',nameAr:'حليب',unit:'piece',isActive:true,requiresBatch:true,requiresProductionDate:true,requiresExpiryDate:true}];
   else if(path==='/inventory/warehouses')data=(await db.query(`SELECT id,code,"nameEn","nameAr","isActive" FROM warehouses WHERE id=$1`,[WAREHOUSE])).rows;
   else if(path==='/inventory/locations')data=(await db.query(`SELECT id,code,"nameEn","nameAr","isActive","warehouseId" FROM storage_locations ORDER BY code`)).rows;
   else if(path==='/parties/suppliers')data=[{id:CUSTOMER,code:'S-1',nameEn:'Seller',nameAr:'بائع',isActive:true}];
   else if(path.includes('tax-pricing'))data={pricesIncludeTax:false};else data=[];
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));
  }catch(e){res.statusCode=400;res.end(JSON.stringify({message:String(e)}));}});
  await new Promise<void>(r=>server.listen(3221,'127.0.0.1',r));
  try{
   const output=await promisify(execFile)(process.env.FLUTTER_BIN??'flutter',['test','test/widget/purchase_location_http_test.dart'],{cwd:join(process.cwd(),'..'),timeout:90000,maxBuffer:4*1024*1024}).catch(e=>{console.log(e.stdout,e.stderr);throw e;});console.log(output.stdout);
   const read=await service.findOne(COMPANY,draft.id) as unknown as {warehouseId:string;lines:Array<{storageLocationId:string}>};
   expect(read.warehouseId).toBe(WAREHOUSE);expect(read.lines[0].storageLocationId).toBe(shelfB);
   expect(read.lines[0]).toMatchObject({batchNumber:'UI-PURCHASE-LOT',batchProductionDate:'2026-11-01',batchExpiryDate:'2027-04-01'});
   await service.post(COMPANY,USER,draft.id);
   const lot=(await db.query<{id:string;q:string}>(`SELECT id,"remainingQuantity"::text q FROM item_batches WHERE "batchNumber"='UI-PURCHASE-LOT'`)).rows[0];expect(lot.q).toBe('5.0000');
   const batches=new BatchesService(pglitePrisma(db) as never,{} as never,{} as never,{} as never,{} as never,{record:async()=>{},recordRequired:async()=>{}} as never,new StockLedgerService());
   await batches.issue(COMPANY,USER,{branchId:BRANCH,warehouseId:WAREHOUSE,itemId:ITEM,batchId:lot.id,storageLocationId:shelfB,quantity:1});
   expect((await db.query(`SELECT "remainingQuantity"::text q FROM item_batches WHERE id=$1`,[lot.id])).rows).toEqual([{q:'4.0000'}]);
   expect((await db.query(`SELECT "storageLocationId" loc,quantity::text q FROM stock_movements WHERE "referenceType"='PURCHASE_INVOICE'`)).rows).toEqual([{loc:shelfB,q:'5.0000'}]);
  }finally{await new Promise<void>(r=>server.close(()=>r()));await db.close();}
 },150000);
});
