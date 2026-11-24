import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';
import { PGlite } from '@electric-sql/pglite';

import { BatchesService } from '../inventory/batches.service';
import { AccountMapService } from '../accounting/account-map.service';
import { CostCentersService } from '../accounting/cost-centers.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { FiscalPeriodsService } from '../accounting/fiscal-periods.service';
import { PostingService } from '../accounting/posting.service';
import { AuditService } from '../../common/audit/audit.service';
import { WarehouseService } from '../../common/warehouse/warehouse.service';
import { StockLedgerService } from '../../common/warehouse/stock-ledger.service';
import { pglitePrisma } from '../../testing/pglite-adapter';

import { SalesInvoicesService } from './sales-invoices.service';
import { StorageLocationsService } from '../inventory/storage-locations.service';

/// A whole sales invoice, posted and reversed, on a real PostgreSQL engine.
///
/// The sibling suite (`sales-batches.integration.spec.ts`) drives the lot engine
/// directly: it proves FEFO, splitting and the expiry guard against real rows,
/// but it never runs `SalesInvoicesService.post`. This one does. It seeds a
/// draft invoice and a chart of accounts in a schema built from the project's
/// own migration files, calls the production `post()`, then calls the
/// production `reverse()`, and reads the resulting rows back with plain SQL -
/// so what is asserted is what the database ended up holding, not what a mock
/// was told to say.
///
/// Posting reaches the journal, the cost centres, the document sequence and the
/// stock ledger, all of them real collaborators against real tables. Two things
/// still cannot be reproduced here: PGlite runs in a single process, so two
/// connections never contend for a row lock; and the company settings service is
/// replaced by a fixed tax policy, since tax configuration is not what this
/// suite is testing. Both limits are repeated in the report.

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const WAREHOUSE = '44444444-4444-4444-8444-444444444444';
const ITEM = '55555555-5555-4555-8555-555555555555';
const CUSTOMER = '66666666-6666-4666-8666-666666666666';
const INVOICE = '77777777-7777-4777-8777-777777777777';
const LINE = '88888888-8888-4888-8888-888888888888';

const D = (value: string | number) => new Prisma.Decimal(value);

const migrationsDir = join(process.cwd(), 'prisma', 'migrations');

/// The five accounts a sales posting resolves, by the codes AccountMapService
/// looks up.
const ACCOUNTS: Array<[string, string, string]> = [
  ['1103', 'Accounts receivable', 'debtors'],
  ['4101', 'Sales revenue', 'revenue'],
  ['2103', 'VAT payable', 'vat'],
  ['1104', 'Inventory', 'inventory'],
  ['5101', 'Cost of goods sold', 'cogs'],
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
    VALUES ('${accountId(code)}', '${COMPANY}', '${code}', '${nameEn}', '${nameEn}', '${index === 0 ? 'ASSET' : index === 1 ? 'REVENUE' : index === 2 ? 'LIABILITY' : index === 3 ? 'ASSET' : 'EXPENSE'}', true, true, now());`,
  ).join('');

  await db.exec(`
    INSERT INTO companies (id, code, "nameEn", "nameAr", "updatedAt")
    VALUES ('${COMPANY}', 'CO', 'Co', 'شركة', now());

    INSERT INTO branches (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
    VALUES ('${BRANCH}', '${COMPANY}', 'BR', 'Branch', 'فرع', now());

    INSERT INTO warehouses (id, "companyId", "branchId", code, "nameEn", "nameAr", "isDefault", "isActive", "updatedAt")
    VALUES ('${WAREHOUSE}', '${COMPANY}', '${BRANCH}', 'W1', 'Main', 'رئيسي', true, true, now());

    INSERT INTO customers (id, "companyId", code, "nameEn", "nameAr", "isActive", "updatedAt")
    VALUES ('${CUSTOMER}', '${COMPANY}', 'C-1', 'Buyer', 'مشتري', true, now());

    -- The journal stamps createdBy, and that column carries a real foreign key
    -- to users. Without the row the posting would fail at the database, which
    -- is exactly the fidelity this suite is here for.
    INSERT INTO users (id, "companyId", username, "fullNameEn", "fullNameAr", "passwordHash", "updatedAt")
    VALUES ('${USER}', '${COMPANY}', 'tester', 'Tester', 'مختبِر', 'x', now());

    INSERT INTO items (id, "companyId", code, "nameEn", "nameAr", unit, "isStockTracked",
                       "requiresBatch", "useFefo", "allowExpiredIssue", "salePrice", "updatedAt")
    VALUES ('${ITEM}', '${COMPANY}', 'IT-1', 'Milk', 'حليب', 'piece', true,
            true, true, false, 10, now());

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

/// One draft invoice with a single line, exactly as the API would have left it.
async function seedDraftInvoice(db: PGlite, quantity: number, unitPrice = 10) {
  await db.query(
    `INSERT INTO sales_invoices
       (id, "companyId", "branchId", "warehouseId", "invoiceNumber", "invoiceDate",
        "customerId", status, currency, "subTotal", "taxAmount", "totalAmount",
        "paidAmount", "costOfGoods", "documentType", "updatedAt")
     VALUES ($1,$2,$3,$4,'SI-0001','2026-11-07',$5,'DRAFT','EGP',$6,0,$6,0,0,'INVOICE',now())`,
    [INVOICE, COMPANY, BRANCH, WAREHOUSE, CUSTOMER, unitPrice * quantity],
  );
  await db.query(
    `INSERT INTO sales_invoice_lines
       (id, "invoiceId", "lineNumber", "itemId", description, quantity, "unitPrice",
        "taxRate", "taxAmount", "lineTotal", "unitCost", "costTotal")
     VALUES ($1,$2,1,$3,'Milk',$4,$5,0,0,$6,0,0)`,
    [LINE, INVOICE, ITEM, quantity, unitPrice, unitPrice * quantity],
  );
}

async function seedLot(
  db: PGlite,
  batchNumber: string,
  quantity: number,
  expiry: string | null,
  unitCost = 5,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO item_batches
       (id,"companyId","branchId","warehouseId","itemId","batchNumber","expiryDate",
        "receivedQuantity","remainingQuantity","unitCost","status","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,'OPEN',now(),now())`,
    [id, COMPANY, BRANCH, WAREHOUSE, ITEM, batchNumber, expiry, quantity, unitCost],
  );
  return id;
}

async function seedShelf(db: PGlite, quantity: number, value: number) {
  await db.query(
    `INSERT INTO stock_balances ("companyId","branchId","itemId",quantity,value,"updatedAt")
     VALUES ($1,$2,$3,$4,$5,now())`,
    [COMPANY, BRANCH, ITEM, quantity, value],
  );
  await db.query(
    `INSERT INTO warehouse_stock_balances ("companyId","branchId","warehouseId","itemId",quantity,value,"updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,now())`,
    [COMPANY, BRANCH, WAREHOUSE, ITEM, quantity, value],
  );
}

/// The production service, wired to real collaborators over PGlite.
function serviceWith(db: PGlite) {
  const prisma = pglitePrisma(db as never);
  const ledger = new StockLedgerService();
  // The real audit service, writing real audit_rows. A stub here would let a
  // missing approval record pass as if it had been written.
  const audit = new AuditService(prisma as never);
  const batches = new BatchesService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    audit as never,
    ledger,
  );
  const posting = new PostingService(
    new DocumentNumberService(),
    new FiscalPeriodsService(prisma as never, audit as never),
    new CostCentersService(prisma as never, audit as never),
  );
  const service = new SalesInvoicesService(
    prisma as never,
    new DocumentNumberService(),
    posting,
    new AccountMapService(),
    // Company tax policy is configuration, not behaviour under test here; a
    // zero rate keeps the journal to the accounts this suite seeded.
    { get: async () => ({ defaultTaxRate: D(0), taxRate: '0.0000', maxDiscountPercent: '100.0000', pricesIncludeTax: false }) } as never,
    new WarehouseService(prisma as never, audit as never),
    {} as never,
    audit as never,
    batches,
    ledger, { assertCanPost: async () => undefined } as never,
    );
  return { service, prisma, ledger, batches };
}

const remaining = async (db: PGlite, batchId: string): Promise<number> => {
  const rows = await db.query<{ q: string }>(
    `SELECT "remainingQuantity"::text AS q FROM item_batches WHERE id = $1`,
    [batchId],
  );
  return Number(rows.rows[0].q);
};

const status = async (db: PGlite, batchId: string): Promise<string> => {
  const rows = await db.query<{ s: string }>(
    `SELECT status AS s FROM item_batches WHERE id = $1`,
    [batchId],
  );
  return rows.rows[0].s;
};

const invoiceStatus = async (db: PGlite): Promise<string> => {
  const rows = await db.query<{ s: string }>(
    `SELECT status AS s FROM sales_invoices WHERE id = $1`,
    [INVOICE],
  );
  return rows.rows[0].s;
};

const shelf = async (db: PGlite): Promise<number> => {
  const rows = await db.query<{ q: string }>(
    `SELECT quantity::text AS q FROM warehouse_stock_balances
      WHERE "companyId"=$1 AND "branchId"=$2 AND "warehouseId"=$3 AND "itemId"=$4`,
    [COMPANY, BRANCH, WAREHOUSE, ITEM],
  );
  return Number(rows.rows[0]?.q ?? 0);
};

const branchBook = async (db: PGlite): Promise<number> => {
  const rows = await db.query<{ q: string }>(
    `SELECT quantity::text AS q FROM stock_balances
      WHERE "companyId"=$1 AND "branchId"=$2 AND "itemId"=$3`,
    [COMPANY, BRANCH, ITEM],
  );
  return Number(rows.rows[0]?.q ?? 0);
};

const movements = async (db: PGlite, direction: string) => {
  const rows = await db.query<{ batchId: string | null; quantity: string }>(
    `SELECT "batchId", quantity::text AS quantity FROM stock_movements
      WHERE "referenceId"=$1 AND direction=$2::"StockDirection" ORDER BY quantity DESC`,
    [INVOICE, direction],
  );
  return rows.rows;
};

jest.setTimeout(180_000);

/// PGlite loads its wasm through a dynamic import that Jest's VM only permits
/// under --experimental-vm-modules. Without the flag the failure is an uncaught
/// exception that takes the whole run down, so the suite skips - loudly -
/// instead of crashing every other test with it.
const vmLacksDynamicImport = !(
  process.execArgv.includes('--experimental-vm-modules') ||
  (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules')
);


const LOC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const LOC_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';

/// Goods already on shelves: location rows and the IN movements that put the lot there.
async function seedPlaced(db: PGlite, lot: string, a: number, b: number) {
  for (const [id, code] of [[LOC_A, 'A-01'], [LOC_B, 'B-01']]) {
    await db.query(
      `INSERT INTO storage_locations (id,"companyId","branchId","warehouseId",kind,code,"nameEn","nameAr","isActive","updatedAt")
       VALUES ($1,$2,$3,$4,'SHELF',$5::varchar,$5::text,$5::text,true,now())`,
      [id, COMPANY, BRANCH, WAREHOUSE, code],
    );
  }
  for (const [loc, q] of [[LOC_A, a], [LOC_B, b]] as const) {
    if (q === 0) continue;
    await db.query(
      `INSERT INTO stock_movements (id,"companyId","branchId","warehouseId","itemId","batchId","storageLocationId","movementDate",
         direction,quantity,"unitCost","totalCost","referenceType")
       VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,now(),'IN',$7,5,$8,'TEST_SEED')`,
      [COMPANY, BRANCH, WAREHOUSE, ITEM, lot, loc, q, q * 5],
    );
  }
}

const allocate = (db: PGlite, allocations: unknown) =>
  db.query(`UPDATE sales_invoice_lines SET "locationAllocations"=$1::jsonb WHERE id=$2`, [JSON.stringify(allocations), LINE]);

const placedNow = async (db: PGlite) => {
  const r = await db.query<{ code: string; q: string }>(
    `SELECT l.code, SUM(CASE WHEN m.direction='IN' THEN m.quantity ELSE -m.quantity END)::text q
       FROM stock_movements m JOIN storage_locations l ON l.id=m."storageLocationId"
      WHERE m."itemId"=$1 GROUP BY l.code ORDER BY l.code`, [ITEM]);
  return Object.fromEntries(r.rows.map((x) => [x.code, Number(x.q)]));
};

(vmLacksDynamicImport ? describe.skip : describe)('sales posting with storage locations', () => {
  let db: PGlite;
  beforeEach(async () => { db = await freshDatabase(); });
  afterEach(async () => { await db.close(); });

  it('blocks posting with an actionable message when the item has placed stock and no source is chosen', async () => {
    const lot = await seedLot(db, 'L1', 10, '2027-01-01', 5);
    await seedShelf(db, 10, 50);
    await seedPlaced(db, lot, 6, 4);
    await seedDraftInvoice(db, 5);
    const { service } = serviceWith(db);
    let message = '';
    try { await service.post(COMPANY, USER, INVOICE); } catch (e) { message = JSON.stringify((e as { getResponse(): unknown }).getResponse()); }
    expect(message).toContain('SALES_POST_LOCATION_REQUIRED');
    expect(message).toContain('A-01');
    expect(message).toContain('B-01');
    expect(message).toContain('Open line 1');
    expect(await invoiceStatus(db)).toBe('DRAFT');
    expect(await shelf(db)).toBe(10);
    expect(await placedNow(db)).toEqual({ 'A-01': 6, 'B-01': 4 });
  });

  it('posts a split source (3 from A-01, 2 from B-01) and lowers exactly those shelves', async () => {
    const lot = await seedLot(db, 'L1', 10, '2027-01-01', 5);
    await seedShelf(db, 10, 50);
    await seedPlaced(db, lot, 6, 4);
    await seedDraftInvoice(db, 5);
    await allocate(db, [{ storageLocationId: LOC_A, quantity: '3.0000' }, { storageLocationId: LOC_B, quantity: '2.0000' }]);
    const { service } = serviceWith(db);
    await service.post(COMPANY, USER, INVOICE);
    expect(await invoiceStatus(db)).toBe('POSTED');
    expect(await placedNow(db)).toEqual({ 'A-01': 3, 'B-01': 2 });
    expect(await shelf(db)).toBe(5);
    expect(await branchBook(db)).toBe(5);
    expect(await remaining(db, lot)).toBe(5);
    const cost = await db.query<{ c: string }>(`SELECT "costTotal"::text c FROM sales_invoice_lines WHERE id=$1`, [LINE]);
    expect(Number(cost.rows[0].c)).toBe(25);
  });

  it('refuses a shelf that holds less than asked, names it, and leaves the invoice a draft with nothing moved', async () => {
    const lot = await seedLot(db, 'L1', 10, '2027-01-01', 5);
    await seedShelf(db, 10, 50);
    await seedPlaced(db, lot, 6, 4);
    await seedDraftInvoice(db, 5);
    await allocate(db, [{ storageLocationId: LOC_A, quantity: '1.0000' }, { storageLocationId: LOC_B, quantity: '4.0000' }]);
    await db.query(`UPDATE stock_movements SET quantity=3 WHERE "storageLocationId"=$1`, [LOC_B]);
    const { service } = serviceWith(db);
    await expect(service.post(COMPANY, USER, INVOICE)).rejects.toThrow(/B-01.*holds 3\.0000.*pick another location/s);
    expect(await invoiceStatus(db)).toBe('DRAFT');
    expect(await shelf(db)).toBe(10);
    expect(await placedNow(db)).toEqual({ 'A-01': 6, 'B-01': 3 });
  });

  it('refuses allocations that do not add up to the line quantity', async () => {
    const lot = await seedLot(db, 'L1', 10, '2027-01-01', 5);
    await seedShelf(db, 10, 50);
    await seedPlaced(db, lot, 6, 4);
    await seedDraftInvoice(db, 5);
    await allocate(db, [{ storageLocationId: LOC_A, quantity: '3.0000' }]);
    const { service } = serviceWith(db);
    await expect(service.post(COMPANY, USER, INVOICE)).rejects.toThrow(/add up to 3\.0000 but the quantity is 5\.0000/);
    expect(await invoiceStatus(db)).toBe('DRAFT');
  });

  it('reversal puts the goods back on the shelves they left', async () => {
    const lot = await seedLot(db, 'L1', 10, '2027-01-01', 5);
    await seedShelf(db, 10, 50);
    await seedPlaced(db, lot, 6, 4);
    await seedDraftInvoice(db, 5);
    await allocate(db, [{ storageLocationId: LOC_A, quantity: '3.0000' }, { storageLocationId: LOC_B, quantity: '2.0000' }]);
    const { service } = serviceWith(db);
    await service.post(COMPANY, USER, INVOICE);
    await service.reverse(COMPANY, USER, INVOICE);
    expect(await placedNow(db)).toEqual({ 'A-01': 6, 'B-01': 4 });
    expect(await shelf(db)).toBe(10);
    expect(await invoiceStatus(db)).toBe('REVERSED');
  });

  it('an item with no placed stock still sells with no location, as before', async () => {
    await seedLot(db, 'L1', 10, '2027-01-01', 5);
    await seedShelf(db, 10, 50);
    await seedDraftInvoice(db, 4);
    const { service } = serviceWith(db);
    await service.post(COMPANY, USER, INVOICE);
    expect(await invoiceStatus(db)).toBe('POSTED');
    expect(await shelf(db)).toBe(6);
  });

  it('non-base unit: allocations are typed in the line unit, stored as typed, converted once at posting', async () => {
    const lot = await seedLot(db, 'L1', 40, '2027-01-01', 5);
    await seedShelf(db, 40, 200);
    await seedPlaced(db, lot, 20, 20);
    await seedDraftInvoice(db, 24);
    // 2 cartons of 12 = 24 base pieces
    await db.query(`UPDATE sales_invoice_lines SET "unitName"='carton', "unitFactor"=12, "unitQuantity"=2 WHERE id=$1`, [LINE]);
    await allocate(db, [{ storageLocationId: LOC_A, quantity: '1.0000' }, { storageLocationId: LOC_B, quantity: '1.0000' }]);
    const { normalizeLocationAllocations } = await import('./sales-invoices.service');
    const typed = [{ storageLocationId: LOC_A, quantity: '1' }, { storageLocationId: LOC_B, quantity: '1' }];
    expect(normalizeLocationAllocations(typed, D(2), 1)).toEqual([
      { storageLocationId: LOC_A, quantity: '1.0000' }, { storageLocationId: LOC_B, quantity: '1.0000' },
    ]);
    const { service } = serviceWith(db);
    await service.post(COMPANY, USER, INVOICE);
    expect(await placedNow(db)).toEqual({ 'A-01': 8, 'B-01': 8 });
    expect(await shelf(db)).toBe(16);
    const row = await db.query<{ a: unknown }>(`SELECT "locationAllocations" a FROM sales_invoice_lines WHERE id=$1`, [LINE]);
    expect(row.rows[0].a).toEqual([
      { storageLocationId: LOC_A, quantity: '1.0000' }, { storageLocationId: LOC_B, quantity: '1.0000' },
    ]);
  });

  it('persisted carton roundtrip: create, findOne, updateDraft, findOne, post', async () => {
    const lot = await seedLot(db, 'L1', 40, '2027-01-01', 5);
    await seedShelf(db, 40, 200);
    await seedPlaced(db, lot, 20, 20);
    await db.query(`INSERT INTO item_units (id,"itemId",unit,factor,"isActive","updatedAt") VALUES (gen_random_uuid(),$1,'carton',12,true,now()),(gen_random_uuid(),$1,'piece',1,true,now())`, [ITEM]);
    const { service } = serviceWith(db);
    const dto = (a: string, b: string) => ({
      customerId: CUSTOMER, invoiceDate: '2026-11-07', warehouseId: WAREHOUSE,
      lines: [{ itemId: ITEM, quantity: '2', unitName: 'carton', unitPrice: '10', taxRate: '0',
        locationAllocations: [{ storageLocationId: LOC_A, quantity: a }, { storageLocationId: LOC_B, quantity: b }] }],
    }) as never;
    const created = await service.create(COMPANY, BRANCH, USER, dto('0.5', '1.5'));
    const first = (created as { lines: Array<{ locationAllocations: unknown; quantity: string; unitQuantity: string }> }).lines[0];
    expect(first.locationAllocations).toEqual([
      { storageLocationId: LOC_A, quantity: '0.5000' }, { storageLocationId: LOC_B, quantity: '1.5000' }]);
    expect([first.quantity, first.unitQuantity]).toEqual(['24.0000', '2.0000']);
    const id = (created as { id: string }).id;
    // reopen and resave what was read, unchanged: must stay the same
    const reread = await service.findOne(COMPANY, id) as unknown as { lines: Array<{ locationAllocations: Array<{ storageLocationId: string; quantity: string }> }> };
    expect((reread as unknown as { warehouseId: string }).warehouseId).toBe(WAREHOUSE);
    await service.updateDraft(COMPANY, BRANCH, USER, id, dto(reread.lines[0].locationAllocations[0].quantity, reread.lines[0].locationAllocations[1].quantity));
    const again = await service.findOne(COMPANY, id) as unknown as { lines: Array<{ locationAllocations: unknown; quantity: string }> };
    expect(again.lines[0].locationAllocations).toEqual(first.locationAllocations);
    expect(again.lines[0].quantity).toBe('24.0000');
    expect((again as unknown as { warehouseId: string }).warehouseId).toBe(WAREHOUSE);
    await service.post(COMPANY, USER, id);
    // 0.5 carton = 6 base from A-01, 1.5 carton = 18 base from B-01
    expect(await placedNow(db)).toEqual({ 'A-01': 14, 'B-01': 2 });
    expect(await shelf(db)).toBe(16);
  });
  (process.env.KAYAN_SALES_LOCATION_UI === '1' ? it : it.skip)('real Flutter draft read allocation edit save then SQL post and reverse', async () => {
    const lot=await seedLot(db,'UI-LOT',40,'2027-01-01',5);
    await seedShelf(db,40,200);await seedPlaced(db,lot,20,20);
    await db.query(`INSERT INTO item_units (id,"itemId",unit,factor,"isActive","updatedAt") VALUES (gen_random_uuid(),$1,'carton',12,true,now()),(gen_random_uuid(),$1,'piece',1,true,now())`,[ITEM]);
    const {service}=serviceWith(db);
    const locations=new StorageLocationsService(pglitePrisma(db) as never,{record:async()=>undefined} as never);
    const invoice=await service.create(COMPANY,BRANCH,USER,{customerId:CUSTOMER,invoiceDate:'2026-11-25',warehouseId:WAREHOUSE,lines:[{itemId:ITEM,quantity:'2',unitName:'carton',unitPrice:'10',taxRate:'0',locationAllocations:[{storageLocationId:LOC_A,quantity:'1'},{storageLocationId:LOC_B,quantity:'1'}]}]} as never);
    const id=(invoice as {id:string}).id;
    const server=createServer(async(req,res)=>{try{
      const url=new URL(req.url!,'http://localhost');const path=url.pathname.replace('/api/v1','');let data:unknown;
      if(path==='/sales/invoices/current'&&req.method==='PUT'){let body='';for await(const chunk of req)body+=chunk;data=await service.updateDraft(COMPANY,BRANCH,USER,id,JSON.parse(body));}
      else if(path==='/sales/invoices/current')data=await service.findOne(COMPANY,id);
      else if(path.startsWith('/inventory/locations/item/'))data=await locations.itemLocations(COMPANY,ITEM,{},null);
      else if(path==='/inventory/items')data=[{id:ITEM,code:'IT-1',nameEn:'Milk',nameAr:'حليب',unit:'piece',isActive:true,units:[{unit:'piece',factor:'1'},{unit:'carton',factor:'12'}]}];
      else if(path==='/parties/customers')data=[{id:CUSTOMER,code:'C-1',nameEn:'Buyer',nameAr:'مشتري',isActive:true}];
      else if(path.includes('tax-pricing'))data={pricesIncludeTax:false};
      else data=[];
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));
    }catch(e){res.statusCode=400;res.end(JSON.stringify({message:String(e)}));}});
    await new Promise<void>(r=>server.listen(3220,'127.0.0.1',r));
    try{
      const output=await promisify(execFile)(process.env.FLUTTER_BIN??'flutter',['test','test/widget/sales_location_http_test.dart'],{cwd:join(process.cwd(),'..'),timeout:90000,maxBuffer:4*1024*1024}).catch(e=>{console.log(e.stdout,e.stderr);throw e;});
      console.log(output.stdout);
      const read=await service.findOne(COMPANY,id) as unknown as {warehouseId:string;lines:Array<{locationAllocations:unknown;quantity:string}>};
      expect(read.warehouseId).toBe(WAREHOUSE);expect(read.lines[0].locationAllocations).toEqual([{storageLocationId:LOC_A,quantity:'0.5000'},{storageLocationId:LOC_B,quantity:'1.5000'}]);
      await service.post(COMPANY,USER,id);expect(await placedNow(db)).toEqual({'A-01':14,'B-01':2});expect(await shelf(db)).toBe(16);
      await service.reverse(COMPANY,USER,id);expect(await placedNow(db)).toEqual({'A-01':20,'B-01':20});expect(await shelf(db)).toBe(40);
    }finally{await new Promise<void>(r=>server.close(()=>r()));}
  },150000);

});
