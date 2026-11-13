import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';
import { PGlite } from '@electric-sql/pglite';

import { BatchesService } from './batches.service';
import { StockLedgerService } from '../../common/warehouse/stock-ledger.service';
import { pglitePrisma } from '../../testing/pglite-adapter';

/// A lot keeps its quality state when it moves between shelves.
///
/// `transfer()` used to create the destination pair with a hard-coded
/// `status: 'OPEN'`. Goods sitting in QUARANTINE, or a lot that had already
/// expired, arrived on the other shelf as sellable stock: a move laundered the
/// hold. That is the opposite of what a warehouse transfer is for, and it is
/// invisible in the movement list - the rows look right, only the state was
/// dropped.
///
/// These run the production `transfer()` over a schema built from the project's
/// own migration files, so the CHECK constraints on `item_batches.status` are
/// the real ones. They need PGlite's wasm engine and therefore run under
/// `npm run test:lots` (NODE_OPTIONS=--experimental-vm-modules); without it the
/// suite skips, loudly.

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const FROM_SHELF = '44444444-4444-4444-8444-444444444444';
const TO_SHELF = '55555555-5555-4555-8555-555555555555';
const ITEM = '66666666-6666-4666-8666-666666666666';

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
    VALUES ('${FROM_SHELF}', '${COMPANY}', '${BRANCH}', 'W1', 'Main', 'رئيسي', true, true, now()),
           ('${TO_SHELF}', '${COMPANY}', '${BRANCH}', 'W2', 'Overflow', 'احتياطي', false, true, now());

    INSERT INTO items (id, "companyId", code, "nameEn", "nameAr", unit, "isStockTracked",
                       "requiresBatch", "useFefo", "salePrice", "updatedAt")
    VALUES ('${ITEM}', '${COMPANY}', 'IT-1', 'Milk', 'حليب', 'piece', true,
            true, true, 10, now());
  `);
  return db;
}

async function seedLot(
  db: PGlite,
  status: string,
  quantity = 10,
  batchNumber = 'L-1',
): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO item_batches
       (id,"companyId","branchId","warehouseId","itemId","batchNumber",
        "receivedQuantity","remainingQuantity","unitCost","status","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7,5,$8,now(),now())`,
    [id, COMPANY, BRANCH, FROM_SHELF, ITEM, batchNumber, quantity, status],
  );
  await db.query(
    `INSERT INTO stock_balances ("companyId","branchId","itemId",quantity,value,"updatedAt")
     VALUES ($1,$2,$3,$4,$5,now())`,
    [COMPANY, BRANCH, ITEM, quantity, quantity * 5],
  );
  await db.query(
    `INSERT INTO warehouse_stock_balances ("companyId","branchId","warehouseId","itemId",quantity,value,"updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,now())`,
    [COMPANY, BRANCH, FROM_SHELF, ITEM, quantity, quantity * 5],
  );
  return id;
}

function serviceWith(db: PGlite): BatchesService {
  const prisma = pglitePrisma(db);
  const audit = {
    record: async () => undefined,
    recordRequired: async () => undefined,
  };
  return new BatchesService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    audit as never,
    new StockLedgerService(),
  );
}

const destinationStatus = async (db: PGlite): Promise<string | undefined> => {
  const rows = await db.query<{ status: string }>(
    `SELECT status FROM item_batches
      WHERE "companyId"=$1 AND "warehouseId"=$2 AND "itemId"=$3`,
    [COMPANY, TO_SHELF, ITEM],
  );
  return rows.rows[0]?.status;
};

jest.setTimeout(180_000);

const vmReady =
  process.execArgv.includes('--experimental-vm-modules') ||
  (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules');

(vmReady ? describe : describe.skip)('a lot keeps its hold state across a transfer', () => {
  let db: PGlite;

  afterEach(async () => {
    await db.close();
  });

  it('carries QUARANTINE to the destination shelf', async () => {
    db = await freshDatabase();
    const lot = await seedLot(db, 'QUARANTINE');

    await serviceWith(db).transfer(COMPANY, USER, {
      fromWarehouseId: FROM_SHELF,
      toWarehouseId: TO_SHELF,
      batchId: lot,
      quantity: new Prisma.Decimal(4),
    } as never);

    // The goods moved, but they are still on hold.
    expect(await destinationStatus(db)).toBe('QUARANTINE');
    // And the source lot kept its own state.
    const source = await db.query<{ status: string }>(
      `SELECT status FROM item_batches WHERE id=$1`,
      [lot],
    );
    expect(source.rows[0].status).toBe('QUARANTINE');
  });

  it('carries EXPIRED to the destination shelf', async () => {
    db = await freshDatabase();
    const lot = await seedLot(db, 'EXPIRED');

    await serviceWith(db).transfer(COMPANY, USER, {
      fromWarehouseId: FROM_SHELF,
      toWarehouseId: TO_SHELF,
      batchId: lot,
      quantity: new Prisma.Decimal(3),
    } as never);

    expect(await destinationStatus(db)).toBe('EXPIRED');
  });

  it('opens ordinary stock, because OPEN is what travels by default', async () => {
    db = await freshDatabase();
    const lot = await seedLot(db, 'OPEN');

    await serviceWith(db).transfer(COMPANY, USER, {
      fromWarehouseId: FROM_SHELF,
      toWarehouseId: TO_SHELF,
      batchId: lot,
      quantity: new Prisma.Decimal(2),
    } as never);

    expect(await destinationStatus(db)).toBe('OPEN');
  });

  it('refuses to move nothing, and leaves the shelf alone', async () => {
    db = await freshDatabase();
    const lot = await seedLot(db, 'OPEN', 10);

    await expect(
      serviceWith(db).transfer(COMPANY, USER, {
        fromWarehouseId: FROM_SHELF,
        toWarehouseId: TO_SHELF,
        batchId: lot,
        quantity: new Prisma.Decimal(0),
      } as never),
    ).rejects.toThrow();

    expect(await destinationStatus(db)).toBeUndefined();
  });

  it('will not move more than the lot holds', async () => {
    db = await freshDatabase();
    const lot = await seedLot(db, 'OPEN', 3);

    await expect(
      serviceWith(db).transfer(COMPANY, USER, {
        fromWarehouseId: FROM_SHELF,
        toWarehouseId: TO_SHELF,
        batchId: lot,
        quantity: new Prisma.Decimal(4),
      } as never),
    ).rejects.toThrow();

    const rows = await db.query<{ q: string }>(
      `SELECT "remainingQuantity"::text AS q FROM item_batches WHERE id=$1`,
      [lot],
    );
    expect(Number(rows.rows[0].q)).toBe(3);
    expect(await destinationStatus(db)).toBeUndefined();
  });
});
