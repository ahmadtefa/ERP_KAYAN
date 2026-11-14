import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PGlite } from '@electric-sql/pglite';

import { BatchesService } from './batches.service';
import { StockLedgerService } from '../../common/warehouse/stock-ledger.service';
import { pglitePrisma } from '../../testing/pglite-adapter';

/// Receiving the same item more than once, and keeping the lots apart.
///
/// The requirement names this first: several lots of one item, each with its
/// own expiry, and shelves that agree with them afterwards. Nothing tested it
/// end to end before - the existing lot specs started from a seeded lot and
/// asked what could be issued from it, never whether two receipts of the same
/// item produced two lots with two dates and one correct total.
///
/// These run the production `receive` path over a schema built from the
/// project's own migration files, so a constraint that would reject the second
/// receipt fails here rather than in an operator's hands.
///
/// They need PGlite's wasm engine and therefore `npm run test:lots`
/// (NODE_OPTIONS=--experimental-vm-modules). Without it the suite skips.

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const WAREHOUSE = '44444444-4444-4444-8444-444444444444';
const OTHER_WAREHOUSE = '44444444-4444-4444-8444-444444444445';
const ITEM = '55555555-5555-4555-8555-555555555555';

const migrationsDir = join(process.cwd(), 'prisma', 'migrations');

async function freshDatabase(): Promise<PGlite> {
  // Imported lazily so the suite skips cleanly when the wasm module is absent.
  const { PGlite: Engine } = await import('@electric-sql/pglite');
  const db = new Engine();
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
    VALUES ('${WAREHOUSE}', '${COMPANY}', '${BRANCH}', 'W1', 'Main', 'رئيسي', true, true, now());

    INSERT INTO warehouses (id, "companyId", "branchId", code, "nameEn", "nameAr", "isDefault", "isActive", "updatedAt")
    VALUES ('${OTHER_WAREHOUSE}', '${COMPANY}', '${BRANCH}', 'W2', 'Second', 'ثانٍ', false, true, now());

    INSERT INTO items (id, "companyId", code, "nameEn", "nameAr", unit, "isStockTracked",
                       "requiresBatch", "useFefo", "allowExpiredIssue",
                       "expiredIssueNeedsApproval", "salePrice", "updatedAt")
    VALUES ('${ITEM}', '${COMPANY}', 'IT-1', 'Milk', 'حليب', 'piece', true,
            true, true, false, true, 10, now());
  `);
  return db;
}

function serviceWith(db: PGlite) {
  const prisma = pglitePrisma(db as never);
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
    new StockLedgerService(),
  );
  return { service, prisma: prisma as never };
}

const daysFromNow = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const vmReady = (process.env.NODE_OPTIONS ?? '').includes(
  '--experimental-vm-modules',
);

(vmReady ? describe : describe.skip)(
  'receiving the same item more than once keeps the lots apart',
  () => {
    let db: PGlite;
    let service: BatchesService;

    beforeEach(async () => {
      db = await freshDatabase();
      service = serviceWith(db).service;
    });

    afterEach(async () => {
      await db.close();
    });

    it('creates a separate lot per receipt, each with its own expiry', async () => {
      const first = await service.receive(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        batchNumber: 'L-A',
        expiryDate: daysFromNow(30),
        quantity: 10,
        unitCost: 5,
      });
      const second = await service.receive(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        batchNumber: 'L-B',
        expiryDate: daysFromNow(90),
        quantity: 4,
        unitCost: 6,
      });

      expect(first.batchId).not.toEqual(second.batchId);

      const lots = await db.query<{
        batchNumber: string;
        expiryDate: string;
        receivedQuantity: string;
        remainingQuantity: string;
        unitCost: string;
      }>(
        `SELECT "batchNumber", "expiryDate", "receivedQuantity", "remainingQuantity", "unitCost"
           FROM item_batches WHERE "itemId" = $1 ORDER BY "batchNumber"`,
        [ITEM],
      );
      expect(lots.rows).toHaveLength(2);
      const byNumber = new Map(lots.rows.map((row) => [row.batchNumber, row]));
      // Each lot keeps the quantity and the cost of its own receipt: a shared
      // lot would have mixed two prices into one and valued the stock wrongly.
      expect(Number(byNumber.get('L-A')!.remainingQuantity)).toBe(10);
      expect(Number(byNumber.get('L-A')!.unitCost)).toBe(5);
      expect(Number(byNumber.get('L-B')!.remainingQuantity)).toBe(4);
      expect(Number(byNumber.get('L-B')!.unitCost)).toBe(6);
      expect(byNumber.get('L-A')!.expiryDate).not.toEqual(
        byNumber.get('L-B')!.expiryDate,
      );
    });

    it('adds the receipts into one shelf balance instead of a balance per lot', async () => {
      await service.receive(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        batchNumber: 'L-A',
        expiryDate: daysFromNow(30),
        quantity: 10,
        unitCost: 5,
      });
      await service.receive(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        batchNumber: 'L-B',
        expiryDate: daysFromNow(90),
        quantity: 4,
        unitCost: 6,
      });

      const shelf = await db.query<{ quantity: string; value: string }>(
        `SELECT quantity, value FROM warehouse_stock_balances
          WHERE "warehouseId" = $1 AND "itemId" = $2`,
        [WAREHOUSE, ITEM],
      );
      expect(shelf.rows).toHaveLength(1);
      expect(Number(shelf.rows[0].quantity)).toBe(14);
      // 10 x 5 + 4 x 6 = 74
      expect(Number(shelf.rows[0].value)).toBe(74);
    });

    it('keeps a receipt in one warehouse out of the other warehouse', async () => {
      await service.receive(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        batchNumber: 'L-A',
        expiryDate: daysFromNow(30),
        quantity: 10,
        unitCost: 5,
      });
      await service.receive(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: OTHER_WAREHOUSE,
        itemId: ITEM,
        batchNumber: 'L-B',
        expiryDate: daysFromNow(90),
        quantity: 4,
        unitCost: 6,
      });

      const shelves = await db.query<{ warehouseId: string; quantity: string }>(
        `SELECT "warehouseId", quantity FROM warehouse_stock_balances
          WHERE "itemId" = $1 ORDER BY "warehouseId"`,
        [ITEM],
      );
      expect(shelves.rows).toHaveLength(2);
      const byWarehouse = new Map(
        shelves.rows.map((row) => [row.warehouseId, Number(row.quantity)]),
      );
      expect(byWarehouse.get(WAREHOUSE)).toBe(10);
      expect(byWarehouse.get(OTHER_WAREHOUSE)).toBe(4);

      // The branch total is the sum, and the two lots still name their own
      // shelves: a transfer must not have to guess which lot came from where.
      const total = await db.query<{ quantity: string }>(
        `SELECT quantity FROM stock_balances WHERE "itemId" = $1`,
        [ITEM],
      );
      expect(total.rows).toHaveLength(1);
      expect(Number(total.rows[0].quantity)).toBe(14);
    });

    it('refuses a receipt that would let a lot hold less than it received', async () => {
      await service.receive(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        batchNumber: 'L-A',
        expiryDate: daysFromNow(30),
        quantity: 10,
        unitCost: 5,
      });
      await expect(
        db.query(
          `UPDATE item_batches SET "remainingQuantity" = 11 WHERE "batchNumber" = 'L-A'`,
        ),
      ).rejects.toThrow();
    });
  },
);
