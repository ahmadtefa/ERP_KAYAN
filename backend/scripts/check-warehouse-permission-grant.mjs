/**
 * Proves that an installation which already exists receives the warehouse
 * permissions when it upgrades.
 *
 * Every feature added after a customer installed KAYAN is a permission an old
 * database does not have. The screens then answer "permission required" to
 * everybody - the owner included - which is indistinguishable from a broken
 * build. The migration `*_grant_warehouse_permissions` exists to prevent that,
 * and this script proves it on a populated, pre-upgrade database rather than on
 * an empty one:
 *
 *   1. creates `kayan_grant_probe_<stamp>` on the same server;
 *   2. applies every migration that came before the grant one, in filename
 *      order, from the project's own SQL files - the exact bytes an installer
 *      replays;
 *   3. fills it the way a running shop looks: a catalogue without the new
 *      codes, and roles that already hold the older permissions - a storekeeper
 *      who adjusts stock, an accountant who keeps the books, a cashier who
 *      sells, a receiver who buys, an administrator who manages users, a
 *      watcher with nothing relevant, and a role that was deleted last year;
 *   4. applies the grant migration;
 *   5. checks every promise the migration makes: the eighteen codes exist, each
 *      role receives exactly the grants its old permissions justify, approval
 *      is not handed to people who only move goods, the deleted role gets
 *      nothing, nothing that existed before is removed, and replaying the file
 *      changes nothing at all;
 *   6. drops the probe database, whatever happened.
 *
 * Usage:
 *   DATABASE_URL=postgresql://user:pass@host:5432/erp_kayan \
 *   node scripts/check-warehouse-permission-grant.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

function withDatabase(connectionString, database) {
  const parsed = new URL(connectionString);
  parsed.pathname = `/${database}`;
  parsed.search = '';
  return parsed.toString();
}

const adminUrl = process.env.ADMIN_DATABASE_URL ?? withDatabase(url, 'postgres');

const migrationsDir = join('prisma', 'migrations');
const folders = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const grantFolders = folders.filter((name) => name.endsWith('_grant_warehouse_permissions'));
if (grantFolders.length !== 1) {
  throw new Error(
    `expected exactly one *_grant_warehouse_permissions migration, found ${grantFolders.length}`,
  );
}
const grantFolder = grantFolders[0];
const before = folders.filter((name) => name < grantFolder);
const sqlOf = (folder) => readFileSync(join(migrationsDir, folder, 'migration.sql'), 'utf8');

const stamp = `${Date.now().toString(36)}${process.pid.toString(36)}`.toLowerCase();
const probeDb = `kayan_grant_probe_${stamp}`;

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';

/// The eighteen codes the warehouse work introduced. The same list lives in
/// `prisma/permissions.ts`; the migration is what puts them into a database
/// that predates them.
const NEW_CODES = [
  'inventory.batches.read',
  'inventory.batches.receive',
  'inventory.batches.issue',
  'inventory.batches.writeoff',
  'inventory.batches.transfer',
  'inventory.stocktake.read',
  'inventory.stocktake.create',
  'inventory.stocktake.count',
  'inventory.stocktake.approve',
  'inventory.stocktake.post',
  'inventory.writeoff.read',
  'inventory.writeoff.create',
  'inventory.writeoff.approve',
  'inventory.writeoff.post',
  'inventory.warehouse.access.read',
  'inventory.warehouse.access.manage',
  'notifications.read',
  'notifications.manage',
];

/// What a role that already existed should hold afterwards, derived from the
/// migration's own stated policy. The anchors are the older permissions; the
/// expectation is written out here so a change of policy fails the check
/// instead of quietly widening somebody's rights.
const READ_SET = [
  'inventory.batches.read',
  'inventory.stocktake.read',
  'inventory.writeoff.read',
  'inventory.warehouse.access.read',
  'notifications.read',
];
const APPROVAL_SET = [
  'inventory.stocktake.approve',
  'inventory.stocktake.post',
  'inventory.writeoff.approve',
  'inventory.writeoff.post',
];
const EXPECTED = {
  STOREKEEPER: [
    ...READ_SET,
    'inventory.batches.receive',
    'inventory.batches.issue',
    'inventory.batches.transfer',
    'inventory.batches.writeoff',
    'inventory.stocktake.create',
    'inventory.stocktake.count',
    'inventory.writeoff.create',
  ],
  ACCOUNTANT: [...READ_SET, ...APPROVAL_SET],
  CASHIER: [...READ_SET, 'inventory.batches.issue'],
  RECEIVER: [...READ_SET, 'inventory.batches.receive'],
  ADMIN: [...READ_SET, 'notifications.manage', 'inventory.warehouse.access.manage'],
  WATCHER: [],
  GONE: [],
};

/// The catalogue as it stood before the warehouse work: the anchors the
/// migration keys off, plus unrelated codes that must survive untouched.
const OLD_CATALOGUE = [
  ['inventory.items.read', 'View items', 'عرض الأصناف', 'inventory'],
  ['inventory.stock.read', 'View stock', 'عرض المخزون', 'inventory'],
  ['inventory.stock.adjust', 'Adjust, transfer and count stock', 'تسويات وتحويلات وجرد المخزون', 'inventory'],
  ['reports.read', 'View reports', 'عرض التقارير', 'reports'],
  ['sales.invoices.create', 'Create sales invoices', 'إنشاء فواتير بيع', 'sales'],
  ['purchases.invoices.create', 'Create purchase invoices', 'إنشاء فواتير شراء', 'purchases'],
  ['accounting.journal.create', 'Create journal entries', 'إنشاء قيود يومية', 'accounting'],
  ['admin.users.manage', 'Manage users', 'إدارة المستخدمين', 'admin'],
];

const ROLE_LINKS = {
  STOREKEEPER: ['inventory.stock.adjust'],
  ACCOUNTANT: ['accounting.journal.create', 'reports.read'],
  CASHIER: ['sales.invoices.create'],
  RECEIVER: ['purchases.invoices.create'],
  ADMIN: ['admin.users.manage'],
  WATCHER: ['inventory.items.read'],
  GONE: ['inventory.stock.adjust'],
};

const admin = new pg.Client({ connectionString: adminUrl });
const probe = new pg.Client({ connectionString: withDatabase(url, probeDb) });

const grantRowsForRole = async (code) =>
  (
    await probe.query(
      `select p.code
         from role_permissions rp
         join roles r on r.id = rp."roleId"
         join permissions p on p.id = rp."permissionId"
        where r.code = $1
        order by p.code`,
      [code],
    )
  ).rows.map((row) => row.code);

const countOf = async (table) =>
  (await probe.query(`select count(*)::int as n from "${table}"`)).rows[0].n;

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${probeDb}"`);
  console.log(`created throwaway database ${probeDb}`);

  await probe.connect();

  for (const folder of before) {
    await probe.query(sqlOf(folder));
  }
  console.log(`applied ${before.length} migrations that predate the warehouse grant`);

  // A company and a branch, because roles may belong to one.
  await probe.query(
    `INSERT INTO companies (id, code, "nameEn", "nameAr", "updatedAt")
     VALUES ($1, 'GRANT-PROBE', 'Grant probe', 'فحص الصلاحيات', now());
     INSERT INTO branches (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
     VALUES ($2, $1, 'B1', 'Main', 'الرئيسي', now());`,
    [COMPANY, BRANCH],
  );

  const permissionIds = new Map();
  for (const [code, nameEn, nameAr, module] of OLD_CATALOGUE) {
    const row = await probe.query(
      `INSERT INTO permissions (id, code, "nameEn", "nameAr", module)
       VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING id`,
      [code, nameEn, nameAr, module],
    );
    permissionIds.set(code, row.rows[0].id);
  }

  const roleIds = new Map();
  for (const [code, links] of Object.entries(ROLE_LINKS)) {
    const row = await probe.query(
      `INSERT INTO roles (id, "companyId", code, "nameEn", "nameAr", "isSystem", "updatedAt", "deletedAt")
       VALUES (gen_random_uuid(), $1, $2, $2, $2, false, now(), $3) RETURNING id`,
      [COMPANY, code, code === 'GONE' ? new Date('2025-01-01T00:00:00Z') : null],
    );
    const roleId = row.rows[0].id;
    roleIds.set(code, roleId);
    for (const permission of links) {
      await probe.query(
        `INSERT INTO role_permissions ("roleId", "permissionId") VALUES ($1, $2)`,
        [roleId, permissionIds.get(permission)],
      );
    }
  }
  console.log(
    `seeded ${Object.keys(ROLE_LINKS).length} roles and ${OLD_CATALOGUE.length} permissions the way a running shop looks`,
  );

  const beforeCounts = {
    permissions: await countOf('permissions'),
    role_permissions: await countOf('role_permissions'),
    roles: await countOf('roles'),
  };
  const beforeLinks = (
    await probe.query(
      `select r.code as role, p.code as permission
         from role_permissions rp
         join roles r on r.id = rp."roleId"
         join permissions p on p.id = rp."permissionId"
        order by 1, 2`,
    )
  ).rows;

  // ── the upgrade ──
  await probe.query(sqlOf(grantFolder));

  const catalogue = (
    await probe.query(`select code from permissions where code = any($1::text[]) order by code`, [
      NEW_CODES,
    ])
  ).rows.map((row) => row.code);
  check(
    'all eighteen warehouse permissions now exist in the catalogue',
    catalogue.length === NEW_CODES.length,
    `${catalogue.length}/${NEW_CODES.length}${catalogue.length === NEW_CODES.length ? '' : ` missing ${NEW_CODES.filter((code) => !catalogue.includes(code)).join(', ')}`}`,
  );

  for (const [role, expected] of Object.entries(EXPECTED)) {
    const granted = (await grantRowsForRole(role)).filter((code) => NEW_CODES.includes(code));
    const missing = expected.filter((code) => !granted.includes(code));
    const extra = granted.filter((code) => !expected.includes(code));
    check(
      `${role} receives exactly what its existing permissions justify`,
      missing.length === 0 && extra.length === 0,
      missing.length || extra.length
        ? `missing ${missing.join(', ') || 'none'} · unexpected ${extra.join(', ') || 'none'}`
        : `${granted.length} new permissions`,
    );
  }

  const storekeeper = await grantRowsForRole('STOREKEEPER');
  check(
    'approval is not handed to people who only move goods',
    APPROVAL_SET.every((code) => !storekeeper.includes(code)),
    APPROVAL_SET.filter((code) => storekeeper.includes(code)).join(', ') || 'no approval granted',
  );
  const accountant = await grantRowsForRole('ACCOUNTANT');
  check(
    'the accountant who signs the loss may approve it but does not receive or issue stock',
    APPROVAL_SET.every((code) => accountant.includes(code)) &&
      !accountant.includes('inventory.batches.receive') &&
      !accountant.includes('inventory.batches.issue'),
    `${APPROVAL_SET.length} approvals`,
  );
  const cashier = await grantRowsForRole('CASHIER');
  check(
    'a cashier may issue from lots but may not receive them',
    cashier.includes('inventory.batches.issue') &&
      !cashier.includes('inventory.batches.receive'),
    cashier.filter((code) => code.startsWith('inventory.batches')).join(', '),
  );

  const afterLinks = (
    await probe.query(
      `select r.code as role, p.code as permission
         from role_permissions rp
         join roles r on r.id = rp."roleId"
         join permissions p on p.id = rp."permissionId"
        order by 1, 2`,
    )
  ).rows;
  const lost = beforeLinks.filter(
    (link) =>
      !afterLinks.some((row) => row.role === link.role && row.permission === link.permission),
  );
  check(
    'nothing that was granted before the migration is taken away',
    lost.length === 0,
    lost.map((row) => `${row.role}:${row.permission}`).join(', ') || `${beforeLinks.length} links intact`,
  );
  check(
    'no role was added, renamed or removed by the migration',
    (await countOf('roles')) === beforeCounts.roles,
    `${beforeCounts.roles} roles`,
  );

  const deletedRole = (await grantRowsForRole('GONE')).filter((code) => NEW_CODES.includes(code));
  check(
    'a role deleted before the upgrade receives nothing',
    deletedRole.length === 0,
    deletedRole.join(', ') || 'no grants',
  );

  // ── replaying the file ──
  const afterFirst = {
    permissions: await countOf('permissions'),
    role_permissions: await countOf('role_permissions'),
  };
  const replay = await probe
    .query(sqlOf(grantFolder))
    .then(() => 'applied again')
    .catch((error) => error.message);
  const afterReplay = {
    permissions: await countOf('permissions'),
    role_permissions: await countOf('role_permissions'),
  };
  check('replaying the migration file is safe', replay === 'applied again', replay.slice(0, 80));
  check(
    'replaying it adds no duplicate permission and no duplicate grant',
    JSON.stringify(afterFirst) === JSON.stringify(afterReplay),
    `${afterReplay.role_permissions} role links, ${afterReplay.permissions} permissions`,
  );

  // Every link must still point at a permission in the catalogue: the CHECK is
  // that the migration cannot have created a dangling grant.
  const dangling = (
    await probe.query(
      `select count(*)::int as n
         from role_permissions rp
         left join permissions p on p.id = rp."permissionId"
        where p.id is null`,
    )
  ).rows[0].n;
  check('no grant points at a permission that does not exist', dangling === 0, `${dangling} dangling`);
} finally {
  await probe.end().catch(() => {});
  await admin
    .query(`DROP DATABASE IF EXISTS "${probeDb}" WITH (FORCE)`)
    .catch((error) => console.error(`could not drop ${probeDb}: ${error.message}`));
  await admin.end().catch(() => {});
}

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
if (failures === 0) {
  console.log(
    `::notice title=Warehouse permission grant::existing roles on a pre-upgrade database received the ${NEW_CODES.length} warehouse permissions, with approval kept separate`,
  );
}
process.exit(failures === 0 ? 0 : 1);
