'use strict';
// Isolated native PostgreSQL smoke test; creates a new database and leaves it intact.
// Requires a Unix-socket-only test cluster and an explicit marker in its data dir.
const { Client } = require('pg');
const { readdirSync, readFileSync, realpathSync } = require('node:fs');
const { join } = require('node:path');
const { randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const host = process.env.KAYAN_ISOLATED_PG_SOCKET;
const port = Number(process.env.KAYAN_ISOLATED_PG_PORT);
if (!host || !host.startsWith('/') || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Set KAYAN_ISOLATED_PG_SOCKET to a private Unix socket directory and KAYAN_ISOLATED_PG_PORT.');
const cfg = { host, port, user: 'kayan_test' };
const root = join(__dirname, '..', 'prisma', 'migrations');
const dbname = 'kayan_isolated_' + randomBytes(8).toString('hex');
async function main() {
  const admin = new Client({ ...cfg, database: 'postgres' });
  await admin.connect();
  const identity = await admin.query("SELECT current_setting('listen_addresses') AS listen, current_user AS role, version() AS version, current_setting('data_directory') AS data_dir");
  assert.equal(identity.rows[0].listen, '');
  assert.equal(identity.rows[0].role, 'kayan_test');
  assert.match(identity.rows[0].version, /PostgreSQL 17\./);
  const dataDir = realpathSync(identity.rows[0].data_dir);
  const socketDir = realpathSync(host);
  if (join(dataDir, '..') !== join(socketDir, '..')) throw new Error('Test cluster and socket must have the same isolated parent.');
  assert.equal(readFileSync(join(dataDir, 'KAYAN-ISOLATED-TEST-ONLY'), 'utf8').trim(), 'KAYAN ISOLATED TEST CLUSTER - NO CUSTOMER DATA');
  await admin.query(`CREATE DATABASE ${dbname}`);
  await admin.end();
  const db = new Client({ ...cfg, database: dbname });
  await db.connect();
  console.log(`Fresh isolated database ${dbname}; ${identity.rows[0].version.split(',')[0]}`);
  const dirs = readdirSync(root, { withFileTypes: true }).filter(x => x.isDirectory()).map(x=>x.name).sort();
  const old = dirs.filter(x=>x < '20261027130000_item_multiple_units');
  const newer = dirs.filter(x=>x >= '20261027130000_item_multiple_units');
  for (const d of old) {
    try { await db.query('BEGIN'); await db.query(readFileSync(join(root,d,'migration.sql'),'utf8')); await db.query('COMMIT'); }
    catch (e) { await db.query('ROLLBACK'); throw new Error(`Migration ${d}: ${e.message}`); }
  }
  console.log(`PASS: applied ${old.length} pre-upgrade SQL migrations`);
  const C='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222', I='77777777-7777-4777-8777-777777777777', U='88888888-8888-4888-8888-888888888888';
  await db.query(`insert into companies (id,code,"nameEn","nameAr","updatedAt") values ($1,'TEST','Synthetic','Synthetic',now())`,[C]);
  await db.query(`insert into branches (id,"companyId",code,"nameEn","nameAr","updatedAt") values ($1,$2,'B1','Synthetic','Synthetic',now())`,[B,C]);
  await db.query(`insert into items (id,"companyId",code,"nameEn","nameAr","updatedAt") values ($1,$2,'ITEM','Synthetic','Synthetic',now())`,[I,C]);
  await db.query(`insert into item_units (id,"itemId",unit,factor) values ($1,$2,'carton',10)`,[U,I]);
  const legacy = (await db.query('select id, "itemId", unit, factor from item_units')).rows;
  for (const d of newer) {
    try { await db.query('BEGIN'); await db.query(readFileSync(join(root,d,'migration.sql'),'utf8')); await db.query('COMMIT'); }
    catch(e) { await db.query('ROLLBACK'); throw new Error(`Migration ${d}: ${e.message}`); }
  }
  assert.deepEqual((await db.query('select id, "itemId", unit, factor from item_units')).rows, legacy);
  assert.equal((await db.query('select "isActive" from item_units')).rows[0].isActive, true);
  const cols = (await db.query(`select table_name, column_name, is_nullable from information_schema.columns where table_schema='public' and table_name = any($1::text[]) and column_name = any($2::text[])`,[['sales_invoice_lines','purchase_invoice_lines','stock_document_lines','purchase_order_lines','sales_order_lines'],['unitName','unitFactor','unitQuantity']])).rows;
  assert.equal(cols.length, 15);
  assert.ok(cols.every(col => col.is_nullable === 'YES'));
  console.log(`PASS: ${newer.length} upgrade migrations, preserved legacy unit and 15 nullable snapshot columns`);
  const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', CASH='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', R1='cccccccc-cccc-4ccc-8ccc-ccccccccccc1', R2='cccccccc-cccc-4ccc-8ccc-ccccccccccc2', V='dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
 await db.query(`insert into accounts(id,"companyId",code,"nameEn","nameAr",type,"updatedAt") values($1,$2,'ACC','Synthetic','Synthetic','ASSET',now())`,[A,C]);
 await db.query(`insert into cash_accounts(id,"companyId",code,"nameEn","nameAr","accountId","updatedAt") values($1,$2,'CASH','Synthetic','Synthetic',$3,now())`,[CASH,C,A]);
 await db.query(`insert into bank_reconciliations(id,"companyId","cashAccountId","statementDate","periodFrom","periodTo","statementBalance","bookBalance",difference) values($1,$3,$4,'2026-01-01','2026-01-01','2026-01-01',0,0,0),($2,$3,$4,'2026-01-01','2026-01-01','2026-01-01',0,0,0)`,[R1,R2,C,CASH]);
 await db.query(`insert into cash_vouchers(id,"companyId","branchId","voucherNumber","voucherDate",kind,"cashAccountId",amount,"updatedAt") values($1,$2,$3,'SYNTHETIC','2026-01-01','RECEIPT',$4,1,now())`,[V,C,B,CASH]);
 await db.query(`update cash_vouchers set "reconciliationId"=$1 where id=$2`,[R1,V]);
 await db.query(`update cash_vouchers set "reconciliationId"=$1 where id=$2`,[R1,V]);
 await assert.rejects(db.query(`update cash_vouchers set "reconciliationId"=$1 where id=$2`,[R2,V]),e=>e.code==='23P01');
 await assert.rejects(db.query(`update cash_vouchers set "reconciliationId"=null where id=$1`,[V]),e=>e.code==='23P01');
 assert.equal((await db.query(`select "reconciliationId" from cash_vouchers where id=$1`,[V])).rows[0].reconciliationId,R1);
 console.log('PASS: initial claim and idempotent match allowed; reassignment and manual clearing rejected');
 await db.query(`delete from bank_reconciliations where id=$1`,[R1]);
 assert.equal((await db.query(`select "reconciliationId" from cash_vouchers where id=$1`,[V])).rows[0].reconciliationId,null);
 console.log('PASS: deleting parent reconciliation still performs foreign-key SET NULL');

  // The production service is NOT invoked here. These two independent native
  // sessions test the database lock/trigger primitives, not end-to-end Prisma.
  const a = new Client({ ...cfg, database: dbname });
  const b = new Client({ ...cfg, database: dbname });
  await Promise.all([a.connect(), b.connect()]);
  const R3='cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
  await db.query(`insert into bank_reconciliations(id,"companyId","cashAccountId","statementDate","periodFrom","periodTo","statementBalance","bookBalance",difference) values($1,$2,$3,'2026-01-01','2026-01-01','2026-01-01',0,0,0)`,[R3,C,CASH]);
  await a.query('BEGIN');
  await b.query('BEGIN');
  await a.query('update cash_vouchers set "reconciliationId"=$1 where id=$2', [R2,V]);
  let finished = false;
  const competing = b.query('update cash_vouchers set "reconciliationId"=$1 where id=$2', [R3,V])
    .then(() => ({ ok: true }), error => ({ ok: false, code: error.code }))
    .then(result => { finished = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(finished, false, 'second voucher claim must wait for the row lock');
  await a.query('COMMIT');
  const outcome = await competing;
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, '23P01');
  await b.query('ROLLBACK');
  assert.equal((await db.query('select "reconciliationId" from cash_vouchers where id=$1',[V])).rows[0].reconciliationId,R2);
  console.log('PASS: two PostgreSQL sessions contend for one voucher; the second claim is rejected');

  const W='66666666-6666-4666-8666-666666666666';
  await db.query(`insert into warehouses (id,"companyId","branchId",code,"nameEn","nameAr","updatedAt") values($1,$2,$3,'W','Synthetic','Synthetic',now())`,[W,C,B]);
  const insertMovement = `insert into stock_movements (id,"companyId","branchId","warehouseId","itemId","movementDate",direction,quantity,"unitCost","totalCost","referenceType") values(gen_random_uuid(),$1,$2,$3,$4,'2026-01-01',$5,$6,1,$6,'TEST')`;
  await db.query(insertMovement,[C,B,W,I,'IN',7]);
  const lock=`select id from warehouses where id=$1 and "companyId"=$2 and "deletedAt" is null for update`;
  const quantity=`select coalesce(sum(case when direction='IN' then quantity else -quantity end),0) as quantity from stock_movements where "companyId"=$1 and "warehouseId"=$2 and "itemId"=$3`;
  await a.query('BEGIN');
  await b.query('BEGIN');
  await a.query(lock,[W,C]);
  let acquired = false;
  const waiting = b.query(lock,[W,C]).then(() => { acquired = true; });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(acquired, false, 'second session must wait for the warehouse lock');
  assert.equal((await a.query(quantity,[C,W,I])).rows[0].quantity,'7.0000');
  await a.query(insertMovement,[C,B,W,I,'OUT',5]);
  await a.query('COMMIT');
  await waiting;
  assert.equal((await b.query(quantity,[C,W,I])).rows[0].quantity,'2.0000');
  await b.query('ROLLBACK');
  await Promise.all([a.end(), b.end()]);
  console.log('PASS: a second PostgreSQL session waits for the warehouse lock and reads the committed balance');

  console.log('Database left intact in the disposable cluster for inspection.');
  await db.end();
}
main().catch(e => { console.error(e.stack); process.exit(1); });
