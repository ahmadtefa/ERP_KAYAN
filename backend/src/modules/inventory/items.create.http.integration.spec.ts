import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Module, ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PGlite } from '@electric-sql/pglite';

import { AccountMapService } from '../accounting/account-map.service';
import { CostCentersService } from '../accounting/cost-centers.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { FiscalPeriodsService } from '../accounting/fiscal-periods.service';
import { PostingService } from '../accounting/posting.service';
import { AuditService } from '../../common/audit/audit.service';
import { ProblemDetailsFilter } from '../../common/filters/problem-details.filter';
import { validationExceptionFactory } from '../../common/validation/field-errors';
import { StockLedgerService } from '../../common/warehouse/stock-ledger.service';
import { WarehouseService } from '../../common/warehouse/warehouse.service';
import { pglitePrisma } from '../../testing/pglite-adapter';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

/// "New item with opening stock" over real HTTP: the production ValidationPipe
/// (whitelist + forbidNonWhitelisted), ProblemDetailsFilter, ItemsController and
/// ItemsService, on a real PostgreSQL engine (PGlite) built from the project's
/// own migrations. Auth guards are not mounted: a middleware sets the session
/// user, with the branch taken from a header so the "user has no branch" case
/// can be driven. Synthetic company only.
const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const WAREHOUSE = '44444444-4444-4444-8444-444444444444';
const SHELF = '55555555-5555-4555-8555-555555555555';
const OTHER_BRANCH = '66666666-6666-4666-8666-666666666666';
const OTHER_WH = '77777777-7777-4777-8777-777777777777';
const OTHER_SHELF = '88888888-8888-4888-8888-888888888888';
const migrationsDir = join(process.cwd(), 'prisma', 'migrations');

async function freshDatabase(): Promise<PGlite> {
  const db = new PGlite();
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const dir of dirs) {
    try {
      await db.exec(readFileSync(join(migrationsDir, dir, 'migration.sql'), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }
  await db.exec(`
    INSERT INTO companies (id, code, "nameEn", "nameAr", "updatedAt") VALUES ('${COMPANY}','CO','Co','شركة',now());
    INSERT INTO branches (id, "companyId", code, "nameEn", "nameAr", "updatedAt") VALUES ('${BRANCH}','${COMPANY}','BR','Branch','فرع',now());
    INSERT INTO branches (id, "companyId", code, "nameEn", "nameAr", "updatedAt") VALUES ('${OTHER_BRANCH}','${COMPANY}','B2','Branch 2','فرع ٢',now());
    INSERT INTO warehouses (id,"companyId","branchId",code,"nameEn","nameAr","isDefault","isActive","updatedAt") VALUES ('${WAREHOUSE}','${COMPANY}','${BRANCH}','W1','Main','رئيسي',true,true,now());
    INSERT INTO warehouses (id,"companyId","branchId",code,"nameEn","nameAr","isDefault","isActive","updatedAt") VALUES ('${OTHER_WH}','${COMPANY}','${OTHER_BRANCH}','W2','Other','آخر',true,true,now());
    INSERT INTO storage_locations (id,"companyId","branchId","warehouseId",kind,code,"nameEn","nameAr","isActive","updatedAt") VALUES ('${SHELF}','${COMPANY}','${BRANCH}','${WAREHOUSE}','SHELF','A-01','Shelf A','رف أ',true,now());
    INSERT INTO storage_locations (id,"companyId","branchId","warehouseId",kind,code,"nameEn","nameAr","isActive","updatedAt") VALUES ('${OTHER_SHELF}','${COMPANY}','${OTHER_BRANCH}','${OTHER_WH}','SHELF','Z-09','Shelf Z','رف ز',true,now());
    INSERT INTO users (id,"companyId",username,"fullNameEn","fullNameAr","passwordHash","updatedAt") VALUES ('${USER}','${COMPANY}','tester','Tester','مختبِر','x',now());
  `);
  return db;
}

async function seedAccounts(db: PGlite) {
  await db.exec(`
    INSERT INTO accounts (id,"companyId",code,"nameEn","nameAr",type,"isPostable","isActive","updatedAt") VALUES
      ('99999999-9999-4999-8999-000000001104','${COMPANY}','1104','Inventory','المخزون','ASSET',true,true,now()),
      ('99999999-9999-4999-8999-000000003103','${COMPANY}','3103','Opening equity','أرصدة افتتاحية','EQUITY',true,true,now());
  `);
}

const count = async (db: PGlite, sql: string): Promise<number> =>
  Number((await db.query<{ n: string }>(sql)).rows[0].n);

/// PGlite needs --experimental-vm-modules; without it the run would crash, so
/// the suite skips loudly (the no-skip runner and test:pglite pass the flag).
const vmLacksDynamicImport = !(
  process.execArgv.includes('--experimental-vm-modules') ||
  (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules')
);

(vmLacksDynamicImport ? describe.skip : describe)('POST /inventory/items with opening stock (real HTTP, real pipe, PGlite)', () => {
  jest.setTimeout(180_000);
  let db: PGlite;
  let app: INestApplication;
  let base = '';

  beforeAll(async () => {
    db = await freshDatabase();
    await seedAccounts(db);
    const prisma = pglitePrisma(db as never);
    const audit = new AuditService(prisma as never);
    const posting = new PostingService(
      new DocumentNumberService(),
      new FiscalPeriodsService(prisma as never, audit as never),
      new CostCentersService(prisma as never, audit as never),
    );
    const service = new ItemsService(
      prisma as never,
      audit as never,
      new AccountMapService(),
      posting,
      new WarehouseService(prisma as never, audit as never),
      new StockLedgerService(),
    );
    @Module({ controllers: [ItemsController], providers: [{ provide: ItemsService, useValue: service }] })
    class M {}
    app = await NestFactory.create(M, { logger: false });
    app.use((req: any, _res: any, next: () => void) => {
      const branch = req.headers['x-test-branch'];
      req.user = {
        userId: USER,
        username: 'tester',
        companyId: COMPANY,
        branchId: branch === 'none' ? null : (branch ?? BRANCH),
        isSuperAdmin: req.headers['x-test-grants'] ? false : true,
        warehouseAccess: req.headers['x-test-grants'] ? JSON.parse(String(req.headers['x-test-grants'])) : undefined,
        permissions: ['inventory.items.create', 'inventory.cost.manage', 'inventory.cost.read', 'inventory.items.purchaseprice.manage'],
        roles: [],
      };
      next();
    });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: validationExceptionFactory }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });
  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  const post = async (body: unknown, branch?: string, grants?: unknown) => {
    const res = await fetch(`${base}/api/v1/inventory/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(branch ? { 'x-test-branch': branch } : {}), ...(grants ? { 'x-test-grants': JSON.stringify(grants) } : {}) },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* */ }
    return { status: res.status, json };
  };
  const payload = (code: string, extra: Record<string, unknown> = {}) => ({
    code, nameEn: 'Arosa Tea', nameAr: 'شاي العروسة', unit: 'باكو', purchasePrice: '20', taxRate: '0',
    isStockTracked: true, openingQuantity: '1000', openingUnitCost: '20', ...extra,
  });
  const itemRows = (code: string) => count(db, `SELECT count(*) AS n FROM items WHERE code='${code}'`);
  const movementRows = (code: string) => count(db, `SELECT count(*) AS n FROM stock_movements m JOIN items i ON i.id=m."itemId" WHERE i.code='${code}'`);
  const journalRows = () => count(db, `SELECT count(*) AS n FROM journal_entries`);

  it('1. user without a branch: 400 "Select a branch…", nothing written', async () => {
    const r = await post(payload('NB-1'), 'none');
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('Select a branch before adding opening stock');
    expect(await itemRows('NB-1')).toBe(0);
    expect(await journalRows()).toBe(0);
  });

  it('2. branch user, location NOT sent: item, opening movement and journal are created', async () => {
    const r = await post(payload('OK-1'));
    expect(r.status).toBe(201);
    expect(await itemRows('OK-1')).toBe(1);
    expect(await movementRows('OK-1')).toBe(1);
    expect(await journalRows()).toBe(1);
  });

  it('3. branch user, location selected: saved with the shelf on the movement', async () => {
    const r = await post(payload('OK-2', { openingStorageLocationId: SHELF }));
    expect(r.status).toBe(201);
    expect(await count(db, `SELECT count(*) AS n FROM stock_movements m JOIN items i ON i.id=m."itemId" WHERE i.code='OK-2' AND m."storageLocationId"='${SHELF}'`)).toBe(1);
  });

  it('2b. destination proof: stock lands on the branch DEFAULT warehouse (the one the form displays), not on a lower-code non-default one', async () => {
    await db.exec(`INSERT INTO warehouses (id,"companyId","branchId",code,"nameEn","nameAr","isDefault","isActive","updatedAt") VALUES ('88888888-8888-4888-8888-888888888888','${COMPANY}','${BRANCH}','A0','Annex','ملحق',false,true,now())`);
    const r = await post(payload('OK-DEST'));
    expect(r.status).toBe(201);
    expect(await count(db, `SELECT count(*) AS n FROM stock_movements m JOIN items i ON i.id=m."itemId" WHERE i.code='OK-DEST' AND m."warehouseId"='${WAREHOUSE}' AND m."storageLocationId" IS NULL`)).toBe(1);
    expect(await count(db, `SELECT count(*) AS n FROM stock_movements m JOIN items i ON i.id=m."itemId" WHERE i.code='OK-DEST' AND m."warehouseId"='88888888-8888-4888-8888-888888888888'`)).toBe(0);
    // The same ordering the form uses: default first, then lowest code, within the user's branch.
    expect(await count(db, `SELECT count(*) AS n FROM (SELECT id FROM warehouses WHERE "branchId"='${BRANCH}' ORDER BY "isDefault" DESC, code ASC LIMIT 1) w WHERE w.id='${WAREHOUSE}'`)).toBe(1);
  });

  it('2c. destination proof: a selected shelf puts the stock in that shelf AND in the shelf warehouse', async () => {
    const r = await post(payload('OK-DEST2', { openingStorageLocationId: SHELF }));
    expect(r.status).toBe(201);
    expect(await count(db, `SELECT count(*) AS n FROM stock_movements m JOIN items i ON i.id=m."itemId" WHERE i.code='OK-DEST2' AND m."warehouseId"='${WAREHOUSE}' AND m."storageLocationId"='${SHELF}'`)).toBe(1);
  });

  const addBranch = async (id: string, code: string, warehouses: Array<[string, string, boolean, boolean]>) => {
    await db.exec(`INSERT INTO branches (id, "companyId", code, "nameEn", "nameAr", "updatedAt") VALUES ('${id}','${COMPANY}','${code}','Branch ${code}','فرع ${code}',now())`);
    for (const [wid, wcode, isDefault, isActive] of warehouses) {
      await db.exec(`INSERT INTO warehouses (id,"companyId","branchId",code,"nameEn","nameAr","isDefault","isActive","updatedAt") VALUES ('${wid}','${COMPANY}','${id}','${wcode}','WH ${wcode}','مخزن ${wcode}',${isDefault},${isActive},now())`);
    }
  };
  const movementWarehouse = async (code: string) =>
    (await db.query<{ w: string }>(`SELECT m."warehouseId" AS w FROM stock_movements m JOIN items i ON i.id=m."itemId" WHERE i.code='${code}'`)).rows.map((r) => r.w);

  it('2d. destination proof: an INACTIVE default warehouse is skipped; stock goes to the first ACTIVE one (what the form shows)', async () => {
    const B = '99999999-9999-4999-8999-999999999991';
    await addBranch(B, 'B4', [
      ['99999999-9999-4999-8999-9999999999a1', 'D1', true, false],
      ['99999999-9999-4999-8999-9999999999a2', 'Z9', false, true],
      ['99999999-9999-4999-8999-9999999999a3', 'M5', false, true],
    ]);
    const r = await post(payload('OK-INACT'), B);
    expect(r.status).toBe(201);
    expect(await movementWarehouse('OK-INACT')).toEqual(['99999999-9999-4999-8999-9999999999a3']);
  });

  it('2e. every warehouse of the branch inactive: refused with a specific message, item, movement and journal not kept', async () => {
    const B = '99999999-9999-4999-8999-999999999992';
    await addBranch(B, 'B5', [['99999999-9999-4999-8999-9999999999b1', 'D2', true, false]]);
    const journalsBefore = await journalRows();
    const r = await post(payload('NO-ACTIVE'), B);
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('ITEM_OPENING_WAREHOUSE_INACTIVE');
    expect(await itemRows('NO-ACTIVE')).toBe(0);
    expect(await movementRows('NO-ACTIVE')).toBe(0);
    expect(await journalRows()).toBe(journalsBefore);
  });

  it('2f. branch with no warehouse: one is created for the branch on save and holds the stock', async () => {
    const B = '99999999-9999-4999-8999-999999999993';
    await addBranch(B, 'B6', []);
    const r = await post(payload('OK-NOWH'), B);
    expect(r.status).toBe(201);
    const wh = await movementWarehouse('OK-NOWH');
    expect(wh.length).toBe(1);
    expect(await count(db, `SELECT count(*) AS n FROM warehouses WHERE id='${wh[0]}' AND "branchId"='${B}' AND "isDefault"=true AND "isActive"=true`)).toBe(1);
  });

  const grant = (warehouseId: string, canReceive: boolean) => ({ warehouseId, canView: true, canReceive, canIssue: false, canTransfer: false, canCount: false, canApprove: false, canSeeCost: true });
  const getTarget = async (branch: string, grants?: unknown) => {
    const res = await fetch(`${base}/api/v1/inventory/items/opening-target`, {
      headers: { 'x-test-branch': branch, ...(grants ? { 'x-test-grants': JSON.stringify(grants) } : {}) },
    });
    return { status: res.status, json: await res.json() as any };
  };

  it('2g. restricted user: display and save use the same PERMITTED warehouse (default is hidden from them), no hidden warehouse leaks', async () => {
    const B = '99999999-9999-4999-8999-999999999994';
    await addBranch(B, 'B7', [
      ['99999999-9999-4999-8999-9999999999c1', 'C1', true, true],
      ['99999999-9999-4999-8999-9999999999c2', 'C2', false, true],
    ]);
    const grants = [grant('99999999-9999-4999-8999-9999999999c2', true)];
    const t = await getTarget(B, grants);
    expect(t.status).toBe(200);
    expect(t.json.state).toBe('ready');
    expect(t.json.warehouse.id).toBe('99999999-9999-4999-8999-9999999999c2');
    expect(JSON.stringify(t.json)).not.toContain('C1');
    const r = await post(payload('OK-GRANT', { openingWarehouseId: t.json.warehouse.id }), B, grants);
    expect(r.status).toBe(201);
    expect(await movementWarehouse('OK-GRANT')).toEqual(['99999999-9999-4999-8999-9999999999c2']);
  });

  it('2h. view-only grant (cannot receive): target is forbidden, save refused with 403 and nothing is written', async () => {
    const B = '99999999-9999-4999-8999-999999999995';
    await addBranch(B, 'B8', [['99999999-9999-4999-8999-9999999999d1', 'E1', true, true]]);
    const grants = [grant('99999999-9999-4999-8999-9999999999d1', false)];
    expect((await getTarget(B, grants)).json.state).toBe('forbidden');
    const journalsBefore = await journalRows();
    const r = await post(payload('NO-RECV'), B, grants);
    expect(r.status).toBe(403);
    expect(r.json.code).toBe('ITEM_OPENING_WAREHOUSE_FORBIDDEN');
    expect(await itemRows('NO-RECV')).toBe(0);
    expect(await journalRows()).toBe(journalsBefore);
  });

  it('2i. restricted user in a branch with no warehouse: forbidden (no warehouse is created for them); unrestricted user is told it will be created', async () => {
    const B = '99999999-9999-4999-8999-999999999996';
    await addBranch(B, 'B9', []);
    expect((await getTarget(B, [grant(WAREHOUSE, true)])).json.state).toBe('forbidden');
    const r = await post(payload('NO-CREATE'), B, [grant(WAREHOUSE, true)]);
    expect(r.status).toBe(403);
    expect(await count(db, `SELECT count(*) AS n FROM warehouses WHERE "branchId"='${B}'`)).toBe(0);
    expect((await getTarget(B)).json.state).toBe('create');
  });

  it('2j. stale form: the warehouse the form named is no longer the target (deactivated meanwhile): 409, nothing written', async () => {
    const B = '99999999-9999-4999-8999-999999999997';
    await addBranch(B, 'BA', [
      ['99999999-9999-4999-8999-9999999999e1', 'F1', true, true],
      ['99999999-9999-4999-8999-9999999999e2', 'F2', false, true],
    ]);
    const shown = (await getTarget(B)).json.warehouse.id;
    expect(shown).toBe('99999999-9999-4999-8999-9999999999e1');
    await db.exec(`UPDATE warehouses SET "isActive"=false WHERE id='${shown}'`);
    const journalsBefore = await journalRows();
    const r = await post(payload('STALE-1', { openingWarehouseId: shown }), B);
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('ITEM_OPENING_TARGET_CHANGED');
    expect(await itemRows('STALE-1')).toBe(0);
    expect(await journalRows()).toBe(journalsBefore);
    // Reopened form shows the new target and saves there.
    const now = (await getTarget(B)).json.warehouse.id;
    expect(now).toBe('99999999-9999-4999-8999-9999999999e2');
    expect((await post(payload('STALE-2', { openingWarehouseId: now }), B)).status).toBe(201);
  });

  it('3b. a location of another branch is refused with the existing Arabic message and nothing is kept', async () => {
    const before = await journalRows();
    const r = await post(payload('BAD-LOC', { openingStorageLocationId: OTHER_SHELF }));
    expect(r.status).toBe(400);
    expect(r.json.errorCode).toBe('ITEM_OPENING_LOCATION_WRONG_WAREHOUSE');
    expect(await itemRows('BAD-LOC')).toBe(0);
    expect(await journalRows()).toBe(before);
  });

  it('4. branch already has an opening-balance document: 400 and the item is not kept', async () => {
    await db.exec(`INSERT INTO opening_balances (id,"companyId","branchId","documentNumber","asOfDate",status,"updatedAt") VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${COMPANY}','${OTHER_BRANCH}','OB-0001','2026-01-01','DRAFT',now())`);
    const r = await post(payload('OB-ITEM'), OTHER_BRANCH);
    expect(r.status).toBe(400);
    expect(r.json.message).toMatch(/^This branch already has an opening balance \(OB-0001\)\./);
    expect(await itemRows('OB-ITEM')).toBe(0);
  });

  it('5. chart lacks the opening-equity account: 400 AFTER the item row is inserted, and the whole save is rolled back', async () => {
    await db.exec(`UPDATE accounts SET code='3103-OFF' WHERE code='3103'`);
    const before = await journalRows();
    const r = await post(payload('NOACC-1'));
    expect(r.status).toBe(400);
    expect(r.json.message).toMatch(/^Required account 3103 \(openingBalanceEquity\) does not exist in this company's chart of accounts$/);
    expect(await itemRows('NOACC-1')).toBe(0);
    expect(await movementRows('NOACC-1')).toBe(0);
    expect(await journalRows()).toBe(before);
    expect(await count(db, `SELECT count(*) AS n FROM item_units u JOIN items i ON i.id=u."itemId" WHERE i.code='NOACC-1'`)).toBe(0);
  });

  it('6. missing names: 400 with the exact sentence; duplicate code: 409', async () => {
    const r = await post({ code: 'NN-1', unit: 'x' });
    expect(r.status).toBe(400);
    expect(r.json.message).toBe('Provide an Arabic or English item name');
    const dup = await post(payload('OK-1'));
    expect(dup.status).toBe(409);
    expect(dup.json.message).toBe('Item code OK-1 is already used');
  });
});
