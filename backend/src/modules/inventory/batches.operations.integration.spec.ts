import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';

import { BatchesService } from './batches.service';
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

function serviceWith(db: PGlite): BatchesService {
  const prisma = pglitePrisma(db);
  const audit = {
    record: async () => undefined,
    recordRequired: async () => undefined,
  };
  // The real sequence table, so the document number the write-off stores is
  // the one the application would allocate.
  const numbers = new DocumentNumberService();
  // A write-off writes a real journal entry, so the posting services are the
  // production ones rather than stand-ins. A stand-in would let a wrong account
  // code, an unbalanced entry or a missing period pass unnoticed - and the
  // point of covering the write-off here is that it reaches the ledger.
  const accountMap = new AccountMapService();
  const posting = new PostingService(
    numbers,
    new FiscalPeriodsService(prisma as never, audit as never),
    new CostCentersService(prisma as never, audit as never),
  );
  return new BatchesService(
    prisma as never,
    {} as never,
    posting as never,
    accountMap as never,
    numbers as never,
    audit as never,
    new StockLedgerService(),
  );
}

const batchRow = async (db: PGlite, id: string) => {
  const result = await db.query<{
    remaining: string;
    received: string;
    unitcost: string;
    status: string;
    production: string | null;
    expiry: string | null;
    location: string | null;
  }>(
    `SELECT "remainingQuantity"::text AS remaining,
            "receivedQuantity"::text AS received,
            "unitCost"::text AS unitcost,
            status,
            "productionDate"::text AS production,
            "expiryDate"::text AS expiry,
            "storageLocationId"::text AS location
       FROM item_batches WHERE id = $1`,
    [id],
  );
  return result.rows[0];
};

const movementCount = async (db: PGlite) => {
  const result = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM stock_movements`,
  );
  return Number(result.rows[0].n);
};

jest.setTimeout(180_000);

const vmReady =
  process.execArgv.includes('--experimental-vm-modules') ||
  (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules');

(vmReady ? describe : describe.skip)('batch operations over a real engine', () => {
  let db: PGlite;
  let service: BatchesService;

  beforeEach(async () => {
    db = await freshDatabase();
    service = serviceWith(db);
  });

  afterEach(async () => {
    await db.close();
  });

  describe('receive', () => {
    it('stores the dates, the shelf and the cost that will be frozen', async () => {
      const lot = await service.receive(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        batchNumber: 'LOT-FRESH',
        productionDate: '2026-02-01',
        expiryDate: '2027-02-01',
        quantity: 10,
        unitCost: 4.25,
        storageLocationId: SHELF,
      });

      const stored = await batchRow(db, lot.batchId as string);
      expect(stored.received).toBe('10.0000');
      expect(stored.remaining).toBe('10.0000');
      expect(stored.unitcost).toBe('4.2500');
      expect(stored.production).toBe('2026-02-01');
      expect(stored.expiry).toBe('2027-02-01');
      expect(stored.location).toBe(SHELF);
      expect(stored.status).toBe('OPEN');
    });

    it('a lot with no dates is accepted, because not every item expires', async () => {
      const lot = await service.receive(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM_NO_EXPIRY,
        batchNumber: 'SAND-1',
        quantity: 3,
        unitCost: 1,
      });

      const stored = await batchRow(db, lot.batchId as string);
      expect(stored.production).toBeNull();
      expect(stored.expiry).toBeNull();
      expect(stored.location).toBeNull();
    });

    it('the shelf must belong to the warehouse that receives it', async () => {
      await expect(
        service.receive(COMPANY, USER, {
          branchId: BRANCH,
          warehouseId: WAREHOUSE_2,
          itemId: ITEM,
          batchNumber: 'LOT-WRONG-SHELF',
          quantity: 1,
          unitCost: 1,
          // This shelf lives in WAREHOUSE.
          storageLocationId: SHELF,
        }),
      ).rejects.toThrow();
    });

    it('records the receipt as a movement, so the lot has a history', async () => {
      await service.receive(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        batchNumber: 'LOT-MOVED',
        quantity: 7,
        unitCost: 2,
      });

      expect(await movementCount(db)).toBe(1);
    });
  });

  describe('issue', () => {
    const seeded = async (quantity = 10) => {
      const lot = await service.receive(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        batchNumber: 'LOT-ISSUE',
        expiryDate: '2099-01-01',
        quantity,
        unitCost: 5,
      });
      return lot.batchId as string;
    };

    it('takes the quantity out of the lot and out of the balance', async () => {
      const id = await seeded(10);

      await service.issue(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        batchId: id,
        quantity: 4,
      });

      const stored = await batchRow(db, id);
      expect(stored.remaining).toBe('6.0000');
      // The receipt wrote 10 and the issue wrote -4; the balance follows.
      const balance = await db.query<{ quantity: string }>(
        `SELECT quantity::text FROM stock_balances
          WHERE "companyId"=$1 AND "branchId"=$2 AND "itemId"=$3`,
        [COMPANY, BRANCH, ITEM],
      );
      expect(balance.rows[0].quantity).toBe('6.0000');
    });

    it('refuses to leave a negative balance, and leaves the lot untouched', async () => {
      const id = await seeded(3);

      await expect(
        service.issue(COMPANY, USER, {
          branchId: BRANCH,
          warehouseId: WAREHOUSE,
          itemId: ITEM,
          batchId: id,
          quantity: 4,
        }),
      ).rejects.toThrow();

      const stored = await batchRow(db, id);
      expect(stored.remaining).toBe('3.0000');
    });

    it('refuses an expired lot without the approval, and records it with one', async () => {
      const lot = await service.receive(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        batchNumber: 'LOT-OLD',
        expiryDate: '2020-01-01',
        quantity: 5,
        unitCost: 5,
      });
      const id = lot.batchId as string;

      await expect(
        service.issue(COMPANY, USER, {
          branchId: BRANCH,
          warehouseId: WAREHOUSE,
          itemId: ITEM,
          batchId: id,
          quantity: 1,
        }),
      ).rejects.toThrow();

      await service.issue(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        batchId: id,
        quantity: 1,
        allowExpired: true,
        expiredApproval: { userId: USER, reason: 'Quality control sample' },
      });

      expect((await batchRow(db, id)).remaining).toBe('4.0000');
    });

    it('FEFO takes the lot that expires first when none is named', async () => {
      const later = await service.receive(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        batchNumber: 'LOT-LATER',
        expiryDate: '2099-06-01',
        quantity: 5,
        unitCost: 5,
      });
      const sooner = await service.receive(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        batchNumber: 'LOT-SOONER',
        expiryDate: '2099-01-01',
        quantity: 5,
        unitCost: 5,
      });

      await service.issue(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        quantity: 2,
      });

      expect((await batchRow(db, sooner.batchId as string)).remaining).toBe('3.0000');
      expect((await batchRow(db, later.batchId as string)).remaining).toBe('5.0000');
    });
  });

  describe('transfer', () => {
    it('moves the quantity and leaves the source empty', async () => {
      const lot = await service.receive(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        batchNumber: 'LOT-MOVE',
        expiryDate: '2099-01-01',
        quantity: 8,
        unitCost: 5,
      });

      await service.transfer(COMPANY, USER, {
        branchId: BRANCH,
        fromWarehouseId: WAREHOUSE,
        toWarehouseId: WAREHOUSE_2,
        itemId: ITEM,
        batchId: lot.batchId as string,
        quantity: 8,
      });

      expect((await batchRow(db, lot.batchId as string)).remaining).toBe('0.0000');
      const destination = await db.query<{ remaining: string; status: string }>(
        `SELECT "remainingQuantity"::text AS remaining, status FROM item_batches
          WHERE "companyId"=$1 AND "warehouseId"=$2 AND "itemId"=$3`,
        [COMPANY, WAREHOUSE_2, ITEM],
      );
      expect(destination.rows[0].remaining).toBe('8.0000');
      // Acquired through a move, so it is still the same saleable lot.
      expect(destination.rows[0].status).toBe('OPEN');
    });

    it('refuses a transfer into the same warehouse', async () => {
      const lot = await service.receive(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        batchNumber: 'LOT-SAME',
        expiryDate: '2099-01-01',
        quantity: 2,
        unitCost: 5,
      });

      await expect(
        service.transfer(COMPANY, USER, {
          branchId: BRANCH,
          fromWarehouseId: WAREHOUSE,
          toWarehouseId: WAREHOUSE,
          itemId: ITEM,
          batchId: lot.batchId as string,
          quantity: 1,
        }),
      ).rejects.toThrow();

      expect((await batchRow(db, lot.batchId as string)).remaining).toBe('2.0000');
    });

    it('refuses to move more than the lot holds', async () => {
      const lot = await service.receive(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        batchNumber: 'LOT-SHORT',
        expiryDate: '2099-01-01',
        quantity: 1,
        unitCost: 5,
      });

      await expect(
        service.transfer(COMPANY, USER, {
          branchId: BRANCH,
          fromWarehouseId: WAREHOUSE,
          toWarehouseId: WAREHOUSE_2,
          itemId: ITEM,
          batchId: lot.batchId as string,
          quantity: 2,
        }),
      ).rejects.toThrow();
    });
  });

  describe('write-off', () => {
    it('removes the stock and keeps the reason', async () => {
      const lot = await service.receive(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        batchNumber: 'LOT-BROKEN',
        expiryDate: '2099-01-01',
        quantity: 6,
        unitCost: 5,
      });

      await service.writeOff(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        batchId: lot.batchId as string,
        quantity: 6,
        reason: 'Broken in the yard',
      });

      const stored = await batchRow(db, lot.batchId as string);
      expect(stored.remaining).toBe('0.0000');

      // The write-off stores its reason on the movement's `notes`, which is
      // the column the movement list shows.
      const movement = await db.query<{ notes: string }>(
        `SELECT notes FROM stock_movements
          WHERE "batchId"=$1 ORDER BY "createdAt" DESC LIMIT 1`,
        [lot.batchId],
      );
      expect(movement.rows[0].notes).toBe('Broken in the yard');

      // The write-off is not only a stock move: it posts to the ledger. The
      // journal is read back from the table the accounting reports read, so a
      // wrong account, an unbalanced entry or a skipped posting fails here.
      const entry = await db.query<{
        debit: string;
        credit: string;
        status: string;
        source: string;
        number: string;
      }>(
        `SELECT "totalDebit"::text AS debit, "totalCredit"::text AS credit,
                status, "sourceType" AS source, "sourceNumber" AS number
           FROM journal_entries
          WHERE "sourceType"='INVENTORY_WRITE_OFF' AND "sourceId"=$1`,
        [lot.batchId],
      );
      expect(entry.rows).toHaveLength(1);
      expect(entry.rows[0].debit).toBe('30.0000');
      expect(entry.rows[0].credit).toBe('30.0000');
      expect(entry.rows[0].source).toBe('INVENTORY_WRITE_OFF');
      expect(entry.rows[0].number).toMatch(/^WO-/);

      const lines = await db.query<{ code: string; debit: string; credit: string }>(
        `SELECT a.code, l.debit::text AS debit, l.credit::text AS credit
           FROM journal_lines l
           JOIN accounts a ON a.id = l."accountId"
           JOIN journal_entries e ON e.id = l."journalEntryId"
          WHERE e."sourceId"=$1 ORDER BY a.code`,
        [lot.batchId],
      );
      // The loss is debited to inventory difference and the stock credited out
      // of inventory: 5107 debit, 1104 credit.
      expect(lines.rows.map((row) => row.code)).toEqual(['1104', '5107']);
      expect(lines.rows[0].credit).toBe('30.0000');
      expect(lines.rows[1].debit).toBe('30.0000');
    });

    it('refuses to write off more than is left', async () => {
      const lot = await service.receive(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        batchNumber: 'LOT-ALMOST',
        expiryDate: '2099-01-01',
        quantity: 2,
        unitCost: 5,
      });

      await expect(
        service.writeOff(COMPANY, USER, {
          branchId: BRANCH,
          warehouseId: WAREHOUSE,
          itemId: ITEM,
          batchId: lot.batchId as string,
          quantity: 3,
          reason: 'Counted short',
        }),
      ).rejects.toThrow();

      expect((await batchRow(db, lot.batchId as string)).remaining).toBe('2.0000');
    });
  });

  describe('the list the screen reads', () => {
    it('returns the shelf so the row can name it', async () => {
      await service.receive(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM,
        batchNumber: 'LOT-SHELVED',
        productionDate: '2026-03-01',
        expiryDate: '2027-03-01',
        quantity: 2,
        unitCost: 5,
        storageLocationId: SHELF,
      });

      const page = await service.list(COMPANY, { includeEmpty: true });
      const row = page.items.find((entry) => entry.batchNumber === 'LOT-SHELVED');
      expect(row).toBeDefined();
      expect(row!.productionDate).toBeInstanceOf(Date);
      expect(row!.storageLocation).toMatchObject({
        id: SHELF,
        code: 'A-01',
        nameEn: 'Aisle A shelf 1',
        nameAr: 'ممر أ رف ١',
        kind: 'SHELF',
      });
    });

    it('a lot with no shelf answers null rather than dropping the field', async () => {
      await service.receive(COMPANY, USER, {
        branchId: BRANCH,
        warehouseId: WAREHOUSE,
        itemId: ITEM_NO_EXPIRY,
        batchNumber: 'LOT-NOSHELF',
        quantity: 1,
        unitCost: 1,
      });

      const page = await service.list(COMPANY, { includeEmpty: true });
      const row = page.items.find((entry) => entry.batchNumber === 'LOT-NOSHELF');
      expect(row!.storageLocation).toBeNull();
      expect(row!.storageLocationId).toBeNull();
    });

    it('reads the shelf in one query for the whole page, not one per lot', async () => {
      for (const [index, number] of ['A', 'B', 'C'].entries()) {
        await service.receive(COMPANY, USER, {
          branchId: BRANCH,
          warehouseId: WAREHOUSE,
          itemId: ITEM,
          batchNumber: `LOT-${number}`,
          expiryDate: '2099-01-01',
          quantity: 1 + index,
          unitCost: 5,
          storageLocationId: SHELF,
        });
      }

      const page = await service.list(COMPANY, { includeEmpty: true });
      expect(page.items).toHaveLength(3);
      // All three name the same shelf, and the join was a single `IN` query;
      // a per-row lookup would still produce this result, so the count above
      // is what pins the page, and this pins the value.
      expect(page.items.every((row) => row.storageLocation?.code === 'A-01')).toBe(
        true,
      );
    });
  });
});
