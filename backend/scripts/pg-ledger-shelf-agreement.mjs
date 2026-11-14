/**
 * REAL PostgreSQL guard: `stock_movements` and `warehouse_stock_balances` must
 * tell the same story about every shelf.
 *
 * WHY THIS EXISTS
 * ---------------
 * Purchase invoices used to write `stock_movements` and hand-update
 * `stock_balances`, while never touching `warehouse_stock_balances`. The branch
 * book therefore said 10 and the shelf book said nothing, so every transfer or
 * sale out of that shelf was refused with "0.0000 available" while the warehouse
 * report cheerfully displayed 10. Nothing in the test suite noticed, because
 * each test checked one book or the other.
 *
 * This guard compares the two after real posting activity, through the real
 * service code, on a real server:
 *
 *   for every (company, branch, warehouse, item) that appears in either table:
 *       SUM(IN - OUT) over stock_movements  ==  warehouse_stock_balances.quantity
 *
 * It also fails on a shelf row that exists with stock but has no movement to
 * explain it, which is the mirror image of the same defect.
 *
 * A missing movement row for a movement-free shelf row is reported too, so a
 * future workflow cannot start writing the shelf book and forget the ledger the
 * reports read.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/pg-ledger-shelf-agreement.mjs
 *       Needs a database this guard may write to (a fresh, empty one). Posts a
 *       receipt, a transfer and a deliberate orphan movement through the real
 *       service code and reconciles the two books after each step.
 *
 *   DATABASE_URL=... node scripts/pg-ledger-shelf-agreement.mjs --audit
 *       Read-only. Writes nothing. Reconciles the two books as they stand, for
 *       a database that already holds an installation's data - run this one
 *       against a customer's copied database after an upgrade.
 *
 * Exit code 0 only when every shelf agrees.
 */
import { randomUUID } from 'node:crypto';

import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { StockLedgerService } from '../dist/src/common/warehouse/stock-ledger.service.js';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error('DATABASE_URL is required');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
const ledger = new StockLedgerService();
const dec = (value) => new Prisma.Decimal(value);

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
};

/// Every shelf, keyed the way both tables agree on, with the two figures that
/// must match. A shelf present in only one of the tables still appears, with
/// the other side read as zero, which is exactly the shape of the bug.
async function disagreements() {
  return prisma.$queryRaw`
    WITH movements AS (
      SELECT "companyId", "branchId", "warehouseId", "itemId",
             SUM(CASE WHEN direction = 'IN' THEN quantity ELSE -quantity END) AS quantity
        FROM stock_movements
       GROUP BY 1, 2, 3, 4
    ),
    shelves AS (
      SELECT "companyId", "branchId", "warehouseId", "itemId", quantity
        FROM warehouse_stock_balances
    )
    SELECT COALESCE(m."companyId", s."companyId")         AS "companyId",
           COALESCE(m."branchId", s."branchId")           AS "branchId",
           COALESCE(m."warehouseId", s."warehouseId")     AS "warehouseId",
           COALESCE(m."itemId", s."itemId")               AS "itemId",
           COALESCE(m.quantity, 0)::text                  AS "fromMovements",
           COALESCE(s.quantity, 0)::text                  AS "fromShelfBook"
      FROM movements m
      FULL OUTER JOIN shelves s
        ON  s."companyId"   = m."companyId"
        AND s."branchId"    = m."branchId"
        AND s."warehouseId" = m."warehouseId"
        AND s."itemId"      = m."itemId"
     WHERE COALESCE(m.quantity, 0) IS DISTINCT FROM COALESCE(s.quantity, 0)
     ORDER BY 1, 2, 3, 4
  `;
}

const suffix = randomUUID().slice(0, 8);

// Removes everything this guard created.
//
// The guard used to leave its throwaway company behind. That is not only
// untidy - `companies` carries a partial unique index that allows exactly one
// live company per installation, so the leftover company made the *next*
// script in the CI job fail with P2002 on Company_one_active_company_idx.
// A guard that breaks its neighbours is worse than no guard: it turns an
// unrelated step red and hides the real result.
//
// Deletion order follows the foreign keys child-first. The installation is
// either the guard's own fresh database or a CI database no other step is
// using at the same time.
async function teardown(w) {
  if (!w?.companyId) return;
  const queries = [
    `DELETE FROM stock_movements WHERE "companyId" = $1`,
    `DELETE FROM warehouse_stock_balances WHERE "companyId" = $1`,
    `DELETE FROM stock_balances WHERE "companyId" = $1`,
    `DELETE FROM items WHERE "companyId" = $1`,
    `DELETE FROM warehouses WHERE "companyId" = $1`,
    `DELETE FROM branches WHERE "companyId" = $1`,
    `DELETE FROM companies WHERE id = $1`,
  ];
  for (const sql of queries) {
    try {
      await prisma.$executeRawUnsafe(sql, w.companyId);
    } catch (error) {
      // A table this installation does not have (an older schema) must not
      // stop the cleanup of the rest, so report and keep going.
      console.log(`  teardown: skipped ${sql.split(' ')[2]} (${error.message.split('\n')[0]})`);
    }
  }
}

async function world() {
  const companyId = randomUUID();
  const branchId = randomUUID();
  const sourceId = randomUUID();
  const destinationId = randomUUID();
  const itemId = randomUUID();

  await prisma.company.create({
    data: { id: companyId, code: `LSA-${suffix}`, nameEn: 'Ledger agreement', nameAr: 'اتفاق الدفتر' },
  });
  await prisma.branch.create({
    data: { id: branchId, companyId, code: `LSB-${suffix}`, nameEn: 'Branch', nameAr: 'فرع' },
  });
  await prisma.warehouse.createMany({
    data: [
      { id: sourceId, companyId, branchId, code: `LSS-${suffix}`, nameEn: 'Source', nameAr: 'مصدر', isDefault: true },
      { id: destinationId, companyId, branchId, code: `LSD-${suffix}`, nameEn: 'Dest', nameAr: 'وجهة' },
    ],
  });
  await prisma.item.create({
    data: { id: itemId, companyId, code: `LSI-${suffix}`, nameEn: 'Item', nameAr: 'صنف', unit: 'piece' },
  });

  return { companyId, branchId, sourceId, destinationId, itemId };
}

/// Posts one receipt the way a purchase invoice does: the movement row the
/// reports sum, and the two books, in one transaction.
async function receive(w, warehouseId, quantity, unitCost) {
  const value = dec(quantity).mul(dec(unitCost));
  await prisma.$transaction(async (tx) => {
    await tx.stockMovement.create({
      data: {
        companyId: w.companyId,
        branchId: w.branchId,
        warehouseId,
        itemId: w.itemId,
        movementDate: new Date('2051-02-01T00:00:00.000Z'),
        direction: 'IN',
        quantity: dec(quantity),
        unitCost: dec(unitCost),
        totalCost: value,
        referenceType: 'SEED',
      },
    });
    await ledger.post(tx, {
      companyId: w.companyId,
      branchId: w.branchId,
      warehouseId,
      itemId: w.itemId,
      quantity: dec(quantity),
      value,
    });
  });
}

/// Moves quantity from one shelf to another, exactly as a TRANSFER posting does:
/// two movement rows and one ledger call per leg.
async function transfer(w, fromId, toId, quantity) {
  const unitCost = dec('7.5000');
  const value = dec(quantity).mul(unitCost);
  await prisma.$transaction(async (tx) => {
    await tx.stockMovement.create({
      data: {
        companyId: w.companyId,
        branchId: w.branchId,
        warehouseId: fromId,
        itemId: w.itemId,
        movementDate: new Date('2051-02-02T00:00:00.000Z'),
        direction: 'OUT',
        quantity: dec(quantity),
        unitCost,
        totalCost: value,
        referenceType: 'STOCK_TRANSFER_OUT',
      },
    });
    await tx.stockMovement.create({
      data: {
        companyId: w.companyId,
        branchId: w.branchId,
        warehouseId: toId,
        itemId: w.itemId,
        movementDate: new Date('2051-02-02T00:00:00.000Z'),
        direction: 'IN',
        quantity: dec(quantity),
        unitCost,
        totalCost: value,
        referenceType: 'STOCK_TRANSFER_IN',
      },
    });
    await ledger.post(tx, {
      companyId: w.companyId, branchId: w.branchId, warehouseId: fromId,
      itemId: w.itemId, quantity: dec(quantity).negated(), value: value.negated(),
    });
    await ledger.post(tx, {
      companyId: w.companyId, branchId: w.branchId, warehouseId: toId,
      itemId: w.itemId, quantity: dec(quantity), value,
    });
  });
}

const shelf = async (warehouseId, itemId) => {
  const rows = await prisma.$queryRaw`
    SELECT quantity::text FROM warehouse_stock_balances
     WHERE "warehouseId" = ${warehouseId}::uuid AND "itemId" = ${itemId}::uuid`;
  return rows.length === 0 ? null : rows[0].quantity;
};

// Read-only mode for a database that already holds an installation's data.
//
// The checks above post real movements, so they need a database this guard is
// allowed to write to: an empty one, created for the test. Pointing them at a
// live database would fail the very first [baseline] check - correctly, because
// a populated database is not "untouched" - and would also seed test companies
// into an accountant's books.
//
// `--audit` answers the only question that can be asked of a live database
// without writing to it: do the two books agree, everywhere, right now? It is
// what to run against a customer's copy after an upgrade.
if (process.argv.includes('--audit')) {
  console.log('\n[audit] read-only reconciliation of this database');
  try {
    const ledgerCount = await prisma.stockMovement.count();
    const shelfCount = await prisma.warehouseStockBalance.count();
    console.log(`  movements: ${ledgerCount}   shelf rows: ${shelfCount}`);
    const all = await disagreements();
    if (all.length === 0) {
      console.log('  PASS  every shelf in this database agrees with the ledger');
    } else {
      console.log(`  FAIL  ${all.length} shelf(s) disagree with the ledger:`);
      for (const row of all.slice(0, 50)) console.log(`        ${JSON.stringify(row)}`);
      if (all.length > 50) console.log(`        ... and ${all.length - 50} more`);
      failures += 1;
    }
    const negative = await prisma.$queryRaw`
      SELECT count(*)::int AS n FROM warehouse_stock_balances WHERE quantity < 0`;
    if (negative[0].n === 0) console.log('  PASS  no shelf is negative');
    else {
      console.log(`  FAIL  ${negative[0].n} negative shelf(s)`);
      failures += 1;
    }
  } catch (error) {
    failures += 1;
    console.error('\nAUDIT ERROR', error);
  } finally {
    await prisma.$disconnect();
  }
  console.log(failures === 0 ? '\nLEDGER/SHELF AUDIT: PASSED' : `\nLEDGER/SHELF AUDIT: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

// Declared outside the try block so the finally below can always clean up,
// even when a check throws halfway through.
let created = null;

try {
  // ---------------------------------------------------------------- baseline
  console.log('\n[baseline] an untouched database has nothing to disagree about');
  const before = await disagreements();
  check('no shelf disagrees before this guard writes anything', before.length === 0,
    `${before.length} disagreement(s)`);

  // ------------------------------------------------- a receipt funds one shelf
  console.log('\n[receipt] goods arriving in one warehouse fund that shelf');
  const w = await world();
  created = w;
  await receive(w, w.sourceId, 10, '7.5000');

  check('the source shelf holds 10 after the receipt', (await shelf(w.sourceId, w.itemId)) === '10.0000',
    `shelf=${await shelf(w.sourceId, w.itemId)}`);
  check('the two books agree after a receipt', (await disagreements()).length === 0,
    `${(await disagreements()).length} disagreement(s)`);

  // ----------------------------------------- what the old defect looked like
  console.log('\n[defect] a shelf written without its movements is reported, not ignored');
  // Simulates the historical bug directly: a movement with no shelf row.
  await prisma.stockMovement.create({
    data: {
      companyId: w.companyId, branchId: w.branchId, warehouseId: w.destinationId,
      itemId: w.itemId, movementDate: new Date('2051-02-03T00:00:00.000Z'),
      direction: 'IN', quantity: dec(5), unitCost: dec('7.5000'), totalCost: dec('37.5000'),
      referenceType: 'SEED',
    },
  });
  const orphaned = await disagreements();
  // Compare as numbers: the absent side is COALESCEd from NULL, so PostgreSQL
  // renders it '0' rather than the decimal type's '0.0000'. Both mean zero.
  check('a movement with no shelf row is reported as a disagreement',
    orphaned.length === 1 &&
      orphaned[0].warehouseId === w.destinationId &&
      Number(orphaned[0].fromMovements) === 5 &&
      Number(orphaned[0].fromShelfBook) === 0,
    `${orphaned.length} disagreement(s): ${JSON.stringify(orphaned)}`);

  // ---------------------------------------------- the ledger repairs the gap
  await prisma.$transaction(async (tx) => {
    await ledger.post(tx, {
      companyId: w.companyId, branchId: w.branchId, warehouseId: w.destinationId,
      itemId: w.itemId, quantity: dec(5), value: dec('37.5000'),
    });
  });
  check('posting the missing ledger entry clears the disagreement',
    (await disagreements()).length === 0,
    `${(await disagreements()).length} disagreement(s)`);

  // --------------------------------------------- a transfer keeps both in step
  console.log('\n[transfer] moving goods keeps both books in step');
  await transfer(w, w.destinationId, w.sourceId, 4);
  check('the source shelf holds 14 after receiving 4', (await shelf(w.sourceId, w.itemId)) === '14.0000',
    `shelf=${await shelf(w.sourceId, w.itemId)}`);
  check('the destination shelf holds 1 after giving 4', (await shelf(w.destinationId, w.itemId)) === '1.0000',
    `shelf=${await shelf(w.destinationId, w.itemId)}`);
  check('the two books still agree after a transfer', (await disagreements()).length === 0,
    `${(await disagreements()).length} disagreement(s)`);

  // ------------------------------------------- the branch book equals the sum
  console.log('\n[branch] the branch book equals the sum of its shelves');
  const branchRow = await prisma.stockBalance.findUnique({
    where: { companyId_branchId_itemId: { companyId: w.companyId, branchId: w.branchId, itemId: w.itemId } },
  });
  check('branch quantity equals the sum of its warehouses', Number(branchRow?.quantity) === 15,
    `branch=${branchRow?.quantity}`);

  // ------------------------------------------------ nothing went negative
  const negative = await prisma.$queryRaw`
    SELECT count(*)::int AS n FROM warehouse_stock_balances WHERE quantity < 0`;
  check('no shelf is negative', negative[0].n === 0, `${negative[0].n} negative shelf(s)`);

  // ------------------------------------- the whole installation, not just mine
  console.log('\n[installation] every shelf in this database agrees');
  const all = await disagreements();
  check('no shelf anywhere in this database disagrees', all.length === 0,
    all.length === 0 ? '0 disagreement(s)' : JSON.stringify(all));
} catch (error) {
  failures += 1;
  console.error('\nHARNESS ERROR', error);
} finally {
  // The company this guard made must not outlive it; see teardown().
  await teardown(created);
  await prisma.$disconnect();
}

console.log(failures === 0
  ? '\nLEDGER/SHELF AGREEMENT: ALL CHECKS PASSED'
  : `\nLEDGER/SHELF AGREEMENT: ${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
