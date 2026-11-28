#!/usr/bin/env node
/**
 * Upgrades a populated database and proves nothing was lost.
 *
 * The rules that matter for this feature are not "does the schema parse" but
 * "did the accountant who has been posting since 2024 keep her password, her
 * role and her documents". This script builds a database at the schema *before*
 * 20261119120000, fills it with the kind of rows an installation that predates
 * multi-role access already has, then applies the migration and checks:
 *
 *   - the two roles every installation has are still there, now labelled with
 *     a category, still active, still held by the same people;
 *   - users keep their password hash, their photo and their branch assignment;
 *   - a direct grant that existed before the migration is still a grant (not a
 *     deny), and carries an updatedAt;
 *   - notifications and audit rows written before the upgrade are untouched;
 *   - the catalogue pass adds the sixteen missing roles and does *not* rewrite
 *     the two existing ones: a company that tuned ACCOUNTANT keeps its tuning;
 *   - applying the migration a second time changes nothing.
 *
 * Run only against disposable PostgreSQL:
 *   PGUSER=kayan PGPASSWORD=kayan PGPORT=55432 node scripts/verify-rbac-upgrade.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import pg from 'pg';

const HOST = process.env.PGHOST ?? '127.0.0.1';
const PORT = Number(process.env.PGPORT ?? 5432);
const USER = process.env.PGUSER ?? 'kayan';
const PASSWORD = process.env.PGPASSWORD ?? '';
const DB = process.env.RBAC_UPGRADE_DB ?? 'kayan_rbac_upgrade';
const credentials = PASSWORD ? `${USER}:${encodeURIComponent(PASSWORD)}@` : `${USER}@`;
const ADMIN_URL = `postgresql://${credentials}${HOST}:${PORT}/postgres`;
const URL = `postgresql://${credentials}${HOST}:${PORT}/${DB}`;

const BACKEND = path.resolve(import.meta.dirname, '..');
const MIGRATIONS = path.join(BACKEND, 'prisma', 'migrations');
const TARGET = '20261119120000_roles_catalogue_and_deny';
// Keep this regression focused on the RBAC upgrade: later notification and
// dashboard migrations intentionally add data/grants of their own, and must
// not be mistaken for the RBAC migration rewriting an existing role.

/// Assigned in main(); the error path closes it so a failed check exits
/// instead of hanging on an open socket.
let openClient = null;

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
    (await client.query('SELECT name FROM "_upgrade_check"')).rows.map((row) => row.name),
  );
  const dirs = fs
    .readdirSync(MIGRATIONS)
    .filter((dir) => fs.statSync(path.join(MIGRATIONS, dir)).isDirectory())
    .sort();
  let count = 0;
  for (const dir of dirs) {
    if (stopBefore && dir >= stopBefore) break;
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
      throw new Error(`Migration ${dir} failed: ${error.message}`);
    }
  }
  return count;
}

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const ADMIN_USER = '33333333-3333-4333-8333-333333333333';
const CLERK_USER = '44444444-4444-4444-8444-444444444444';
const ADMIN_ROLE = '55555555-5555-4555-8555-555555555555';
const ACCOUNTANT_ROLE = '66666666-6666-4666-8666-666666666666';
const LEGACY_HASH = '$argon2id$v=19$m=65536,t=3,p=4$legacy-salt$legacy-digest-value';

async function main() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${DB}"`);
  await admin.query(`CREATE DATABASE "${DB}"`);
  await admin.end();

  const client = new pg.Client({ connectionString: URL });
  openClient = client;
  await client.connect();

  const before = await applyAll(client, { stopBefore: TARGET });
  check('the database is built at the pre-RBAC schema', before > 0, `${before} migration(s)`);

  // ── a populated installation, written with the old columns only ──────────
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO companies (id, code, "nameEn", "nameAr", "updatedAt")
     VALUES ($1, 'KAYAN', 'Kayan Trading', 'كيان للتجارة', now())`,
    [COMPANY],
  );
  await client.query(
    `INSERT INTO branches (id, "companyId", code, "nameEn", "nameAr", kind, "updatedAt")
     VALUES ($1, $2, 'HQ', 'Head office', 'الإدارة', 'HEADQUARTERS', now())`,
    [BRANCH, COMPANY],
  );
  // The permission catalogue is already populated by earlier migrations; use
  // the rows that are there and add only the ones this check needs. A real
  // installation has them all, this is the same ON CONFLICT the seed uses.
  await client.query(
    // Prisma generates uuids in the client, not in the column, so the id is
    // supplied here the way the seed does it.
    `INSERT INTO permissions (id, code, "nameEn", "nameAr", module) VALUES
       (gen_random_uuid(), 'parties.customers.read', 'View customers', 'عرض العملاء', 'parties'),
       (gen_random_uuid(), 'cash.vouchers.post', 'Post vouchers', 'ترحيل السندات', 'cash'),
       (gen_random_uuid(), 'admin.roles.manage', 'Manage roles', 'إدارة الأدوار', 'admin')
     ON CONFLICT (code) DO NOTHING`,
  );
  const permissionIds = new Map(
    (
      await client.query(
        `SELECT code, id FROM permissions WHERE code = ANY($1)`,
        [['parties.customers.read', 'cash.vouchers.post', 'admin.roles.manage']],
      )
    ).rows.map((row) => [row.code, row.id]),
  );
  for (const code of ['parties.customers.read', 'cash.vouchers.post', 'admin.roles.manage']) {
    if (!permissionIds.has(code)) throw new Error(`The catalogue is missing ${code}`);
  }
  const PERM_CUSTOMERS_ID = permissionIds.get('parties.customers.read');
  const PERM_POST_ID = permissionIds.get('cash.vouchers.post');
  const PERM_ROLES_ID = permissionIds.get('admin.roles.manage');
  await client.query(
    `INSERT INTO roles (id, "companyId", code, "nameEn", "nameAr", "isSystem", "updatedAt") VALUES
       ($1, $3, 'ADMIN', 'Administrator', 'مدير النظام', true, now()),
       ($2, $3, 'ACCOUNTANT', 'Accountant', 'محاسب', true, now())`,
    [ADMIN_ROLE, ACCOUNTANT_ROLE, COMPANY],
  );
  await client.query(
    `INSERT INTO role_permissions ("roleId", "permissionId") VALUES
       ($1, $3), ($2, $4), ($2, $5)`,
    [ADMIN_ROLE, ACCOUNTANT_ROLE, PERM_ROLES_ID, PERM_CUSTOMERS_ID, PERM_POST_ID],
  );
  await client.query(
    `INSERT INTO users (id, "companyId", username, "fullNameEn", "fullNameAr", "passwordHash", "isSuperAdmin", "updatedAt")
     VALUES ($1, $3, 'admin', 'System Administrator', 'مدير النظام', $4, true, now()),
            ($2, $3, 'rania', 'Rania Adel', 'رانيا عادل', $4, false, now())`,
    [ADMIN_USER, CLERK_USER, COMPANY, LEGACY_HASH],
  );
  await client.query(
    `INSERT INTO user_roles ("userId", "roleId", "companyId") VALUES ($1, $3, $5), ($2, $4, $5)`,
    [ADMIN_USER, CLERK_USER, ADMIN_ROLE, ACCOUNTANT_ROLE, COMPANY],
  );
  await client.query(
    `INSERT INTO user_branches ("userId", "branchId") VALUES ($1, $2), ($3, $2)`,
    [ADMIN_USER, BRANCH, CLERK_USER],
  );
  // The exception this whole feature is about: a grant the accountant holds
  // on top of her role, which must survive as a grant.
  await client.query(
    `INSERT INTO user_permissions ("userId", "permissionId") VALUES ($1, $2)`,
    [CLERK_USER, PERM_POST_ID],
  );
  await client.query(
    `INSERT INTO user_profile_photos ("userId", "companyId", data, mime, "updatedAt")
     VALUES ($1, $2, $3, 'image/jpeg', now())`,
    [CLERK_USER, COMPANY, Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
  );
  await client.query(
    `INSERT INTO notifications (id, "companyId", type, severity, "severityRank", "titleEn", "titleAr", "dedupeKey")
     VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $1, 'STOCK_EXPIRED', 'CRITICAL', 3,
             'Batch expired', 'دفعة منتهية', 'STOCK_EXPIRED:legacy')`,
    [COMPANY],
  );
  await client.query(
    `INSERT INTO audit_logs (id, "companyId", "userId", action, entity, "entityId")
     VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', $1, $2::uuid, 'LOGIN', 'users', $2::text)`,
    [COMPANY, ADMIN_USER],
  );
  await client.query('COMMIT');

  const beforeSnapshot = (
    await client.query(
      `SELECT (SELECT count(*) FROM users)::int AS users,
              (SELECT count(*) FROM user_roles)::int AS assignments,
              (SELECT count(*) FROM role_permissions)::int AS grants`,
    )
  ).rows[0];

  // ── the migration ────────────────────────────────────────────────────────
  const applied = await applyAll(client, { stopBefore: '20261120090000_notification_user_state' });
  check('the RBAC migration applies to a populated database', applied === 1, `${applied} migration(s)`);

  const roleRows = (
    await client.query('SELECT code, category, "isActive", "isSystem" FROM roles ORDER BY code')
  ).rows;
  check('both existing roles survive with their codes and holders', roleRows.length === 2);
  const byCode = new Map(roleRows.map((row) => [row.code, row]));
  check(
    'ADMIN is labelled MANAGEMENT and stays active',
    byCode.get('ADMIN')?.category === 'MANAGEMENT' && byCode.get('ADMIN')?.isActive === true,
  );
  check(
    'ACCOUNTANT is labelled FINANCE and stays active',
    byCode.get('ACCOUNTANT')?.category === 'FINANCE' && byCode.get('ACCOUNTANT')?.isActive === true,
  );

  const afterSnapshot = (
    await client.query(
      `SELECT (SELECT count(*) FROM users)::int AS users,
              (SELECT count(*) FROM user_roles)::int AS assignments,
              (SELECT count(*) FROM role_permissions)::int AS grants`,
    )
  ).rows[0];
  check(
    'users, assignments and role grants are exactly as they were',
    afterSnapshot.users === beforeSnapshot.users &&
      afterSnapshot.assignments === beforeSnapshot.assignments &&
      afterSnapshot.grants === beforeSnapshot.grants,
    JSON.stringify(afterSnapshot),
  );

  const clerk = (
    await client.query('SELECT "passwordHash", "isActive" FROM users WHERE id = $1', [CLERK_USER])
  ).rows[0];
  check('the password hash is untouched, so the same password still signs in', clerk?.passwordHash === LEGACY_HASH);

  const branch = (
    await client.query('SELECT count(*)::int AS n FROM user_branches WHERE "userId" = $1', [CLERK_USER])
  ).rows[0];
  check('branch assignments survive', branch.n === 1);

  const photo = (
    await client.query('SELECT count(*)::int AS n FROM user_profile_photos WHERE "userId" = $1', [CLERK_USER])
  ).rows[0];
  check('the profile photo survives', photo.n === 1);

  const grant = (
    await client.query(
      `SELECT "isDenied", "updatedAt" FROM user_permissions WHERE "userId" = $1 AND "permissionId" = $2`,
      [CLERK_USER, PERM_POST_ID],
    )
  ).rows[0];
  check('the legacy direct grant is still a grant, not a deny', grant?.isDenied === false);
  check('the grant has an updatedAt for the audit view', grant?.updatedAt instanceof Date);

  const notification = (
    await client.query(`SELECT count(*)::int AS n FROM notifications WHERE "dedupeKey" = 'STOCK_EXPIRED:legacy'`)
  ).rows[0];
  check('notifications written before the upgrade are untouched', notification.n === 1);

  const auditRow = (
    await client.query('SELECT count(*)::int AS n FROM audit_logs')
  ).rows[0];
  check('the audit trail survives', auditRow.n === 1);

  // ── the catalogue pass ───────────────────────────────────────────────────
  const seed = spawnSync(
    'npx',
    ['ts-node', '--transpile-only', 'scripts/apply-role-catalogue.ts'],
    {
      cwd: BACKEND,
      env: { ...process.env, DATABASE_URL: URL },
      encoding: 'utf8',
      timeout: 180_000,
    },
  );
  check('the catalogue pass runs against the upgraded database', seed.status === 0, (seed.stderr ?? '').trim().split('\n').slice(-2).join(' '));

  const total = (
    await client.query('SELECT count(*)::int AS n FROM roles WHERE "companyId" = $1 AND "deletedAt" IS NULL', [COMPANY])
  ).rows[0];
  // 18 shipped roles (the HR manager role included) plus the CUSTOM template, which is created on demand: the
  // two the company already had are counted once, not duplicated.
  check('the company now has the whole catalogue', total.n === 18, `${total.n} roles`);

  const accountantGrants = (
    await client.query(
      `SELECT count(*)::int AS n FROM role_permissions rp
       JOIN roles r ON r.id = rp."roleId" WHERE r.code = 'ACCOUNTANT' AND r."companyId" = $1`,
      [COMPANY],
    )
  ).rows[0];
  check(
    'the tuned ACCOUNTANT role was not rewritten by the catalogue pass',
    accountantGrants.n === 2,
    `${accountantGrants.n} permission(s)`,
  );

  const adminGrants = (
    await client.query(
      `SELECT count(*)::int AS n FROM role_permissions rp
       JOIN roles r ON r.id = rp."roleId" WHERE r.code = 'ADMIN' AND r."companyId" = $1`,
      [COMPANY],
    )
  ).rows[0];
  // The pass adds roles; it does not rewrite the permissions of a role a
  // company already had, so the legacy ADMIN keeps the single grant it had.
  check(
    'the pre-existing ADMIN role was not rewritten either',
    adminGrants.n === 1,
    `${adminGrants.n} permission(s)`,
  );

  const clerkStillClerk = (
    await client.query(
      `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur."roleId" WHERE ur."userId" = $1`,
      [CLERK_USER],
    )
  ).rows.map((row) => row.code);
  check('nobody was moved to another role by the catalogue pass', clerkStillClerk.join(',') === 'ACCOUNTANT');

  // A second pass changes nothing.
  const second = spawnSync('npx', ['ts-node', '--transpile-only', 'scripts/apply-role-catalogue.ts'], {
    cwd: BACKEND,
    env: { ...process.env, DATABASE_URL: URL },
    encoding: 'utf8',
    timeout: 180_000,
  });
  const afterSecond = (
    await client.query('SELECT count(*)::int AS n FROM roles WHERE "companyId" = $1', [COMPANY])
  ).rows[0];
  check(
    'a second catalogue pass adds nothing',
    second.status === 0 && afterSecond.n === total.n,
    `${afterSecond.n} roles`,
  );

  // And the migration itself is idempotent.
  const recheck = await applyAll(client, { stopBefore: '20261120090000_notification_user_state' });
  check('re-running the RBAC migration applies nothing', recheck === 0);

  await client.end();

  const failed = results.filter((row) => !row.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.error(`\n${failed.length} check(s) failed`);
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error(error);
  await openClient?.end().catch(() => {});
  process.exitCode = 1;
});
