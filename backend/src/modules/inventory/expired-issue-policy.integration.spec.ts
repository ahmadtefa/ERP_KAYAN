import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PGlite } from '@electric-sql/pglite';

import { BatchesService } from './batches.service';
import { StockLedgerService } from '../../common/warehouse/stock-ledger.service';
import { pglitePrisma } from '../../testing/pglite-adapter';

/// Who may issue expired stock, against a real PostgreSQL engine.
///
/// This spec exists because of two defects in the same guard.
///
/// The first: an item whose own policy said `allowExpiredIssue: true` could be
/// issued past its expiry date with no approval at all. The guard was written
///
///     if (allowExpired && (input.allowExpired ?? false)) { ...ask for approval... }
///
/// so when the policy opened the gate and the request carried no
/// `allowExpired` of its own, the second half was false and the approval was
/// never looked for. An item policy is a standing decision about how an item is
/// tracked; it is not a person agreeing to sell out-of-date goods today.
///
/// The second, found while writing the first test: a *blanket* refusal further
/// down threw whenever the chosen lots included expired stock and the item's
/// `expiredIssueNeedsApproval` was on - so that item could never issue expired
/// stock even with a complete, recorded approval. The flag that says "ask
/// somebody" made asking pointless.
///
/// The tests drive the production `BatchesService.issueTx` over a schema built
/// from the project's own migration files - real CHECK constraints, real
/// conditional UPDATEs - and assert on the rows afterwards, so a refusal that
/// forgot to roll back shows up as a stock discrepancy rather than passing.
///
/// These need PGlite's wasm engine, so they run under `npm run test:lots`
/// (NODE_OPTIONS=--experimental-vm-modules). Without it the suite skips, loudly.

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const WAREHOUSE = '44444444-4444-4444-8444-444444444444';
const ITEM = '55555555-5555-4555-8555-555555555555';

const migrationsDir = join(process.cwd(), 'prisma', 'migrations');

interface Policy {
  allowExpiredIssue: boolean;
  expiredIssueNeedsApproval: boolean;
}

async function freshDatabase(policy: Policy): Promise<PGlite> {
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
    VALUES ('${WAREHOUSE}', '${COMPANY}', '${BRANCH}', 'W1', 'Main', 'رئيسي', true, true, now());

    INSERT INTO items (id, "companyId", code, "nameEn", "nameAr", unit, "isStockTracked",
                       "requiresBatch", "useFefo", "allowExpiredIssue",
                       "expiredIssueNeedsApproval", "salePrice", "updatedAt")
    VALUES ('${ITEM}', '${COMPANY}', 'IT-1', 'Milk', 'حليب', 'piece', true,
            true, true, ${policy.allowExpiredIssue},
            ${policy.expiredIssueNeedsApproval}, 10, now());
  `);
  return db;
}

/// One lot that went out of date yesterday, with shelves that agree it is there.
async function seedExpiredLot(db: PGlite, quantity = 10): Promise<string> {
  const id = crypto.randomUUID();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await db.query(
    `INSERT INTO item_batches
       (id,"companyId","branchId","warehouseId","itemId","batchNumber","expiryDate",
        "receivedQuantity","remainingQuantity","unitCost","status","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,'L-OLD',$6,$7,$7,5,'OPEN',now(),now())`,
    [id, COMPANY, BRANCH, WAREHOUSE, ITEM, yesterday, quantity],
  );
  await db.query(
    `INSERT INTO stock_balances ("companyId","branchId","itemId",quantity,value,"updatedAt")
     VALUES ($1,$2,$3,$4,$5,now())`,
    [COMPANY, BRANCH, ITEM, quantity, quantity * 5],
  );
  await db.query(
    `INSERT INTO warehouse_stock_balances ("companyId","branchId","warehouseId","itemId",quantity,value,"updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,now())`,
    [COMPANY, BRANCH, WAREHOUSE, ITEM, quantity, quantity * 5],
  );
  return id;
}

/// A lot that is still good, to prove the guard only fires on expired stock.
///
/// Adds to the shelves rather than replacing them, so a spec can hold an
/// expired lot and a fresh one side by side.
async function seedFreshLot(db: PGlite, quantity = 10, batchNumber = 'L-NEW'): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO item_batches
       (id,"companyId","branchId","warehouseId","itemId","batchNumber","expiryDate",
        "receivedQuantity","remainingQuantity","unitCost","status","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,'2099-12-31',$7,$7,5,'OPEN',now(),now())`,
    [id, COMPANY, BRANCH, WAREHOUSE, ITEM, batchNumber, quantity],
  );
  await db.query(
    `INSERT INTO stock_balances ("companyId","branchId","itemId",quantity,value,"updatedAt")
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT ("companyId","branchId","itemId")
     DO UPDATE SET quantity = stock_balances.quantity + EXCLUDED.quantity,
                   value    = stock_balances.value    + EXCLUDED.value,
                   "updatedAt" = now()`,
    [COMPANY, BRANCH, ITEM, quantity, quantity * 5],
  );
  await db.query(
    `INSERT INTO warehouse_stock_balances ("companyId","branchId","warehouseId","itemId",quantity,value,"updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,now())
     ON CONFLICT ("companyId","branchId","warehouseId","itemId")
     DO UPDATE SET quantity = warehouse_stock_balances.quantity + EXCLUDED.quantity,
                   value    = warehouse_stock_balances.value    + EXCLUDED.value,
                   "updatedAt" = now()`,
    [COMPANY, BRANCH, WAREHOUSE, ITEM, quantity, quantity * 5],
  );
  return id;
}

function serviceWith(db: PGlite, policy: Policy) {
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
  const item = {
    id: ITEM,
    code: 'IT-1',
    unit: 'piece',
    isStockTracked: true,
    requiresBatch: true,
    requiresProductionDate: false,
    requiresExpiryDate: false,
    useFefo: true,
    allowExpiredIssue: policy.allowExpiredIssue,
    expiredIssueNeedsApproval: policy.expiredIssueNeedsApproval,
  };
  return { service, prisma: prisma as never, item };
}

interface IssueOptions {
  quantity?: number;
  allowExpired?: boolean;
  expiredApproval?: { userId: string; reason: string };
}

const issue = (ctx: ReturnType<typeof serviceWith>, options: IssueOptions = {}) => {
  const quantity = options.quantity ?? 4;
  return ctx.service.issueTx(
    ctx.prisma,
    COMPANY,
    USER,
    { warehouse: { id: WAREHOUSE, branchId: BRANCH }, branchId: BRANCH, item: ctx.item as never },
    {
      branchId: BRANCH,
      warehouseId: WAREHOUSE,
      itemId: ITEM,
      quantity: new Prisma.Decimal(quantity),
      referenceType: 'TEST',
      ...(options.allowExpired === undefined ? {} : { allowExpired: options.allowExpired }),
      ...(options.expiredApproval === undefined
        ? {}
        : { expiredApproval: options.expiredApproval }),
    } as never,
    new Prisma.Decimal(quantity),
  );
};

const remaining = async (db: PGlite, batchId: string): Promise<number> => {
  const rows = await db.query<{ q: string }>(
    `SELECT "remainingQuantity"::text AS q FROM item_batches WHERE id = $1`,
    [batchId],
  );
  return Number(rows.rows[0].q);
};

const shelf = async (db: PGlite): Promise<number> => {
  const rows = await db.query<{ q: string }>(
    `SELECT quantity::text AS q FROM warehouse_stock_balances
      WHERE "companyId"=$1 AND "branchId"=$2 AND "warehouseId"=$3 AND "itemId"=$4`,
    [COMPANY, BRANCH, WAREHOUSE, ITEM],
  );
  return Number(rows.rows[0]?.q ?? 0);
};

jest.setTimeout(180_000);

const vmReady =
  process.execArgv.includes('--experimental-vm-modules') ||
  (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules');

(vmReady ? describe : describe.skip)('issuing expired stock always needs a recorded approval', () => {
  let db: PGlite;

  afterEach(async () => {
    await db.close();
  });

  describe('an item policy that permits expired handling', () => {
    const permitting: Policy = { allowExpiredIssue: true, expiredIssueNeedsApproval: false };

    beforeEach(async () => {
      db = await freshDatabase(permitting);
    });

    // The regression this suite was written for: the policy alone opened the
    // gate, and the issue went through with nobody's name on it.
    it('refuses to reach for the expired lot when no approval travels', async () => {
      const lot = await seedExpiredLot(db);
      const ctx = serviceWith(db, permitting);

      await expect(issue(ctx)).rejects.toBeInstanceOf(ForbiddenException);

      expect(await remaining(db, lot)).toBe(10);
      expect(await shelf(db)).toBe(10);
    });

    it('gives the same answer when the caller sends the flag alone', async () => {
      const lot = await seedExpiredLot(db);
      const ctx = serviceWith(db, permitting);

      // A forged request body carries exactly this, and nothing else.
      await expect(issue(ctx, { allowExpired: true })).rejects.toBeInstanceOf(ForbiddenException);

      expect(await remaining(db, lot)).toBe(10);
      expect(await shelf(db)).toBe(10);
    });

    // The behaviour that matters most in a shop: an old lot sitting in front of
    // good stock must not stop a cashier selling the good stock.
    it('sells the fresh lot behind an expired one without asking anybody', async () => {
      const expired = await seedExpiredLot(db, 10);
      const fresh = await seedFreshLot(db, 10);
      const ctx = serviceWith(db, permitting);

      await issue(ctx, { quantity: 4 });

      expect(await remaining(db, expired)).toBe(10);
      expect(await remaining(db, fresh)).toBe(6);
      expect(await shelf(db)).toBe(16);
    });

    it('refuses an approval whose reason is blank', async () => {
      const lot = await seedExpiredLot(db);
      const ctx = serviceWith(db, permitting);

      await expect(
        issue(ctx, { expiredApproval: { userId: USER, reason: '   ' } }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(await remaining(db, lot)).toBe(10);
    });

    it('refuses an approval with no person attached', async () => {
      const lot = await seedExpiredLot(db);
      const ctx = serviceWith(db, permitting);

      await expect(
        issue(ctx, { expiredApproval: { userId: '', reason: 'customer accepted it' } }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(await remaining(db, lot)).toBe(10);
    });

    it('issues once a named approver and a reason are recorded', async () => {
      const lot = await seedExpiredLot(db);
      const ctx = serviceWith(db, permitting);

      const result = await issue(ctx, {
        expiredApproval: { userId: USER, reason: 'customer accepted short-dated stock' },
      });

      expect(await remaining(db, lot)).toBe(6);
      expect(await shelf(db)).toBe(6);
      expect(Number(result.expiredQuantity)).toBe(4);
    });
  });

  describe('an item policy that forbids expired handling', () => {
    const forbidding: Policy = { allowExpiredIssue: false, expiredIssueNeedsApproval: false };

    beforeEach(async () => {
      db = await freshDatabase(forbidding);
    });

    it('never reaches for the expired lot on its own', async () => {
      const lot = await seedExpiredLot(db);
      const ctx = serviceWith(db, forbidding);

      // Only dated stock is left, so the answer is the permission one: this is
      // available, but not to a caller who cannot approve it.
      await expect(issue(ctx)).rejects.toBeInstanceOf(ForbiddenException);

      expect(await remaining(db, lot)).toBe(10);
      expect(await shelf(db)).toBe(10);
    });

    it('reports a plain shortfall when the expired lot cannot cover it either', async () => {
      const lot = await seedExpiredLot(db, 2);

      // Asking for 10 when 2 exist, all expired: no approval would have made
      // this possible, so the message is not about permission.
      const ctx = serviceWith(db, forbidding);
      await expect(issue(ctx, { quantity: 10 })).rejects.toBeInstanceOf(BadRequestException);

      expect(await remaining(db, lot)).toBe(2);
    });

    it('issues the expired lot when a recorded approval overrides the policy', async () => {
      const lot = await seedExpiredLot(db);
      const ctx = serviceWith(db, forbidding);

      // The sales-invoice route does exactly this: it checks
      // `inventory.batches.expired.issue` and passes both halves together.
      await issue(ctx, {
        allowExpired: true,
        expiredApproval: { userId: USER, reason: 'write-off approved by the owner' },
      });

      expect(await remaining(db, lot)).toBe(6);
      expect(await shelf(db)).toBe(6);
    });

    it('cannot be overridden by the flag without an approval', async () => {
      const lot = await seedExpiredLot(db);
      const ctx = serviceWith(db, forbidding);

      // Sending the flag claims permission to handle dated stock, so the answer
      // is "that needs an approval" rather than "there is none" - the operator
      // is told which of the two things is missing.
      await expect(issue(ctx, { allowExpired: true })).rejects.toBeInstanceOf(ForbiddenException);

      expect(await remaining(db, lot)).toBe(10);
    });
  });

  describe('an item whose policy says an expired issue needs approval', () => {
    const asksForApproval: Policy = { allowExpiredIssue: true, expiredIssueNeedsApproval: true };

    beforeEach(async () => {
      db = await freshDatabase(asksForApproval);
    });

    // The second defect: this used to be refused *whatever* the caller sent,
    // because a blanket check threw on any expired quantity. The flag that asks
    // for an approver made approval impossible rather than required.
    it('issues once that approval is actually there', async () => {
      const lot = await seedExpiredLot(db);
      const ctx = serviceWith(db, asksForApproval);

      await issue(ctx, {
        allowExpired: true,
        expiredApproval: { userId: USER, reason: 'quality checked and released for sale' },
      });

      expect(await remaining(db, lot)).toBe(6);
      expect(await shelf(db)).toBe(6);
    });

    it('still refuses without one', async () => {
      const lot = await seedExpiredLot(db);
      const ctx = serviceWith(db, asksForApproval);

      await expect(issue(ctx, { allowExpired: true })).rejects.toBeInstanceOf(ForbiddenException);

      expect(await remaining(db, lot)).toBe(10);
    });
  });
});

if (!vmReady) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n  SKIPPED: the expired-issue policy suite needs\n' +
      '    npm run test:lots\n' +
      '  (it sets NODE_OPTIONS=--experimental-vm-modules, without which PGlite cannot load its wasm engine).\n',
  );
}
