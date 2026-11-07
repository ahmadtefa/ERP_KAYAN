import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';
import { PGlite } from '@electric-sql/pglite';

import { BatchesService } from '../inventory/batches.service';
import { StockLedgerService } from '../../common/warehouse/stock-ledger.service';
import { pglitePrisma } from '../../testing/pglite-adapter';

/// Selling out of lots, against a real PostgreSQL engine.
///
/// Every other sales spec in this folder mocks the database, so it can prove the
/// invoice calls the lot engine but not that the lot engine then does the right
/// thing to real rows. This one builds the entire schema from the project's own
/// migration files inside PGlite - real DDL, real CHECK constraints, real
/// UPDATE ... WHERE - seeds lots with different expiry dates, and drives the
/// production `BatchesService.issueTx`, the exact function `SalesInvoicesService.post`
/// now calls.
///
/// What it cannot prove: PGlite runs in one process, so two connections never
/// contend. The conditional update and the FOR UPDATE lock are exercised as
/// statements, but genuine simultaneous posting needs a server PostgreSQL. That
/// gap is stated in the report rather than papered over.

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const WAREHOUSE = '44444444-4444-4444-8444-444444444444';
const ITEM = '55555555-5555-4555-8555-555555555555';

const D = (v: string | number) => new Prisma.Decimal(v);
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const migrationsDir = join(process.cwd(), 'prisma', 'migrations');

async function freshDatabase() {
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

  // The minimum a lot needs to exist: a company, a branch and a warehouse.
  await db.exec(`
    INSERT INTO companies (id, code, "nameEn", "nameAr", "updatedAt")
    VALUES ('${COMPANY}', 'CO', 'Co', 'شركة', now());

    INSERT INTO branches (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
    VALUES ('${BRANCH}', '${COMPANY}', 'BR', 'Branch', 'فرع', now());

    INSERT INTO warehouses (id, "companyId", "branchId", code, "nameEn", "nameAr", "isDefault", "isActive", "updatedAt")
    VALUES ('${WAREHOUSE}', '${COMPANY}', '${BRANCH}', 'W1', 'Main', 'رئيسي', true, true, now());

    INSERT INTO items (id, "companyId", code, "nameEn", "nameAr", unit, "isStockTracked",
                       "requiresBatch", "useFefo", "allowExpiredIssue",
                       "salePrice", "updatedAt")
    VALUES ('${ITEM}', '${COMPANY}', 'IT-1', 'Milk', 'حليب', 'piece', true,
            true, true, false, 10, now());
  `);
  return db;
}

async function seedLot(
  db: PGlite,
  batchNumber: string,
  quantity: number,
  expiry: string | null,
  unitCost = 5,
) {
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

const batchPolicyItem = {
  id: ITEM,
  code: 'IT-1',
  unit: 'piece',
  isStockTracked: true,
  requiresBatch: true,
  requiresProductionDate: false,
  requiresExpiryDate: false,
  useFefo: true,
  allowExpiredIssue: false,
  expiredIssueNeedsApproval: false,
};

function serviceWith(db: PGlite) {
  const prisma = pglitePrisma(db as never);
  const ledger = new StockLedgerService();
  const audit = {
    record: async () => undefined,
    recordRequired: async () => undefined,
  };
  const service = new BatchesService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    audit as never,
    ledger,
  );
  return { service, prisma, ledger };
}

const remaining = async (db: PGlite, batchId: string) => {
  const rows = await db.query<{ q: string }>(
    `SELECT "remainingQuantity"::text AS q FROM item_batches WHERE id = $1`,
    [batchId],
  );
  return Number(rows.rows[0].q);
};

const shelfQuantity = async (db: PGlite) => {
  const rows = await db.query<{ q: string }>(
    `SELECT quantity::text AS q FROM warehouse_stock_balances
      WHERE "companyId"=$1 AND "branchId"=$2 AND "warehouseId"=$3 AND "itemId"=$4`,
    [COMPANY, BRANCH, WAREHOUSE, ITEM],
  );
  return Number(rows.rows[0]?.q ?? 0);
};

const branchQuantity = async (db: PGlite) => {
  const rows = await db.query<{ q: string }>(
    `SELECT quantity::text AS q FROM stock_balances
      WHERE "companyId"=$1 AND "branchId"=$2 AND "itemId"=$3`,
    [COMPANY, BRANCH, ITEM],
  );
  return Number(rows.rows[0]?.q ?? 0);
};

const movementsFor = async (db: PGlite, referenceId: string) => {
  const rows = await db.query<{ batchId: string; quantity: string }>(
    `SELECT "batchId", quantity::text AS quantity FROM stock_movements
      WHERE "referenceId"=$1 AND direction='OUT' ORDER BY quantity DESC`,
    [referenceId],
  );
  return rows.rows;
};

jest.setTimeout(120_000);

/// PGlite loads its wasm through a dynamic import, which Jest's VM only permits
/// when Node is started with --experimental-vm-modules. Without the flag the
/// failure is an uncaught exception that takes the whole run down, so this suite
/// skips - loudly, naming the command - instead of crashing the rest.
// The flag can arrive either on the command line (npm run already sets it) or
// through NODE_OPTIONS, so both are checked.
const vmLacksDynamicImport = !(
  process.execArgv.includes('--experimental-vm-modules') ||
  (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules')
);

(vmLacksDynamicImport ? describe.skip : describe)(
  'selling out of lots on a real PostgreSQL engine',
  () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await freshDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  it('takes the nearest expiry first (FEFO)', async () => {
    const late = await seedLot(db, 'L-LATE', 100, '2027-12-31');
    const soon = await seedLot(db, 'L-SOON', 100, '2026-12-01');
    const mid = await seedLot(db, 'L-MID', 100, '2027-06-30');
    await seedShelf(db, 300, 1500);

    const { service } = serviceWith(db);
    const result = await service.issueTx(
      pglitePrisma(db as never) as never,
      COMPANY,
      USER,
      { warehouse: { id: WAREHOUSE, branchId: BRANCH }, branchId: BRANCH, item: batchPolicyItem },
      {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        quantity: D(10),
        referenceType: 'SALES_INVOICE',
        referenceId: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        referenceNumber: 'SI-1',
      },
      D(10),
    );

    // The 2026 lot must be the one that moved.
    expect(await remaining(db, soon)).toBe(90);
    expect(await remaining(db, mid)).toBe(100);
    expect(await remaining(db, late)).toBe(100);
    expect(result.lots).toHaveLength(1);
    expect(result.lots[0].batchId).toBe(soon);
  });

  it('splits one line across several lots when the first cannot cover it, and records each lot', async () => {
    const soon = await seedLot(db, 'L-SOON', 4, '2026-12-01');
    const mid = await seedLot(db, 'L-MID', 30, '2027-06-30');
    await seedShelf(db, 34, 170);

    const referenceId = '22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const { service } = serviceWith(db);
    await service.issueTx(
      pglitePrisma(db as never) as never,
      COMPANY,
      USER,
      { warehouse: { id: WAREHOUSE, branchId: BRANCH }, branchId: BRANCH, item: batchPolicyItem },
      {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        quantity: D(10),
        referenceType: 'SALES_INVOICE',
        referenceId,
        referenceNumber: 'SI-2',
      },
      D(10),
    );

    // 4 from the near lot, 6 from the next - and the near lot closed, not deleted.
    expect(await remaining(db, soon)).toBe(0);
    expect(await remaining(db, mid)).toBe(24);

    const moves = await movementsFor(db, referenceId);
    expect(moves).toHaveLength(2);
    const byBatch = Object.fromEntries(moves.map((m) => [m.batchId, Number(m.quantity)]));
    expect(byBatch[soon]).toBe(4);
    expect(byBatch[mid]).toBe(6);

    const status = await db.query<{ status: string }>(
      `SELECT status FROM item_batches WHERE id=$1`,
      [soon],
    );
    expect(status.rows[0].status).toBe('CLOSED');
  });

  it('skips an expired lot and refuses the sale rather than silently shorting it', async () => {
    const expired = await seedLot(db, 'L-OLD', 50, '2025-01-01');
    await seedShelf(db, 50, 250);

    const { service } = serviceWith(db);
    await expect(
      service.issueTx(
        pglitePrisma(db as never) as never,
        COMPANY,
        USER,
        { warehouse: { id: WAREHOUSE, branchId: BRANCH }, branchId: BRANCH, item: batchPolicyItem },
        {
          branchId: BRANCH,
          warehouseId: WAREHOUSE,
          itemId: ITEM,
          quantity: D(5),
          referenceType: 'SALES_INVOICE',
          referenceId: '33333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          referenceNumber: 'SI-3',
        },
        D(5),
      ),
      // The sale is refused because expired stock is all that is left, and that
      // answer is a permission one: 'this needs approval', not 'there is none'.
      // Both leave the shelf untouched.
    ).rejects.toThrow(/متوفرة في دفعات منتهية|only available in expired/i);

    // Nothing moved: a refused sale leaves every lot exactly as it was.
    expect(await remaining(db, expired)).toBe(50);
    expect(await shelfQuantity(db)).toBe(50);
    expect(await branchQuantity(db)).toBe(50);
  });

  it('refuses a sale larger than the valid lots hold, without taking a partial quantity', async () => {
    const soon = await seedLot(db, 'L-SOON', 4, '2026-12-01');
    await seedShelf(db, 4, 20);

    const { service } = serviceWith(db);
    await expect(
      service.issueTx(
        pglitePrisma(db as never) as never,
        COMPANY,
        USER,
        { warehouse: { id: WAREHOUSE, branchId: BRANCH }, branchId: BRANCH, item: batchPolicyItem },
        {
          branchId: BRANCH,
          warehouseId: WAREHOUSE,
          itemId: ITEM,
          quantity: D(9),
          referenceType: 'SALES_INVOICE',
          referenceId: '44444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          referenceNumber: 'SI-4',
        },
        D(9),
      ),
    ).rejects.toThrow();

    expect(await remaining(db, soon)).toBe(4);
    expect(await shelfQuantity(db)).toBe(4);
  });

  it('keeps the lots, the shelf and the branch books in agreement after an issue', async () => {
    const a = await seedLot(db, 'L-A', 6, '2026-12-01');
    const b = await seedLot(db, 'L-B', 20, '2027-06-30');
    await seedShelf(db, 26, 130);

    const { service } = serviceWith(db);
    await service.issueTx(
      pglitePrisma(db as never) as never,
      COMPANY,
      USER,
      { warehouse: { id: WAREHOUSE, branchId: BRANCH }, branchId: BRANCH, item: batchPolicyItem },
      {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        quantity: D(15),
        referenceType: 'SALES_INVOICE',
        referenceId: '55555555-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        referenceNumber: 'SI-5',
      },
      D(15),
    );

    const lotTotal = (await remaining(db, a)) + (await remaining(db, b));
    expect(lotTotal).toBe(11);
    expect(await shelfQuantity(db)).toBe(11);
    expect(await branchQuantity(db)).toBe(11);

    // And the movements account for exactly what left.
    const rows = await db.query<{ total: string }>(
      `SELECT COALESCE(SUM(quantity),0)::text AS total FROM stock_movements
        WHERE "referenceId"=$1 AND direction='OUT'`,
      ['55555555-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    );
    expect(Number(rows.rows[0].total)).toBe(15);
  });

  it('refuses an expired issue sent without an approval, even when the flag is set', async () => {
    const expired = await seedLot(db, 'L-OLD', 20, '2025-01-01');
    await seedShelf(db, 20, 100);

    const { service } = serviceWith(db);
    await expect(
      service.issueTx(
        pglitePrisma(db as never) as never,
        COMPANY,
        USER,
        { warehouse: { id: WAREHOUSE, branchId: BRANCH }, branchId: BRANCH, item: batchPolicyItem },
        {
          branchId: BRANCH,
          warehouseId: WAREHOUSE,
          itemId: ITEM,
          quantity: D(5),
          allowExpired: true, // the bare flag a request body used to be able to send
          referenceType: 'SALES_INVOICE',
          referenceId: '66666666-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          referenceNumber: 'SI-6',
        },
        D(5),
      ),
    ).rejects.toThrow(/اعتماد|approval/i);

    expect(await remaining(db, expired)).toBe(20);
  });

  it('issues an expired lot when an approval travels with the request, and records who, why and when', async () => {
    const expired = await seedLot(db, 'L-OLD', 20, '2025-01-01');
    await seedShelf(db, 20, 100);

    const { service } = serviceWith(db);
    const referenceId = '77777777-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const result = await service.issueTx(
      pglitePrisma(db as never) as never,
      COMPANY,
      USER,
      { warehouse: { id: WAREHOUSE, branchId: BRANCH }, branchId: BRANCH, item: batchPolicyItem },
      {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        quantity: D(5),
        allowExpired: true,
        expiredApproval: { userId: USER, reason: 'Customer insisted; stock still sealed.' },
        referenceType: 'SALES_INVOICE',
        referenceId,
        referenceNumber: 'SI-7',
      },
      D(5),
    );

    expect(await remaining(db, expired)).toBe(15);
    expect(Number(result.expiredQuantity)).toBe(5);
    expect(result.lots[0].expired).toBe(true);
  });

  it('records the unit snapshot on the movement when a line is sold in a non-base unit', async () => {
    const lot = await seedLot(db, 'L-BOX', 1000, '2027-06-01', 5);
    await seedShelf(db, 1000, 5000);

    const { service } = serviceWith(db);
    const referenceId = '88888888-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    // "2 cartons of 500" is 1,000 base units: the ledger moves the base
    // quantity, while the movement keeps what the cashier actually typed.
    // This is the path that was untested - and therefore the one where a
    // missing `stock_movements.enteredUnit` column reached production.
    await service.issueTx(
      pglitePrisma(db as never) as never,
      COMPANY,
      USER,
      { warehouse: { id: WAREHOUSE, branchId: BRANCH }, branchId: BRANCH, item: batchPolicyItem },
      {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        quantity: D(1000),
        referenceType: 'SALES_INVOICE',
        referenceId,
        referenceNumber: 'SI-8',
        movementUnits: {
          enteredUnit: 'carton',
          enteredQuantity: D(2),
          unitFactor: D(500),
          baseUnitName: 'piece',
        },
      },
      D(1000),
    );

    const rows = await db.query<{
      enteredUnit: string | null;
      enteredQuantity: string | null;
      unitFactor: string | null;
      quantity: string;
    }>(
      `SELECT "enteredUnit", "enteredQuantity"::text, "unitFactor"::text, quantity::text
         FROM stock_movements WHERE "referenceId"=$1`,
      [referenceId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].enteredUnit).toBe('carton');
    expect(Number(rows.rows[0].enteredQuantity)).toBe(2);
    expect(Number(rows.rows[0].unitFactor)).toBe(500);
    // The ledger still moved base units, so the lot and the shelf agree.
    expect(Number(rows.rows[0].quantity)).toBe(1000);
    expect(await remaining(db, lot)).toBe(0);
  });

  it('cannot hand out more than a lot holds, even if the request asks twice', async () => {
    const only = await seedLot(db, 'L-ONE', 3, '2027-01-01');
    await seedShelf(db, 6, 30);

    const { service } = serviceWith(db);
    const tx = pglitePrisma(db as never) as never;
    await service.issueTx(
      tx,
      COMPANY,
      USER,
      { warehouse: { id: WAREHOUSE, branchId: BRANCH }, branchId: BRANCH, item: batchPolicyItem },
      {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        quantity: D(3),
        referenceType: 'SALES_INVOICE',
        referenceId: '88888888-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        referenceNumber: 'SI-8',
      },
      D(3),
    );
    expect(await remaining(db, only)).toBe(0);

    // The lot is closed and empty; a second sale of the same 3 must not find it.
    await expect(
      service.issueTx(
        tx,
        COMPANY,
        USER,
        { warehouse: { id: WAREHOUSE, branchId: BRANCH }, branchId: BRANCH, item: batchPolicyItem },
        {
          branchId: BRANCH,
          warehouseId: WAREHOUSE,
          itemId: ITEM,
          quantity: D(3),
          referenceType: 'SALES_INVOICE',
          referenceId: '99999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          referenceNumber: 'SI-9',
        },
        D(3),
      ),
    ).rejects.toThrow();
    expect(await remaining(db, only)).toBe(0);
  });
  },
);

if (vmLacksDynamicImport) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n  SKIPPED: the real-PostgreSQL lot suite needs\n' +
      '    NODE_OPTIONS=--experimental-vm-modules npx jest src/modules/sales/sales-batches.integration.spec.ts\n' +
      '  Without it PGlite cannot load its wasm engine.\n',
  );
}
