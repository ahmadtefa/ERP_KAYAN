'use strict';
/**
 * Real service + generated Prisma Client + native PostgreSQL 17 integration.
 * Requires a locally compiled backend, an explicitly marked throwaway cluster
 * listening ONLY on a Unix socket, and creates a NEW database. It never drops
 * a database. The accounting/audit/settings collaborators are test doubles;
 * StockDocumentsService, WarehouseService, Prisma and PostgreSQL are real.
 *
 * KAYAN_ISOLATED_PG_SOCKET=/absolute/socket/directory
 * KAYAN_ISOLATED_PG_PORT=... KAYAN_TEST_BUILD_DIR=/absolute/backend/build
 * NODE_PATH=/path/to/backend/node_modules node scripts/isolated-prisma-stock-reversal.cjs
 */
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { readdirSync, readFileSync, realpathSync } = require('node:fs');
const { join, isAbsolute } = require('node:path');
const { Client } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const host = process.env.KAYAN_ISOLATED_PG_SOCKET;
const port = Number(process.env.KAYAN_ISOLATED_PG_PORT);
const build = process.env.KAYAN_TEST_BUILD_DIR;
if (!host || !isAbsolute(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !build || !isAbsolute(build)) {
  throw new Error('Explicit private socket, port and compiled backend build directory are required.');
}
const { StockDocumentsService } = require(join(build, 'dist/src/modules/inventory/stock-documents.service.js'));
const { WarehouseService } = require(join(build, 'dist/src/common/warehouse/warehouse.service.js'));
const cfg = { host, port, user: 'kayan_test' };
const database = 'kayan_stock_' + randomBytes(8).toString('hex');
const migrations = join(__dirname, '..', 'prisma', 'migrations');
const USER = randomUUID();
const log = (message) => console.log('PASS:', message);
async function main() {
  const admin = new Client({ ...cfg, database: 'postgres' });
  await admin.connect();
  const identity = (await admin.query("SELECT current_setting('listen_addresses') AS listen, current_user AS role, version() AS version, current_setting('data_directory') AS data_dir")).rows[0];
  assert.equal(identity.listen, '');
  assert.equal(identity.role, 'kayan_test');
  assert.match(identity.version, /PostgreSQL 17\./);
  const dataDir = realpathSync(identity.data_dir);
  assert.equal(join(dataDir, '..'), join(realpathSync(host), '..'));
  assert.equal(readFileSync(join(dataDir, 'KAYAN-ISOLATED-TEST-ONLY'), 'utf8').trim(), 'KAYAN ISOLATED TEST CLUSTER - NO CUSTOMER DATA');
  await admin.query(`CREATE DATABASE ${database}`);
  await admin.end();
  const sql = new Client({ ...cfg, database });
  await sql.connect();
  const dirs = readdirSync(migrations, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
  for (const name of dirs) {
    try {
      await sql.query('BEGIN');
      await sql.query(readFileSync(join(migrations, name, 'migration.sql'), 'utf8'));
      await sql.query('COMMIT');
    } catch (e) {
      await sql.query('ROLLBACK');
      throw new Error(`migration ${name}: ${e.message}`);
    }
  }
  console.log(`Disposable ${database}: ${dirs.length} project migration SQL files applied`);
  const queries = [];
  function client(track = false) {
    const p = new PrismaClient({ adapter: new PrismaPg({ ...cfg, database }), ...(track ? { log: [{ emit: 'event', level: 'query' }] } : {}) });
    if (track) p.$on('query', (event) => queries.push(event.query));
    return p;
  }
  const p = client(true), p2 = client();
  await Promise.all([p.$connect(), p2.$connect()]);
  const company = await p.company.create({ data: { code: 'SYNTH', nameEn: 'Synthetic', nameAr: 'Synthetic' } });
  const branch = await p.branch.create({ data: { companyId: company.id, code: 'B', nameEn: 'Synthetic', nameAr: 'Synthetic' } });
  const source = await p.warehouse.create({ data: { companyId: company.id, branchId: branch.id, code: 'S', nameEn: 'Source', nameAr: 'Source' } });
  const dest = await p.warehouse.create({ data: { companyId: company.id, branchId: branch.id, code: 'D', nameEn: 'Dest', nameAr: 'Dest' } });
  let serial = 0;
  const fakePosting = { reverse: async () => { throw new Error('unexpected posting reverse'); } };
  const fakeAudit = { record: async () => {} };
  const fakeSettings = { get: async () => ({ allowNegativeStock: false }) };
  const warehouse = new WarehouseService(p, fakeAudit);
  const service = new StockDocumentsService(p, {}, fakePosting, {}, fakeAudit, fakeSettings, warehouse, {});
  async function fixture(srcQty, dstQty, lines = [5]) {
    const tag = String(++serial);
    const item = await p.item.create({ data: { companyId: company.id, code: `I${tag}`, nameEn: 'Synthetic', nameAr: 'Synthetic' } });
    for (const [warehouseId, amount] of [[source.id, srcQty], [dest.id, dstQty]]) {
      await p.stockMovement.create({ data: { companyId: company.id, branchId: branch.id, warehouseId, itemId: item.id, movementDate: new Date('2026-01-01Z'), direction: 'IN', quantity: amount, unitCost: 1, totalCost: amount, referenceType: 'SYNTHETIC' } });
    }
    await p.stockBalance.create({ data: { companyId: company.id, branchId: branch.id, itemId: item.id, quantity: srcQty + dstQty, value: srcQty + dstQty } });
    const doc = await p.stockDocument.create({ data: { companyId: company.id, branchId: branch.id, fromBranchId: branch.id, fromWarehouseId: source.id, toWarehouseId: dest.id, documentNumber: `D${tag}`, documentDate: new Date('2026-01-01Z'), kind: 'TRANSFER', status: 'POSTED', lines: { create: lines.map((q, i) => ({ itemId: item.id, quantity: q, unitCost: 1, lineNumber: i + 1 })) } } });
    return { item, doc, tag };
  }
  async function quantity(itemId, warehouseId) {
    const rows = await sql.query(`SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN quantity ELSE -quantity END),0)::text AS qty FROM stock_movements WHERE "warehouseId"=$1 AND "itemId"=$2`, [warehouseId,itemId]);
    return Number(rows.rows[0].qty);
  }
  async function state(f) {
    const doc = await p.stockDocument.findUniqueOrThrow({ where: { id: f.doc.id } });
    const balance = await p.stockBalance.findUniqueOrThrow({ where: { companyId_branchId_itemId: { companyId: company.id, branchId: branch.id, itemId: f.item.id } } });
    const count = await p.stockMovement.count({ where: { referenceId: f.doc.id, referenceType: 'STOCK_DOCUMENT_REVERSAL' } });
    return { status: doc.status, balance: Number(balance.quantity), source: await quantity(f.item.id,source.id), dest: await quantity(f.item.id,dest.id), count };
  }
  const ok = await fixture(12,8);
  queries.length = 0;
  await service.reverse(company.id, USER, ok.doc.id);
  assert.deepEqual(await state(ok), { status:'REVERSED', balance:20, source:17, dest:3, count:2 });
  const forUpdate = queries.filter(q => /FOR UPDATE/i.test(q));
  assert.ok(forUpdate.length >= 2);
  assert.match(forUpdate[0], /warehouses/i);
  assert.ok(forUpdate.slice(1).some(q => /stock_balances/i.test(q)));
  log('real reversal adjusts both warehouses and locks warehouse before branch balance');

  const tooLittle = await fixture(17,3);
  await assert.rejects(service.reverse(company.id, USER, tooLittle.doc.id), /selected warehouse/);
  assert.deepEqual(await state(tooLittle), { status:'POSTED', balance:20, source:17, dest:3, count:0 });
  log('insufficient destination stock preserves document and all balances');

  const duplicate = await fixture(15,5,[3,3]);
  await assert.rejects(service.reverse(company.id, USER, duplicate.doc.id), /selected warehouse/);
  assert.deepEqual(await state(duplicate), { status:'POSTED', balance:20, source:15, dest:5, count:0 });
  log('duplicate item lines are aggregated before checking stock');

  const failed = await fixture(12,8);
  await sql.query(`CREATE FUNCTION synthetic_fail_stock_reversal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."referenceId"='${failed.doc.id}'::uuid AND NEW."referenceType"='STOCK_DOCUMENT_REVERSAL' AND NEW.direction='OUT' THEN RAISE EXCEPTION 'synthetic movement failure'; END IF; RETURN NEW; END $$`);
  await sql.query('CREATE TRIGGER synthetic_fail_stock_reversal BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION synthetic_fail_stock_reversal()');
  await assert.rejects(service.reverse(company.id, USER, failed.doc.id), /synthetic movement failure/);
  assert.deepEqual(await state(failed), { status:'POSTED', balance:20, source:12, dest:8, count:0 });
  log('database failure on second movement rolls back first movement, balance and status');

  const race = await fixture(13,7);
  const other = await p.stockDocument.create({ data: { companyId: company.id, branchId: branch.id, fromBranchId: branch.id, fromWarehouseId: source.id, toWarehouseId: dest.id, documentNumber: `R${race.tag}`, documentDate: new Date('2026-01-01Z'), kind: 'TRANSFER', status: 'POSTED', lines: { create: [{ itemId: race.item.id, quantity: 5, unitCost: 1, lineNumber: 1 }] } } });
  let release; let entered;
  const released = new Promise(resolve => { release = resolve; });
  const locked = new Promise(resolve => { entered = resolve; });
  const realLock = warehouse.lockForPosting.bind(warehouse);
  warehouse.lockForPosting = async (...args) => { await realLock(...args); entered(); await released; };
  const secondWarehouse = new WarehouseService(p2, fakeAudit);
  const secondService = new StockDocumentsService(p2, {}, fakePosting, {}, fakeAudit, fakeSettings, secondWarehouse, {});
  const first = service.reverse(company.id, USER, race.doc.id);
  await locked;
  let secondFinished = false;
  const second = secondService.reverse(company.id, USER, other.id).then(() => ({ ok: true }), error => ({ ok: false, error })).then(result => { secondFinished = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(secondFinished, false, 'second reversal must wait for warehouse lock');
  release();
  await first;
  const secondResult = await second;
  assert.equal(secondResult.ok, false);
  assert.match(String(secondResult.error.message), /selected warehouse/);
  assert.deepEqual(await state(race), { status:'REVERSED', balance:20, source:18, dest:2, count:2 });
  assert.equal((await p.stockDocument.findUniqueOrThrow({ where:{id:other.id} })).status, 'POSTED');
  log('two Prisma sessions contend; only one reversal succeeds and no stock is lost');

  await Promise.all([p.$disconnect(),p2.$disconnect(),sql.end()]);
  console.log('Isolated test database left intact for inspection.');
}
main().catch(error => { console.error(error.stack); process.exit(1); });
