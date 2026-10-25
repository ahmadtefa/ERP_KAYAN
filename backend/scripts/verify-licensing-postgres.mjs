#!/usr/bin/env node
/**
 * Licensing against a real PostgreSQL: the part the unit tests cannot prove.
 *
 * The unit suites run the service against an in-memory ledger. They pin the
 * decisions (which key is refused, what a grant is worth), but they cannot
 * prove the three things that only exist in the database:
 *
 *   1. the seat ledger is written by a real transaction, counted from real
 *      rows, and rolled back as a whole when the limit is reached;
 *   2. `pg_advisory_xact_lock` really serialises two concurrent creations, so
 *      the limit cannot be exceeded by a race;
 *   3. the licensing migration can be applied to a database that already
 *      holds accounts, without losing one of them or counting one twice.
 *
 * It creates throwaway databases on the server named by the environment, so it
 * never touches a real company. Drop them with `--keep` omitted (the default
 * drops them as it finishes).
 *
 *   node scripts/verify-licensing-postgres.mjs
 *
 * Environment:
 *   KAYAN_TEST_ADMIN_URL  postgres://user:pass@host:port/postgres
 *                         (default: derived from DATABASE_URL, /postgres)
 *   KAYAN_TEST_DB_SUFFIX  suffix for the throwaway database names (optional)
 *   KAYAN_API_URL         optional; when the CI API is running, also checks
 *                         the licence routes over HTTP
 *   ADMIN_USERNAME / ADMIN_PASSWORD  credentials for that HTTP check
 */

import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

import { LicenseStore } from '../dist/src/modules/licensing/license-store.js';
import { signPayload } from '../dist/src/modules/licensing/license-key.js';
import { LicensingService } from '../dist/src/modules/licensing/licensing.service.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', 'prisma', 'migrations');
const LICENSING_MIGRATION = '20261025120000_offline_licensing';

const SUFFIX = process.env.KAYAN_TEST_DB_SUFFIX ? `_${process.env.KAYAN_TEST_DB_SUFFIX}` : '';
const DATABASES = {
  migration: `erp_kayan_licence_migration${SUFFIX}`,
  runtime: `erp_kayan_licence_runtime${SUFFIX}`,
  concurrency: `erp_kayan_licence_concurrency${SUFFIX}`,
  transfer: `erp_kayan_licence_transfer${SUFFIX}`,
  perpetual: `erp_kayan_licence_perpetual${SUFFIX}`,
};

const MACHINE = 'KM-TEST-AAAA-BBBB-CCCC';
const OTHER_MACHINE = 'KM-TEST-ZZZZ-YYYY-XXXX';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const PUBLIC_PEM = publicKey.export({ format: 'pem', type: 'spki' }).toString();

let failures = 0;
let passes = 0;
const cleanup = [];

function pass(name, detail = '') {
  passes += 1;
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail) {
  failures += 1;
  console.log(`FAIL  ${name} — ${detail}`);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    pass(name, typeof detail === 'string' ? detail : '');
  } catch (error) {
    fail(name, error?.message ?? String(error));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertCode(outcome, expected) {
  assert(!outcome.resolved, `expected ${expected}, but the call succeeded`);
  assertEqual(outcome.code, expected, 'refusal code');
}

/** Runs a service call that must be refused, and reports its licence code. */
async function refusal(promise) {
  try {
    await promise;
    return { resolved: true, code: null };
  } catch (error) {
    const response = typeof error?.getResponse === 'function' ? error.getResponse() : null;
    return { resolved: false, code: response?.code ?? error?.message ?? 'no-code' };
  }
}

// ───────────────────────────────────────────────────────────── database plumbing

function adminUrl() {
  if (process.env.KAYAN_TEST_ADMIN_URL) return process.env.KAYAN_TEST_ADMIN_URL;
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      'Set KAYAN_TEST_ADMIN_URL (or DATABASE_URL) to a PostgreSQL server this test may create databases on.',
    );
  }
  const url = new URL(base);
  url.pathname = '/postgres';
  return url.toString();
}

function databaseUrl(name) {
  const url = new URL(adminUrl());
  url.pathname = `/${name}`;
  return url.toString();
}

async function withClient(connectionString, fn) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function recreateDatabase(name) {
  await withClient(adminUrl(), async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${name}"`);
  });
  cleanup.push(name);
}

const migrationDirectories = () =>
  readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

/**
 * Applies the migrations exactly as `prisma migrate deploy` would, in name
 * order, so a database can be taken to the schema *before* licensing on
 * purpose - which is how a real upgrade looks.
 */
async function applyMigrations(connectionString, { until, skipLicensing = false } = {}) {
  await withClient(connectionString, async (client) => {
    for (const name of migrationDirectories()) {
      if (until && name >= until) break;
      if (skipLicensing && name === LICENSING_MIGRATION) continue;
      const sql = readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8');
      await client.query(sql);
    }
  });
}

async function applyLicensingMigration(connectionString) {
  const sql = readFileSync(join(MIGRATIONS, LICENSING_MIGRATION, 'migration.sql'), 'utf8');
  await withClient(connectionString, (client) => client.query(sql));
}

async function count(connectionString, sql, params = []) {
  return withClient(connectionString, async (client) => {
    const result = await client.query(sql, params);
    return Number(result.rows[0].count);
  });
}

async function rows(connectionString, sql, params = []) {
  return withClient(connectionString, async (client) => {
    const result = await client.query(sql, params);
    return result.rows;
  });
}

const COMPANY_ID = randomUUID();

async function seedCompany(connectionString) {
  await withClient(connectionString, async (client) => {
    await client.query(
      `INSERT INTO companies (id, code, "nameEn", "nameAr", currency, timezone, "isActive", "createdAt", "updatedAt")
       VALUES ($1, 'LIC', 'Licence check', 'فحص الترخيص', 'EGP', 'Africa/Cairo', true, now(), now())`,
      [COMPANY_ID],
    );
  });
}

async function seedUser(connectionString, username) {
  const id = randomUUID();
  await withClient(connectionString, async (client) => {
    await client.query(
      `INSERT INTO users (id, "companyId", username, "fullNameEn", "fullNameAr", "passwordHash", "isActive", "isSuperAdmin", "tokenVersion", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'User', 'مستخدم', 'test-only-not-a-hash', true, false, 0, now(), now())`,
      [id, COMPANY_ID, username],
    );
  });
  return id;
}

// ─────────────────────────────────────────────────────────── licence plumbing

function payload(overrides) {
  return {
    v: 1,
    keyId: `key_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    type: 'ACTIVATION',
    licenseId: `lic_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    machineId: MACHINE,
    issuedAt: new Date().toISOString(),
    term: { kind: 'MONTHS', months: 12 },
    seats: { mode: 'CAP', value: 5 },
    state: null,
    note: null,
    ...overrides,
  };
}

const key = (overrides) => signPayload(payload(overrides), privateKey);

async function installation({
  database,
  machineId = MACHINE,
  enforcement = 'enforce',
  clock = () => new Date(),
  directory: existingDirectory = null,
}) {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl(database) }) });
  await prisma.$connect();
  const directory = existingDirectory ?? mkdtempSync(join(tmpdir(), 'kayan-licence-state-'));
  if (!existingDirectory) cleanup.push({ directory });
  // When the directory is reused the service must build its own store: the
  // quarantine of a damaged file lives in the service, not in this helper.
  const store = existingDirectory ? null : new LicenseStore(directory);
  const service = new LicensingService(prisma, {}, {
    directory,
    publicKeyText: PUBLIC_PEM,
    enforcement,
    clock,
    appVersion: 'verify-postgres',
    machineId,
    ...(store ? { trustStore: store } : {}),
  });
  return { prisma, service, store, directory };
}

async function close(instance) {
  await instance.prisma.$disconnect();
}

/**
 * Creates a login account the way the product does: the seat is reserved and
 * the user row is written in one transaction, so a refused seat leaves no
 * user behind.
 */
async function createUser(instance, username, idempotencyKey) {
  const id = randomUUID();
  await instance.prisma.$transaction(async (tx) => {
    await instance.service.reserveSeat(tx, {
      userId: id,
      username,
      reason: 'USER_CREATE',
      idempotencyKey,
    });
    await tx.user.create({
      data: {
        id,
        companyId: COMPANY_ID,
        username,
        fullNameEn: 'User',
        fullNameAr: 'مستخدم',
        passwordHash: 'test-only-not-a-hash',
      },
    });
  });
  return id;
}

const seatsIn = (database) =>
  count(databaseUrl(database), 'SELECT count(*) FROM license_seat_usage');
const usersIn = (database) => count(databaseUrl(database), 'SELECT count(*) FROM "users"');
const licenceRowIn = async (database) =>
  (await rows(databaseUrl(database), 'SELECT * FROM license_installations ORDER BY "createdAt" LIMIT 1'))[0];

function addMonths(from, months) {
  const result = new Date(from.getTime());
  const day = result.getUTCDate();
  const targetMonth = result.getUTCMonth() + months;
  const year = result.getUTCFullYear() + Math.floor(targetMonth / 12);
  const month = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  result.setUTCFullYear(year, month, Math.min(day, lastDay));
  return result;
}

// ────────────────────────────────────────── 1. migration on a populated database

async function migrationOnPopulatedDatabase() {
  console.log('\n== Migration applied to a database that already has accounts');
  const connection = databaseUrl(DATABASES.migration);
  await recreateDatabase(DATABASES.migration);

  await applyMigrations(connection, { until: LICENSING_MIGRATION });
  await seedCompany(connection);
  const existing = [];
  for (let index = 1; index <= 6; index += 1) {
    existing.push(await seedUser(connection, `legacy${index}`));
  }
  await withClient(connection, (client) =>
    client.query('UPDATE "users" SET "isActive" = false WHERE username = $1', ['legacy6']),
  );
  const usersBefore = await usersIn(DATABASES.migration);
  assertEqual(usersBefore, 6, 'users seeded before the licensing migration');

  await applyLicensingMigration(connection);

  await check('M1 the licensing migration creates its four tables', async () => {
    const found = await rows(
      connection,
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'license%' ORDER BY 1`,
    );
    const names = found.map((row) => row.tablename);
    for (const table of ['license_events', 'license_installations', 'license_keys', 'license_seat_usage']) {
      assert(names.includes(table), `${table} was not created`);
    }
    return names.join(', ');
  });

  await check('M2 every existing account survives the migration', async () => {
    assertEqual(await usersIn(DATABASES.migration), 6, 'users after the migration');
    const accounts = await rows(connection, 'SELECT username FROM "users" ORDER BY username');
    assertEqual(accounts.length, 6, 'rows readable');
    const stillInactive = await rows(
      connection,
      `SELECT username FROM "users" WHERE "isActive" = false`,
    );
    assertEqual(stillInactive.length, 1, 'the deactivated account was not re-activated');
    return '6 accounts, none deleted, none re-activated';
  });

  await check('M3 each existing account is recorded as one consumed seat', async () => {
    assertEqual(await seatsIn(DATABASES.migration), 6, 'seat rows');
    const migrated = await rows(
      connection,
      `SELECT "userId", reason, "idempotencyKey" FROM license_seat_usage ORDER BY reason`,
    );
    assert(migrated.every((row) => row.reason === 'MIGRATION_EXISTING'), 'reason is MIGRATION_EXISTING');
    for (const row of migrated) {
      assertEqual(row.idempotencyKey, `migration:${row.userId}`, 'stable idempotency key');
    }
    return '6 rows, one per account, reason MIGRATION_EXISTING';
  });

  await check('M4 re-running the backfill duplicates nothing', async () => {
    const sql = readFileSync(join(MIGRATIONS, LICENSING_MIGRATION, 'migration.sql'), 'utf8');
    const backfill = sql.slice(sql.indexOf('INSERT INTO "license_seat_usage"'));
    await withClient(connection, (client) => client.query(backfill));
    assertEqual(await seatsIn(DATABASES.migration), 6, 'seat rows after the second backfill');
    return '0 new rows on the second run';
  });

  await check('M5 deleting an account keeps its seat history', async () => {
    await withClient(connection, (client) =>
      client.query('DELETE FROM "users" WHERE username = $1', ['legacy1']),
    );
    assertEqual(await usersIn(DATABASES.migration), 5, 'users after the delete');
    assertEqual(await seatsIn(DATABASES.migration), 6, 'seat rows after the delete');
    const remaining = await rows(
      connection,
      `SELECT count(*)::int AS n FROM license_seat_usage WHERE username = 'legacy1'`,
    );
    assertEqual(remaining[0].n, 1, 'the ledger row for the deleted account');
    return 'users 6 → 5, seats stay 6';
  });

  await check('M6 the anti-replay indexes exist', async () => {
    const indexes = await rows(
      connection,
      `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname IN ('license_keys_keyId_key','license_seat_usage_idempotencyKey_key')`,
    );
    assertEqual(indexes.length, 2, 'unique indexes');
    return indexes.map((row) => row.indexname).join(', ');
  });
}

// ───────────────────────────────────────────────────── 2. activation, seats, keys

async function activationAndSeats() {
  console.log('\n== Activation, the seat ledger and the four key types (real PostgreSQL)');
  await recreateDatabase(DATABASES.runtime);
  const connection = databaseUrl(DATABASES.runtime);
  await applyMigrations(connection);
  await seedCompany(connection);

  const licenseId = `lic_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const instance = await installation({ database: DATABASES.runtime });
  try {
    const activationKey = key({ licenseId });

    await check('R1 an activation key installs a one-year licence with its seat limit', async () => {
      const status = await instance.service.activate(activationKey);
      assertEqual(status.state, 'ACTIVE', 'state');
      assertEqual(status.seats.limit, 5, 'seat limit');
      assertEqual(status.machineId, MACHINE, 'machine id');
      const expected = addMonths(new Date(status.startsAt), 12).toISOString();
      assertEqual(status.expiresAt, expected, 'expiry is one calendar year later');
      const row = await licenceRowIn(DATABASES.runtime);
      assertEqual(row.machineId, MACHINE, 'stored machine id');
      return `expires ${status.expiresAt}`;
    });

    await check('R2 a key issued for another machine is refused', async () => {
      // A separate database with no licence: the same database would answer
      // LICENSE_ALREADY_ACTIVE first, which is a different rule.
      const otherDatabase = DATABASES.runtime + '_othermachine';
      await recreateDatabase(otherDatabase);
      const otherConnection = databaseUrl(otherDatabase);
      await applyMigrations(otherConnection);
      await seedCompany(otherConnection);
      const other = await installation({ database: otherDatabase });
      try {
        const outcome = await refusal(
          other.service.activate(key({ licenseId, machineId: OTHER_MACHINE })),
        );
        assertCode(outcome, 'LICENSE_KEY_WRONG_MACHINE');
        assertEqual(
          await count(otherConnection, 'SELECT count(*) FROM license_installations'),
          0,
          'no licence was installed by the refused key',
        );
      } finally {
        await close(other);
      }
      return 'refused before touching the licence';
    });

    await check('R3 a second activation cannot replace the licence', async () => {
      const outcome = await refusal(
        instance.service.activate(key({ licenseId: `lic_${'b'.repeat(16)}` })),
      );
      assertCode(outcome, 'LICENSE_ALREADY_ACTIVE');
      assertEqual(await count(connection, 'SELECT count(*) FROM license_installations'), 1, 'licence rows');
      return 'still one installation row';
    });

    await check('R4 a seats key cannot be used as an activation', async () => {
      const outcome = await refusal(
        instance.service.activate(
          key({ type: 'SEATS', licenseId, machineId: null, term: null, seats: { mode: 'INCREASE', value: 2 } }),
        ),
      );
      assertCode(outcome, 'LICENSE_KEY_WRONG_TYPE');
      assertEqual(await seatsIn(DATABASES.runtime), 0, 'no seat written');
      return 'type is checked before anything is written';
    });

    await check('R5 the same key cannot be applied twice', async () => {
      const outcome = await refusal(instance.service.activate(activationKey));
      assertCode(outcome, 'LICENSE_KEY_ALREADY_USED');
      // Nor through the state file alone: drop the row that remembers it and
      // the protected state still refuses.
      await withClient(connection, (client) => client.query('DELETE FROM license_keys'));
      const again = await refusal(instance.service.activate(activationKey));
      assertCode(again, 'LICENSE_KEY_ALREADY_USED');
      return 'refused by the key ledger and by the protected state file';
    });

    let firstUserId = null;

    await check('R6 a retried request with the same Idempotency-Key consumes no second seat', async () => {
      // Exactly the call UsersService makes: a seat reservation inside the
      // caller's transaction, keyed by the request's Idempotency-Key.
      const idempotencyKey = `retry-${randomUUID()}`;
      firstUserId = await createUser(instance, 'retry-a', idempotencyKey);
      const afterFirst = await seatsIn(DATABASES.runtime);
      assertEqual(afterFirst, 1, 'the first request took one seat');
      const retry = await instance.prisma.$transaction((tx) =>
        instance.service.reserveSeat(tx, {
          userId: randomUUID(),
          username: 'retry-a',
          reason: 'USER_CREATE',
          idempotencyKey,
        }),
      );
      assertEqual(retry.alreadyApplied, true, 'the retry was recognised as applied');
      assertEqual(retry.reserved, false, 'the retry reserved nothing');
      assertEqual(await seatsIn(DATABASES.runtime), afterFirst, 'no second seat for the pair');
      const rowsWithKey = await count(
        connection,
        'SELECT count(*) FROM license_seat_usage WHERE "idempotencyKey" = $1',
        [idempotencyKey],
      );
      assertEqual(rowsWithKey, 1, 'one ledger row for the pair');
      return 'two requests with one key produced one seat';
    });

    await check('R7 four more accounts fill the five seats, and the next is refused', async () => {
      for (let index = 1; index <= 4; index += 1) {
        await createUser(instance, `seat${index}`);
      }
      assertEqual(await seatsIn(DATABASES.runtime), 5, 'seat rows: one from R6 plus four');
      assertEqual(await usersIn(DATABASES.runtime), 5, 'users');
      const outcome = await refusal(createUser(instance, 'seat6'));
      assertCode(outcome, 'LICENSE_SEATS_EXHAUSTED');
      assertEqual(await seatsIn(DATABASES.runtime), 5, 'seat rows after the refusal');
      assertEqual(await usersIn(DATABASES.runtime), 5, 'no user was created by the refused request');
      return '5 seats used, sixth refused, no partial user row';
    });

    await check('R8 deleting and deactivating accounts never returns a seat', async () => {
      await instance.prisma.user.delete({ where: { id: firstUserId } });
      await instance.prisma.user.updateMany({
        where: { username: 'seat2' },
        data: { isActive: false },
      });
      assertEqual(await usersIn(DATABASES.runtime), 4, 'active+inactive user rows');
      assertEqual(await seatsIn(DATABASES.runtime), 5, 'seat rows after delete and deactivate');
      const outcome = await refusal(createUser(instance, 'seat7'));
      assertCode(outcome, 'LICENSE_SEATS_EXHAUSTED');
      return 'users 5 → 4, seats stay 5, creation still refused';
    });

    await check('R9 renaming an account does not consume another seat', async () => {
      await instance.prisma.user.updateMany({
        where: { username: 'seat3' },
        data: { username: 'seat3-renamed' },
      });
      assertEqual(await seatsIn(DATABASES.runtime), 5, 'seat rows after a rename');
      return 'seats unchanged';
    });

    await check('R10 a seat-increase key raises the limit without touching the rest', async () => {
      const before = await licenceRowIn(DATABASES.runtime);
      const usedBefore = (await instance.service.status({ fresh: true })).seats.used;
      const status = await instance.service.addSeats(
        key({
          type: 'SEATS',
          licenseId,
          machineId: null,
          term: null,
          seats: { mode: 'INCREASE', value: 3 },
        }),
      );
      assertEqual(status.seats.limit, 8, 'limit after the increase');
      assertEqual(status.seats.used, usedBefore, 'used count is not reset');
      assertEqual(status.expiresAt, before.expiresAt.toISOString(), 'expiry unchanged');
      const after = await licenceRowIn(DATABASES.runtime);
      assertEqual(after.machineId, before.machineId, 'machine unchanged');
      assertEqual(after.startsAt.toISOString(), before.startsAt.toISOString(), 'start date unchanged');
      assertEqual(await seatsIn(DATABASES.runtime), 5, 'ledger rows unchanged');
      return `limit 5 → 8, used stays ${usedBefore}`;
    });

    await check('R11 a seat cap below the accounts in use is refused, and changes nothing', async () => {
      const outcome = await refusal(
        instance.service.addSeats(
          key({
            type: 'SEATS',
            licenseId,
            machineId: null,
            term: null,
            seats: { mode: 'CAP', value: 2 },
          }),
        ),
      );
      assertCode(outcome, 'LICENSE_SEATS_BELOW_USED');
      assertEqual((await licenceRowIn(DATABASES.runtime)).seatLimit, 8, 'limit after the refusal');
      assertEqual(await seatsIn(DATABASES.runtime), 5, 'ledger unchanged');
      return 'limit stays 8';
    });

    await check('R12 a renewal before expiry adds to the end date', async () => {
      const before = await instance.service.status({ fresh: true });
      const status = await instance.service.renew(
        key({ type: 'RENEWAL', licenseId, machineId: null, seats: null, term: { kind: 'MONTHS', months: 12 } }),
      );
      const expected = addMonths(new Date(before.expiresAt), 12).toISOString();
      assertEqual(status.expiresAt, expected, 'expiry after an early renewal');
      assertEqual(status.seats.limit, 8, 'seat limit unchanged by the renewal');
      return `${before.expiresAt} → ${status.expiresAt}`;
    });

    await check('R13 a renewal after expiry starts at the moment it is applied', async () => {
      const past = new Date(Date.now() - 90 * 86_400_000);
      await withClient(connection, (client) =>
        client.query('UPDATE license_installations SET "expiresAt" = $1', [past]),
      );
      const expired = await instance.service.status({ fresh: true });
      assertEqual(expired.state, 'EXPIRED', 'state before the renewal');
      assertEqual(expired.blocked, true, 'blocked under enforce');
      const status = await instance.service.renew(
        key({ type: 'RENEWAL', licenseId, machineId: null, seats: null, term: { kind: 'MONTHS', months: 1 } }),
      );
      const expected = addMonths(new Date(), 1);
      const actual = new Date(status.expiresAt);
      const drift = Math.abs(actual.getTime() - expected.getTime());
      assert(drift < 5 * 60_000, `renewal started at ${actual.toISOString()}, expected about ${expected.toISOString()}`);
      assertEqual(status.state, 'ACTIVE', 'state after the renewal');
      assertEqual(status.seats.used, 5, 'the accounts survived the expiry and the renewal');
      return `expired → renewed to ${status.expiresAt}, data intact`;
    });

    await check('R14 the licence survives a restart of the service', async () => {
      const again = await installation({ database: DATABASES.runtime });
      try {
        const status = await again.service.status({ fresh: true });
        assertEqual(status.state, 'ACTIVE', 'state after a restart');
        assertEqual(status.seats.used, 5, 'used seats after a restart');
      } finally {
        await close(again);
      }
      return 'state and counters are read back from the database';
    });
  } finally {
    await close(instance);
  }
}

// ──────────────────────────────────────────────────────────────── 3. concurrency

async function concurrency() {
  console.log('\n== Two concurrent creations with one seat left');
  await recreateDatabase(DATABASES.concurrency);
  const connection = databaseUrl(DATABASES.concurrency);
  await applyMigrations(connection);
  await seedCompany(connection);

  const licenseId = `lic_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const instance = await installation({ database: DATABASES.concurrency });
  try {
    await instance.service.activate(key({ licenseId, seats: { mode: 'CAP', value: 5 } }));
    for (let index = 1; index <= 4; index += 1) {
      await createUser(instance, `filled${index}`);
    }
    assertEqual(await seatsIn(DATABASES.concurrency), 4, 'four seats used before the race');

    await check('C1 exactly one of two simultaneous creations succeeds', async () => {
      const started = Date.now();
      const outcomes = await Promise.allSettled([
        createUser(instance, 'race-a'),
        createUser(instance, 'race-b'),
      ]);
      const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
      assertEqual(fulfilled.length, 1, 'successful creations');
      assertEqual(rejected.length, 1, 'refused creations');
      const code = rejected[0].reason?.getResponse?.()?.code;
      assertEqual(code, 'LICENSE_SEATS_EXHAUSTED', 'refusal code');
      return `one created, one refused in ${Date.now() - started} ms`;
    });

    await check('C2 the limit was not exceeded and nothing was written twice', async () => {
      assertEqual(await seatsIn(DATABASES.concurrency), 5, 'seat rows');
      assertEqual(await usersIn(DATABASES.concurrency), 5, 'users (the refused one left no row)');
      const duplicates = await count(
        connection,
        `SELECT count(*) FROM (SELECT "userId" FROM license_seat_usage GROUP BY "userId" HAVING count(*) > 1) AS d`,
      );
      assertEqual(duplicates, 0, 'duplicate seat rows for one account');
      const status = await instance.service.status({ fresh: true });
      assertEqual(status.seats.used, 5, 'reported used seats');
      assertEqual(status.seats.limit, 5, 'reported limit');
      return '5 of 5 used, no duplicate ledger rows, no orphan user';
    });

    await check('C3 the refused transaction rolled back completely', async () => {
      const remaining = await rows(connection, `SELECT username FROM "users" ORDER BY username`);
      const names = remaining.map((row) => row.username);
      assert(names.includes('race-a') || names.includes('race-b'), 'the winner exists');
      assert(
        !(names.includes('race-a') && names.includes('race-b')),
        `both racers exist: ${names.join(', ')}`,
      );
      return names.join(', ');
    });

    await check('C4 a refused creation leaves no ledger row behind', async () => {
      const idempotencyKey = `refused-${randomUUID()}`;
      const outcomes = await Promise.allSettled([
        createUser(instance, 'extra-a', idempotencyKey),
        createUser(instance, 'extra-b'),
      ]);
      assert(outcomes.every((outcome) => outcome.status === 'rejected'), 'both refused while full');
      assertEqual(await seatsIn(DATABASES.concurrency), 5, 'seat rows');
      const rowsWithKey = await count(
        connection,
        'SELECT count(*) FROM license_seat_usage WHERE "idempotencyKey" = $1',
        [idempotencyKey],
      );
      assertEqual(rowsWithKey, 0, 'no ledger row for a refused request');
      return 'nothing written by the refused attempts';
    });
  } finally {
    await close(instance);
  }
}

// ─────────────────────────────────────────────────────────────────── 4. transfer

async function transfer() {
  console.log('\n== Transfer to a replacement machine');
  await recreateDatabase(DATABASES.transfer);
  const connection = databaseUrl(DATABASES.transfer);
  // The accounts exist before the licensing migration, exactly as on a real
  // upgrade, so the backfill gives each one its ledger row.
  await applyMigrations(connection, { skipLicensing: true });
  await seedCompany(connection);
  for (let index = 1; index <= 3; index += 1) await seedUser(connection, `newmachine${index}`);
  await applyLicensingMigration(connection);

  const licenseId = `lic_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const expiresAt = addMonths(new Date(), 8).toISOString();
  const instance = await installation({ database: DATABASES.transfer });
  try {
    await check('T1 a transfer installs the licence with its term, limit and used count', async () => {
      const status = await instance.service.transfer(
        key({
          type: 'TRANSFER',
          licenseId,
          machineId: MACHINE,
          term: null,
          seats: null,
          state: {
            expiresAt,
            seatLimit: 5,
            seatsUsed: 3,
            startsAt: new Date(Date.now() - 100 * 86_400_000).toISOString(),
            issuedAt: new Date().toISOString(),
          },
        }),
      );
      assertEqual(status.state, 'ACTIVE', 'state');
      assertEqual(status.expiresAt, expiresAt, 'remaining term preserved');
      assertEqual(status.seats.limit, 5, 'seat limit preserved');
      // The three accounts on this machine are the same three the old machine
      // counted: the transfer recognises them, it does not add them again.
      assertEqual(status.seats.used, 3, 'the three carried seats are counted once');
      const row = await licenceRowIn(DATABASES.transfer);
      assertEqual(row.machineId, MACHINE, 'bound to the new machine');
      assertEqual(await seatsIn(DATABASES.transfer), 3, 'ledger rows after the transfer');
      const watermarks = await count(
        connection,
        `SELECT count(*) FROM license_seat_usage WHERE reason = 'TRANSFER_WATERMARK'`,
      );
      assertEqual(watermarks, 0, 'no marker rows: the local accounts already cover the count');
      return `used ${status.seats.used} of ${status.seats.limit}, expiring ${status.expiresAt}`;
    });

    await check('T2 a transfer key presented as a renewal is refused', async () => {
      const outcome = await refusal(
        instance.service.renew(
          key({
            type: 'TRANSFER',
            licenseId,
            machineId: MACHINE,
            term: null,
            seats: null,
            state: {
              expiresAt: addMonths(new Date(), 20).toISOString(),
              seatLimit: 50,
              seatsUsed: 0,
              startsAt: new Date().toISOString(),
              issuedAt: new Date().toISOString(),
            },
          }),
        ),
      );
      assertCode(outcome, 'LICENSE_KEY_WRONG_TYPE');
      const row = await licenceRowIn(DATABASES.transfer);
      assertEqual(row.seatLimit, 5, 'the limit was not touched');
      return 'refused; the limit and the term stay as they were';
    });

    await check('T3 a transfer key for another machine is refused', async () => {
      const other = await installation({ database: DATABASES.transfer, machineId: OTHER_MACHINE });
      try {
        const outcome = await refusal(
          other.service.transfer(
            key({
              type: 'TRANSFER',
              licenseId,
              machineId: MACHINE,
              term: null,
              seats: null,
              state: {
                expiresAt,
                seatLimit: 5,
                seatsUsed: 3,
                startsAt: new Date().toISOString(),
                issuedAt: new Date().toISOString(),
              },
            }),
          ),
        );
        assertCode(outcome, 'LICENSE_KEY_WRONG_MACHINE');
      } finally {
        await close(other);
      }
      return 'refused';
    });

    await check('T4 a transfer cannot be applied where it would leave accounts over the limit', async () => {
      await recreateDatabase(DATABASES.transfer + '_small');
      const smallConnection = databaseUrl(DATABASES.transfer + '_small');
      await applyMigrations(smallConnection, { skipLicensing: true });
      await seedCompany(smallConnection);
      for (let index = 1; index <= 4; index += 1) await seedUser(smallConnection, `dense${index}`);
      await applyLicensingMigration(smallConnection);
      const dense = await installation({ database: DATABASES.transfer + '_small' });
      try {
        const outcome = await refusal(
          dense.service.transfer(
            key({
              type: 'TRANSFER',
              licenseId: `lic_${'c'.repeat(16)}`,
              machineId: MACHINE,
              term: null,
              seats: null,
              state: {
                expiresAt,
                seatLimit: 2,
                seatsUsed: 2,
                startsAt: new Date().toISOString(),
                issuedAt: new Date().toISOString(),
              },
            }),
          ),
        );
        assertCode(outcome, 'LICENSE_SEATS_BELOW_USED');
        assertEqual(await count(smallConnection, 'SELECT count(*) FROM license_installations'), 0, 'no licence installed');
      } finally {
        await close(dense);
      }
      return 'refused with LICENSE_SEATS_BELOW_USED';
    });
  } finally {
    await close(instance);
  }
}

// ───────────────────────────────────────────────────────────────── 5. perpetual

async function perpetual() {
  console.log('\n== Perpetual licence');
  await recreateDatabase(DATABASES.perpetual);
  const connection = databaseUrl(DATABASES.perpetual);
  await applyMigrations(connection);
  await seedCompany(connection);

  const licenseId = `lic_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  let now = new Date();
  const instance = await installation({ database: DATABASES.perpetual, clock: () => now });
  try {
    await check('P1 a perpetual licence has no expiry and is not expired years later', async () => {
      const status = await instance.service.activate(
        key({ licenseId, term: { kind: 'PERPETUAL' }, seats: { mode: 'CAP', value: 2 } }),
      );
      assertEqual(status.perpetual, true, 'perpetual flag');
      assertEqual(status.expiresAt, null, 'no expiry');
      assertEqual(status.daysRemaining, null, 'no days remaining');
      now = new Date(Date.now() + 20 * 365 * 86_400_000);
      const later = await instance.service.status({ fresh: true });
      assertEqual(later.state, 'ACTIVE', 'state twenty years later');
      assertEqual(later.blocked, false, 'blocked');
      return 'still ACTIVE twenty years later';
    });

    await check('P2 a perpetual licence still enforces the seat limit', async () => {
      await createUser(instance, 'p1');
      await createUser(instance, 'p2');
      const outcome = await refusal(createUser(instance, 'p3'));
      assertCode(outcome, 'LICENSE_SEATS_EXHAUSTED');
      return 'refused at the limit';
    });

    await check('P3 renewing a perpetual licence keeps it perpetual', async () => {
      const status = await instance.service.renew(
        key({ type: 'RENEWAL', licenseId, machineId: null, seats: null, term: { kind: 'PERPETUAL' } }),
      );
      assertEqual(status.perpetual, true, 'still perpetual');
      assertEqual(status.expiresAt, null, 'still no expiry');
      return 'no date invented';
    });
  } finally {
    await close(instance);
  }
}

// ───────────────────────────────────────────────── 6. clock, restore, state file

async function clockAndRestore() {
  console.log('\n== Clock policy, backups and the protected state file');
  await recreateDatabase(DATABASES.runtime + '_clock');
  const connection = databaseUrl(DATABASES.runtime + '_clock');
  await applyMigrations(connection);
  await seedCompany(connection);

  const licenseId = `lic_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  let now = new Date();
  const instance = await installation({
    database: DATABASES.runtime + '_clock',
    clock: () => now,
  });
  try {
    await instance.service.activate(key({ licenseId }));
    await createUser(instance, 'clock1');
    await createUser(instance, 'clock2');

    await check('K1 five minutes of drift is not a warning', async () => {
      now = new Date(Date.now() - 5 * 60_000);
      const status = await instance.service.status({ fresh: true });
      assertEqual(status.clock.state, 'OK', 'clock state');
      assertEqual(status.state, 'ACTIVE', 'licence state');
      return 'ignored';
    });

    await check('K2 two days back is a warning, and the program keeps working', async () => {
      now = new Date(Date.now() - 2 * 86_400_000);
      const status = await instance.service.status({ fresh: true });
      assertEqual(status.clock.state, 'WARNING', 'clock state');
      assertEqual(status.state, 'ACTIVE', 'licence state');
      assertEqual(status.blocked, false, 'blocked');
      const events = await count(
        connection,
        `SELECT count(*) FROM license_events WHERE type = 'CLOCK_WARNING'`,
      );
      assert(events >= 1, 'no CLOCK_WARNING event was written');
      return `warning recorded (${events} event(s))`;
    });

    await check('K3 five days back suspends the licence and keeps every row', async () => {
      now = new Date(Date.now() - 5 * 86_400_000);
      const status = await instance.service.status({ fresh: true });
      assertEqual(status.clock.state, 'TAMPERED', 'clock state');
      assertEqual(status.state, 'SUSPENDED', 'licence state');
      assertEqual(status.blocked, true, 'blocked');
      assertEqual(await usersIn(DATABASES.runtime + '_clock'), 2, 'accounts after the suspension');
      assertEqual(await seatsIn(DATABASES.runtime + '_clock'), 2, 'seat rows after the suspension');
      const events = await count(
        connection,
        `SELECT count(*) FROM license_events WHERE type = 'CLOCK_TAMPERED'`,
      );
      assert(events >= 1, 'no CLOCK_TAMPERED event was written');
      return 'state SUSPENDED, 2 accounts and 2 seats intact';
    });

    await check('K4 confirming is refused while the date is still behind', async () => {
      const outcome = await refusal(instance.service.confirmClock({ userId: null }));
      assertCode(outcome, 'LICENSE_CLOCK_STILL_BEHIND');
      assertEqual((await instance.service.status({ fresh: true })).state, 'SUSPENDED', 'still suspended');
      return 'refused';
    });

    await check('K5 confirming after the date is corrected clears the suspension', async () => {
      now = new Date();
      const status = await instance.service.confirmClock({ userId: null });
      assertEqual(status.state, 'ACTIVE', 'state');
      assertEqual(status.clock.state, 'OK', 'clock state');
      assertEqual(await usersIn(DATABASES.runtime + '_clock'), 2, 'accounts');
      return 'cleared, data intact';
    });

    await check('B1 a restored database older than the state file is raised to the watermarks', async () => {
      // The database "comes back" older: the licence loses its higher limit.
      await withClient(connection, (client) =>
        client.query('UPDATE license_installations SET "seatLimit" = 1, "expiresAt" = $1', [
          new Date(Date.now() + 10 * 86_400_000),
        ]),
      );
      instance.store.update((state) => {
        state.maxSeatLimit = 9;
        state.licenseExpiresAt = new Date(Date.now() + 400 * 86_400_000).toISOString();
      });
      await instance.service.reconcile();
      const row = await licenceRowIn(DATABASES.runtime + '_clock');
      assertEqual(row.seatLimit, 9, 'limit restored from the watermark');
      assert(
        new Date(row.expiresAt).getTime() > Date.now() + 399 * 86_400_000,
        'expiry was not restored from the watermark',
      );
      const events = await count(
        connection,
        `SELECT count(*) FROM license_events WHERE type = 'RESTORED_FROM_WATERMARK'`,
      );
      assert(events >= 1, 'no RESTORED_FROM_WATERMARK event');
      return 'limit 1 → 9 and the term restored, with an event';
    });

    await check('B2 restoring an older backup cannot lower the used-seat count', async () => {
      // Someone restores a copy taken when only one account existed.
      await withClient(connection, (client) =>
        client.query(`DELETE FROM license_seat_usage WHERE username = 'clock2'`),
      );
      assertEqual(await seatsIn(DATABASES.runtime + '_clock'), 1, 'rows in the restored copy');
      const status = await instance.service.status({ fresh: true });
      assertEqual(status.seats.used, 2, 'used seats reported from the watermark');
      // The next creation writes the lost rows back before spending a new one,
      // so the seat that the restored copy "forgot" is not handed out again.
      await createUser(instance, 'clock3');
      const markers = await count(
        connection,
        `SELECT count(*) FROM license_seat_usage WHERE reason = 'RESTORE_WATERMARK'`,
      );
      assertEqual(markers, 1, 'RESTORE_WATERMARK rows written');
      assertEqual(await seatsIn(DATABASES.runtime + '_clock'), 3, 'ledger rows: 1 restored + 1 marker + 1 new');
      const after = await instance.service.status({ fresh: true });
      assertEqual(after.seats.used, 3, 'used seats after the repair');
      return 'used stays 2 until the new seat, then 3 - the lost seat was not handed out again';
    });

    await check('B3 deleting the state file does not hand back seats', async () => {
      // A completely fresh state directory, as if the file were deleted.
      const fresh = await installation({ database: DATABASES.runtime + '_clock' });
      try {
        const status = await fresh.service.status({ fresh: true });
        assertEqual(status.state, 'ACTIVE', 'state');
        assert(status.seats.used >= 2, `used seats fell to ${status.seats.used}`);
        assertEqual(status.seats.limit, 9, 'limit read from the database');
      } finally {
        await close(fresh);
      }
      return 'the database remains the authority';
    });

    await check('B4 a corrupted state file is quarantined, not trusted', async () => {
      const path = join(instance.directory, 'license-state.json');
      const body = JSON.parse(readFileSync(path, 'utf8'));
      body.state.maxSeatsUsed = 0;
      writeFileSync(path, JSON.stringify(body));
      const restarted = await installation({
        database: DATABASES.runtime + '_clock',
        directory: instance.directory,
      });
      try {
        const status = await restarted.service.status({ fresh: true });
        assertEqual(status.state, 'ACTIVE', 'the licence is still readable from the database');
        assert(status.seats.used >= 2, `used seats fell to ${status.seats.used}`);
      } finally {
        await close(restarted);
      }
      return 'edited file refused; the database counters still apply';
    });
  } finally {
    await close(instance);
  }
}

// ───────────────────────────────────────────────────────────────────── HTTP layer

async function httpChecks() {
  const base = process.env.KAYAN_API_URL;
  const username = process.env.ADMIN_USERNAME ?? 'ci-admin';
  const password = process.env.ADMIN_PASSWORD;
  if (!base || !password) {
    console.log('\n== HTTP licence routes: skipped (KAYAN_API_URL/ADMIN_PASSWORD not set)');
    return;
  }
  console.log('\n== HTTP licence routes on the running API');

  await check('H1 the licence status is readable by a signed-in user', async () => {
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    assert(login.ok, `sign-in failed with ${login.status}`);
    const { accessToken } = await login.json();
    const response = await fetch(`${base}/license/status`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assertEqual(response.status, 200, 'status code');
    const body = await response.json();
    assert(typeof body.machineId === 'string' && body.machineId.startsWith('KM-'), 'machine id');
    assert(typeof body.requestCode === 'string' && body.requestCode.startsWith('KYNREQ1.'), 'request code');
    assert(typeof body.state === 'string', 'state');
    return `${body.state}; machine ${body.machineId}`;
  });

  await check('H2 the licence routes are open while business is blocked or unlicensed', async () => {
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const { accessToken } = await login.json();
    const response = await fetch(`${base}/license/request-code`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assertEqual(response.status, 200, 'request-code status');
    const body = await response.json();
    assert(typeof body.code === 'string' && body.code.startsWith('KYNREQ1.'), 'code');
    return 'request code issued over HTTP';
  });
}

// ───────────────────────────────────────────────────────────────────────── main

async function dropDatabases() {
  const names = cleanup.filter((entry) => typeof entry === 'string');
  for (const name of names) {
    try {
      await withClient(adminUrl(), async (client) => {
        await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      });
    } catch (error) {
      console.log(`  (could not drop ${name}: ${error.message})`);
    }
  }
  for (const entry of cleanup) {
    if (entry && typeof entry === 'object' && entry.directory) {
      rmSync(entry.directory, { recursive: true, force: true });
    }
  }
}

async function main() {
  const started = Date.now();
  console.log(`Licensing verification against PostgreSQL (${migrationDirectories().length} migrations)`);
  try {
    await migrationOnPopulatedDatabase();
    await activationAndSeats();
    await concurrency();
    await transfer();
    await perpetual();
    await clockAndRestore();
    await httpChecks();
  } finally {
    if (!process.argv.includes('--keep')) await dropDatabases();
  }

  console.log(
    `\n${passes} passed, ${failures} failed in ${Math.round((Date.now() - started) / 1000)}s`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('\nThe verification could not finish:', error);
  process.exitCode = 2;
});
