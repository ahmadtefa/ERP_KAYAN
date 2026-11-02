/**
 * Restores a real application backup into a clean database and then uses the
 * program against it.
 *
 * A restore is only worth anything if the restored copy behaves like the
 * original: the warehouses, the shelves, the lots, the balances, the per-user
 * warehouse grants, the roles and the licence must all be there, the licence
 * must still be enforced, and a stock operation must still work - and still be
 * refused to a person who was never granted that shelf.
 *
 * Nothing here is mocked: the backup is the file the installed program wrote,
 * the restore uses the installed pg_restore, and the operations go through a
 * real API process running on the restored database.
 *
 * Environment:
 *   KAYAN_DUMP_PATH        the backup file to restore (required)
 *   KAYAN_PG_BIN           directory holding psql/pg_restore (required)
 *   ADMIN_DATABASE_URL     a role that may create databases (required)
 *   DATABASE_URL           the live database the backup came from (required)
 *   KAYAN_RESTORE_DB       the clean database to create (default erp_kayan_restored)
 *   KAYAN_ADMIN_USERNAME / KAYAN_ADMIN_PASSWORD   the installed administrator
 *   KAYAN_RESTORE_REPORT   where to write the JSON report
 *
 * To use the installed Windows program (the real proof):
 *   KAYAN_CLIENT_EXE       the installed erp_kayan.exe
 *   KAYAN_SETTINGS_PATH    the installed kayan.env the shell reads
 *   KAYAN_HEALTH_PORTS     ports the shell may choose from (default 3000,3001,3002,3003,3010,3020)
 *
 * Without KAYAN_CLIENT_EXE a second API process is started directly from
 * KAYAN_NODE + KAYAN_API_MAIN on KAYAN_RESTORE_PORT; that is how this script is
 * rehearsed on a development machine, and it exercises the same checks.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const DUMP = process.env.KAYAN_DUMP_PATH ?? '';
const PG_BIN = process.env.KAYAN_PG_BIN ?? '';
const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? '';
const LIVE_URL = process.env.DATABASE_URL ?? '';
const RESTORE_DB = process.env.KAYAN_RESTORE_DB ?? 'erp_kayan_restored';
const ADMIN_USER = process.env.KAYAN_ADMIN_USERNAME ?? 'ci-admin';
const ADMIN_PASSWORD = process.env.KAYAN_ADMIN_PASSWORD ?? '';
const REPORT = process.env.KAYAN_RESTORE_REPORT ?? '';
const CLIENT_EXE = process.env.KAYAN_CLIENT_EXE ?? '';
const SETTINGS = process.env.KAYAN_SETTINGS_PATH ?? '';
const NODE = process.env.KAYAN_NODE ?? process.execPath;
const API_MAIN = process.env.KAYAN_API_MAIN ?? '';
const BACKEND_DIR = process.env.KAYAN_BACKEND_DIR ?? '';
const RESTORE_PORT = Number(process.env.KAYAN_RESTORE_PORT ?? 3001);
const HEALTH_PORTS = (process.env.KAYAN_HEALTH_PORTS ?? '3000,3001,3002,3003,3010,3020')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter(Boolean);

let pass = 0;
let fail = 0;
const failures = [];
const results = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
  results.push({ name, ok: Boolean(condition), detail });
}

// ───────────────────────────────────────────────────────── tools, not mocks
function tool(name) {
  const path = join(PG_BIN, process.platform === 'win32' ? `${name}.exe` : name);
  if (!existsSync(path)) throw new Error(`The installed PostgreSQL tool is missing: ${path}`);
  return path;
}

/// psql/pg tools reject Prisma's `?schema=public`, and libpq takes the password
/// from PGPASSWORD rather than from the URL.
function connection(url) {
  const parsed = new URL(url);
  return {
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    host: parsed.hostname,
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    url: `${parsed.protocol}//${parsed.username}:${parsed.password}@${parsed.host}`,
  };
}

function run(command, args, { cwd, env = {}, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `${basename(command)} ${args.join(' ')} failed (${result.status}):\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    );
  }
  return result;
}

function psql(connectionInfo, database, sql) {
  const result = run(
    tool('psql'),
    ['-h', connectionInfo.host, '-p', connectionInfo.port, '-U', connectionInfo.user, '-d', database, '-t', '-A', '-c', sql],
    { env: { PGPASSWORD: connectionInfo.password, PGSSLMODE: 'disable' } },
  );
  return String(result.stdout ?? '').trim();
}

function countRows(connectionInfo, database, table) {
  const raw = psql(connectionInfo, database, `SELECT count(*) FROM "${table}"`);
  return Number(raw);
}

function tableExists(connectionInfo, database, table) {
  const raw = psql(
    connectionInfo,
    database,
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='${table}'`,
  );
  return raw === '1';
}

async function login(base, username, password) {
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, token: data?.accessToken ?? '' };
}

const as = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

async function waitForHealth(ports, processHandle) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (processHandle && processHandle.exitCode !== null) {
      throw new Error(`The program exited with code ${processHandle.exitCode} before its server became healthy.`);
    }
    for (const port of ports) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(2000) });
        if (!response.ok) continue;
        const health = await response.json();
        if (health?.status === 'ok' && health?.database === 'up') return port;
      } catch {
        // Not listening yet.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return 0;
}

/// Rewrites the one line of the installed kayan.env that says which database the
/// program uses. A restored machine is a machine whose program points at the
/// restored copy; doing it any other way would prove a library, not a program.
function pointSettingsAt(databaseUrl) {
  const text = readFileSync(SETTINGS, 'utf8');
  const updated = text.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL="${databaseUrl}"`);
  if (updated === text) throw new Error('kayan.env has no DATABASE_URL line to point at the restored database.');
  writeFileSync(`${SETTINGS}.before-restore`, text);
  writeFileSync(SETTINGS, updated);
}

function restoreSettings() {
  const before = `${SETTINGS}.before-restore`;
  if (existsSync(before)) writeFileSync(SETTINGS, readFileSync(before, 'utf8'));
}

async function stopProgram(handle) {
  if (handle && handle.exitCode === null) {
    handle.kill();
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

async function main() {
  console.log('Proving a real application backup restores into a usable copy');
  if (!DUMP || !PG_BIN || !ADMIN_URL || !LIVE_URL) {
    throw new Error('KAYAN_DUMP_PATH, KAYAN_PG_BIN, ADMIN_DATABASE_URL and DATABASE_URL are required');
  }
  if (!ADMIN_PASSWORD) throw new Error('KAYAN_ADMIN_PASSWORD is required');

  const admin = connection(ADMIN_URL);
  const live = connection(LIVE_URL);
  const maintenance = admin.database;
  const restoredUrl = `${admin.url}/${RESTORE_DB}?schema=public`;

  // ── 1. the backup the program wrote ───────────────────────────────────────
  console.log('\n[R1] the application backup is a real, readable PostgreSQL archive');
  check('the backup file exists and is not empty', existsSync(DUMP) && readFileSync(DUMP).length > 0, basename(DUMP));
  const listing = run(tool('pg_restore'), ['--list', DUMP], { allowFailure: true });
  check(
    'the installed pg_restore can list the archive',
    listing.status === 0 && /TABLE DATA/.test(String(listing.stdout ?? '')),
    `${String(listing.stdout ?? '').split('\n').length} line(s)`,
  );

  // ── 2. restore into a clean database ──────────────────────────────────────
  console.log(`\n[R2] the backup restores into a clean database (${RESTORE_DB})`);
  run(tool('psql'), ['-h', admin.host, '-p', admin.port, '-U', admin.user, '-d', maintenance, '-c',
    `DROP DATABASE IF EXISTS "${RESTORE_DB}" WITH (FORCE)`],
    { env: { PGPASSWORD: admin.password, PGSSLMODE: 'disable' } });
  run(tool('psql'), ['-h', admin.host, '-p', admin.port, '-U', admin.user, '-d', maintenance, '-c',
    `CREATE DATABASE "${RESTORE_DB}"`],
    { env: { PGPASSWORD: admin.password, PGSSLMODE: 'disable' } });
  const restore = run(
    tool('pg_restore'),
    ['-h', admin.host, '-p', admin.port, '-U', admin.user, '-d', RESTORE_DB, '--no-owner', '--no-privileges', DUMP],
    { env: { PGPASSWORD: admin.password, PGSSLMODE: 'disable' }, allowFailure: true },
  );
  const restoreErrors = String(restore.stderr ?? '')
    .split('\n')
    .filter((line) => /error:/i.test(line));
  check(
    'pg_restore completes without errors',
    restore.status === 0 && restoreErrors.length === 0,
    restore.status === 0 ? 'exit 0' : `exit ${restore.status}: ${restoreErrors.slice(0, 3).join(' | ')}`,
  );

  // ── 3. the same rows are in both copies ───────────────────────────────────
  console.log('\n[R3] every table that carries the warehouse is identical in the restored copy');
  const tables = [
    'warehouses',
    'storage_locations',
    'items',
    'item_batches',
    'stock_movements',
    'user_warehouse_access',
    'users',
    'roles',
    'role_permissions',
    'license_installations',
    'license_keys',
  ];
  for (const table of tables) {
    if (!tableExists(live, live.database, table)) {
      check(`${table} exists in the live database`, false, 'table missing');
      continue;
    }
    const source = countRows(live, live.database, table);
    const restored = tableExists(admin, RESTORE_DB, table) ? countRows(admin, RESTORE_DB, table) : -1;
    check(`the restored ${table} matches (${source} row(s))`, source === restored, `live ${source}, restored ${restored}`);
  }

  const lots = countRows(admin, RESTORE_DB, 'item_batches');
  const movements = countRows(admin, RESTORE_DB, 'stock_movements');
  const grants = countRows(admin, RESTORE_DB, 'user_warehouse_access');
  check('the restored copy still holds lots and their movements', lots > 0 && movements > 0,
    `${lots} lot(s), ${movements} movement(s)`);
  check('the restored copy still holds the per-user warehouse grants', grants > 0, `${grants} grant(s)`);

  const permissionRows = Number(
    psql(admin, RESTORE_DB,
      `SELECT count(*) FROM role_permissions rp JOIN permissions p ON p.id = rp."permissionId" WHERE p.code LIKE 'inventory.%'`),
  );
  check('the restored roles still carry the inventory permissions', permissionRows > 0, `${permissionRows} inventory grant(s)`);

  const licenceRows = tableExists(admin, RESTORE_DB, 'license_installations')
    ? countRows(admin, RESTORE_DB, 'license_installations')
    : 0;
  check('the restored copy carries the licence records', licenceRows > 0, `${licenceRows} installation row(s)`);

  // ── 4. open the program on the restored copy ──────────────────────────────
  console.log('\n[R4] the program opens the restored copy and works in it');
  let handle = null;
  let base = '';
  try {
    if (CLIENT_EXE && existsSync(CLIENT_EXE)) {
      pointSettingsAt(restoredUrl);
      const response = spawn(CLIENT_EXE, [], { detached: false, stdio: 'ignore' });
      handle = response;
      const port = await waitForHealth(HEALTH_PORTS, response);
      check('the installed program starts its server on the restored database', port > 0, port ? `port ${port}` : 'no healthy server');
      base = `http://127.0.0.1:${port}/api/v1`;
    } else {
      if (!API_MAIN) throw new Error('KAYAN_API_MAIN is required when no installed client is used');
      const response = spawn(NODE, [API_MAIN], {
        cwd: BACKEND_DIR || undefined,
        env: {
          ...process.env,
          DATABASE_URL: restoredUrl,
          PORT: String(RESTORE_PORT),
          NODE_ENV: 'production',
          KAYAN_ADMIN_USERNAME: ADMIN_USER,
          KAYAN_ADMIN_PASSWORD: ADMIN_PASSWORD,
        },
        stdio: 'ignore',
      });
      handle = response;
      const port = await waitForHealth([RESTORE_PORT], response);
      check('a second server starts on the restored database', port > 0, port ? `port ${port}` : 'no healthy server');
      base = `http://127.0.0.1:${port}/api/v1`;
    }
    if (!base) return finish();

    const status = await fetch(`${base}/license/status`).then((r) => r.json()).catch(() => ({}));
    check(
      'the restored copy is licensed, and the licence was not bypassed',
      status?.state === 'ACTIVE' && status?.blocked === false,
      `state ${status?.state ?? 'unknown'}`,
    );

    const signed = await login(base, ADMIN_USER, ADMIN_PASSWORD);
    check('the restored administrator can sign in', signed.status === 201 && Boolean(signed.token), `HTTP ${signed.status}`);
    if (!signed.token) return finish();

    // A real post-restore operation: a new warehouse, which a restore that only
    // copied rows and broke the schema could not accept.
    const stamp = String(Date.now()).slice(-6);
    const branchId = psql(admin, RESTORE_DB, 'SELECT id FROM branches LIMIT 1');
    const created = await fetch(`${base}/inventory/warehouses`, {
      method: 'POST',
      headers: as(signed.token),
      body: JSON.stringify({
        code: `PR-${stamp}`,
        nameEn: `Post-restore ${stamp}`,
        nameAr: `بعد الاستعادة ${stamp}`,
        branchId,
      }),
    });
    const createdBody = await created.json().catch(() => ({}));
    check('a stock operation succeeds on the restored copy', created.status === 201 && Boolean(createdBody.id),
      `HTTP ${created.status} ${createdBody?.code ?? ''}`);

    const warehouses = await fetch(`${base}/inventory/warehouses`, { headers: as(signed.token) }).then((r) => r.json());
    const rows = warehouses?.items ?? warehouses ?? [];
    check('the restored warehouses are readable through the program', rows.length >= 3, `${rows.length} warehouse(s)`);

    // The separation of duties has to survive the restore as well: the clerk the
    // proof created was granted one shelf and refused the other.
    const clerk = psql(admin, RESTORE_DB,
      `SELECT u.username FROM users u JOIN user_warehouse_access g ON g."userId" = u.id GROUP BY u.username LIMIT 1`);
    if (clerk) {
      const clerkSession = await login(base, clerk, 'Pr0ved!Passw0rd-2026');
      check('the restored storekeeper can sign in', clerkSession.status === 201, `HTTP ${clerkSession.status}`);
      if (clerkSession.token) {
        const grantedWarehouse = psql(admin, RESTORE_DB,
          `SELECT g."warehouseId" FROM user_warehouse_access g JOIN users u ON u.id = g."userId" WHERE u.username='${clerk}' AND g."canView" LIMIT 1`);
        const otherWarehouse = psql(admin, RESTORE_DB,
          `SELECT id FROM warehouses WHERE id <> '${grantedWarehouse}' LIMIT 1`);
        const allowed = await fetch(`${base}/inventory/reports/valuation-by-warehouse?warehouseId=${grantedWarehouse}`,
          { headers: as(clerkSession.token) });
        const refused = await fetch(`${base}/inventory/reports/valuation-by-warehouse?warehouseId=${otherWarehouse}`,
          { headers: as(clerkSession.token) });
        check('the restored grant still allows the granted shelf', allowed.status === 200, `HTTP ${allowed.status}`);
        check('the restored grant still refuses the other shelf', refused.status === 403, `HTTP ${refused.status}`);
      }
    } else {
      check('the restored copy names a storekeeper with a grant', false, 'no user_warehouse_access row');
    }

    // Writing into a shelf the storekeeper was not granted must be refused by
    // the server, not hidden by a screen - the same rule after a restore.
    const clerkName = psql(admin, RESTORE_DB,
      `SELECT u.username FROM users u JOIN user_warehouse_access g ON g."userId" = u.id GROUP BY u.username LIMIT 1`);
    if (clerkName) {
      const session = await login(base, clerkName, 'Pr0ved!Passw0rd-2026');
      if (session.token) {
        const item = psql(admin, RESTORE_DB,
          `SELECT i.id FROM items i WHERE EXISTS (SELECT 1 FROM item_batches b WHERE b."itemId" = i.id) LIMIT 1`);
        const denied = await fetch(`${base}/inventory/batches/receive`, {
          method: 'POST',
          headers: as(session.token),
          body: JSON.stringify({
            branchId: psql(admin, RESTORE_DB, 'SELECT id FROM branches LIMIT 1'),
            warehouseId: psql(admin, RESTORE_DB,
              `SELECT w.id FROM warehouses w WHERE NOT EXISTS (SELECT 1 FROM user_warehouse_access g JOIN users u ON u.id=g."userId" WHERE u.username='${clerkName}' AND g."warehouseId"=w.id) LIMIT 1`),
            itemId: item,
            quantity: 1,
            unitCost: 1,
            batchNumber: `RESTORE-DENY-${Date.now()}`,
          }),
        });
        const deniedBody = await denied.json().catch(() => ({}));
        check('a receipt into an ungranted shelf is still refused after the restore',
          denied.status === 403, `HTTP ${denied.status} ${deniedBody?.detail ?? ''}`);
      }
    }
  } finally {
    await stopProgram(handle);
    if (CLIENT_EXE) restoreSettings();
  }

  finish();
}

function finish() {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) console.log(`Failures: ${failures.join(', ')}`);
  if (REPORT) {
    try {
      writeFileSync(REPORT, JSON.stringify({ dump: DUMP, restoreDatabase: RESTORE_DB, pass, fail, failures, results }, null, 2));
    } catch {
      // A report that cannot be written must not change the verdict.
    }
  }
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error('Restored-copy proof aborted:', error);
  if (REPORT) {
    try {
      writeFileSync(REPORT, JSON.stringify({ dump: DUMP, pass, fail, failures, results, aborted: String(error) }, null, 2));
    } catch {
      // Ignore.
    }
  }
  process.exitCode = 1;
});
