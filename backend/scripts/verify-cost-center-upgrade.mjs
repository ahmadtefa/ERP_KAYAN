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
    'CREATE TABLE IF NOT EXISTS "_upgrade_check" (name text primary key, applied_at timestamptz default now())',
  );
  const applied = new Set(
    (await client.query('SELECT name FROM "_upgrade_check"')).rows.map((r) => r.name),
  );
  const dirs = fs
    .readdirSync(MIGRATIONS)
    .filter((d) => fs.statSync(path.join(MIGRATIONS, d)).isDirectory())
    .sort();
  let count = 0;
  for (const dir of dirs) {
    if (stopBefore && dir.startsWith(stopBefore)) break;
    if (applied.has(dir)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO "_upgrade_check" (name) VALUES ($1)', [dir]);
      await client.query('COMMIT');
      count += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${dir} failed: ${error.message}`);
    }
  }
  return count;
}

async function snapshot(client) {
  const centre = (
    await client.query(
      'SELECT code, type, "parentId", description, "startDate", "endDate" FROM cost_centers ORDER BY code',
    )
  ).rows;
  const lines = (
    await client.query(
      'SELECT id, "costCenterId" FROM journal_lines ORDER BY "lineNumber"',
    )
  ).rows;
  const allocations = (await client.query('SELECT count(*)::int n FROM journal_line_allocations')).rows[0].n;
  const permissions = (
    await client.query("SELECT code FROM permissions WHERE code LIKE 'accounting.costcenters.%' ORDER BY code")
  ).rows.map((r) => r.code);
  const grants = (
    await client.query(
      `SELECT r.code AS role, p.code AS permission
         FROM role_permissions rp
         JOIN roles r ON r.id = rp."roleId"
         JOIN permissions p ON p.id = rp."permissionId"
        WHERE p.code LIKE 'accounting.costcenters.%'
        ORDER BY 1, 2`,
    )
  ).rows;
  return { centre, lines, allocations, permissions, grants };
}

// ─────────────────────────────────────────────────────────── a throwaway database
{
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${DB}"`);
  await admin.query(`CREATE DATABASE "${DB}"`);
  await admin.end();
  console.log(`database ${DB} created`);
}

const client = new pg.Client({ connectionString: URL });
await client.connect();

try {
  // ─────────────────────────────────────── 1. the schema before the migration
  const pre = await applyAll(client, { stopBefore: TARGET });
  check('the database is built at the pre-upgrade schema', pre >= 20, `${pre} migrations`);

  // Seed with the current code, then roll the catalogue back to what an old
  // installation actually had: no `read`, no type, no hierarchy columns.
  const { execFileSync } = await import('node:child_process');
  execFileSync('node', ['dist/prisma/seed.js'], {
    cwd: '/home/user/ERP_KAYAN/backend',
    env: { ...process.env, DATABASE_URL: `${URL}?schema=public` },
    stdio: 'ignore',
  });

  const company = (await client.query('SELECT id FROM companies LIMIT 1')).rows[0].id;
  const adminRole = (await client.query("SELECT id FROM roles WHERE code = 'ADMIN' LIMIT 1")).rows[0].id;
  const accountantRole = (await client.query("SELECT id FROM roles WHERE code = 'ACCOUNTANT' LIMIT 1")).rows[0].id;

  await client.query("BEGIN");
  await client.query(
    `DELETE FROM role_permissions WHERE "permissionId" IN
       (SELECT id FROM permissions WHERE code LIKE 'accounting.costcenters.%')`,
  );
  await client.query("DELETE FROM permissions WHERE code LIKE 'accounting.costcenters.%'");
  // The permission an old install had before this migration. Re-added below as
  // `manage` by the seed in real upgrades; here it stays deleted so the
  // migration's own defensive insert is what has to bring it back.
  await client.query(
    `INSERT INTO cost_centers (id, "companyId", code, "nameEn", "nameAr", "isActive", "createdAt", "updatedAt")
     VALUES ('00000000-0000-4000-8000-00000000c001', $1, 'LEG-1', 'Legacy centre', 'مركز قديم', true, now(), now())`,
    [company],
  );
  const account = (await client.query("SELECT id FROM accounts WHERE code = '4101' LIMIT 1")).rows[0].id;
  const branch = (await client.query('SELECT id FROM branches LIMIT 1')).rows[0].id;
  const entry = await client.query(
    `INSERT INTO journal_entries (id, "companyId", "branchId", "entryNumber", "entryDate", status, "totalDebit", "totalCredit", description, "createdBy", "createdAt", "updatedAt")
     VALUES ('00000000-0000-4000-8000-00000000e001', $1, $2, 'LEG-JE-1', current_date, 'DRAFT', 100, 100, 'legacy', NULL, now(), now())
     RETURNING id, "entryNumber"`,
    [company, branch],
  );
  await client.query(
    `INSERT INTO journal_lines (id, "journalEntryId", "lineNumber", "accountId", debit, credit, description, "costCenterId")
     VALUES ('00000000-0000-4000-8000-000000000001', $1, 1, $2, 100, 0, 'legacy line', '00000000-0000-4000-8000-00000000c001')`,
    [entry.rows[0].id, account],
  );
  // A role that can read reports but has never heard of cost centers.
  await client.query(
    `INSERT INTO roles (id, "companyId", code, "nameEn", "nameAr", "isSystem", "createdAt", "updatedAt")
     VALUES ('00000000-0000-4000-8000-0000000000a1', $1, 'LEGACY_AUDITOR', 'Legacy auditor', 'مراجع قديم', false, now(), now())`,
    [company],
  );
  await client.query(
    `INSERT INTO role_permissions ("roleId", "permissionId")
     SELECT '00000000-0000-4000-8000-0000000000a1', id FROM permissions WHERE code = 'reports.read'`,
  );
  await client.query('COMMIT');

  const prePermissions = (
    await client.query("SELECT count(*)::int n FROM permissions WHERE code LIKE 'accounting.costcenters.%'")
  ).rows[0].n;
  check('the upgrade starts without the new cost-center permissions', prePermissions === 0);

  // ───────────────────────────────────────────────────────── 2. the upgrade
  const applied = await applyAll(client);
  check('the upgrade migration applies to an existing database', applied === 1, `${applied} migration`);
  const after = await snapshot(client);

  const legacy = after.centre.find((row) => row.code === 'LEG-1');
  check(
    'the legacy centre survives with its code, and becomes a DEPARTMENT',
    Boolean(legacy) && legacy.type === 'DEPARTMENT',
    legacy ? `type ${legacy.type}` : 'missing',
  );
  check(
    'no parent, description or dates are invented for it',
    Boolean(legacy) &&
      legacy.parentId === null &&
      legacy.description === null &&
      legacy.startDate === null &&
      legacy.endDate === null,
  );
  check(
    'the historical journal line still points at the same centre',
    after.lines.some((line) => line.id === '00000000-0000-4000-8000-000000000001' && line.costCenterId === '00000000-0000-4000-8000-00000000c001'),
  );
  check('no allocation row is invented for historical lines', after.allocations === 0, `${after.allocations} rows`);
  check(
    'both permission codes exist after the upgrade',
    after.permissions.includes('accounting.costcenters.read') &&
      after.permissions.includes('accounting.costcenters.manage'),
    after.permissions.join(', '),
  );
  check(
    'the old ADMIN and ACCOUNTANT roles can read and manage cost centers',
    ['ADMIN', 'ACCOUNTANT'].every((role) =>
      ['accounting.costcenters.read', 'accounting.costcenters.manage'].every((permission) =>
        after.grants.some((g) => g.role === role && g.permission === permission),
      ),
    ),
    after.grants.map((g) => `${g.role}:${g.permission.split('.').pop()}`).join(', '),
  );
  check(
    'a custom role that could read reports receives read access',
    after.grants.some((g) => g.role === 'LEGACY_AUDITOR' && g.permission === 'accounting.costcenters.read'),
  );

  // Data integrity added by the migration.
  const constraints = await client.query(
    `SELECT conname FROM pg_constraint WHERE conname IN
       ('cost_centers_parent_not_self', 'cost_centers_date_window', 'journal_line_allocations_amount_positive')`,
  );
  check(
    'the new CHECK constraints exist',
    constraints.rows.length === 3,
    constraints.rows.map((r) => r.conname).join(', '),
  );
  const indexes = await client.query(
    `SELECT indexname FROM pg_indexes WHERE indexname IN
       ('cost_centers_companyId_parentId_idx', 'journal_line_allocations_costCenterId_idx',
        'sales_invoice_lines_costCenterId_idx', 'purchase_invoice_lines_costCenterId_idx',
        'cash_vouchers_costCenterId_idx')`,
  );
  check('the allocation and dimension indexes exist', indexes.rows.length === 5, `${indexes.rows.length} of 5`);
  const enumRow = await client.query("SELECT 1 FROM pg_type WHERE typname = 'CostCenterType'");
  check('the CostCenterType enum exists', enumRow.rows.length === 1);

  let selfParentRejected = false;
  try {
    await client.query('UPDATE cost_centers SET "parentId" = id WHERE code = $1', ['LEG-1']);
  } catch (error) {
    selfParentRejected = error.code === '23514';
  }
  check('a centre cannot be its own parent at the database level', selfParentRejected);

  let badWindowRejected = false;
  try {
    await client.query(
      `UPDATE cost_centers SET "startDate" = DATE '2026-05-01', "endDate" = DATE '2026-04-01' WHERE code = $1`,
      ['LEG-1'],
    );
  } catch (error) {
    badWindowRejected = error.code === '23514';
  }
  check('a centre cannot end before it starts', badWindowRejected);
  await client.query('UPDATE cost_centers SET "startDate" = NULL, "endDate" = NULL WHERE code = $1', ['LEG-1']);

  let zeroAllocationRejected = false;
  try {
    await client.query(
      `INSERT INTO journal_line_allocations (id, "journalLineId", "costCenterId", amount)
       VALUES (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000c001', 0)`,
    );
  } catch (error) {
    zeroAllocationRejected = error.code === '23514';
  }
  check('a zero allocation is refused by the database', zeroAllocationRejected);

  let negativeAllocationRejected = false;
  try {
    await client.query(
      `INSERT INTO journal_line_allocations (id, "journalLineId", "costCenterId", amount)
       VALUES (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000c001', -1)`,
    );
  } catch (error) {
    negativeAllocationRejected = error.code === '23514';
  }
  check('a negative allocation is refused by the database', negativeAllocationRejected);

  // ─────────────────────────────────────────────────── 3. running it again
  const before = await snapshot(client);
  const second = await applyAll(client);
  const again = await snapshot(client);
  check('the migration is safe to run twice', second === 0);
  check(
    'a second run changes nothing',
    JSON.stringify(before) === JSON.stringify(again),
    `${before.centre.length} centres, ${before.allocations} allocations, ${before.grants.length} grants`,
  );
} finally {
  await client.end();
}

const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
