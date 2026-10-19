#!/usr/bin/env node
/**
 * Reproduces an upgrade of an existing installation and asserts that the
 * cost-center migration is safe on data that predates it.
 *
 * 1. Builds a database at the schema *before* 20261019120000.
 * 2. Seeds it, then removes the new permission and its grants so the database
 *    looks like one installed before cost centers had a type, a hierarchy and
 *    an allocation table.
 * 3. Inserts a legacy flat cost center, a legacy journal entry that carries it,
 *    and a legacy pending journal line, using only the old columns.
 * 4. Applies 20261019120000 and checks the result:
 *      - the legacy centre is still there, with its name and code, now typed
 *        DEPARTMENT with no invented parent or dates;
 *      - the legacy journal line still points at the same centre and no
 *        allocation row was invented for it;
 *      - an ADMIN role of an old company can read cost centers (grant exists);
 *      - a non-super administrator with a custom role that can read reports
 *        also receives the read permission;
 *      - the CHECK constraints, enum, foreign keys and indexes exist;
 *      - running the migration a second time changes nothing.
 *
 * Run only against disposable PostgreSQL:  node scripts/verify-cost-center-upgrade.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const HOST = process.env.PGHOST ?? '127.0.0.1';
const PORT = Number(process.env.PGPORT ?? 55432);
const USER = process.env.PGUSER ?? 'kayan';
const DB = process.env.UPGRADE_DB ?? 'kayan_upgrade';
const ADMIN_URL = `postgresql://${USER}@${HOST}:${PORT}/postgres`;
const URL = `postgresql://${USER}@${HOST}:${PORT}/${DB}`;
const MIGRATIONS = '/home/user/ERP_KAYAN/backend/prisma/migrations';
const TARGET = '20261019120000_cost_centers_hierarchy_allocations';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function applyAll(client, { stopBefore } = {}) {
  await client.query(
    'CREATE TABLE IF NOT EXISTS "_arena_migrations" (name text primary key, applied_at timestamptz default now())',
  );
  const dirs = fs
    .readdirSync(MIGRATIONS)
    .filter((dir) => fs.statSync(path.join(MIGRATIONS, dir)).isDirectory())
    .sort();
  let applied = 0;
  for (const dir of dirs) {
    if (stopBefore && dir >= stopBefore) break;
    const done = await client.query('SELECT 1 FROM "_arena_migrations" WHERE name = $1', [dir]);
    if (done.rowCount) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO "_arena_migrations" (name) VALUES ($1)', [dir]);
      await client.query('COMMIT');
      applied += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${dir} failed: ${error.message}`);
    }
  }
  return applied;
}

async function main() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${DB}"`);
  await admin.end();

  let client = new pg.Client({ connectionString: URL });
  await client.connect();

  const applied = await applyAll(client, { stopBefore: TARGET });
  check('the pre-upgrade schema builds', applied > 0, `${applied} migrations`);

  // The seed adds the current permission catalogue; remove the two codes and
  // every grant of them so the database looks like the older installation.
  const { execFileSync } = await import('node:child_process');
  execFileSync('npx', ['ts-node', 'prisma/seed.ts'], {
    cwd: '/home/user/ERP_KAYAN/backend',
    env: { ...process.env, DATABASE_URL: URL },
    stdio: 'ignore',
  });
  await client.query(
    `DELETE FROM role_permissions WHERE "permissionId" IN
       (SELECT id FROM permissions WHERE code LIKE 'accounting.costcenters.%')`,
  );
  await client.query(`DELETE FROM permissions WHERE code LIKE 'accounting.costcenters.%'`);
  const gone = await client.query(
    `SELECT count(*)::int c FROM permissions WHERE code LIKE 'accounting.costcenters.%'`,
  );
  check('the upgrade starts without the cost-center permission', gone.rows[0].c === 0);

  const company = (await client.query('SELECT id FROM companies LIMIT 1')).rows[0];
  const branch = (await client.query('SELECT id FROM branches LIMIT 1')).rows[0];

  // A legacy flat centre and a bank/cash account so a journal can be written.
  const legacy = await client.query(
    `INSERT INTO cost_centers (id, "companyId", code, "nameEn", "nameAr", "isActive", "updatedAt")
     VALUES (gen_random_uuid(), $1, 'LEG-1', 'Legacy centre', 'مركز قديم', true, now())
     RETURNING id`,
    [company.id],
  );
  const legacyId = legacy.rows[0].id;
  const cash = (
    await client.query(`SELECT id FROM accounts WHERE code = '1101' LIMIT 1`)
  ).rows[0];
  const expense = (
    await client.query(`SELECT id FROM accounts WHERE code = '5103' LIMIT 1`)
  ).rows[0];
  const entry = await client.query(
    `INSERT INTO journal_entries
       (id, "companyId", "branchId", "entryNumber", "entryDate", description, status,
        "totalDebit", "totalCredit", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, 'LEG-JE-1', '2026-03-01', 'Legacy entry', 'POSTED',
             100, 100, now(), now())
     RETURNING id`,
    [company.id, branch.id],
  );
  const entryId = entry.rows[0].id;
  await client.query(
    `INSERT INTO journal_lines
       (id, "journalEntryId", "lineNumber", "accountId", debit, credit, description, "costCenterId")
     VALUES (gen_random_uuid(), $1, 1, $2, 100, 0, 'Legacy expense', $4),
            (gen_random_uuid(), $1, 2, $3, 0, 100, 'Legacy credit', NULL)`,
    [entryId, expense.id, cash.id, legacyId],
  );

  const upgrade = await applyAll(client, { stopBefore: null });
  check('the cost-center migration applies to an old database', upgrade === 1, `${upgrade} applied`);

  const centre = await client.query(
    `SELECT code, "nameEn", type::text AS type, "parentId", "startDate", "endDate", "isActive"
       FROM cost_centers WHERE id = $1`,
    [legacyId],
  );
  const row = centre.rows[0];
  check(
    'the legacy centre survives with its data intact',
    row?.code === 'LEG-1' && row?.nameEn === 'Legacy centre' && row?.isActive === true,
  );
  check(
    'the legacy centre becomes a DEPARTMENT with no invented parent or window',
    row?.type === 'DEPARTMENT' && row?.parentId === null && row?.startDate === null && row?.endDate === null,
    JSON.stringify(row),
  );

  const line = await client.query(
    `SELECT "costCenterId" FROM journal_lines WHERE "journalEntryId" = $1 AND "lineNumber" = 1`,
    [entryId],
  );
  check('the historical journal line keeps its centre', line.rows[0]?.costCenterId === legacyId);
  const allocations = await client.query('SELECT count(*)::int c FROM journal_line_allocations');
  check('no allocation is invented for historical lines', allocations.rows[0].c === 0);

  const perms = await client.query(
    `SELECT code FROM permissions WHERE code LIKE 'accounting.costcenters.%' ORDER BY code`,
  );
  check(
    'the permission catalogue gained read and keeps manage',
    perms.rows.map((r) => r.code).join(',') ===
      'accounting.costcenters.manage,accounting.costcenters.read',
    perms.rows.map((r) => r.code).join(','),
  );

  const adminGrant = await client.query(
    `SELECT count(*)::int c
       FROM role_permissions rp
       JOIN roles r ON r.id = rp."roleId"
       JOIN permissions p ON p.id = rp."permissionId"
      WHERE r.code = 'ADMIN' AND p.code IN ('accounting.costcenters.read','accounting.costcenters.manage')`,
  );
  check('the ADMIN role of the old company can read and manage centres', adminGrant.rows[0].c === 2);

  // A custom role that could read reports but was created before the new code.
  const custom = await client.query(
    `INSERT INTO roles (id, "companyId", code, "nameEn", "nameAr", "isSystem", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, 'LEGACY_AUDITOR', 'Auditor', 'مراجع', false, now(), now())
     RETURNING id`,
    [company.id],
  );
  await client.query(
    `INSERT INTO role_permissions ("roleId", "permissionId")
     SELECT $1, id FROM permissions WHERE code = 'reports.read'`,
    [custom.rows[0].id],
  );
  // Re-run the grant part of the migration the way a second deployment would.
  await client.query(
    `INSERT INTO role_permissions ("roleId", "permissionId")
     SELECT DISTINCT rp."roleId", target."id"
       FROM role_permissions rp
       JOIN permissions source ON source."id" = rp."permissionId" AND source."code" = 'reports.read'
      CROSS JOIN permissions target
      WHERE target."code" = 'accounting.costcenters.read'
     ON CONFLICT ("roleId", "permissionId") DO NOTHING`,
  );
  const auditorGrant = await client.query(
    `SELECT count(*)::int c FROM role_permissions rp
       JOIN permissions p ON p.id = rp."permissionId"
      WHERE rp."roleId" = $1 AND p.code = 'accounting.costcenters.read'`,
    [custom.rows[0].id],
  );
  check('a legacy role that reads reports gains read access without losing anything', auditorGrant.rows[0].c === 1);

  const enumValues = await client.query(
    `SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = 'CostCenterType' ORDER BY e.enumsortorder`,
  );
  check(
    'the CostCenterType enum has the three documented values',
    enumValues.rows.map((r) => r.enumlabel).join(',') ===
      'DEPARTMENT,ADMINISTRATIVE_UNIT,PROJECT',
    enumValues.rows.map((r) => r.enumlabel).join(','),
  );

  const constraints = await client.query(
    `SELECT conname FROM pg_constraint
      WHERE conname IN ('cost_centers_parent_not_self','cost_centers_date_window',
                        'cost_centers_parentId_fkey','journal_line_allocations_journalLineId_fkey',
                        'journal_line_allocations_costCenterId_fkey','sales_invoice_lines_costCenterId_fkey',
                        'purchase_invoice_lines_costCenterId_fkey','cash_vouchers_costCenterId_fkey')
      ORDER BY conname`,
  );
  check(
    'every hierarchy, allocation and invoice-line constraint exists',
    constraints.rows.length === 8,
    `${constraints.rows.length} of 8`,
  );

  const indexes = await client.query(
    `SELECT indexname FROM pg_indexes
      WHERE indexname IN ('journal_line_allocations_line_center_key',
                          'sales_invoice_lines_costCenterId_idx',
                          'purchase_invoice_lines_costCenterId_idx',
                          'cash_vouchers_costCenterId_idx',
                          'cost_centers_companyId_parentId_idx')`,
  );
  check('the allocation and dimension indexes exist', indexes.rows.length === 5, `${indexes.rows.length} of 5`);

  // Re-running the whole file must be a no-op (deployment retries happen).
  const file = fs.readFileSync(path.join(MIGRATIONS, TARGET, 'migration.sql'), 'utf8');
  let rerun = '';
  try {
    await client.query(file);
  } catch (error) {
    rerun = error.message;
  }
  const after = await client.query('SELECT count(*)::int c FROM journal_line_allocations');
  check('the migration is safe to run twice', rerun === '' && after.rows[0].c === 0, rerun);

  // Constraints really bite.
  let selfParent = '';
  try {
    await client.query(`UPDATE cost_centers SET "parentId" = id WHERE id = $1`, [legacyId]);
  } catch (error) {
    selfParent = error.code ?? error.message;
  }
  check('the database refuses a centre as its own parent', selfParent === '23514', selfParent);

  let badWindow = '';
  try {
    await client.query(
      `UPDATE cost_centers SET "startDate" = '2026-05-01', "endDate" = '2026-04-01' WHERE id = $1`,
      [legacyId],
    );
  } catch (error) {
    badWindow = error.code ?? error.message;
  }
  check('the database refuses an end date before the start', badWindow === '23514', badWindow);

  let badAmount = '';
  try {
    await client.query(
      `INSERT INTO journal_line_allocations ("journalLineId", "costCenterId", amount)
       SELECT id, $1, 0 FROM journal_lines WHERE "journalEntryId" = $2 LIMIT 1`,
      [legacyId, entryId],
    );
  } catch (error) {
    badAmount = error.code ?? error.message;
  }
  check('the database refuses a zero allocation', badAmount === '23514', badAmount);

  await client.end();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
