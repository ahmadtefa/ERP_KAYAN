import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';

import { BatchesService } from './batches.service';
import { StockDocumentsService } from './stock-documents.service';
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
  const documents = new StockDocumentsService(
    prisma as never, numbers as never, posting as never, new AccountMapService() as never, audit as never,
    { get: async () => ({ allowNegativeStock: false }) } as never,
    new WarehouseService(prisma as never, audit as never),
    new CostCentersService(prisma as never, audit as never),
    new StockLedgerService(),
  );
  return { batches, documents };
}

const one = async (db: PGlite, sql: string, args: unknown[] = []) =>
  (await db.query<Record<string, string>>(sql, args)).rows[0];

jest.setTimeout(180_000);
const vmReady =
  process.execArgv.includes('--experimental-vm-modules') ||
  (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules');

(vmReady ? describe : describe.skip)('stock document transfer with source and target shelves over a real engine', () => {
  let db: PGlite;
  let batches: BatchesService;
  let documents: StockDocumentsService;
  const SHELF_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const SHELF_W2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  beforeEach(async () => {
    db = await freshDatabase();
    ({ batches, documents } = servicesWith(db));
    jest.spyOn(documents, 'findOne').mockImplementation((async (_c: string, id: string) => ({ id })) as never);
    await db.exec(`INSERT INTO storage_locations
      (id, "companyId", "branchId", "warehouseId", kind, code, "nameEn", "nameAr", "isActive", "updatedAt")
      VALUES ('${SHELF_B}', '${COMPANY}', '${BRANCH}', '${WAREHOUSE}', 'SHELF', 'B-01', 'B1', 'ب١', true, now()),
             ('${SHELF_W2}', '${COMPANY}', '${BRANCH}', '${WAREHOUSE_2}', 'SHELF', 'C-01', 'C1', 'ج١', true, now())`);
    // Warehouse 1: lot L1, 10 at cost 12 (6 on A-01, 4 on B-01). Warehouse 2: the same lot, 5 at cost 6 on C-01.
    const rec = (wh: string, qty: number, cost: number, loc: string) =>
      batches.receive(COMPANY, USER, { branchId: BRANCH, warehouseId: wh, itemId: ITEM, batchNumber: 'L1', quantity: qty, unitCost: cost, storageLocationId: loc, expiryDate: '2027-02-01' });
    await rec(WAREHOUSE, 6, 12, SHELF);
    await rec(WAREHOUSE, 4, 12, SHELF_B);
    await rec(WAREHOUSE_2, 5, 6, SHELF_W2);
  });
  afterEach(async () => { await db.close(); });

  const failure = async (p: Promise<unknown>) => {
    try { await p; } catch (e) { return (e as { response?: { code?: string; message?: string } }).response ?? { message: String(e) }; }
    return null;
  };
  const shelf = async (loc: string) =>
    Number((await one(db, `SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN quantity ELSE -quantity END),0)::text q FROM stock_movements WHERE "itemId"=$1 AND "storageLocationId"=$2`, [ITEM, loc])).q);
  const lot = async (wh: string) =>
    one(db, `SELECT "remainingQuantity"::text r, "unitCost"::text c FROM item_batches WHERE "warehouseId"=$1 AND "batchNumber"='L1'`, [wh]);
  const wh = async (w: string) =>
    one(db, `SELECT quantity::text q, value::text v FROM warehouse_stock_balances WHERE "itemId"=$1 AND "warehouseId"=$2`, [ITEM, w]);
  const draft = async (line: Record<string, unknown>) => {
    const created = await documents.create(COMPANY, BRANCH, USER, {
      kind: 'transfer', documentDate: '2026-11-08', fromWarehouseId: WAREHOUSE, toWarehouseId: WAREHOUSE_2,
      fromBranchId: BRANCH, reason: 'rebalance',
      lines: [{ itemId: ITEM, quantity: 3, ...line }],
    } as never) as unknown as { id: string };
    return created.id;
  };
  const batch = async () => (await one(db, `SELECT id FROM item_batches WHERE "warehouseId"=$1 AND "batchNumber"='L1'`, [WAREHOUSE])).id;

  (process.env.KAYAN_STOCKDOC_LOCATION_UI==='1'?it:it.skip)('actual Flutter old draft read correction save post uses production SQL without duplication', async () => {
    const id=await draft({batchId:await batch(),storageLocationId:SHELF,toStorageLocationId:null});
    await db.query(`UPDATE stock_document_lines SET "storageLocationId"=$1 WHERE "documentId"=$2`,[SHELF_W2,id]);
    jest.restoreAllMocks();const locations=new (await import('./storage-locations.service')).StorageLocationsService(pglitePrisma(db) as never,{record:async()=>undefined} as never);
    const calls:Array<{method:string;body:unknown}>=[];
    const server=createServer(async(req,res)=>{try{
      const url=new URL(req.url!,'http://localhost');let data:unknown;
      if(url.pathname.endsWith('/locations'))data=await locations.list(COMPANY,{warehouseId:url.searchParams.get('warehouseId')??undefined});
      else if(req.method==='PUT'){let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);calls.push({method:'PUT',body});data=await documents.updateDraftLocations(COMPANY,USER,id,body);}
      else if(req.method==='POST'){calls.push({method:'POST',body:null});data=await documents.post(COMPANY,USER,id);}
      else if(url.pathname.endsWith('/stock-documents'))data={items:[await documents.findOne(COMPANY,id)]};
      else data=await documents.findOne(COMPANY,id);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));
    }catch(e){console.log('BRIDGE_ERROR',e);res.statusCode=400;res.end(JSON.stringify({message:String(e)}));}});
    await new Promise<void>(r=>server.listen(3223,'127.0.0.1',r));
    try{const out=await promisify(execFile)('/tmp/flutter/bin/flutter',['test','test/widget/stock_document_locations_http_test.dart'],{cwd:join(process.cwd(),'..'),timeout:90000,maxBuffer:4*1024*1024}).catch(e=>{console.log(e.stdout,e.stderr);throw e;});console.log(out.stdout);
      expect(calls.map(x=>x.method)).toEqual(['PUT','POST']);expect(calls[0].body).toMatchObject({expectedVersion:0,lines:[{lineNumber:1,storageLocationId:SHELF,toStorageLocationId:SHELF_W2}]});
      expect(await shelf(SHELF)).toBe(3);expect(await shelf(SHELF_W2)).toBe(8);expect((await one(db,`SELECT COUNT(*)::text n FROM stock_documents`)).n).toBe('1');
    }finally{await new Promise<void>(r=>server.close(()=>r()));}
  },150000);

  it('old transfer draft with former destination shelf in source field refuses safely at posting', async () => {
    const id=await draft({batchId:await batch(),storageLocationId:SHELF,toStorageLocationId:SHELF_W2});
    await db.query(`UPDATE stock_document_lines SET "storageLocationId"=$1,"toStorageLocationId"=NULL WHERE "documentId"=$2`,[SHELF_W2,id]);
    const before={a:await shelf(SHELF),b:await shelf(SHELF_W2),w1:await wh(WAREHOUSE),w2:await wh(WAREHOUSE_2)};
    await expect(documents.post(COMPANY,USER,id)).rejects.toBeDefined();
    expect({a:await shelf(SHELF),b:await shelf(SHELF_W2),w1:await wh(WAREHOUSE),w2:await wh(WAREHOUSE_2)}).toEqual(before);
    expect((await one(db,`SELECT status::text s FROM stock_documents WHERE id=$1`,[id])).s).toBe('DRAFT');
  });

  it('moves 3 from the named source shelf onto the named target shelf and conserves quantity, value and lot cost', async () => {
    const id = await draft({ batchId: await batch(), storageLocationId: SHELF, toStorageLocationId: SHELF_W2 });
    const before = { w1: await wh(WAREHOUSE), w2: await wh(WAREHOUSE_2) };
    await documents.post(COMPANY, USER, id);
    expect(await shelf(SHELF)).toBe(3);
    expect(await shelf(SHELF_B)).toBe(4);
    expect(await shelf(SHELF_W2)).toBe(8);
    const a = await wh(WAREHOUSE), b = await wh(WAREHOUSE_2);
    expect(Number(a.q) + Number(b.q)).toBe(Number(before.w1.q) + Number(before.w2.q));
    expect(Number(a.v) + Number(b.v)).toBeCloseTo(Number(before.w1.v) + Number(before.w2.v), 4);
    expect((await lot(WAREHOUSE)).r).toBe('7.0000');
    const dest = await lot(WAREHOUSE_2);
    expect(dest.r).toBe('8.0000');
    expect(Number(dest.c)).toBeCloseTo((5 * 6 + 3 * 12) / 8, 4);
  });

  it('without a target shelf the goods arrive unlocated, not on the source shelf id', async () => {
    const id = await draft({ batchId: await batch(), storageLocationId: SHELF });
    await documents.post(COMPANY, USER, id);
    expect(await shelf(SHELF)).toBe(3);
    expect(await shelf(SHELF_W2)).toBe(5);
    expect(Number((await one(db, `SELECT COALESCE(SUM(quantity),0)::text q FROM stock_movements WHERE "referenceType"='STOCK_TRANSFER_IN' AND "storageLocationId" IS NULL`)).q)).toBe(3);
  });

  it('refuses a transfer with no source shelf while the lot is on shelves, names them and writes nothing', async () => {
    const id = await draft({ batchId: await batch() });
    const err = await failure(documents.post(COMPANY, USER, id));
    expect(err?.code).toBe('STOCK_DOC_LOCATION_REQUIRED');
    expect(String(err?.message)).toContain('A-01: 6.0000');
    expect(await shelf(SHELF)).toBe(6);
    expect((await lot(WAREHOUSE)).r).toBe('10.0000');
    expect((await one(db, `SELECT status::text s FROM stock_documents WHERE id=$1`, [id])).s).toBe('DRAFT');
  });

  it('refuses more than the named shelf holds, with nothing moved', async () => {
    const id = await draft({ batchId: await batch(), storageLocationId: SHELF_B, quantity: 5 });
    const err = await failure(documents.post(COMPANY, USER, id));
    expect(err?.code).toBe('STOCK_DOC_SHELF_SHORT');
    expect(await shelf(SHELF_B)).toBe(4);
    expect((await lot(WAREHOUSE_2)).r).toBe('5.0000');
  });

  it('refuses a target shelf that is not in the receiving warehouse, when the draft is created', async () => {
    const err = await failure(draft({ batchId: await batch(), storageLocationId: SHELF, toStorageLocationId: SHELF_B }));
    expect(err?.code).toBe('STOCK_DOC_TARGET_LOCATION_INVALID');
  });
  const writeOff = async (line: Record<string, unknown>) => {
    const created = await documents.create(COMPANY, BRANCH, USER, {
      kind: 'write_off', documentDate: '2026-11-08', toWarehouseId: WAREHOUSE, branchId: BRANCH, reason: 'damaged',
      lines: [{ itemId: ITEM, quantity: -2, ...line }],
    } as never) as unknown as { id: string };
    const APPROVER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await db.exec(`INSERT INTO users (id, "companyId", username, "fullNameEn", "fullNameAr", "passwordHash", "isActive", "isSuperAdmin", "tokenVersion", "updatedAt")
      VALUES ('${APPROVER}', '${COMPANY}', 'approver', 'Approver', 'معتمد', 'x', true, false, 0, now()) ON CONFLICT DO NOTHING`);
    await documents.approve(COMPANY, APPROVER, created.id);
    return created.id;
  };

  it('write-off drains the named shelf and the lot, and the warehouse balance follows', async () => {
    const id = await writeOff({ batchId: await batch(), storageLocationId: SHELF });
    const before = await wh(WAREHOUSE);
    await documents.post(COMPANY, USER, id);
    expect(await shelf(SHELF)).toBe(4);
    expect(await shelf(SHELF_B)).toBe(4);
    expect((await lot(WAREHOUSE)).r).toBe('8.0000');
    expect(Number((await wh(WAREHOUSE)).q)).toBe(Number(before.q) - 2);
    // Issue leaves at the selected warehouse average, not the blended branch.
    expect(Number((await wh(WAREHOUSE)).v)).toBeCloseTo(Number(before.v) - 24, 4);
  });

  it('write-off with no shelf is refused while the lot is on shelves, names them, writes nothing', async () => {
    const id = await writeOff({ batchId: await batch() });
    const err = await failure(documents.post(COMPANY, USER, id));
    expect(err?.code).toBe('STOCK_DOC_LOCATION_REQUIRED');
    expect(String(err?.message)).toContain('A-01: 6.0000');
    expect((await lot(WAREHOUSE)).r).toBe('10.0000');
  });

  it('write-off of more than the shelf holds is refused with the shelf named', async () => {
    const id = await writeOff({ batchId: await batch(), storageLocationId: SHELF_B, quantity: -5 });
    const err = await failure(documents.post(COMPANY, USER, id));
    expect(err?.code).toBe('STOCK_DOC_SHELF_SHORT');
    expect(await shelf(SHELF_B)).toBe(4);
    expect((await lot(WAREHOUSE)).r).toBe('10.0000');
  });
  it('full two-shelf write-off exposes any residual warehouse value',async()=>{
    const id=await writeOff({batchId:await batch(),storageLocationId:SHELF,quantity:-6});await documents.post(COMPANY,USER,id);
    const second=await writeOff({batchId:await batch(),storageLocationId:SHELF_B,quantity:-4});await documents.post(COMPANY,USER,second);
    const actual=await wh(WAREHOUSE);const branch=await one(db,`SELECT quantity::text q,value::text v FROM stock_balances WHERE "itemId"=$1`,[ITEM]);const warehouseSum=await one(db,`SELECT SUM(quantity)::text q,SUM(value)::text v FROM warehouse_stock_balances WHERE "itemId"=$1`,[ITEM]);const movements=await one(db,`SELECT SUM(CASE WHEN direction='IN' THEN "totalCost" ELSE -"totalCost" END)::text v FROM stock_movements WHERE "itemId"=$1 AND "warehouseId"=$2`,[ITEM,WAREHOUSE]);console.log('FULL_WRITE_OFF_VALUE',{actual,branch,warehouseSum,movements});expect(actual.q).toBe('0.0000');expect(actual.v).toBe('0.0000');expect(branch.v).toBe(warehouseSum.v);
  });

  it('transfer post reverse restores exact source target lot and branch values',async()=>{
    const id=await draft({batchId:await batch(),storageLocationId:SHELF,toStorageLocationId:SHELF_W2});
    const before={a:await shelf(SHELF),b:await shelf(SHELF_W2),w1:await wh(WAREHOUSE),w2:await wh(WAREHOUSE_2),l1:await lot(WAREHOUSE),l2:await lot(WAREHOUSE_2)};
    await documents.post(COMPANY,USER,id);await documents.reverse(COMPANY,USER,id);
    expect({a:await shelf(SHELF),b:await shelf(SHELF_W2),w1:await wh(WAREHOUSE),w2:await wh(WAREHOUSE_2),l1:await lot(WAREHOUSE),l2:await lot(WAREHOUSE_2)}).toEqual(before);
  });
  it('writeoff post reverse restores exact shelf lot warehouse branch values',async()=>{
    const id=await writeOff({batchId:await batch(),storageLocationId:SHELF});const before={a:await shelf(SHELF),w:await wh(WAREHOUSE),l:await lot(WAREHOUSE)};
    await documents.post(COMPANY,USER,id);await documents.reverse(COMPANY,USER,id);
    expect({a:await shelf(SHELF),w:await wh(WAREHOUSE),l:await lot(WAREHOUSE)}).toEqual(before);
  });

  it('transfer reversal refuses depleted original destination shelf atomically',async()=>{
    const id=await draft({batchId:await batch(),storageLocationId:SHELF,toStorageLocationId:SHELF_W2});await documents.post(COMPANY,USER,id);
    const other='cccccccc-cccc-4ccc-8ccc-cccccccccccc';await db.query(`INSERT INTO storage_locations (id,"companyId","branchId","warehouseId",kind,code,"nameEn","nameAr","isActive","updatedAt") VALUES ($1,$2,$3,$4,'SHELF','D-01','D','D',true,now())`,[other,COMPANY,BRANCH,WAREHOUSE_2]);
    const destLot=(await one(db,`SELECT id FROM item_batches WHERE "warehouseId"=$1 AND "batchNumber"='L1'`,[WAREHOUSE_2])).id;
    const available=Number((await one(db,`SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN quantity ELSE -quantity END),0)::text q FROM stock_movements WHERE "storageLocationId"=$1 AND "batchId"=$2`,[SHELF_W2,destLot])).q);
    const locs=new StorageLocationsService(pglitePrisma(db) as never,{record:async()=>undefined} as never);await locs.move(COMPANY,USER,{fromLocationId:SHELF_W2,toLocationId:other,itemId:ITEM,batchId:destLot,quantity:available-1,reason:'synthetic move'},null);
    const before={a:await shelf(SHELF),c:await shelf(SHELF_W2),d:await shelf(other),w1:await wh(WAREHOUSE),w2:await wh(WAREHOUSE_2),l1:await lot(WAREHOUSE),l2:await lot(WAREHOUSE_2)};
    const err=await failure(documents.reverse(COMPANY,USER,id));expect(err).not.toBeNull();expect({a:await shelf(SHELF),c:await shelf(SHELF_W2),d:await shelf(other),w1:await wh(WAREHOUSE),w2:await wh(WAREHOUSE_2),l1:await lot(WAREHOUSE),l2:await lot(WAREHOUSE_2)}).toEqual(before);expect((await one(db,`SELECT status FROM stock_documents WHERE id=$1`,[id])).status).toBe('POSTED');
  });

  it('transfer receipt movement binds the actual destination warehouse lot',async()=>{
    const id=await draft({batchId:await batch(),storageLocationId:SHELF,toStorageLocationId:SHELF_W2});await documents.post(COMPANY,USER,id);
    const row=await one(db,`SELECT m."batchId", b."warehouseId" FROM stock_movements m JOIN item_batches b ON b.id=m."batchId" WHERE m."referenceId"=$1 AND m."referenceType"='STOCK_TRANSFER_IN'`,[id]);expect(row.warehouseId).toBe(WAREHOUSE_2);
  });

  it('transfer reverse after repricing source refuses atomically or restores proven original cost',async()=>{
    const id=await draft({batchId:await batch(),storageLocationId:SHELF,toStorageLocationId:SHELF_W2});await documents.post(COMPANY,USER,id);
    await batches.receive(COMPANY,USER,{branchId:BRANCH,warehouseId:WAREHOUSE,itemId:ITEM,batchNumber:'L1',quantity:7,unitCost:24,storageLocationId:SHELF,expiryDate:'2027-02-01'});
    const before={a:await lot(WAREHOUSE),b:await lot(WAREHOUSE_2),w1:await wh(WAREHOUSE),w2:await wh(WAREHOUSE_2),s1:await shelf(SHELF),s2:await shelf(SHELF_W2)};const refusal=await failure(documents.reverse(COMPANY,USER,id));if(refusal){expect((refusal as {code:string}).code).toBe('STOCK_DOC_REVERSE_LOT_COST_UNPROVABLE');expect({a:await lot(WAREHOUSE),b:await lot(WAREHOUSE_2),w1:await wh(WAREHOUSE),w2:await wh(WAREHOUSE_2),s1:await shelf(SHELF),s2:await shelf(SHELF_W2)}).toEqual(before);expect((await one(db,`SELECT status FROM stock_documents WHERE id=$1`,[id])).status).toBe('POSTED');return;}
    const a=await lot(WAREHOUSE),b=await lot(WAREHOUSE_2);expect(Number(a.r)).toBe(17);expect(Number(a.c)).toBeCloseTo(288/17,3);expect(Number(b.r)).toBe(5);expect(Number(b.c)).toBe(6);expect(await wh(WAREHOUSE)).toEqual({q:'17.0000',v:'288.0000'});expect(await wh(WAREHOUSE_2)).toEqual({q:'5.0000',v:'30.0000'});
  });

  it('transfer reverse after destination receipt preserves that receipt cost',async()=>{
    const id=await draft({batchId:await batch(),storageLocationId:SHELF,toStorageLocationId:SHELF_W2});await documents.post(COMPANY,USER,id);
    await batches.receive(COMPANY,USER,{branchId:BRANCH,warehouseId:WAREHOUSE_2,itemId:ITEM,batchNumber:'L1',quantity:2,unitCost:20,storageLocationId:SHELF_W2,expiryDate:'2027-02-01'});const before={b:await lot(WAREHOUSE_2),w:await wh(WAREHOUSE_2),s:await shelf(SHELF_W2)};const refusal=await failure(documents.reverse(COMPANY,USER,id));if(refusal){expect((refusal as {code:string}).code).toBe('STOCK_DOC_REVERSE_LOT_COST_UNPROVABLE');expect({b:await lot(WAREHOUSE_2),w:await wh(WAREHOUSE_2),s:await shelf(SHELF_W2)}).toEqual(before);expect((await one(db,`SELECT status FROM stock_documents WHERE id=$1`,[id])).status).toBe('POSTED');return;}
    const b=await lot(WAREHOUSE_2);expect(Number(b.r)).toBe(7);expect(Number(b.c)).toBeCloseTo(10,3);expect(await wh(WAREHOUSE_2)).toEqual({q:'7.0000',v:'70.0000'});
  });
  it('transfer reverse refuses conflicting original batch identity without writes',async()=>{
    const id=await draft({batchId:await batch(),storageLocationId:SHELF,toStorageLocationId:SHELF_W2});await documents.post(COMPANY,USER,id);
    const other=(await one(db,`SELECT id FROM item_batches WHERE "warehouseId"=$1 AND "batchNumber"='L1'`,[WAREHOUSE_2])).id;await db.query(`UPDATE stock_movements SET "batchId"=$1 WHERE "referenceId"=$2 AND "referenceType"='STOCK_TRANSFER_OUT'`,[other,id]);
    const before={a:await shelf(SHELF),c:await shelf(SHELF_W2),w1:await wh(WAREHOUSE),w2:await wh(WAREHOUSE_2),l1:await lot(WAREHOUSE),l2:await lot(WAREHOUSE_2)};expect(await failure(documents.reverse(COMPANY,USER,id))).not.toBeNull();expect({a:await shelf(SHELF),c:await shelf(SHELF_W2),w1:await wh(WAREHOUSE),w2:await wh(WAREHOUSE_2),l1:await lot(WAREHOUSE),l2:await lot(WAREHOUSE_2)}).toEqual(before);expect((await one(db,`SELECT status FROM stock_documents WHERE id=$1`,[id])).status).toBe('POSTED');
  });

  it('transfer reversal outgoing movement binds original destination batch identity',async()=>{
    const id=await draft({batchId:await batch(),storageLocationId:SHELF,toStorageLocationId:SHELF_W2});await documents.post(COMPANY,USER,id);const dest=(await one(db,`SELECT id FROM item_batches WHERE "warehouseId"=$1 AND "batchNumber"='L1'`,[WAREHOUSE_2])).id;await documents.reverse(COMPANY,USER,id);
    const out=await one(db,`SELECT "batchId" FROM stock_movements WHERE "referenceId"=$1 AND "referenceType"='STOCK_DOCUMENT_REVERSAL' AND direction='OUT'`,[id]);expect(out.batchId).toBe(dest);
  });

  it('transfer no-lot line refuses ambiguous shelf lot allocation or binds full exact lot coverage',async()=>{
    await batches.receive(COMPANY,USER,{branchId:BRANCH,warehouseId:WAREHOUSE,itemId:ITEM,batchNumber:'L2',quantity:5,unitCost:20,storageLocationId:SHELF,expiryDate:'2027-03-01'});
    const id=await draft({quantity:8,storageLocationId:SHELF,toStorageLocationId:SHELF_W2});const before={a:await shelf(SHELF),b:await shelf(SHELF_B),c:await shelf(SHELF_W2),w1:await wh(WAREHOUSE),w2:await wh(WAREHOUSE_2)};const err=await failure(documents.post(COMPANY,USER,id));if(err){console.log('NO_LOT_REFUSAL',JSON.stringify(err));expect({a:await shelf(SHELF),b:await shelf(SHELF_B),c:await shelf(SHELF_W2),w1:await wh(WAREHOUSE),w2:await wh(WAREHOUSE_2)}).toEqual(before);return;}
    const rows=(await db.query<{batchId:string|null,warehouseId:string,quantity:string}>(`SELECT m."batchId",b."warehouseId",m.quantity::text FROM stock_movements m LEFT JOIN item_batches b ON b.id=m."batchId" WHERE m."referenceId"=$1 AND m."referenceType"='STOCK_TRANSFER_IN'`,[id])).rows;expect(rows.every(r=>r.batchId&&r.warehouseId===WAREHOUSE_2)).toBe(true);expect(rows.reduce((n,r)=>n+Number(r.quantity),0)).toBe(8);
  });

  it('named-lot transfer preserves separate warehouse-average books and physical lot contribution',async()=>{
    await batches.receive(COMPANY,USER,{branchId:BRANCH,warehouseId:WAREHOUSE,itemId:ITEM,batchNumber:'L2',quantity:5,unitCost:24,storageLocationId:SHELF_B,expiryDate:'2027-03-01'});const id=await draft({batchId:await batch(),storageLocationId:SHELF,toStorageLocationId:SHELF_W2});await documents.post(COMPANY,USER,id);
    const move=await one(db,`SELECT "unitCost"::text c,"totalCost"::text v FROM stock_movements WHERE "referenceId"=$1 AND "referenceType"='STOCK_TRANSFER_IN'`,[id]);expect(Number(move.c)).toBe(16);expect(Number(move.v)).toBe(48);expect(await wh(WAREHOUSE_2)).toEqual({q:'8.0000',v:'78.0000'});expect(Number((await lot(WAREHOUSE_2)).c)).toBe(8.25);await documents.reverse(COMPANY,USER,id);expect(await wh(WAREHOUSE_2)).toEqual({q:'5.0000',v:'30.0000'});expect(Number((await lot(WAREHOUSE_2)).c)).toBe(6);expect(await wh(WAREHOUSE)).toEqual({q:'15.0000',v:'240.0000'});expect(Number((await lot(WAREHOUSE)).c)).toBe(12);
  });

  it('legacy null lot cost evidence refuses actionable and preserves all inputs and stock',async()=>{
    const id=await draft({batchId:await batch(),storageLocationId:SHELF,toStorageLocationId:SHELF_W2});await documents.post(COMPANY,USER,id);await db.query(`UPDATE stock_movements SET "lotUnitCost"=NULL WHERE "referenceId"=$1`,[id]);const before={a:await shelf(SHELF),c:await shelf(SHELF_W2),w1:await wh(WAREHOUSE),w2:await wh(WAREHOUSE_2),l1:await lot(WAREHOUSE),l2:await lot(WAREHOUSE_2)};const err=await failure(documents.reverse(COMPANY,USER,id));expect(err?.code).toBe('STOCK_DOC_REVERSE_LOT_COST_UNPROVABLE');expect(err?.message).toContain('accountant');expect({a:await shelf(SHELF),c:await shelf(SHELF_W2),w1:await wh(WAREHOUSE),w2:await wh(WAREHOUSE_2),l1:await lot(WAREHOUSE),l2:await lot(WAREHOUSE_2)}).toEqual(before);expect((await one(db,`SELECT status FROM stock_documents WHERE id=$1`,[id])).status).toBe('POSTED');
  });
  it('legacy conflicting receiving batch refuses instead of guessing a different lot',async()=>{
    const id=await draft({batchId:await batch(),storageLocationId:SHELF,toStorageLocationId:SHELF_W2});await documents.post(COMPANY,USER,id);await db.query(`UPDATE stock_movements SET "batchId"=$1 WHERE "referenceId"=$2 AND "referenceType"='STOCK_TRANSFER_IN'`,[await batch(),id]);const before={a:await shelf(SHELF),c:await shelf(SHELF_W2),w1:await wh(WAREHOUSE),w2:await wh(WAREHOUSE_2)};expect(await failure(documents.reverse(COMPANY,USER,id))).not.toBeNull();expect({a:await shelf(SHELF),c:await shelf(SHELF_W2),w1:await wh(WAREHOUSE),w2:await wh(WAREHOUSE_2)}).toEqual(before);
  });

  it('draft split across distinct lots persists entered-unit frozen conversion and posts reverses both identities',async()=>{
    await batches.receive(COMPANY,USER,{branchId:BRANCH,warehouseId:WAREHOUSE,itemId:ITEM,batchNumber:'L2',quantity:5,unitCost:20,storageLocationId:SHELF,expiryDate:'2027-03-01'});const lot2=(await one(db,`SELECT id FROM item_batches WHERE "warehouseId"=$1 AND "batchNumber"='L2'`,[WAREHOUSE])).id;
    const id=await draft({quantity:3,batchId:await batch(),storageLocationId:SHELF,toStorageLocationId:SHELF_W2});await db.query(`UPDATE stock_document_lines SET "unitName"='carton',"unitFactor"=3,"unitQuantity"=1 WHERE "documentId"=$1`,[id]);
    await documents.updateDraftLocations(COMPANY,USER,id,{expectedVersion:0,lines:[{lineNumber:1,splits:[{batchId:await batch(),quantity:'0.3333',storageLocationId:SHELF,toStorageLocationId:SHELF_W2},{batchId:lot2,quantity:'0.6667',storageLocationId:SHELF,toStorageLocationId:SHELF_W2}]}]});
    const rows=(await db.query<{quantity:string,unitQuantity:string,unitFactor:string,batchId:string}>(`SELECT quantity::text,"unitQuantity"::text,"unitFactor"::text,"batchId" FROM stock_document_lines WHERE "documentId"=$1 ORDER BY "lineNumber"`,[id])).rows;expect(rows.map(r=>r.quantity)).toEqual(['0.9999','2.0001']);expect(rows.map(r=>r.unitQuantity)).toEqual(['0.3333','0.6667']);expect(rows.every(r=>r.unitFactor==='3.000000')).toBe(true);
    const before={a:await shelf(SHELF),w1:await wh(WAREHOUSE),w2:await wh(WAREHOUSE_2)};await documents.post(COMPANY,USER,id);await documents.reverse(COMPANY,USER,id);expect({a:await shelf(SHELF),w1:await wh(WAREHOUSE),w2:await wh(WAREHOUSE_2)}).toEqual(before);expect(Number((await lot(WAREHOUSE)).r)).toBe(10);expect(Number((await one(db,`SELECT "remainingQuantity"::text r FROM item_batches WHERE id=$1`,[lot2])).r)).toBe(5);
  });

  it('splitting two original lines in one correction preserves unique line numbering atomically',async()=>{
    const lotId=await batch();const doc=await documents.create(COMPANY,BRANCH,USER,{kind:'transfer',documentDate:'2026-11-25',fromBranchId:BRANCH,fromWarehouseId:WAREHOUSE,toWarehouseId:WAREHOUSE_2,lines:[1,2].map(()=>({itemId:ITEM,quantity:2,batchId:lotId,storageLocationId:SHELF,toStorageLocationId:SHELF_W2}))} as never) as unknown as {id:string};
    await documents.updateDraftLocations(COMPANY,USER,doc.id,{expectedVersion:0,lines:[1,2].map(lineNumber=>({lineNumber,splits:[1,2].map(()=>({batchId:lotId,quantity:1,storageLocationId:SHELF,toStorageLocationId:SHELF_W2}))}))});
    const rows=(await db.query<{lineNumber:number}>(`SELECT "lineNumber" FROM stock_document_lines WHERE "documentId"=$1 ORDER BY "lineNumber"`,[doc.id])).rows;expect(rows.map(r=>r.lineNumber)).toEqual([1,2,3,4]);await documents.post(COMPANY,USER,doc.id);await documents.reverse(COMPANY,USER,doc.id);expect(await shelf(SHELF)).toBe(6);
  });

  it('multi-original split later invalid lot rolls back all earlier parts and version',async()=>{
    const lotId=await batch();const doc=await documents.create(COMPANY,BRANCH,USER,{kind:'transfer',documentDate:'2026-11-25',fromBranchId:BRANCH,fromWarehouseId:WAREHOUSE,toWarehouseId:WAREHOUSE_2,lines:[1,2].map(()=>({itemId:ITEM,quantity:2,batchId:lotId,storageLocationId:SHELF,toStorageLocationId:SHELF_W2}))} as never) as unknown as {id:string};
    const err=await failure(documents.updateDraftLocations(COMPANY,USER,doc.id,{expectedVersion:0,lines:[{lineNumber:1,splits:[1,2].map(()=>({batchId:lotId,quantity:1}))},{lineNumber:2,splits:[{batchId:lotId,quantity:1},{batchId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',quantity:1}]}]}));expect(err?.code).toBe('STOCK_DOC_LOT_INVALID');const rows=(await db.query<{lineNumber:number,quantity:string}>(`SELECT "lineNumber",quantity::text FROM stock_document_lines WHERE "documentId"=$1 ORDER BY "lineNumber"`,[doc.id])).rows;expect(rows).toEqual([{lineNumber:1,quantity:'2.0000'},{lineNumber:2,quantity:'2.0000'}]);expect((await one(db,`SELECT "editVersion"::text v FROM stock_documents WHERE id=$1`,[doc.id])).v).toBe('0');expect(await shelf(SHELF)).toBe(6);
  });

  it.each([{name:'positive adjustment',kind:'adjustment',quantity:2},{name:'negative count',kind:'count',quantity:0,countedQuantity:8},{name:'positive count',kind:'count',quantity:0,countedQuantity:12}])('generic $name post reverse restores lot and ledger together',async input=>{
    const lotId=await batch();const fullLot=()=>one(db,`SELECT "remainingQuantity"::text r,"receivedQuantity"::text received,status,"unitCost"::text c FROM item_batches WHERE id=$1`,[lotId]);const before={a:await shelf(SHELF),w:await wh(WAREHOUSE),l:await fullLot()};const doc=await documents.create(COMPANY,BRANCH,USER,{kind:input.kind,documentDate:'2026-11-25',toWarehouseId:WAREHOUSE,lines:[{itemId:ITEM,quantity:input.quantity,...('countedQuantity' in input?{countedQuantity:input.countedQuantity}:{}),unitCost:12,batchId:await batch(),storageLocationId:SHELF}]} as never) as unknown as {id:string};await documents.post(COMPANY,USER,doc.id);await documents.reverse(COMPANY,USER,doc.id);expect({a:await shelf(SHELF),w:await wh(WAREHOUSE),l:await fullLot()}).toEqual(before);
  });

  it('omitted-lot transfer with one covering existing destination lot is exact or refuses without writes',async()=>{
    const before={a:await shelf(SHELF),c:await shelf(SHELF_W2),l1:await lot(WAREHOUSE),l2:await lot(WAREHOUSE_2),w1:await wh(WAREHOUSE),w2:await wh(WAREHOUSE_2)};const id=await draft({storageLocationId:SHELF,toStorageLocationId:SHELF_W2});const err=await failure(documents.post(COMPANY,USER,id));if(err){expect({a:await shelf(SHELF),c:await shelf(SHELF_W2),l1:await lot(WAREHOUSE),l2:await lot(WAREHOUSE_2),w1:await wh(WAREHOUSE),w2:await wh(WAREHOUSE_2)}).toEqual(before);return;}await documents.reverse(COMPANY,USER,id);expect({a:await shelf(SHELF),c:await shelf(SHELF_W2),l1:await lot(WAREHOUSE),l2:await lot(WAREHOUSE_2),w1:await wh(WAREHOUSE),w2:await wh(WAREHOUSE_2)}).toEqual(before);
  });

  it.each([null,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'])('generic reversal refuses original batch mismatch %s atomically',async mismatch=>{
    const lotId=await batch();const doc=await documents.create(COMPANY,BRANCH,USER,{kind:'adjustment',documentDate:'2026-11-25',toWarehouseId:WAREHOUSE,lines:[{itemId:ITEM,quantity:2,unitCost:12,batchId:lotId,storageLocationId:SHELF}]} as never) as unknown as {id:string};await documents.post(COMPANY,USER,doc.id);await db.query(`UPDATE stock_movements SET "batchId"=$1 WHERE "referenceId"=$2 AND "referenceType"='STOCK_ADJUSTMENT'`,[mismatch===null?null:(await one(db,`SELECT id FROM item_batches WHERE "warehouseId"=$1 AND "batchNumber"='L1'`,[WAREHOUSE_2])).id,doc.id]);const before={a:await shelf(SHELF),l:await lot(WAREHOUSE),w:await wh(WAREHOUSE)};const err=await failure(documents.reverse(COMPANY,USER,doc.id));expect(err?.code).toBe('STOCK_DOC_REVERSE_LOT_AMBIGUOUS');expect({a:await shelf(SHELF),l:await lot(WAREHOUSE),w:await wh(WAREHOUSE)}).toEqual(before);expect((await one(db,`SELECT status FROM stock_documents WHERE id=$1`,[doc.id])).status).toBe('POSTED');
  });

  it('generic positive adjustment depleted original lot shelf refuses despite unrelated shelf stock',async()=>{
    const lotId=await batch();const doc=await documents.create(COMPANY,BRANCH,USER,{kind:'adjustment',documentDate:'2026-11-25',toWarehouseId:WAREHOUSE,lines:[{itemId:ITEM,quantity:2,unitCost:12,batchId:lotId,storageLocationId:SHELF}]} as never) as unknown as {id:string};await documents.post(COMPANY,USER,doc.id);const locations=new StorageLocationsService(pglitePrisma(db) as never,{record:async()=>undefined} as never);await locations.move(COMPANY,USER,{fromLocationId:SHELF,toLocationId:SHELF_B,itemId:ITEM,batchId:lotId,quantity:7,reason:'synthetic relocation'},null);await batches.receive(COMPANY,USER,{branchId:BRANCH,warehouseId:WAREHOUSE,itemId:ITEM,batchNumber:'OTHER',quantity:3,unitCost:12,storageLocationId:SHELF,expiryDate:'2027-03-01'});const before={a:await shelf(SHELF),b:await shelf(SHELF_B),l:await lot(WAREHOUSE),w:await wh(WAREHOUSE)};const err=await failure(documents.reverse(COMPANY,USER,doc.id));expect(err?.code).toBe('STOCK_DOC_REVERSE_LOT_SHELF_SHORT');expect({a:await shelf(SHELF),b:await shelf(SHELF_B),l:await lot(WAREHOUSE),w:await wh(WAREHOUSE)}).toEqual(before);expect((await one(db,`SELECT status FROM stock_documents WHERE id=$1`,[doc.id])).status).toBe('POSTED');
  });

});
