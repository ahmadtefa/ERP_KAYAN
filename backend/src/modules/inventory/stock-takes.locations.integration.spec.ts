import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';

import { BatchesService } from './batches.service';
import { StockDocumentsService } from './stock-documents.service';
import { StockTakesService } from './stock-takes.service';
import { WarehouseService } from '../../common/warehouse/warehouse.service';
import { StorageLocationsService } from './storage-locations.service';
import { AccountMapService } from '../accounting/account-map.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { FiscalPeriodsService } from '../accounting/fiscal-periods.service';
import { PostingService } from '../accounting/posting.service';
import { CostCentersService } from '../accounting/cost-centers.service';
import { StockLedgerService } from '../../common/warehouse/stock-ledger.service';
import { pglitePrisma } from '../../testing/pglite-adapter';

/// The four things a storekeeper does to a lot, against a real engine.
///
/// Every one of them moves a quantity that the balance tables also hold, so a
/// test that only checked the returned object would miss a lot whose
/// `remainingQuantity` disagrees with `stock_balances`. These read both, over a
/// schema built from the project's own migrations, so the CHECK constraints and
/// the unique index that stops a duplicated movement are the real ones.
///
/// They need PGlite's wasm engine and run under
/// `NODE_OPTIONS=--experimental-vm-modules`; without it the suite skips.

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const WAREHOUSE = '44444444-4444-4444-8444-444444444444';
const WAREHOUSE_2 = '55555555-5555-4555-8555-555555555555';
const ITEM = '66666666-6666-4666-8666-666666666666';
const ITEM_NO_EXPIRY = '77777777-7777-4777-8777-777777777777';
const SHELF = '88888888-8888-4888-8888-888888888888';
const ACCOUNT_INVENTORY = '99999999-9999-4999-8999-999999999991';
const ACCOUNT_DIFF = '99999999-9999-4999-8999-999999999992';

const migrationsDir = join(process.cwd(), 'prisma', 'migrations');

async function freshDatabase(): Promise<PGlite> {
  const db = new PGlite();
  for (const dir of readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()) {
    let sql: string;
    try {
      sql = readFileSync(join(migrationsDir, dir, 'migration.sql'), 'utf8');
    } catch {
      continue;
    }
    await db.exec(sql);
  }
  await db.exec(`
    INSERT INTO companies (id, code, "nameEn", "nameAr", "updatedAt")
    VALUES ('${COMPANY}', 'CO', 'Co', 'شركة', now());

    INSERT INTO branches (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
    VALUES ('${BRANCH}', '${COMPANY}', 'BR', 'Branch', 'فرع', now());

    INSERT INTO warehouses (id, "companyId", "branchId", code, "nameEn", "nameAr", "isDefault", "isActive", "updatedAt")
    VALUES ('${WAREHOUSE}', '${COMPANY}', '${BRANCH}', 'W1', 'Main', 'رئيسي', true, true, now()),
           ('${WAREHOUSE_2}', '${COMPANY}', '${BRANCH}', 'W2', 'Overflow', 'احتياطي', false, true, now());

    INSERT INTO storage_locations
      (id, "companyId", "branchId", "warehouseId", kind, code, "nameEn", "nameAr", "isActive", "updatedAt")
    VALUES ('${SHELF}', '${COMPANY}', '${BRANCH}', '${WAREHOUSE}', 'SHELF', 'A-01',
            'Aisle A shelf 1', 'ممر أ رف ١', true, now());

    INSERT INTO users (id, "companyId", username, "fullNameEn", "fullNameAr", "passwordHash", "isActive", "isSuperAdmin", "tokenVersion", "updatedAt")
    VALUES ('${USER}', '${COMPANY}', 'storekeeper', 'Storekeeper', 'أمين المخزن',
            'not-a-real-hash', true, false, 0, now());

    INSERT INTO accounts (id, "companyId", code, "nameEn", "nameAr", type, "isPostable", "isActive", "updatedAt")
    VALUES ('${ACCOUNT_INVENTORY}', '${COMPANY}', '1104', 'Inventory', 'المخزون', 'ASSET', true, true, now()),
           ('${ACCOUNT_DIFF}', '${COMPANY}', '5107', 'Inventory difference', 'فروق المخزون', 'EXPENSE', true, true, now());

    INSERT INTO items (id, "companyId", code, "nameEn", "nameAr", unit, "isStockTracked",
                       "requiresBatch", "useFefo", "salePrice", "updatedAt")
    VALUES ('${ITEM}', '${COMPANY}', 'IT-1', 'Milk', 'حليب', 'piece', true, true, true, 10, now()),
           ('${ITEM_NO_EXPIRY}', '${COMPANY}', 'IT-2', 'Sand', 'رمل', 'kg', true, true, true, 4, now());
  `);
  return db;
}


function servicesWith(db: PGlite) {
  const prisma = pglitePrisma(db);
  const audit = { record: async () => undefined, recordRequired: async () => undefined };
  const numbers = new DocumentNumberService();
  const posting = new PostingService(
    numbers,
    new FiscalPeriodsService(prisma as never, audit as never),
    new CostCentersService(prisma as never, audit as never),
  );
  const batches = new BatchesService(
    prisma as never, {} as never, posting as never, new AccountMapService() as never,
    numbers as never, audit as never, new StockLedgerService(),
  );
  const warehouses = new WarehouseService(prisma as never, audit as never);
  const documents = new StockDocumentsService(
    prisma as never, numbers as never, posting as never, new AccountMapService() as never, audit as never,
    { get: async () => ({ allowNegativeStock: false }) } as never,
    warehouses, new CostCentersService(prisma as never, audit as never), new StockLedgerService(),
  );
  const takes = new StockTakesService(prisma as never, warehouses, new StockLedgerService(), numbers as never, documents, audit as never);
  return { batches, takes };
}

const one = async (db: PGlite, sql: string, args: unknown[] = []) =>
  (await db.query<Record<string, string>>(sql, args)).rows[0];

jest.setTimeout(180_000);
const vmReady =
  process.execArgv.includes('--experimental-vm-modules') ||
  (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules');

(vmReady ? describe : describe.skip)('stock count per location over a real engine', () => {
  let db: PGlite;
  let batches: BatchesService;
  let takes: StockTakesService;
  const SHELF_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  beforeEach(async () => {
    db = await freshDatabase();
    ({ batches, takes } = servicesWith(db));
    await db.exec(`INSERT INTO storage_locations
      (id, "companyId", "branchId", "warehouseId", kind, code, "nameEn", "nameAr", "isActive", "updatedAt")
      VALUES ('${SHELF_B}', '${COMPANY}', '${BRANCH}', '${WAREHOUSE}', 'SHELF', 'B-01', 'B1', 'ب١', true, now())`);
    const rec = (qty: number, loc?: string) =>
      batches.receive(COMPANY, USER, { branchId: BRANCH, warehouseId: WAREHOUSE, itemId: ITEM, batchNumber: 'L1', quantity: qty, unitCost: 2, ...(loc ? { storageLocationId: loc } : {}), expiryDate: '2027-02-01' });
    await rec(6, SHELF);
    await rec(4, SHELF_B);
    await rec(3); // unlocated
    await db.exec(`UPDATE items SET "isStockTracked"=false WHERE id='${ITEM_NO_EXPIRY}'`);
  });
  afterEach(async () => { await db.close(); });

  const shelf = async (loc: string | null) =>
    Number((await one(db, `SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN quantity ELSE -quantity END),0)::text q FROM stock_movements WHERE "itemId"=$1 AND "storageLocationId" ${loc ? '= $2' : 'IS NULL'}`, loc ? [ITEM, loc] : [ITEM])).q);


  it('patch54 own-key creation replay changed intent and safe read are exact',async()=>{
    const body={warehouseId:WAREHOUSE,scope:'PARTIAL' as const,itemIds:[ITEM],notes:'shelf check'};
    const first=await takes.start(COMPANY,USER,body,null,'own-create');
    await batches.receive(COMPANY,USER,{branchId:BRANCH,warehouseId:WAREHOUSE,itemId:ITEM,batchNumber:'L2',quantity:2,unitCost:2});
    const again=await takes.start(COMPANY,USER,{...body,notes:' shelf check ',itemIds:[ITEM,ITEM]},null,'own-create');
    expect(again.id).toBe(first.id);expect(again.lines).toEqual(first.lines);
    await expect(takes.start(COMPANY,USER,{...body,notes:'changed'},null,'own-create')).rejects.toThrow('different count');
    expect((await takes.createOutcome(COMPANY,USER,'own-create')).session?.id).toBe(first.id);
    expect((await takes.createOutcome(COMPANY,'99999999-9999-4999-8999-999999999999','own-create')).state).toBe('ABSENT');
    expect((await takes.createOutcome(COMPANY,USER,'own-create',[])).state).toBe('ABSENT');
    const read=JSON.stringify(await takes.createOutcome(COMPANY,USER,'own-create'));expect(read).not.toMatch(/Hash|notes|unitCost|systemQuantity|createdBy/);
  });
  it('patch54 keyed marker failure rolls back frozen rows and number then permits original request',async()=>{
    const before=await db.query(`SELECT * FROM document_sequences`);
    await db.exec(`CREATE FUNCTION fail_count_key() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."createRequestKey" IS NOT NULL THEN RAISE EXCEPTION 'create-key-failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_count_create BEFORE UPDATE ON stock_take_sessions FOR EACH ROW EXECUTE FUNCTION fail_count_key();`);
    await expect(takes.start(COMPANY,USER,{warehouseId:WAREHOUSE,scope:'PARTIAL',itemIds:[ITEM]},null,'rollback-key')).rejects.toThrow('create-key-failure');
    expect((await db.query('SELECT * FROM stock_take_sessions')).rows).toHaveLength(0);expect((await db.query('SELECT * FROM stock_take_lines')).rows).toHaveLength(0);expect((await db.query('SELECT * FROM document_sequences')).rows).toEqual(before.rows);
    expect((await takes.createOutcome(COMPANY,USER,'rollback-key')).state).toBe('ABSENT');
    await db.exec('DROP TRIGGER fail_count_create ON stock_take_sessions');
    const success=await takes.start(COMPANY,USER,{warehouseId:WAREHOUSE,scope:'PARTIAL',itemIds:[ITEM]},null,'rollback-key');expect(success.lines.length).toBeGreaterThan(1);expect((await takes.createOutcome(COMPANY,USER,'rollback-key')).state).toBe('COMPLETED');
  });
  it('freezes one row per shelf plus an unlocated row, and a shelf shortfall posts against that shelf only', async () => {
    const session = await takes.start(COMPANY, USER, { warehouseId: WAREHOUSE, scope: 'PARTIAL', itemIds: [ITEM] }) as unknown as { id: string; lines: Array<{ id: string; storageLocationCode: string | null; systemQuantity: string }> };
    const rows = Object.fromEntries(session.lines.map((l) => [l.storageLocationCode ?? 'none', l.systemQuantity]));
    expect(rows).toEqual({ 'A-01': '6.0000', 'B-01': '4.0000', none: '3.0000' });
    const lineOf = (code: string | null) => session.lines.find((l) => l.storageLocationCode === code)!.id;
    await takes.record(COMPANY, USER, session.id, { lines: [
      { lineId: lineOf('A-01'), countedQuantity: 5 },
      { lineId: lineOf('B-01'), countedQuantity: 4 },
      { lineId: lineOf(null), countedQuantity: 3 },
    ], finish: true } as never);
    await takes.approve(COMPANY, '44444444-4444-4444-8444-444444444444', session.id);
    await takes.post(COMPANY, USER, session.id);
    expect(await shelf(SHELF)).toBe(5);
    expect(await shelf(SHELF_B)).toBe(4);
    expect(await shelf(null)).toBe(3);
    expect((await one(db, `SELECT "remainingQuantity"::text r FROM item_batches WHERE "batchNumber"='L1'`)).r).toBe('12.0000');
  });
  async function finishCount(countA: number) {
    const session = await takes.start(COMPANY, USER, {warehouseId: WAREHOUSE, scope:'PARTIAL',itemIds:[ITEM]}) as any;
    await takes.record(COMPANY, USER, session.id, {lines:session.lines.map((l:any)=>({lineId:l.id,countedQuantity:l.storageLocationCode==='A-01'?countA:Number(l.systemQuantity)})),finish:true} as never);
    await takes.approve(COMPANY, WAREHOUSE, session.id);
    return session;
  }
  it('surplus stays on its counted shelf and preserves other shelves and original variance',async()=>{
    const st=await finishCount(8);await takes.post(COMPANY,USER,st.id);
    expect(await shelf(SHELF)).toBe(8);expect(await shelf(SHELF_B)).toBe(4);expect(await shelf(null)).toBe(3);
    expect((await one(db,`SELECT "remainingQuantity"::text r FROM item_batches WHERE "batchNumber"='L1'`)).r).toBe('15.0000');
    expect((await one(db,`SELECT "varianceQuantity"::text q FROM stock_take_lines WHERE "sessionId"=$1 AND "storageLocationId"=$2`,[st.id,SHELF])).q).toBe('2.0000');
  });
  it('a later issue does not rewrite the frozen variance or absolute shelf count',async()=>{
    const st=await finishCount(5);
    await batches.writeOff(COMPANY,USER,{branchId:BRANCH,warehouseId:WAREHOUSE,itemId:ITEM,batchId:(await one(db,`SELECT id FROM item_batches WHERE "batchNumber"='L1'`)).id,quantity:2,storageLocationId:SHELF,reason:'after snapshot'} as never);
    await takes.post(COMPANY,USER,st.id);
    expect(await shelf(SHELF)).toBe(3);expect(await shelf(SHELF_B)).toBe(4);
    expect((await one(db,`SELECT "systemQuantity"::text s,"varianceQuantity"::text v FROM stock_take_lines WHERE "sessionId"=$1 AND "storageLocationId"=$2`,[st.id,SHELF]))).toMatchObject({s:'6.0000',v:'-1.0000'});
  });
  it.each([5,8])('inactive counted shelf with count %s',async(countA)=>{
    const st=await finishCount(countA);await db.exec(`UPDATE storage_locations SET "isActive"=false WHERE id='${SHELF}'`);
    if(countA<6){await takes.post(COMPANY,USER,st.id);expect(await shelf(SHELF)).toBe(5);}
    else {await expect(takes.post(COMPANY,USER,st.id)).rejects.toThrow();expect(await shelf(SHELF)).toBe(6);}
  });

  it('different lots on the same shelf stay separate when only one is short',async()=>{
    await batches.receive(COMPANY,USER,{branchId:BRANCH,warehouseId:WAREHOUSE,itemId:ITEM,batchNumber:'L2',quantity:7,unitCost:4,storageLocationId:SHELF,expiryDate:'2027-04-01'});
    const st=await takes.start(COMPANY,USER,{warehouseId:WAREHOUSE,scope:'PARTIAL',itemIds:[ITEM]}) as any;
    const onA=st.lines.filter((l:any)=>l.storageLocationId===SHELF);expect(onA).toHaveLength(2);
    await takes.record(COMPANY,USER,st.id,{lines:st.lines.map((l:any)=>({lineId:l.id,countedQuantity:l.storageLocationId===SHELF && l.batchNumber==='L1'?5:Number(l.systemQuantity)})),finish:true} as never);
    await takes.approve(COMPANY,WAREHOUSE,st.id);await takes.post(COMPANY,USER,st.id);
    expect(await shelf(SHELF)).toBe(12);expect((await one(db,`SELECT "remainingQuantity"::text q FROM item_batches WHERE "batchNumber"='L2'`)).q).toBe('7.0000');
  });

  it('unlocated assignment onto a zero-stock shelf preserves lot quantity and all stock values',async()=>{
    const loc='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';await db.exec(`INSERT INTO storage_locations(id,"companyId","branchId","warehouseId",kind,code,"nameEn","nameAr","updatedAt") VALUES('${loc}','${COMPANY}','${BRANCH}','${WAREHOUSE}','SHELF','C-01','C','C',now())`);
    let st=await takes.start(COMPANY,USER,{warehouseId:WAREHOUSE,scope:'PARTIAL',itemIds:[ITEM]}) as any;
    st=await takes.addLocation(COMPANY,USER,st.id,{itemId:ITEM,batchId:st.lines[0].batchId,storageLocationId:loc});
    const before=await one(db,`SELECT quantity::text q,value::text v FROM warehouse_stock_balances WHERE "itemId"=$1`,[ITEM]);
    st=await takes.record(COMPANY,USER,st.id,{lines:st.lines.map((l:any)=>({lineId:l.id,countedQuantity:l.storageLocationId===null?0:l.storageLocationId===loc?3:Number(l.systemQuantity)})),finish:true} as never);
    expect(st.assignedQuantity).toBe(3);expect(st.realVarianceValue).toBe('0.0000');
    await takes.approve(COMPANY,WAREHOUSE,st.id);await takes.post(COMPANY,USER,st.id);
    expect(await shelf(loc)).toBe(3);expect(await shelf(null)).toBe(0);expect(await shelf(SHELF)).toBe(6);expect(await shelf(SHELF_B)).toBe(4);
    expect(await one(db,`SELECT quantity::text q,value::text v FROM warehouse_stock_balances WHERE "itemId"=$1`,[ITEM])).toEqual(before);
    expect((await one(db,`SELECT "remainingQuantity"::text q,"unitCost"::text c FROM item_batches WHERE "batchNumber"='L1'`))).toEqual({q:'13.0000',c:'2.0000'});
    expect((await one(db,`SELECT quantity::text q,value::text v FROM stock_balances WHERE "itemId"=$1`,[ITEM]))).toEqual(before);
  });

  it('unique-shelf migration refuses historical duplicates without changing either row',async()=>{
    const st=await takes.start(COMPANY,USER,{warehouseId:WAREHOUSE,scope:'PARTIAL',itemIds:[ITEM]}) as any;
    await db.exec(`DROP INDEX stock_take_lines_session_item_lot_shelf_key`);
    const original=st.lines[0];
    await db.query(`INSERT INTO stock_take_lines(id,"sessionId","itemId","batchId","storageLocationId","systemQuantity","unitCost","varianceQuantity","varianceValue") SELECT 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',"sessionId","itemId","batchId","storageLocationId","systemQuantity","unitCost",7,14 FROM stock_take_lines WHERE id=$1`,[original.id]);
    const before=(await db.query(`SELECT id,"systemQuantity"::text,"varianceQuantity"::text FROM stock_take_lines WHERE "sessionId"=$1 ORDER BY id`,[st.id])).rows;
    await expect(db.exec(readFileSync(join(migrationsDir,'20261125050000_stock_take_line_unique_shelf','migration.sql'),'utf8'))).rejects.toThrow(/No data was changed.*Review/s);
    expect((await db.query(`SELECT id,"systemQuantity"::text,"varianceQuantity"::text FROM stock_take_lines WHERE "sessionId"=$1 ORDER BY id`,[st.id])).rows).toEqual(before);
  });
  it('a lot-less new shelf accepts neutral assignment without fabricating a lot',async()=>{
    await db.exec(`UPDATE items SET "isStockTracked"=true,"requiresBatch"=false,"useFefo"=false WHERE id='${ITEM_NO_EXPIRY}'`);
    await db.exec(`INSERT INTO stock_movements(id,"companyId","branchId","warehouseId","itemId","movementDate",direction,quantity,"unitCost","totalCost","referenceType","referenceId","createdBy") VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','${COMPANY}','${BRANCH}','${WAREHOUSE}','${ITEM_NO_EXPIRY}',now(),'IN',5,2,10,'ITEM_OPENING_STOCK','${ITEM_NO_EXPIRY}','${USER}');
    INSERT INTO stock_balances("companyId","branchId","itemId",quantity,value,"updatedAt") VALUES('${COMPANY}','${BRANCH}','${ITEM_NO_EXPIRY}',5,10,now());
    INSERT INTO warehouse_stock_balances("companyId","branchId","warehouseId","itemId",quantity,value,"updatedAt") VALUES('${COMPANY}','${BRANCH}','${WAREHOUSE}','${ITEM_NO_EXPIRY}',5,10,now());`);
    let st=await takes.start(COMPANY,USER,{warehouseId:WAREHOUSE,scope:'PARTIAL',itemIds:[ITEM_NO_EXPIRY]}) as any;
    st=await takes.addLocation(COMPANY,USER,st.id,{itemId:ITEM_NO_EXPIRY,storageLocationId:SHELF});
    st=await takes.record(COMPANY,USER,st.id,{lines:st.lines.map((l:any)=>({lineId:l.id,countedQuantity:l.storageLocationId?5:0})),finish:true} as never);
    expect(st.assignedQuantity).toBe(5);await takes.approve(COMPANY,WAREHOUSE,st.id);await takes.post(COMPANY,USER,st.id);
    expect((await one(db,`SELECT quantity::text q,value::text v FROM warehouse_stock_balances WHERE "itemId"=$1`,[ITEM_NO_EXPIRY]))).toEqual({q:'5.0000',v:'10.0000'});
    expect((await one(db,`SELECT count(*)::text n FROM item_batches WHERE "itemId"=$1`,[ITEM_NO_EXPIRY])).n).toBe('0');
  });

  (process.env.KAYAN_COUNT_LOCATION_UI==='1'?it:it.skip)('actual Flutter count add record finish uses service SQL and preserves frozen physical variance',async()=>{
    const CLOC='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';await db.exec(`INSERT INTO storage_locations(id,"companyId","branchId","warehouseId",kind,code,"nameEn","nameAr","updatedAt") VALUES('${CLOC}','${COMPANY}','${BRANCH}','${WAREHOUSE}','SHELF','C-01','C1','C1',now())`);
    const st=await takes.start(COMPANY,USER,{warehouseId:WAREHOUSE,scope:'PARTIAL',itemIds:[ITEM]}) as any;const locations=new StorageLocationsService(pglitePrisma(db) as never,{record:async()=>undefined} as never);const calls:string[]=[];
    const server=createServer(async(req,res)=>{try{const url=new URL(req.url!,'http://localhost');let data:any;if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);calls.push(url.pathname);data=url.pathname.endsWith('/locations')?await takes.addLocation(COMPANY,USER,st.id,body):await takes.record(COMPANY,USER,st.id,body);}else if(url.pathname.endsWith('/locations'))data=await locations.list(COMPANY,{warehouseId:WAREHOUSE});else if(url.pathname.endsWith('/stock-takes'))data={items:[await takes.findOne(COMPANY,st.id)]};else data=await takes.findOne(COMPANY,st.id);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));}catch(e){console.log(e);res.statusCode=400;res.end(JSON.stringify({message:String(e)}));}});await new Promise<void>(r=>server.listen(3224,'127.0.0.1',r));
    try{const out=await promisify(execFile)('/tmp/flutter/bin/flutter',['test','test/widget/stock_take_locations_http_test.dart'],{cwd:join(process.cwd(),'..'),timeout:90000,maxBuffer:4*1024*1024}).catch(e=>{console.log(e.stdout,e.stderr);throw e;});console.log(out.stdout);expect(calls.map(x=>x.split('/').pop())).toEqual(['locations','count','count']);const final=await takes.findOne(COMPANY,st.id);expect(final.status).toBe('REVIEW');expect(final.assignedQuantity).toBe(3);expect(final.realVarianceValue).toBe('0.0000');expect(await shelf(null)).toBe(3);expect(await shelf(CLOC)).toBe(0);}
    finally{await new Promise<void>(r=>server.close(()=>r()));}
  },150000);

});
