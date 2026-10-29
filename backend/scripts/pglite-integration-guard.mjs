/**
 * Real-PostgreSQL integration check for the warehouse-level negative-stock
 * guard (WarehouseService.lockForPosting / availableQuantity /
 * assertWarehouseAvailable).
 *
 * WHAT IS REAL HERE
 * -----------------
 *  - A genuine PostgreSQL engine (PostgreSQL 18.x compiled to WASM, PGlite)
 *    executes the project's own migration SQL files (51 at the time of
 *    writing) on a brand-new empty
 *    database and then executes the exact SQL strings the production service
 *    emits through Prisma.sql (SELECT ... FOR UPDATE and the IN-minus-OUT
 *    SUM). This is NOT SQLite and NOT a mock of the database: the DDL,
 *    enums, uuid casts, row locks, transaction ROLLBACK and the stock_balances
 *    CHECK constraint are all enforced by PostgreSQL itself.
 *  - The production WarehouseService class is imported from the compiled
 *    dist/ output and exercised unmodified, including its BadRequestException.
 *
 * WHAT IS NOT PROVEN HERE
 * -----------------------
 *  - PGlite is embedded and single-connection: it cannot open two independent
 *    blocking sessions, so the D-class cross-connection concurrency test
 *    (two sessions contending on SELECT ... FOR UPDATE) stays BLOCKED until a
 *    networked PostgreSQL is available. A probe at the end documents the
 *    single-writer limitation with real output.
 *  - The Prisma Client/network transport is replaced by a thin adapter that
 *    forwards Prisma.sql to PGlite; the full Nest+Prisma+server stack is not
 *    exercised here (covered only by Jest unit tests with mocks).
 *
 * Run:
 *   npm run build
 *   npm i --no-save @electric-sql/pglite@0.5.13
 *   node scripts/pglite-integration-guard.mjs
 * Exit code 0 only if every check passes.
 */
import { readdirSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { PGlite } from '@electric-sql/pglite';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { WarehouseService } from '../dist/src/common/warehouse/warehouse.service.js';

const D = (v) => new Prisma.Decimal(v);

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const W_SRC = '55555555-5555-4555-8555-555555555555';
const W_DST = '66666666-6666-4666-8666-666666666666';
const ITEM = '77777777-7777-4777-8777-777777777777';

const results = [];
async function check(label, fn) {
  try {
    const detail = await fn();
    results.push({ label, status: 'PASS', detail: detail ?? '' });
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    results.push({ label, status: 'FAIL', detail: e.message });
    console.log(`  FAIL  ${label} — ${e.message}`);
  }
}

/** Render a Prisma.sql tagged object to PGlite's (text, params) contract. */
function pgliteTx(db) {
  return {
    $queryRaw: async (sql) => {
      let text = '';
      sql.strings.forEach((part, i) => {
        text += part;
        if (i < sql.values.length) text += `$${i + 1}`;
      });
      const res = await db.query(text, sql.values);
      return res.rows;
    },
  };
}

const migrationsDir = join('prisma', 'migrations');

async function main() {
  const db = new PGlite();
  const version = (await db.query('select version()')).rows[0].version;
  console.log(`Engine: ${version}\n`);

  // ---- 1. Fresh-database migration run (real DDL, real PostgreSQL) --------
  // Prisma's @updatedAt is enforced by the client, not by a database default,
  // so the harness counts migration.sql files explicitly rather than dirs.
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const migrationFiles = dirs.filter((dir) => {
    try {
      readFileSync(join(migrationsDir, dir, 'migration.sql'), 'utf8');
      return true;
    } catch {
      return false;
    }
  });
  let applied = 0;
  for (const dir of migrationFiles) {
    const sql = readFileSync(join(migrationsDir, dir, 'migration.sql'), 'utf8');
    await db.exec(sql); // throws (and fails the run) on any DDL error
    applied += 1;
  }
  await check(`all ${migrationFiles.length} migration files apply on a fresh empty database`, () => {
    if (applied !== migrationFiles.length) {
      throw new Error(`applied ${applied} of ${migrationFiles.length}`);
    }
    return `${applied}/${migrationFiles.length}`;
  });

  const constraint = await db.query(
    `select conname from pg_constraint where conname = 'stock_balances_quantity_nonnegative'`,
  );
  await check('stock_balances nonnegative CHECK constraint exists after migrations', () => {
    if (constraint.rows.length !== 1) throw new Error('constraint missing');
    return constraint.rows[0].conname;
  });

  // ---- 2. Seed the exact reported-defect shape ----------------------------
  // Branch total 20 (4 left in source + 16 in destination): a 5-unit transfer
  // is covered by the branch total while the source warehouse holds only 4.
  // @updatedAt is a Prisma-client rule, so raw SQL must set "updatedAt" itself.
  await db.query(
    `insert into companies (id, code, "nameEn", "nameAr", "updatedAt")
     values ($1, 'C1', 'Kayan', 'كيان', now())`,
    [COMPANY],
  );
  await db.query(
    `insert into branches (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
     values ($1, $2, 'B1', 'Branch', 'الفرع', now())`,
    [BRANCH, COMPANY],
  );
  await db.query(
    `insert into warehouses (id, "companyId", "branchId", code, "nameEn", "nameAr", "updatedAt")
     values ($1,$2,$3,'WS','Source','مصدر',now()), ($4,$2,$3,'WD','Destination','وجهة',now())`,
    [W_SRC, COMPANY, BRANCH, W_DST],
  );
  await db.query(
    `insert into items (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
     values ($1,$2,'MILK','Milk','لبن',now())`,
    [ITEM, COMPANY],
  );
  await db.query(
    `insert into stock_balances ("companyId","branchId","itemId",quantity,value,"updatedAt")
     values ($1,$2,$3,20,150,now())`,
    [COMPANY, BRANCH, ITEM],
  );
  const seedMovement = (warehouseId, direction, quantity) =>
    db.query(
      `insert into stock_movements
        (id,"companyId","branchId","warehouseId","itemId","movementDate",direction,quantity,"unitCost","totalCost","referenceType")
       values (gen_random_uuid(),$1,$2,$3,$4,'2026-10-01',$5,$6,7.5,$7,'SEED')`,
      [COMPANY, BRANCH, warehouseId, ITEM, direction, quantity, Number(quantity) * 7.5],
    );
  await seedMovement(W_SRC, 'IN', 20);
  await seedMovement(W_SRC, 'OUT', 16);
  await seedMovement(W_DST, 'IN', 16);

  const service = new WarehouseService({}, {});
  const tx = pgliteTx(db);

  // ---- 3. Guard behaviour against the real engine -------------------------
  await check('availableQuantity uses real IN-minus-OUT SUM: source warehouse = 4', async () => {
    const qty = await service.availableQuantity(tx, COMPANY, W_SRC, ITEM);
    if (qty.toString() !== '4') throw new Error(`got ${qty.toString()}`);
    return qty.toFixed(4);
  });

  await check('destination warehouse independently reports 16 (same branch, separate pile)', async () => {
    const qty = await service.availableQuantity(tx, COMPANY, W_DST, ITEM);
    if (qty.toString() !== '16') throw new Error(`got ${qty.toString()}`);
    return qty.toFixed(4);
  });

  await check('SELECT ... FOR UPDATE row lock is accepted by PostgreSQL', async () => {
    await service.lockForPosting(tx, COMPANY, W_SRC);
    return 'locked without error';
  });

  await check('requesting 5 from a warehouse holding 4 throws BadRequestException', async () => {
    const before = (await db.query(`select count(*)::int as n from stock_movements`)).rows[0].n;
    let threw = null;
    try {
      await service.assertWarehouseAvailable({
        tx,
        companyId: COMPANY,
        warehouseId: W_SRC,
        itemId: ITEM,
        quantity: D(5),
        allowNegative: false,
        reference: 'ST-000001',
      });
    } catch (e) {
      threw = e;
    }
    if (!(threw instanceof BadRequestException)) throw new Error('no BadRequestException');
    if (!/selected warehouse/.test(threw.message)) throw new Error(`message: ${threw.message}`);
    const after = (await db.query(`select count(*)::int as n from stock_movements`)).rows[0].n;
    if (after !== before) throw new Error(`movement count changed ${before} -> ${after}`);
    return threw.message;
  });

  await check('exact-balance request (4 of 4) is allowed', async () => {
    await service.assertWarehouseAvailable({
      tx,
      companyId: COMPANY,
      warehouseId: W_SRC,
      itemId: ITEM,
      quantity: D(4),
      allowNegative: false,
      reference: 'ST-000002',
    });
    return 'resolved';
  });

  await check('allowNegative=true bypasses the guard even for 999 units', async () => {
    await service.assertWarehouseAvailable({
      tx,
      companyId: COMPANY,
      warehouseId: W_SRC,
      itemId: ITEM,
      quantity: D(999),
      allowNegative: true,
      reference: 'ST-000003',
    });
    return 'no-op as designed';
  });

  await check('missing warehouseId keeps the no-op branch (branch guard/CHECK stay the backstop)', async () => {
    await service.assertWarehouseAvailable({
      tx,
      companyId: COMPANY,
      warehouseId: null,
      itemId: ITEM,
      quantity: D(999),
      allowNegative: false,
      reference: 'ST-000004',
    });
    return 'no-op as designed';
  });

  // ---- 4. Real transaction semantics --------------------------------------
  await check('ROLLBACK undoes an OUT movement inside a real PostgreSQL transaction', async () => {
    await db.exec('begin');
    await db.query(
      `insert into stock_movements
        (id,"companyId","branchId","warehouseId","itemId","movementDate",direction,quantity,"unitCost","totalCost","referenceType")
       values (gen_random_uuid(),$1,$2,$3,$4,'2026-10-02','OUT',7,7.5,52.5,'ROLLBACK_PROBE')`,
      [COMPANY, BRANCH, W_SRC, ITEM],
    );
    await db.exec('rollback');
    const qty = await service.availableQuantity(tx, COMPANY, W_SRC, ITEM);
    if (qty.toString() !== '4') throw new Error(`post-rollback quantity ${qty.toString()}`);
    return 'quantity still 4';
  });

  await check('COMMIT persists an OUT movement and the SUM drops to 0', async () => {
    await db.exec('begin');
    await db.query(
      `insert into stock_movements
        (id,"companyId","branchId","warehouseId","itemId","movementDate",direction,quantity,"unitCost","totalCost","referenceType")
       values (gen_random_uuid(),$1,$2,$3,$4,'2026-10-03','OUT',4,7.5,30,'COMMIT_PROBE')`,
      [COMPANY, BRANCH, W_SRC, ITEM],
    );
    await db.exec('commit');
    const qty = await service.availableQuantity(tx, COMPANY, W_SRC, ITEM);
    if (qty.toString() !== '0') throw new Error(`post-commit quantity ${qty.toString()}`);
    return 'quantity now 0';
  });

  await check('stock_balances CHECK rejects a negative branch balance at the database layer', async () => {
    let code = null;
    try {
      await db.query(`update stock_balances set quantity = -1 where "companyId" = $1`, [COMPANY]);
    } catch (e) {
      code = e.code;
    }
    if (code !== '23514') throw new Error(`expected check_violation 23514, got ${code}`);
    return 'SQLSTATE 23514';
  });

  await db.close();

  // ---- 5. Concurrency limitation evidence (D-class test stays BLOCKED) ----
  // Prove, rather than assume, why PGlite cannot stand in for a networked
  // PostgreSQL: two embedded engines share a data directory but not a lock
  // manager. With real server PostgreSQL the second UPDATE would block on
  // A's SELECT ... FOR UPDATE; here it returns immediately and even observes
  // its own uncommitted write. Recorded evidence for the BLOCKED classification.
  const dir = join(tmpdir(), `pglite-concurrency-probe-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const first = new PGlite(dir);
  await first.waitReady;
  await first.query('create table lock_probe (id int primary key, v int)');
  await first.query('insert into lock_probe values (1, 10)');
  await first.query('begin');
  await first.query('select * from lock_probe where id = 1 for update');

  const second = new PGlite(dir);
  await second.waitReady;
  const started = Date.now();
  let blocked = true;
  await Promise.race([
    second
      .query('update lock_probe set v = 20 where id = 1')
      .then(() => {
        blocked = false;
      }),
    new Promise((resolve) => setTimeout(resolve, 4000)),
  ]);
  const elapsedMs = Date.now() - started;
  await first.query('rollback');
  await first.close();
  await second.close();
  rmSync(dir, { recursive: true, force: true });
  await check(
    'PGlite exhibits no cross-session FOR UPDATE blocking (D-class concurrency test needs server PostgreSQL)',
    () => {
      if (blocked) throw new Error('PGlite unexpectedly serialised the two engines — re-check classification');
      return `second engine updated a FOR UPDATE-locked row after ${elapsedMs}ms without waiting`;
    },
  );

  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} integration checks passed on real PostgreSQL (PGlite).`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Integration harness error:', e);
  process.exit(1);
});
