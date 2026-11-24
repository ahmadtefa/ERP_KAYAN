import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';

import { BatchesService } from './batches.service';
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
  const locations = new StorageLocationsService(prisma as never, audit as never);
  return { batches, locations };
}

const one = async (db: PGlite, sql: string, args: unknown[] = []) =>
  (await db.query<Record<string, string>>(sql, args)).rows[0];

jest.setTimeout(180_000);
const vmReady =
  process.execArgv.includes('--experimental-vm-modules') ||
  (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules');

(vmReady ? describe : describe.skip)('storage location lifecycle over a real engine', () => {
  let db: PGlite;
  let batches: BatchesService;
  let locations: StorageLocationsService;
  const SHELF_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  beforeEach(async () => {
    db = await freshDatabase();
    ({ batches, locations } = servicesWith(db));
    await db.exec(`INSERT INTO storage_locations
      (id, "companyId", "branchId", "warehouseId", kind, code, "nameEn", "nameAr", "isActive", "updatedAt")
      VALUES ('${SHELF_B}', '${COMPANY}', '${BRANCH}', '${WAREHOUSE}', 'SHELF', 'B-01', 'B1', 'ب١', true, now())`);
  });
  afterEach(async () => { await db.close(); });

  const breakdown = async () => {
    const r = await locations.itemLocations(COMPANY, ITEM, {}, null);
    return r.warehouses.find((w) => w.warehouseId === WAREHOUSE);
  };
  const balances = async () => ({
    branch: await one(db, `SELECT quantity::text q, value::text v FROM stock_balances WHERE "itemId"=$1`, [ITEM]),
    shelf: await one(db, `SELECT quantity::text q, value::text v FROM warehouse_stock_balances WHERE "itemId"=$1`, [ITEM]),
  });

  it('shows a located receipt with its location and quantity', async () => {
    await batches.receive(COMPANY, USER, {
      branchId: BRANCH, warehouseId: WAREHOUSE, itemId: ITEM, batchNumber: 'L1',
      quantity: 3, unitCost: 4.25, storageLocationId: SHELF, expiryDate: '2027-02-01',
    });
    const b = await breakdown();
    expect(b?.total).toBe('3.0000');
    expect(b?.locations.map((l) => [l.code, l.quantity])).toEqual([['A-01', '3.0000']]);
    expect(b?.unlocated.quantity).toBe('0.0000');
  });

  it('assigns existing unlocated stock without changing quantity or value', async () => {
    const lot = await batches.receive(COMPANY, USER, {
      branchId: BRANCH, warehouseId: WAREHOUSE, itemId: ITEM, batchNumber: 'L1',
      quantity: 10, unitCost: 4.25, expiryDate: '2027-02-01',
    });
    expect((await breakdown())?.unlocated.quantity).toBe('10.0000');
    const before = await balances();
    const docsBefore = await one(db, `SELECT (SELECT count(*) FROM journal_entries)::text j, (SELECT count(*) FROM item_batches)::text b`);
    // split across two shelves
    await locations.assignUnlocated(COMPANY, USER, {
      warehouseId: WAREHOUSE, toLocationId: SHELF, itemId: ITEM, batchId: lot.batchId as string, quantity: 4,
    }, null);
    await locations.assignUnlocated(COMPANY, USER, {
      warehouseId: WAREHOUSE, toLocationId: SHELF_B, itemId: ITEM, batchId: lot.batchId as string, quantity: 6,
    }, null);
    const b = await breakdown();
    expect(b?.total).toBe('10.0000');
    expect(b?.unlocated.quantity).toBe('0.0000');
    expect(Object.fromEntries((b?.locations ?? []).map((l) => [l.code, l.quantity]))).toEqual({ 'A-01': '4.0000', 'B-01': '6.0000' });
    expect(await balances()).toEqual(before);
    expect(await one(db, `SELECT (SELECT count(*) FROM journal_entries)::text j, (SELECT count(*) FROM item_batches)::text b`)).toEqual(docsBefore);
    const lotRow = await one(db, `SELECT "remainingQuantity"::text r, "receivedQuantity"::text rc FROM item_batches WHERE id=$1`, [lot.batchId]);
    expect(lotRow).toEqual({ r: '10.0000', rc: '10.0000' });
  });

  it('refuses to assign more than the unlocated quantity and leaves no trace', async () => {
    await batches.receive(COMPANY, USER, {
      branchId: BRANCH, warehouseId: WAREHOUSE, itemId: ITEM, batchNumber: 'L1',
      quantity: 2, unitCost: 1, storageLocationId: SHELF, expiryDate: '2027-02-01',
    });
    const n = await one(db, `SELECT count(*)::text n FROM stock_movements`);
    await expect(
      locations.assignUnlocated(COMPANY, USER, { warehouseId: WAREHOUSE, toLocationId: SHELF_B, itemId: ITEM, quantity: 1 }, null),
    ).rejects.toThrow(/no location/);
    expect(await one(db, `SELECT count(*)::text n FROM stock_movements`)).toEqual(n);
  });

  it('refuses a location in another warehouse', async () => {
    await expect(
      locations.assignUnlocated(COMPANY, USER, { warehouseId: WAREHOUSE_2, toLocationId: SHELF, itemId: ITEM, quantity: 1 }, null),
    ).rejects.toThrow(/not in that warehouse/);
  });

  const receiveLot = (qty: number, loc?: string, item = ITEM, num = 'L1') =>
    batches.receive(COMPANY, USER, {
      branchId: BRANCH, warehouseId: WAREHOUSE, itemId: item, batchNumber: num,
      quantity: qty, unitCost: 2, storageLocationId: loc ?? null, expiryDate: '2027-02-01',
    });

  it('an issue from a named shelf lowers that shelf, not an invented unlocated figure', async () => {
    const lot = await receiveLot(5, SHELF);
    await batches.issue(COMPANY, USER, {
      branchId: BRANCH, warehouseId: WAREHOUSE, itemId: ITEM, quantity: 2,
      batchId: lot.batchId as string, storageLocationId: SHELF,
    });
    const b = await breakdown();
    expect(b?.total).toBe('3.0000');
    expect(b?.locations.map((l) => [l.code, l.quantity])).toEqual([['A-01', '3.0000']]);
    expect(b?.unlocated.quantity).toBe('0.0000');
  });

  it('one sale quantity can be split across two shelves chosen by the employee', async () => {
    const lot = await receiveLot(10, SHELF);
    await locations.move(COMPANY, USER, {
      fromLocationId: SHELF, toLocationId: SHELF_B, itemId: ITEM, batchId: lot.batchId as string, quantity: 4,
    }, null);
    // a split lot names no single shelf: neither the source nor the destination
    expect((await one(db, `SELECT "storageLocationId"::text l FROM item_batches WHERE id=$1`, [lot.batchId])).l).toBeNull();
    for (const [loc, q] of [[SHELF, 2], [SHELF_B, 3]] as const) {
      await batches.issue(COMPANY, USER, {
        branchId: BRANCH, warehouseId: WAREHOUSE, itemId: ITEM, quantity: q, storageLocationId: loc,
      });
    }
    const b = await breakdown();
    expect(Object.fromEntries((b?.locations ?? []).map((l) => [l.code, l.quantity]))).toEqual({ 'A-01': '4.0000', 'B-01': '1.0000' });
    expect(b?.total).toBe('5.0000');
    expect((await balances()).shelf.q).toBe('5.0000');
  });

  it('refuses to take from a shelf more than it holds even when the lot has more elsewhere', async () => {
    const lot = await receiveLot(10, SHELF);
    await locations.move(COMPANY, USER, {
      fromLocationId: SHELF, toLocationId: SHELF_B, itemId: ITEM, batchId: lot.batchId as string, quantity: 8,
    }, null);
    const n = await one(db, `SELECT count(*)::text n FROM stock_movements`);
    await expect(
      batches.issue(COMPANY, USER, { branchId: BRANCH, warehouseId: WAREHOUSE, itemId: ITEM, quantity: 3, storageLocationId: SHELF }),
    ).rejects.toThrow(/holds 2\.0000/);
    expect(await one(db, `SELECT count(*)::text n FROM stock_movements`)).toEqual(n);
    expect((await balances()).shelf.q).toBe('10.0000');
  });

  it('an item without lots issues from a named shelf too', async () => {
    const PLAIN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await db.exec(`INSERT INTO items (id, "companyId", code, "nameEn", "nameAr", unit, "isStockTracked", "salePrice", "updatedAt")
      VALUES ('${PLAIN}', '${COMPANY}', 'IT-P', 'Nail', 'مسمار', 'piece', true, 1, now())`);
    const mv = (dir: string, q: number, loc: string | null) => db.query(
      `INSERT INTO stock_movements (id, "companyId", "branchId", "warehouseId", "itemId", "storageLocationId", "movementDate",
         direction, quantity, "unitCost", "totalCost", "referenceType")
       VALUES (gen_random_uuid(), $1,$2,$3,$4,$5, now(), $6, $7, 1, $7, 'TEST_SEED')`,
      [COMPANY, BRANCH, WAREHOUSE, PLAIN, loc, dir, q]);
    await mv('IN', 6, SHELF);
    await db.query(`INSERT INTO stock_balances ("companyId", "branchId", "itemId", quantity, value, "updatedAt") VALUES ($1,$2,$3,6,6,now())`, [COMPANY, BRANCH, PLAIN]);
    await db.query(`INSERT INTO warehouse_stock_balances ("companyId", "branchId", "warehouseId", "itemId", quantity, value, "updatedAt") VALUES ($1,$2,$3,$4,6,6,now())`, [COMPANY, BRANCH, WAREHOUSE, PLAIN]);
    await expect(
      batches.issue(COMPANY, USER, { branchId: BRANCH, warehouseId: WAREHOUSE, itemId: PLAIN, quantity: 4, storageLocationId: SHELF_B }),
    ).rejects.toThrow(/holds 0\.0000/);
    await batches.issue(COMPANY, USER, { branchId: BRANCH, warehouseId: WAREHOUSE, itemId: PLAIN, quantity: 4, storageLocationId: SHELF });
    const r = await locations.itemLocations(COMPANY, PLAIN, {}, null);
    const w = r.warehouses[0];
    expect([w.total, w.locations.map((l) => [l.code, l.quantity]), w.unlocated.quantity]).toEqual(['2.0000', [['A-01', '2.0000']], '0.0000']);
  });

  it('lot list shows the split of a lot and names no single shelf for it', async () => {
    const lot = await receiveLot(10, SHELF);
    await locations.move(COMPANY, USER, {
      fromLocationId: SHELF, toLocationId: SHELF_B, itemId: ITEM, batchId: lot.batchId as string, quantity: 4,
    }, null);
    const list = await batches.list(COMPANY, { itemId: ITEM } as never, null);
    const row = list.items.find((r: { id: string }) => r.id === lot.batchId) as never as {
      storageLocation: unknown; storageLocationId: string | null; unplacedQuantity: string;
      locations: Array<{ code: string; quantity: string }>;
    };
    expect(row.storageLocationId).toBeNull();
    expect(row.storageLocation).toBeNull();
    expect(Object.fromEntries(row.locations.map((l) => [l.code, l.quantity]))).toEqual({ 'A-01': '6.0000', 'B-01': '4.0000' });
    expect(row.unplacedQuantity).toBe('0.0000');
  });

  it('tells the screen per warehouse whether this user may assign or move', async () => {
    const lot = await receiveLot(10, SHELF);
    await receiveLot(5, undefined, ITEM, 'L2');
    await locations.move(COMPANY, USER, { fromLocationId: SHELF, toLocationId: SHELF_B, itemId: ITEM, batchId: lot.batchId as string, quantity: 4 }, null);
    const r = await locations.itemLocations(COMPANY, ITEM, {}, null, undefined, (w) => w === WAREHOUSE);
    expect(r.warehouses[0].canAllocate).toBe(true);
    const denied = await locations.itemLocations(COMPANY, ITEM, {}, null, undefined, () => false);
    expect(denied.warehouses[0].canAllocate).toBe(false);
  });

  it('reconciles a legacy deficit in the right direction: bucket up, shelf down, books unchanged', async () => {
    const lot = await receiveLot(5, SHELF);
    // the old behaviour: a sale that named no shelf
    // (the service now refuses this, so the legacy row is written directly)
    await db.query(
      `INSERT INTO stock_movements (id,"companyId","branchId","warehouseId","itemId","batchId",direction,quantity,"unitCost","totalCost","movementDate","referenceType","createdBy")
       VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,'OUT',2,2,4,now(),'LEGACY_SALE',$6)`,
      [COMPANY, BRANCH, WAREHOUSE, ITEM, lot.batchId, USER],
    );
    let b = await breakdown();
    expect([b?.locations[0].quantity, b?.unlocated.quantity]).toEqual(['5.0000', '-2.0000']);
    const before = await balances();
    await expect(
      locations.reconcileUnlocated(COMPANY, USER, { warehouseId: WAREHOUSE, fromLocationId: SHELF, itemId: ITEM, batchId: lot.batchId as string, quantity: 3, reason: 'count' }, null),
    ).rejects.toThrow(/At most 2\.0000/);
    await expect(
      locations.reconcileUnlocated(COMPANY, USER, { warehouseId: WAREHOUSE, fromLocationId: SHELF, itemId: ITEM, batchId: lot.batchId as string, quantity: 2, reason: '' }, null),
    ).rejects.toThrow(/reason/);
    const r = await locations.reconcileUnlocated(COMPANY, USER, { warehouseId: WAREHOUSE, fromLocationId: SHELF, itemId: ITEM, batchId: lot.batchId as string, quantity: 2, reason: 'sold before shelves existed' }, null);
    expect(r.remainingUnlocatedDeficit).toBe('0.0000');
    b = await breakdown();
    expect([b?.locations[0].quantity, b?.unlocated.quantity, b?.total]).toEqual(['3.0000', '0.0000', '3.0000']);
    expect(await balances()).toEqual(before);
    await expect(
      locations.reconcileUnlocated(COMPANY, USER, { warehouseId: WAREHOUSE, fromLocationId: SHELF, itemId: ITEM, batchId: lot.batchId as string, quantity: 1, reason: 'again' }, null),
    ).rejects.toThrow(/nothing to correct/);
  });

  describe('direct issue and write-off keep the manual-source rule', () => {
    const receiveAt = (batchNumber: string, quantity: number, storageLocationId: string | undefined, expiryDate: string) =>
      batches.receive(COMPANY, USER, {
        branchId: BRANCH, warehouseId: WAREHOUSE, itemId: ITEM, batchNumber, quantity, unitCost: 2,
        ...(storageLocationId ? { storageLocationId } : {}), expiryDate,
      });
    const base = { branchId: BRANCH, warehouseId: WAREHOUSE, itemId: ITEM };
    const outs = async () =>
      Number((await one(db, `SELECT COALESCE(SUM(quantity),0)::text q FROM stock_movements WHERE "itemId"=$1 AND direction='OUT'`, [ITEM])).q);
    const at = async (loc: string) =>
      Number((await one(db, `SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN quantity ELSE -quantity END),0)::text q FROM stock_movements WHERE "itemId"=$1 AND "storageLocationId"=$2`, [ITEM, loc])).q);
    const failure = async (p: Promise<unknown>) => {
      try { await p; } catch (e) { return (e as { response?: { code?: string; message?: string } }).response ?? { message: String(e) }; }
      return null;
    };

    beforeEach(async () => {
      await receiveAt('L1', 3, SHELF, '2027-02-01');
      await receiveAt('L2', 2, SHELF_B, '2027-03-01');
    });

    it('refuses an issue with no source while the item has located stock, and writes nothing', async () => {
      const before = await balances();
      const err = await failure(batches.issue(COMPANY, USER, { ...base, quantity: 1 }));
      expect(err?.code).toBe('ISSUE_LOCATION_REQUIRED');
      expect(err?.message).toContain('A-01');
      expect(err?.message).toContain('B-01');
      expect(await outs()).toBe(0);
      expect(await balances()).toEqual(before);
    });

    it('issues a split over two shelves atomically and conserves the quantity', async () => {
      const r = await batches.issue(COMPANY, USER, {
        ...base, quantity: 4,
        locationAllocations: [{ storageLocationId: SHELF, quantity: 2 }, { storageLocationId: SHELF_B, quantity: 2 }],
      });
      expect(r.quantity).toBe('4.0000');
      expect(await outs()).toBe(4);
      expect(await at(SHELF)).toBe(1);
      expect(await at(SHELF_B)).toBe(0);
      expect((await balances()).branch.q).toBe('1.0000');
    });

    it('refuses a split that does not add up, with nothing written', async () => {
      const err = await failure(batches.issue(COMPANY, USER, {
        ...base, quantity: 4,
        locationAllocations: [{ storageLocationId: SHELF, quantity: 2 }, { storageLocationId: SHELF_B, quantity: 1 }],
      }));
      expect(err?.code).toBe('ISSUE_ALLOCATION_SUM');
      expect(await outs()).toBe(0);
    });

    it('rolls back the first slice when a later slice is short', async () => {
      const err = await failure(batches.issue(COMPANY, USER, {
        ...base, quantity: 5,
        locationAllocations: [{ storageLocationId: SHELF, quantity: 2 }, { storageLocationId: SHELF_B, quantity: 3 }],
      }));
      expect(err).not.toBeNull();
      expect(await outs()).toBe(0);
      expect(await at(SHELF)).toBe(3);
    });

    it('writes off only from a named shelf, up to what the shelf holds of the lot', async () => {
      const lot = (await one(db, `SELECT id FROM item_batches WHERE "batchNumber"='L1'`)).id;
      const w = { ...base, batchId: lot, reason: 'damaged' };
      expect((await failure(batches.writeOff(COMPANY, USER, { ...w, quantity: 1 })))?.code).toBe('WRITEOFF_LOCATION_REQUIRED');
      expect((await failure(batches.writeOff(COMPANY, USER, { ...w, quantity: 1, storageLocationId: SHELF_B })))?.code).toBe('WRITEOFF_LOCATION_SHORT');
      expect(await outs()).toBe(0);
      await batches.writeOff(COMPANY, USER, { ...w, quantity: 1, storageLocationId: SHELF });
      expect(await at(SHELF)).toBe(2);
      expect(await outs()).toBe(1);
    });

    it('keeps the legacy behaviour for an item with no located stock', async () => {
      await batches.receive(COMPANY, USER, {
        branchId: BRANCH, warehouseId: WAREHOUSE, itemId: ITEM_NO_EXPIRY, batchNumber: 'S1', quantity: 5, unitCost: 1,
      });
      const err = await failure(batches.issue(COMPANY, USER, { ...base, itemId: ITEM_NO_EXPIRY, quantity: 1 }));
      expect(err).toBeNull();
      expect(await outs()).toBe(0);
      expect(Number((await one(db, `SELECT COALESCE(SUM(quantity),0)::text q FROM stock_movements WHERE "itemId"=$1 AND direction='OUT'`, [ITEM_NO_EXPIRY])).q)).toBe(1);
    });
  });
});
