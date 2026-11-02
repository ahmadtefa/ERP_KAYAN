/**
 * Proves the user-avatar migration on a database that already has data.
 *
 * A migration that only ever meets an empty database has not been tested: a
 * customer installation is a populated one, and the avatar migration is the
 * first schema change that touches the `users` table since accounts were
 * created. So this does what an upgrade does, but on a throwaway database:
 *
 *   1. creates `kayan_avatar_probe_<stamp>` on the same server;
 *   2. applies every migration that came *before* the avatar one, in filename
 *      order, using the project's own SQL files - no Prisma, no schema engine,
 *      the exact bytes the installer replays;
 *   3. fills the database: a company, a branch and two accounts;
 *   4. records every public table's row count and the two account rows;
 *   5. applies `*_user_avatars/migration.sql`;
 *   6. checks that nothing was lost, that the three columns exist with the
 *      right types, that every existing account reads as "no photo", that the
 *      partial index exists, that a photo can be written and read back at the
 *      same length for one account without touching the other, and that
 *      clearing it returns the account to "no photo";
 *   7. drops the database, whatever happened.
 *
 * Usage:
 *   DATABASE_URL=postgresql://user:pass@host:5432/erp_kayan \
 *   ADMIN_DATABASE_URL=postgresql://user:pass@host:5432/postgres \
 *   node scripts/check-user-avatar-migration.mjs
 *
 * ADMIN_DATABASE_URL is optional and only used to create/drop the probe
 * database; without it the same credentials are pointed at the `postgres`
 * maintenance database.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

/** A connection string for the same server, but on a named database. */
function withDatabase(connectionString, database) {
  const parsed = new URL(connectionString);
  parsed.pathname = `/${database}`;
  parsed.search = '';
  return parsed.toString();
}

const adminUrl =
  process.env.ADMIN_DATABASE_URL ?? withDatabase(url, 'postgres');

const migrationsDir = join('prisma', 'migrations');
const folders = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const avatarFolders = folders.filter((name) => name.endsWith('_user_avatars'));
if (avatarFolders.length !== 1) {
  throw new Error(
    `expected exactly one *_user_avatars migration, found ${avatarFolders.length}`,
  );
}
const avatarFolder = avatarFolders[0];
const before = folders.filter((name) => name < avatarFolder);
const sqlOf = (folder) =>
  readFileSync(join(migrationsDir, folder, 'migration.sql'), 'utf8');

const stamp = `${Date.now().toString(36)}${process.pid.toString(36)}`.toLowerCase();
const probeDb = `kayan_avatar_probe_${stamp}`;

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_A = '33333333-3333-4333-8333-333333333333';
const ACCOUNT_B = '44444444-4444-4444-8444-444444444444';

const admin = new pg.Client({ connectionString: adminUrl });
const probe = new pg.Client({ connectionString: withDatabase(url, probeDb) });

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${probeDb}"`);
  console.log(`created throwaway database ${probeDb}`);

  await probe.connect();

  for (const folder of before) {
    await probe.query(sqlOf(folder));
  }
  console.log(`applied ${before.length} migrations that predate the avatar one`);

  await probe.query(`
    INSERT INTO companies (id, code, "nameEn", "nameAr", "updatedAt")
    VALUES ('${COMPANY}', 'AVATAR-PROBE', 'Avatar probe', 'فحص الصور', now());
    INSERT INTO branches (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
    VALUES ('${BRANCH}', '${COMPANY}', 'B1', 'Main', 'الرئيسي', now());
    INSERT INTO users (id, "companyId", username, "fullNameEn", "fullNameAr", "passwordHash", "updatedAt")
    VALUES ('${ACCOUNT_A}', '${COMPANY}', 'amal', 'Amal Hassan', 'أمل حسن', 'hash-a', now()),
           ('${ACCOUNT_B}', '${COMPANY}', 'wael', 'Wael Sami', 'وائل سامي', 'hash-b', now());
  `);

  const tableNames = async () =>
    (
      await probe.query(
        `select table_name from information_schema.tables
          where table_schema = 'public' order by table_name`,
      )
    ).rows.map((row) => row.table_name);

  const counts = async () => {
    const out = {};
    for (const table of await tableNames()) {
      const result = await probe.query(
        `select count(*)::int as n from "${table}"`,
      );
      out[table] = result.rows[0].n;
    }
    return out;
  };

  const accounts = async () =>
    (
      await probe.query(
        `select id::text, "companyId"::text, username, "fullNameEn", "fullNameAr",
                "passwordHash", "createdAt"::text
           from users order by username`,
      )
    ).rows;

  const tablesBefore = await tableNames();
  const countsBefore = await counts();
  const accountsBefore = await accounts();

  await probe.query(sqlOf(avatarFolder));

  const tablesAfter = await tableNames();
  const countsAfter = await counts();
  const accountsAfter = await accounts();

  const changedTables = Object.keys(countsAfter).filter(
    (table) => countsBefore[table] !== countsAfter[table],
  );
  check(
    'the migration adds no table and removes none',
    JSON.stringify(tablesBefore) === JSON.stringify(tablesAfter),
    `${tablesAfter.length} public tables`,
  );
  check(
    'every row that existed before the migration still exists',
    changedTables.length === 0,
    changedTables.length
      ? changedTables
          .map((t) => `${t}: ${countsBefore[t]} -> ${countsAfter[t]}`)
          .join(', ')
      : 'no table changed its row count',
  );
  check(
    'the accounts themselves are unchanged',
    JSON.stringify(accountsBefore) === JSON.stringify(accountsAfter),
    `${accountsAfter.length} accounts`,
  );

  const columns = (
    await probe.query(
      `select column_name, data_type, character_maximum_length
         from information_schema.columns
        where table_name = 'users' and column_name like 'avatar%'
        order by column_name`,
    )
  ).rows;
  const column = (name) => columns.find((c) => c.column_name === name);
  check(
    'the three avatar columns exist with the right types',
    columns.length === 3 &&
      column('avatarData')?.data_type === 'bytea' &&
      column('avatarMime')?.data_type === 'character varying' &&
      column('avatarUpdatedAt')?.data_type === 'timestamp without time zone',
    columns.map((c) => `${c.column_name}:${c.data_type}`).join(' '),
  );

  const nulls = (
    await probe.query(
      `select count(*)::int as n from users
        where "avatarData" is null
          and "avatarMime" is null
          and "avatarUpdatedAt" is null`,
    )
  ).rows[0].n;
  check(
    'every existing account reads as "no photo" (all three columns null)',
    nulls === 2,
    `${nulls}/2`,
  );

  const withPhoto = (
    await probe.query(
      `select count(*)::int as n from users where "avatarData" is not null`,
    )
  ).rows[0].n;
  check('the "has a photo" predicate is false for every existing row', withPhoto === 0);

  const indexes = (
    await probe.query(
      `select indexname from pg_indexes
        where tablename = 'users' and indexname = 'users_avatar_present_idx'`,
    )
  ).rows;
  check('the partial index that answers "has a photo" exists', indexes.length === 1);

  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);
  await probe.query(
    `update users set "avatarData" = $1, "avatarMime" = $2, "avatarUpdatedAt" = now()
      where id = '${ACCOUNT_A}'`,
    [bytes, 'image/png'],
  );
  const stored = (
    await probe.query(
      `select octet_length("avatarData") as byte_count, "avatarMime" as mime,
              ("avatarUpdatedAt" is not null) as stamped
         from users where id = '${ACCOUNT_A}'`,
    )
  ).rows[0];
  check(
    'a photo is stored and read back at exactly the same length',
    stored.byte_count === bytes.length &&
      stored.mime === 'image/png' &&
      stored.stamped === true,
    `${stored.byte_count} bytes`,
  );

  const untouched = (
    await probe.query(
      `select ("avatarData" is null) as empty from users where id = '${ACCOUNT_B}'`,
    )
  ).rows[0].empty;
  check('one account having a photo does not give another one a photo', untouched === true);

  await probe.query(
    `update users set "avatarData" = null, "avatarMime" = null, "avatarUpdatedAt" = null
      where id = '${ACCOUNT_A}'`,
  );
  const cleared = (
    await probe.query(
      `select count(*)::int as n from users where "avatarData" is not null`,
    )
  ).rows[0].n;
  check('clearing the photo returns the account to "no photo"', cleared === 0);

  const rerun = await probe
    .query(sqlOf(avatarFolder))
    .then(() => 'applied again')
    .catch((error) => error.message);
  check(
    'replaying the migration file is safe (IF NOT EXISTS throughout)',
    rerun === 'applied again',
    rerun.slice(0, 80),
  );
} finally {
  await probe.end().catch(() => {});
  await admin
    .query(`DROP DATABASE IF EXISTS "${probeDb}" WITH (FORCE)`)
    .catch((error) => console.error(`could not drop ${probeDb}: ${error.message}`));
  await admin.end().catch(() => {});
}

console.log(
  failures === 0
    ? 'ALL CHECKS PASSED'
    : `${failures} CHECK(S) FAILED`,
);
if (failures === 0) {
  console.log(
    `::notice title=User-avatar migration::populated database upgraded with no data loss (${before.length} migrations before it)`,
  );
}
process.exit(failures === 0 ? 0 : 1);
