// Real Prisma migration tests against real PostgreSQL, using Prisma's classic
// (native) schema engine. Nothing here is faked: every phase shells out to the
// bundled Prisma CLI, which downloads and runs the official schema-engine
// binary, and every assertion reads the resulting database with `pg`.
//
// Phases
//   1. fresh database: `migrate deploy` applies every checked-in migration
//   2. migration history: names, order, no failures, checksums match the files
//   3. idempotency: a second `migrate deploy` changes nothing at all
//   4. failure: a deliberately broken migration must fail, roll back, and stop
//      the next run (fail closed) - then be recoverable with `migrate resolve`
//   5. populated upgrade: a database built by the first N migrations, filled with
//      business rows, is upgraded by the real deploy with its data intact
//   6. atomicity/idempotency of business data after the upgrade
//
// It never touches a database it did not create, and it drops only the
// throwaway databases named KAYAN_PRISMA_TEST_PREFIX*.
//
//   DATABASE_URL=postgresql://... node scripts/prisma-native-migration-suite.mjs
//
// The URL's database is used as the administration target (it is created and
// dropped if missing; in CI it is the service's own database).

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = join(here, '..');
const migrationsDir = join(backendDir, 'prisma', 'migrations');
const prismaCli = join(backendDir, 'node_modules', 'prisma', 'build', 'index.js');

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) {
  fail('DATABASE_URL is not set; the migration suite needs a PostgreSQL server.');
}

const prefix = `${process.env.KAYAN_PRISMA_TEST_PREFIX ?? 'kayan_native_'}`;
const created = [];
let failures = 0;
const started = Date.now();

function fail(message) {
  console.error(`::error title=Prisma native migration suite::${message}`);
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function note(message) {
  console.log(`      ${message}`);
}

/** A URL for another database on the same server, keeping credentials intact. */
function urlFor(database) {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

async function withClient(database, fn) {
  const client = new pg.Client({ connectionString: database });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

async function createDatabase(name) {
  await withClient(adminUrl, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}"`);
    await client.query(`CREATE DATABASE "${name}"`);
  });
  created.push(name);
  return urlFor(name);
}

/** Runs the real Prisma CLI. Returns { code, output }. */
function prisma(args, { databaseUrl, cwd = backendDir, extraEnv = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [prismaCli, ...args], {
      cwd,
      env: {
        ...process.env,
        ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
        // Migrations must never be able to reach a shadow database in this
        // suite; the isolation suite proves that path separately.
        KAYAN_PRISMA_SHADOW_DATABASE_URL: '',
        KAYAN_PRISMA_SHADOW_VERIFIED: '',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => {
      output += d.toString();
    });
    child.stderr.on('data', (d) => {
      output += d.toString();
    });
    child.on('error', (error) => resolve({ code: -1, output: String(error) }));
    child.on('exit', (code) => resolve({ code: code ?? -1, output }));
  });
}

function migrationNames() {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function migrationChecksum(name) {
  return createHash('sha256')
    .update(readFileSync(join(migrationsDir, name, 'migration.sql')))
    .digest('hex');
}

/**
 * A temporary migrations tree. The checked-in migrations are only ever read;
 * a subset or an extra failing migration is expressed by copying them.
 */
function stagedMigrations({ upto, extra } = {}) {
  const names = migrationNames();
  const included = typeof upto === 'number' ? names.slice(0, upto) : names;
  const root = mkdtempSync(join(tmpdir(), 'kayan-native-'));
  const target = join(root, 'migrations');
  mkdirSync(target, { recursive: true });
  for (const name of included) {
    mkdirSync(join(target, name), { recursive: true });
    copyFileSync(
      join(migrationsDir, name, 'migration.sql'),
      join(target, name, 'migration.sql'),
    );
  }
  copyFileSync(
    join(migrationsDir, 'migration_lock.toml'),
    join(target, 'migration_lock.toml'),
  );
  if (extra) {
    mkdirSync(join(target, extra.name), { recursive: true });
    writeFileSync(join(target, extra.name, 'migration.sql'), extra.sql);
  }
  copyFileSync(
    join(backendDir, 'prisma', 'schema.prisma'),
    join(root, 'schema.prisma'),
  );
  return { root, schema: join(root, 'schema.prisma'), dir: target };
}

async function deploy({ databaseUrl, upto, extra, label }) {
  const staged = stagedMigrations({ upto, extra });
  const result = await prisma(['migrate', 'deploy', '--schema', staged.schema], {
    databaseUrl,
  });
  if (label) {
    note(`${label}: exit ${result.code}`);
  }
  return { ...result, staged };
}

async function history(databaseUrl) {
  return withClient(databaseUrl, async (client) => {
    const { rows } = await client.query(
      'SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count FROM _prisma_migrations ORDER BY started_at, migration_name',
    );
    return rows;
  });
}

/**
 * A fingerprint of the business *content*: explicit columns, not `row::text`.
 *
 * `row::text` would also change when a migration adds a column, and then a
 * perfectly correct upgrade would look like data corruption. These column lists
 * describe what must never change: which company, which item, which invoice, in
 * which status, for how much.
 */
const BUSINESS_COLUMNS = {
  companies: ['id', 'code', 'nameEn', 'nameAr'],
  items: ['id', 'code', 'nameEn', 'nameAr', 'salePrice'],
  sales_invoices: ['id', 'invoiceNumber', 'status', 'totalAmount'],
};

async function dataFingerprint(databaseUrl, tables = Object.keys(BUSINESS_COLUMNS)) {
  return withClient(databaseUrl, async (client) => {
    const parts = [];
    for (const table of tables) {
      const reg = await client.query('SELECT to_regclass($1) AS oid', [
        `public."${table}"`,
      ]);
      if (!reg.rows[0].oid) {
        parts.push(`${table}:<absent>`);
        continue;
      }
      const columns = BUSINESS_COLUMNS[table] ?? ['id'];
      const projection = columns.map((column) => `"${column}"::text`).join(" || '|' || ");
      const { rows } = await client.query(
        `SELECT count(*)::text AS n, coalesce(md5(string_agg(${projection}, '#' ORDER BY ${projection})), '') AS digest FROM "${table}"`,
      );
      parts.push(`${table}:${rows[0].n}:${rows[0].digest}`);
    }
    return parts.join('\n');
  });
}

async function tableExists(databaseUrl, table) {
  return withClient(databaseUrl, async (client) => {
    const { rows } = await client.query('SELECT to_regclass($1) AS oid', [
      `public."${table}"`,
    ]);
    return rows[0].oid !== null;
  });
}

/**
 * Inserts one row into a table, filling only the columns that have no default
 * and cannot be null. Values are chosen by column type, so this keeps working
 * as the schema grows instead of hard-coding a row shape that later drifts.
 */
async function insertRow(databaseUrl, table, overrides = {}) {
  return withClient(databaseUrl, async (client) => {
    const { rows: columns } = await client.query(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`,
      [table],
    );
    if (columns.length === 0) {
      throw new Error(`table ${table} does not exist yet`);
    }
    const names = [];
    const values = [];
    const params = [];
    for (const column of columns) {
      const override = overrides[column.column_name];
      const required = column.is_nullable === 'NO' && column.column_default === null;
      if (override === undefined && !required) continue;
      names.push(`"${column.column_name}"`);
      let value = override;
      if (value === undefined) {
        switch (column.data_type) {
          case 'uuid':
            value = randomUuid();
            break;
          case 'numeric':
          case 'integer':
          case 'bigint':
          case 'smallint':
          case 'double precision':
          case 'real':
            value = 0;
            break;
          case 'boolean':
            value = false;
            break;
          case 'timestamp without time zone':
          case 'timestamp with time zone':
          case 'date':
            value = new Date('2026-01-01T00:00:00Z');
            break;
          case 'jsonb':
          case 'json':
            value = '{}';
            break;
          case 'ARRAY':
            value = '{}';
            break;
          case 'USER-DEFINED': {
            // An enum: use its own first label rather than an invented string,
            // which the server would reject.
            const { rows: labels } = await client.query(
              `SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname = $1 ORDER BY e.enumsortorder LIMIT 1`,
              [column.udt_name],
            );
            if (labels.length === 0) {
              throw new Error(
                `column ${table}.${column.column_name} is a user-defined type (${column.udt_name}) with no enum labels; pass an explicit override`,
              );
            }
            value = labels[0].enumlabel;
            break;
          }
          default:
            value = `kayan-test-${column.column_name}`;
        }
      }
      params.push(value);
      values.push(`$${params.length}`);
    }
    const sql = `INSERT INTO "${table}" (${names.join(',')}) VALUES (${values.join(',')}) RETURNING *`;
    const { rows } = await client.query(sql, params);
    return rows[0];
  });
}

function randomUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function phase1FreshDeploy() {
  const names = migrationNames();
  note(`${names.length} checked-in migrations`);
  if (names.length < 40) {
    fail(`expected the full migration history, found only ${names.length} migrations`);
  }
  const url = await createDatabase(`${prefix}fresh`);
  const run = await deploy({ databaseUrl: url, label: 'fresh database deploy' });
  if (run.code !== 0) {
    fail(`prisma migrate deploy failed on a fresh database:\n${run.output}`);
  }
  const rows = await history(url);
  const finished = rows.filter((row) => row.finished_at !== null);
  if (finished.length !== names.length) {
    fail(
      `after deploy the history has ${finished.length} applied migrations, expected ${names.length}`,
    );
  }
  const missing = names.filter((name) => !rows.some((row) => row.migration_name === name));
  if (missing.length > 0) {
    fail(`migrations missing from history: ${missing.join(', ')}`);
  }
  pass(`fresh database applied all ${names.length} migrations with the native engine`);
  return { url, names };
}

async function phase2History({ url, names }) {
  const rows = await history(url);
  const failed = rows.filter((row) => row.finished_at === null);
  if (failed.length > 0) {
    fail(`history records unfinished migrations: ${failed.map((r) => r.migration_name).join(', ')}`);
  }
  const mismatched = [];
  for (const name of names) {
    const row = rows.find((entry) => entry.migration_name === name);
    const expected = migrationChecksum(name);
    if (!row || row.checksum !== expected) {
      mismatched.push(`${name} (db ${row?.checksum ?? 'absent'}, file ${expected})`);
    }
  }
  if (mismatched.length > 0) {
    fail(`checksum mismatch between database and files:\n${mismatched.join('\n')}`);
  }
  // The order Prisma recorded must be the order the files are in: a database
  // built in another order is a different database.
  const appliedOrder = rows.map((row) => row.migration_name);
  const expectedOrder = names.filter((name) => appliedOrder.includes(name));
  if (appliedOrder.join(',') !== expectedOrder.join(',')) {
    fail('migration history order does not match the checked-in order');
  }
  pass(`migration history matches the ${names.length} checked-in files, checksums included`);
}

async function phase3Idempotent({ url, names }) {
  const before = await history(url);
  const fingerprintBefore = await dataFingerprint(url);
  const run = await deploy({ databaseUrl: url, label: 'second deploy (no changes)' });
  if (run.code !== 0) {
    fail(`a second prisma migrate deploy failed:\n${run.output}`);
  }
  if (!/no pending migrations/i.test(run.output)) {
    fail(`a second migrate deploy did not report "No pending migrations":\n${run.output}`);
  }
  const after = await history(url);
  if (after.length !== before.length || after.length !== names.length) {
    fail(`a second deploy changed the history: ${before.length} -> ${after.length}`);
  }
  const fingerprintAfter = await dataFingerprint(url);
  if (fingerprintAfter !== fingerprintBefore) {
    fail('a second deploy changed business data');
  }
  pass('a repeated migrate deploy is a no-op: history and data unchanged');
}

async function phase4FailureAndRetry() {
  const badName = '99999999999999_kayan_deliberate_failure';
  const badSql = [
    'CREATE TABLE "kayan_partial_should_not_survive" ("id" integer);',
    'SELECT 1 / 0;',
  ].join('\n');
  const url = await createDatabase(`${prefix}failure`);
  const before = await deploy({ databaseUrl: url, upto: 12, label: 'partial deploy' });
  if (before.code !== 0) {
    fail(`could not prepare the failure database:\n${before.output}`);
  }
  await insertRow(url, 'companies', { code: 'FAIL-1' });
  const fingerprintBefore = await dataFingerprint(url, ['companies']);

  const broken = await deploy({
    databaseUrl: url,
    extra: { name: badName, sql: badSql },
    label: 'deploy with a deliberately broken migration',
  });
  if (broken.code === 0) {
    fail('a deliberately broken migration was reported as applied');
  }
  // Atomicity: the table the broken migration created before it errored must not
  // exist. PostgreSQL runs each Prisma migration in a transaction for this
  // reason; this is the assertion that proves the transaction is real.
  if (await tableExists(url, 'kayan_partial_should_not_survive')) {
    fail('the failed migration left a partial table behind (no transaction rollback)');
  }
  const rows = await history(url);
  const failedRow = rows.find((row) => row.migration_name === badName);
  if (!failedRow) {
    fail('the failed migration is missing from _prisma_migrations');
  }
  if (failedRow.finished_at !== null) {
    fail('the failed migration is recorded as finished');
  }
  const fingerprintAfterFailure = await dataFingerprint(url, ['companies']);
  if (fingerprintAfterFailure !== fingerprintBefore) {
    fail('a failed migration changed business data');
  }

  // Fail closed: with a failed migration in the history, a plain deploy against
  // the real (unbroken) migrations must still refuse rather than skip it.
  const retryWithFailure = await deploy({ databaseUrl: url, label: 'deploy after the failure' });
  if (retryWithFailure.code === 0) {
    fail('deploy continued past a recorded failed migration instead of stopping');
  }
  pass('a broken migration failed, rolled back atomically and blocked the next deploy');

  const resolved = await prisma(
    ['migrate', 'resolve', '--rolled-back', badName],
    { databaseUrl: url },
  );
  if (resolved.code !== 0) {
    fail(`migrate resolve --rolled-back failed:\n${resolved.output}`);
  }
  const retried = await deploy({ databaseUrl: url, label: 'deploy after resolve' });
  if (retried.code !== 0) {
    fail(`deploy after a resolved failure failed:\n${retried.output}`);
  }
  const fingerprintAfterRetry = await dataFingerprint(url, ['companies']);
  if (fingerprintAfterRetry !== fingerprintBefore) {
    fail('the retry changed business data');
  }
  pass('after `migrate resolve --rolled-back` the retry succeeded with data intact');
}

async function phase5PopulatedUpgrade({ names }) {
  // A database that stops part-way through history, as an installed older
  // release would be, filled with business rows that must survive the upgrade.
  const cutoff = Math.max(1, Math.floor(names.length / 2));
  const url = await createDatabase(`${prefix}populated`);
  const partial = await deploy({
    databaseUrl: url,
    upto: cutoff,
    label: `build database at migration ${cutoff}/${names.length}`,
  });
  if (partial.code !== 0) {
    fail(`could not build the populated database:\n${partial.output}`);
  }

  // Parent rows first: the migrations create real foreign keys, and a test that
  // bypassed them would prove nothing about a real database.
  const company = await insertRow(url, 'companies', {
    code: 'KAYAN-LEGACY',
    nameEn: 'Legacy Company',
    nameAr: 'شركة قديمة',
  });
  const branch = await insertRow(url, 'branches', { companyId: company.id });
  const customer = await insertRow(url, 'customers', { companyId: company.id });
  const item = await insertRow(url, 'items', {
    companyId: company.id,
    code: 'LEGACY-ITEM',
    nameEn: 'Legacy Item',
    nameAr: 'صنف قديم',
    salePrice: '125.5000',
  });
  // A historical invoice in a terminal status ("POSTED" is the terminal member of
  // the InvoiceStatus enum this schema shipped with), the shape of data that must
  // never be rewritten by an upgrade.
  const invoice = await insertRow(url, 'sales_invoices', {
    companyId: company.id,
    branchId: branch.id,
    customerId: customer.id,
    invoiceNumber: 'LEGACY-INV-1',
    status: 'POSTED',
  });
  note(`seeded company ${company.code}, item ${item.code}, invoice ${invoice.invoiceNumber}`);

  const businessTables = ['companies', 'items', 'sales_invoices'];
  const fingerprintBefore = await dataFingerprint(url, businessTables);
  const historyBefore = await history(url);
  const oldChecksums = historyBefore.map((row) => `${row.migration_name}:${row.checksum}`);
  const invoiceStatusBefore = await withClient(url, async (client) => {
    const { rows } = await client.query('SELECT status::text FROM sales_invoices WHERE id = $1', [
      invoice.id,
    ]);
    return rows[0]?.status ?? '<absent>';
  });

  const upgrade = await deploy({ databaseUrl: url, label: 'upgrade to the latest migration' });
  if (upgrade.code !== 0) {
    fail(`upgrading a populated database failed:\n${upgrade.output}`);
  }

  const fingerprintAfter = await dataFingerprint(url, businessTables);
  if (fingerprintAfter !== fingerprintBefore) {
    fail(
      `the upgrade changed business data\n before:\n${fingerprintBefore}\n after:\n${fingerprintAfter}`,
    );
  }
  const historyAfter = await history(url);
  if (historyAfter.length !== names.length) {
    fail(`the upgraded database has ${historyAfter.length} migrations, expected ${names.length}`);
  }
  // The rows written before the upgrade keep their original checksums: an
  // upgrade must not "fix up" history.
  for (const entry of oldChecksums) {
    if (!historyAfter.map((row) => `${row.migration_name}:${row.checksum}`).includes(entry)) {
      fail(`the upgrade rewrote the checksum of an already-applied migration: ${entry}`);
    }
  }
  const invoiceStatusAfter = await withClient(url, async (client) => {
    const { rows } = await client.query('SELECT status::text FROM sales_invoices WHERE id = $1', [
      invoice.id,
    ]);
    return rows[0]?.status ?? '<absent>';
  });
  if (invoiceStatusAfter !== invoiceStatusBefore) {
    fail(`the upgrade changed a historical invoice status ${invoiceStatusBefore} -> ${invoiceStatusAfter}`);
  }
  if (!(await tableExists(url, 'item_units'))) {
    fail('the upgrade did not create the tables the later migrations introduce');
  }
  pass(
    `a populated database at ${cutoff}/${names.length} upgraded to ${names.length} with data, statuses and checksums intact`,
  );
  note(`legacy company ${company.code}, item ${item.code}, invoice status ${invoiceStatusAfter}`);
  return url;
}

async function phase6PostUpgradeIntegrity({ url }) {
  // Foreign-key integrity of the upgraded database: a migration that leaves
  // orphans is a corrupt database even when every count matches.
  const orphan = await withClient(url, async (client) => {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM "sales_invoices" i
         WHERE NOT EXISTS (SELECT 1 FROM "companies" c WHERE c.id = i."companyId")`,
    );
    return rows[0].n;
  });
  if (orphan !== 0) {
    fail(`${orphan} sales_invoices rows point at a company that does not exist`);
  }
  const redeploy = await deploy({ databaseUrl: url, label: 'post-upgrade redeploy' });
  if (redeploy.code !== 0 || !/no pending migrations/i.test(redeploy.output)) {
    fail(`the upgraded database is not reported up to date:\n${redeploy.output}`);
  }
  pass('the upgraded database has no orphaned rows and reports no pending migrations');
}

async function main() {
  note('using the real Prisma CLI and the native (classic) schema engine');
  const names = migrationNames();
  const fresh = await phase1FreshDeploy();
  await phase2History(fresh);
  await phase3Idempotent(fresh);
  await phase4FailureAndRetry();
  const upgraded = await phase5PopulatedUpgrade({ names });
  await phase6PostUpgradeIntegrity({ url: upgraded });
  console.log(`\nall migration phases passed in ${Math.round((Date.now() - started) / 1000)}s`);
}

main()
  .catch((error) => {
    console.error(`::error title=Prisma native migration suite::${error?.stack ?? error}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const name of created) {
      await withClient(adminUrl, async (client) => {
        await client.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [name],
        );
        await client.query(`DROP DATABASE IF EXISTS "${name}"`);
      }).catch(() => {});
    }
    if (process.exitCode) process.exit(process.exitCode);
  });
