#!/usr/bin/env node
/**
 * Builds the one downloadable demo backup file.
 *
 * The file it produces is a real PostgreSQL Custom-format archive, made by
 * the program's own backup route — not a copy of the folder, not a script,
 * not a pile of spreadsheets. Restoring it through the Restore Backup screen
 * is the test this script runs at the end, against a second throwaway
 * database, before it is willing to call the file finished.
 *
 *   1. a clean, throwaway database is created and every real migration is
 *      applied to it — no table is hand-made here;
 *   2. the fictional demo company is built into it through the real schema,
 *      the real enums and balanced books;
 *   3. the API is started against that database and asked, over HTTP, to take
 *      a full backup — the same call the Backup screen makes;
 *   4. the archive is read back with `pg_restore --list`, the way the program
 *      itself checks an upload before it will trust one;
 *   5. a second clean database is created and the exact file from step 3 is
 *      restored into it, through the program's restore route;
 *   6. the restored books are counted and the accounting totals compared, and
 *      only then is the file copied out and named.
 *
 * Environment:
 *   DATABASE_URL          the throwaway database the demo is built in
 *                         (default postgresql://kayan:kayan@127.0.0.1:5432/erp_kayan_demo)
 *   ADMIN_DATABASE_URL    used only to create and drop the throwaway
 *                         databases (default: the same server's `postgres`)
 *   KAYAN_RESTORE_URL     the second throwaway database the file is restored
 *                         into (default: …erp_kayan_demo_restore)
 *   PSQL / PG_DUMP / PG_RESTORE   paths to the PostgreSQL client tools
 *   OUT_DIR               where the finished file is written (default ./dist-demo)
 *
 * Nothing here touches the database the program normally runs on: two
 * databases are created and dropped, and both names are chosen here.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = join(here, '..');

const PSQL = process.env.PSQL ?? 'psql';
const PG_RESTORE = process.env.PG_RESTORE ?? 'pg_restore';
const DEMO_URL =
  process.env.DATABASE_URL ??
  'postgresql://kayan:kayan@127.0.0.1:5432/erp_kayan_demo';
const RESTORE_URL = process.env.KAYAN_RESTORE_URL ?? `${DEMO_URL}_restore`;
const BARE_URL = process.env.KAYAN_BARE_URL ?? `${DEMO_URL}_bare`;
const OUT_DIR = process.env.OUT_DIR ?? join(backendDir, 'dist-demo');

const results = [];

function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(
            new Error(
              `${command} ${args.join(' ')} exited ${code}\n${stderr || stdout}`,
            ),
          ),
    );
  });
}

/**
 * The URL as Prisma wants it. `psql` will not accept the `schema` parameter
 * Prisma adds, and it is a client-side hint anyway, so it is dropped before a
 * URL is handed to a command-line tool.
 */
const psqlUrl = (url) => url.replace(/([?&])schema=[^&]*/, '$1').replace(/[?&]$/, '');

const databaseName = (url) =>
  new URL(url).pathname.replace(/^\//, '').split('?')[0];
const serverOf = (url) => url.slice(0, url.indexOf(new URL(url).pathname));

async function recreateDatabase(url) {
  const name = databaseName(url);
  const maintenance =
    process.env.ADMIN_DATABASE_URL ?? `${serverOf(url)}/postgres`;
  await run(
    PSQL,
    [psqlUrl(maintenance), '-c', `DROP DATABASE IF EXISTS "${name}"`],
    {
    env: process.env,
  }).catch(() => {
    /* it was not there, which is fine */
  });
  await run(PSQL, [psqlUrl(maintenance), '-c', `CREATE DATABASE "${name}"`], {
    env: process.env,
  });
}

/// One row, from a query that is expected to return exactly one.
async function sql(url, query) {
  const { stdout } = await run(
    PSQL,
    [psqlUrl(url), '-At', '-F', '|', '-c', query],
    { env: process.env },
  );
  return stdout
    .trim()
    .split('|')
    .reduce((row, value, index) => {
      row[['tables', 'entries', 'accounts'][index]] = value;
      return row;
    }, {});
}

async function migrate(url) {
  const migrationsDir = join(backendDir, 'prisma', 'migrations');
  const folders = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((folder) => {
      try {
        statSync(join(migrationsDir, folder, 'migration.sql'));
        return true;
      } catch {
        return false;
      }
    })
    .sort();
  for (const folder of folders) {
    await run(
      PSQL,
      [
        psqlUrl(url),
        '-v',
        'ON_ERROR_STOP=1',
        '-q',
        '-f',
        join(migrationsDir, folder, 'migration.sql'),
      ],
      { env: process.env },
    );
  }
  return folders.length;
}

async function nodeScript(script, env) {
  const { stdout } = await run(
    process.execPath,
    [
      join(backendDir, 'node_modules', 'ts-node', 'dist', 'bin.js'),
      '--transpile-only',
      script,
    ],
    { env: { ...process.env, ...env }, cwd: backendDir },
  );
  return stdout;
}

/// Waits for the API to answer, so the next step is not racing the boot.
async function waitForApi(base, attempts = 90) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

/// The last few lines a server wrote, for a failure message that explains
/// itself. Errors travel in the log long before anybody reads a stack trace.
function serverLogTail(log, lines = 12) {
  const text = String(log ?? '').trim();
  if (!text) return '(the server wrote nothing)';
  const clean = text
    .split('\n')
    .map((line) => line.replace(/\u001b\[[0-9;]*m/g, '').trimEnd())
    .filter((line) => line.trim().length > 0);
  // The sentence that says what went wrong, then the last few lines for
  // context: a stack trace without its first line explains nothing.
  const headlines = clean
    .filter((line) =>
      /(Error|Exception|refus|append-only|denied|could not|violates)/i.test(line),
    )
    .slice(0, 4);
  const kept = clean.slice(-lines);
  const parts = [...headlines, ...kept.filter((line) => !headlines.includes(line))];
  return '\n    ' + parts.join('\n    ');
}

function startApi(port, databaseUrl, backupDir) {
  const child = spawn(
    process.execPath,
    [join(backendDir, 'dist', 'src', 'main.js')],
    {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        KAYAN_BACKUP_DIR: backupDir,
        PORT: String(port),
        HOST: '127.0.0.1',
        NODE_ENV: 'development',
        JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'demo-build-secret',
        JWT_REFRESH_SECRET:
          process.env.JWT_REFRESH_SECRET ?? 'demo-build-refresh-secret',
        JWT_ACCESS_TTL: '900',
        JWT_REFRESH_TTL: '604800',
      },
      cwd: backendDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));
  return { child, log: () => log };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const backupDir = join(OUT_DIR, 'backups');
  rmSync(backupDir, { recursive: true, force: true });
  mkdirSync(backupDir, { recursive: true });

  console.log(`Building the demo backup in "${databaseName(DEMO_URL)}"…`);

  // ── 1. a clean database, with the real migrations ──────────────────────
  await recreateDatabase(DEMO_URL);
  const applied = await migrate(DEMO_URL);
  check(
    'a clean database is created and every migration is applied',
    applied > 0,
    `${applied} migrations`,
  );

  // ── 2. the permission catalogue, then the fictional company ────────────
  await nodeScript('prisma/seed-permissions.ts', { DATABASE_URL: DEMO_URL });
  const seeded = await nodeScript('prisma/seed-demo.ts', {
    DATABASE_URL: DEMO_URL,
  });
  process.stdout.write(seeded);
  check(
    'the fictional demo company is built with balanced books',
    seeded.includes('The demo books balance'),
  );

  // ── 3. the program takes the backup, over HTTP ─────────────────────────
  const demoPort = 3999;
  const demoBase = `http://127.0.0.1:${demoPort}/api/v1`;
  const demo = startApi(demoPort, DEMO_URL, backupDir);
  let bytes = null;
  let jsonBytes = null;
  let name = '';
  let before = null;
  let token = '';

  try {
    if (!(await waitForApi(demoBase))) {
      throw new Error(`the demo API did not start:\n${demo.log()}`);
    }

    const login = await fetch(`${demoBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'Admin@12345' }),
    });
    const session = await login.json().catch(() => ({}));
    token = session.accessToken ?? '';
    const headers = { Authorization: `Bearer ${token}` };
    check(
      'the demo company can be signed into',
      Boolean(session.accessToken),
      `login answered ${login.status}`,
    );

    const capabilities = await fetch(`${demoBase}/backup/full/capabilities`, {
      headers,
    }).then((response) => response.json());
    check(
      'this machine has the PostgreSQL tools a backup needs',
      capabilities.available === true,
      capabilities.version ? `pg_dump ${capabilities.version}` : capabilities.reason,
    );

    const created = await fetch(`${demoBase}/backup/full`, {
      method: 'POST',
      headers,
    }).then((response) => response.json());
    name = created?.file?.name ?? '';
    check(
      'the program takes the backup through its own route',
      /\.dump$/.test(name),
      `${name} (${created?.file?.sizeBytes ?? 0} bytes)`,
    );

    // ── 4. the archive is read back the way an upload is checked ─────────
    const archivePath = join(backupDir, name);
    const listing = await run(PG_RESTORE, ['--list', archivePath], {
      env: process.env,
    });
    const objects = (listing.stdout.match(/^\d+; /gm) ?? []).length;
    check(
      'the archive is read back with pg_restore before it is trusted',
      objects > 0 && listing.stdout.includes('TABLE DATA'),
      `${objects} objects listed`,
    );

    const downloaded = await fetch(
      `${demoBase}/backup/full/${encodeURIComponent(name)}/download`,
      { headers },
    );
    bytes = Buffer.from(await downloaded.arrayBuffer());
    check(
      'the downloaded file is a PostgreSQL Custom archive',
      downloaded.status === 200 &&
        bytes.subarray(0, 5).toString('latin1') === 'PGDMP',
      `${bytes.length} bytes, HTTP ${downloaded.status}`,
    );

    // ── 5. the accounting totals the demo is supposed to hold ────────────
    before = await fetch(
      `${demoBase}/reports/trial-balance?from=2000-01-01&to=2099-12-31`,
      { headers },
    ).then((response) => response.json());
    check(
      'the demo books balance before they are backed up',
      Number(before?.totals?.difference) === 0 &&
        Number(before?.totals?.debit) === Number(before?.totals?.credit) &&
        (before?.rows?.length ?? 0) >= 20,
      `${before?.rows?.length ?? 0} accounts with movement, debits ${before?.totals?.debit} / credits ${before?.totals?.credit}, difference ${before?.totals?.difference}`,
    );

    // ── 5b. the company JSON backup file ─────────────────────────────────
    const jsonDownload = await fetch(`${demoBase}/backup/download`, { headers });
    jsonBytes = Buffer.from(await jsonDownload.arrayBuffer());
    check(
      'the company JSON backup is downloaded from /backup/download',
      jsonDownload.status === 200 && jsonBytes.length > 0,
      `${jsonBytes.length} bytes, HTTP ${jsonDownload.status}`,
    );

    const jsonParsed = JSON.parse(jsonBytes.toString('utf8'));
    // Turn the downloaded company backup into a portable demo fixture. The
    // restore service recognizes companyCode=DEMO and safely maps all rows
    // into the current company, even when its code/ID differs from NAKHEEL.
    // The actual company JSON export route remains unchanged.
    jsonParsed.companyCode = 'DEMO';
    jsonBytes = Buffer.from(JSON.stringify(jsonParsed, null, 2), 'utf8');
    check(
      'the company JSON backup is portable across fresh KAYAN installations',
      jsonParsed.format === 'kayan-backup' &&
        jsonParsed.version === 1 &&
        jsonParsed.companyCode === 'DEMO' &&
        !jsonBytes.subarray(0, 5).toString('latin1').startsWith('PGDMP') &&
        Object.keys(jsonParsed.tables ?? {}).length > 10,
      `format=${jsonParsed.format}, tables=${Object.keys(jsonParsed.tables ?? {}).length}, companyCode=${jsonParsed.companyCode}`,
    );
  } finally {
    demo.child.kill('SIGTERM');
  }

  // ── 6. the exact file, restored into a second clean database ───────────
  await recreateDatabase(RESTORE_URL);
  await migrate(RESTORE_URL);

  const restorePort = 3998;
  const restoreBase = `http://127.0.0.1:${restorePort}/api/v1`;
  const restore = startApi(restorePort, RESTORE_URL, backupDir);

  try {
    if (!(await waitForApi(restoreBase))) {
      throw new Error(`the restore API did not start:\n${restore.log()}`);
    }

    // A source-database JWT is not authorization on a fresh installation:
    // the destination must have its own real administrator first. Exercise
    // public first-run setup and login, exactly as the installed client does.
    const foreignToken = await fetch(`${restoreBase}/backup/full`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    check('a token from the source database is rejected on the fresh destination', foreignToken.status === 401, `HTTP ${foreignToken.status}`);
    const setup = await fetch(`${restoreBase}/setup/initial`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyCode: 'RESTORE-CI', companyNameEn: 'Disposable restore target', companyNameAr: 'شركة اختبار الاسترجاع',
        facilityKind: 'HEADQUARTERS', unitCode: 'MAIN', unitNameEn: 'Head Office', unitNameAr: 'المركز الرئيسي',
        adminUsername: 'restore-ci', adminPassword: 'CI-Restore-Password-12345', seedChartOfAccounts: true,
      }),
    });
    if (!setup.ok) throw new Error(`Destination first-run setup failed: HTTP ${setup.status} ${await setup.text()}`);
    const targetToken = await loginAs(restoreBase, 'restore-ci', 'CI-Restore-Password-12345');
    if (!targetToken) throw new Error('Destination administrator could not sign in before the full restore');

    const form = new FormData();
    form.append('confirm', 'true');
    form.append('file', new Blob([bytes]), name || 'kayan-demo.dump');
    const response = await fetch(`${restoreBase}/backup/full/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${targetToken}` },
      body: form,
    });
    const result = await response.json().catch(() => null);
    check(
      'the exact file restores through the program’s own restore route',
      response.status === 201 && result?.restored === true,
      `HTTP ${response.status}, checked=${result?.checked === true}, rehearsed in a scratch database=${result?.rehearsed === true}`,
    );

    const signedIn = await loginAs(restoreBase);
    const headers = { Authorization: `Bearer ${signedIn}` };
    check(
      'the restored company can be signed into with the demo password',
      Boolean(signedIn),
      signedIn ? '' : 'the restore did not bring the users back',
    );

    /**
     * How many rows a list holds. Pages are asked for one big page; the
     * screens that are not paged have no `pageSize` to give and refuse an
     * unknown query parameter, so that case falls back to a plain call.
     */
    const count = async (path) => {
      const separator = path.includes('?') ? '&' : '?';
      const paged = await fetch(`${restoreBase}${path}${separator}pageSize=500`, {
        headers,
      });
      const response = paged.ok
        ? paged
        : await fetch(`${restoreBase}${path}`, { headers });
      const body = await response.json().catch(() => null);
      return body?.items?.length ?? (Array.isArray(body) ? body.length : 0);
    };

    const accounts = await count('/accounting/chart-of-accounts');
    const sales = await count('/sales/invoices');
    const purchases = await count('/purchases/invoices');
    const customers = await count('/parties/customers');
    const suppliers = await count('/parties/suppliers');
    const items = await count('/inventory/items');
    const stock = await count('/inventory/stock');
    const periods = await count('/accounting/fiscal-periods');
    const journal = await count('/accounting/journal-entries');

    check(
      'the restored company holds the demo company’s books',
      accounts >= 30 && sales >= 40 && purchases >= 18 && journal >= 50,
      `${accounts} accounts, ${journal} journal entries, ${sales} sales, ${purchases} purchases`,
    );
    check(
      'the restored company holds its parties, catalogue, stock and calendar',
      customers >= 14 && suppliers >= 9 && items >= 30 && stock > 0 && periods > 0,
      `${customers} customers, ${suppliers} suppliers, ${items} items, ${stock} stock rows, ${periods} periods`,
    );

    const after = await fetch(
      `${restoreBase}/reports/trial-balance?from=2000-01-01&to=2099-12-31`,
      { headers },
    ).then((response) => response.json());
    check(
      'the restored books balance, and match what was backed up',
      Number(after?.totals?.difference) === 0 &&
        Number(after?.totals?.debit) === Number(before?.totals?.debit) &&
        after?.rows?.length === before?.rows?.length,
      `debits ${after?.totals?.debit} (backed up ${before?.totals?.debit}), difference ${after?.totals?.difference}`,
    );

    // ── 6b. test restoring the company JSON backup via /backup/restore ───
    const { existsSync, readFileSync } = await import('node:fs');
    const committedDemoJsonPath = join(
      backendDir,
      '..',
      'demo-data',
      'kayan-company-backup-demo.json',
    );
    const jsonToRestore = existsSync(committedDemoJsonPath)
      ? readFileSync(committedDemoJsonPath)
      : jsonBytes;
    const jsonForm = new FormData();
    jsonForm.append('replace', 'true');
    jsonForm.append(
      'file',
      new Blob([jsonToRestore], { type: 'application/json' }),
      'kayan-company-backup-demo.json',
    );
    const jsonRestoreRes = await fetch(`${restoreBase}/backup/restore?replace=true`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${signedIn}` },
      body: jsonForm,
    });
    const jsonRestoreBody = await jsonRestoreRes.json().catch(() => null);
    check(
      'the company JSON backup restores cleanly through the company restore route',
      (jsonRestoreRes.status === 200 || jsonRestoreRes.status === 201) &&
        jsonRestoreBody?.companyId != null,
      `HTTP ${jsonRestoreRes.status}, total written=${jsonRestoreBody?.total ?? 0}` +
        // The server's own account of the failure, so a red run says why
        // instead of only that it was red. The log carries no secrets.
        (jsonRestoreRes.status >= 400
          ? `\n  server said: ${serverLogTail(restore.log())}`
          : ''),
    );

    const demoLoginAfterJson = await loginAs(restoreBase);
    check(
      'demo login succeeds after importing demo-data/kayan-company-backup-demo.json',
      Boolean(demoLoginAfterJson),
    );

    const afterJson = await fetch(
      `${restoreBase}/reports/trial-balance?from=2000-01-01&to=2099-12-31`,
      { headers: { Authorization: `Bearer ${demoLoginAfterJson || signedIn}` } },
    ).then((response) => response.json());
    check(
      'the books balance after restoring from company JSON backup',
      Number(afterJson?.totals?.difference) === 0 &&
        Number(afterJson?.totals?.debit) > 0,
      `debits ${afterJson?.totals?.debit}, difference ${afterJson?.totals?.difference}`,
    );
  } finally {
    restore.child.kill('SIGTERM');
  }

  // ── 7. the file is self-contained: it carries its own structure ────────
  // A database with nothing in it at all — not one migration — is created and
  // the file is put straight into it. If the archive were only rows, this is
  // where it would fall over.
  await recreateDatabase(BARE_URL);
  await run(
    PG_RESTORE,
    ['--no-owner', '--no-privileges', '-d', psqlUrl(BARE_URL), join(backupDir, name)],
    { env: process.env },
  );
  const bare = await sql(
    BARE_URL,
    "SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') AS tables, " +
      '(SELECT count(*) FROM journal_entries) AS entries, ' +
      '(SELECT count(*) FROM accounts) AS accounts',
  );
  check(
    'the file carries its own structure: a bare database comes up complete',
    Number(bare.tables) >= 20 &&
      Number(bare.entries) > 0 &&
      Number(bare.accounts) >= 30,
    `${bare.tables} tables, ${bare.entries} entries, ${bare.accounts} accounts in a database that was empty`,
  );

  // ── 8. the file is named and left where it can be collected ────────────
  const stamp = new Date().toISOString().slice(0, 10);
  const finalName = `kayan-demo-backup-${stamp}.dump`;
  const finalPath = join(OUT_DIR, finalName);
  renameSync(join(backupDir, name), finalPath);
  const size = statSync(finalPath).size;
  check('the demo backup file is written out', size > 0, `${finalName}, ${size} bytes`);
  console.log(`\nDemo backup file: ${finalPath}`);

  // Write out the company JSON backup file
  const jsonFinalName = `kayan-company-backup-${stamp}.json`;
  const jsonFinalPath = join(OUT_DIR, jsonFinalName);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(jsonFinalPath, jsonBytes);
  const jsonSize = statSync(jsonFinalPath).size;
  check(
    'the company JSON backup file is written out and verified',
    jsonSize > 0 && !jsonBytes.subarray(0, 5).toString('latin1').startsWith('PGDMP'),
    `${jsonFinalName}, ${jsonSize} bytes (strictly JSON)`,
  );
  console.log(`\nDemo company JSON backup file: ${jsonFinalPath}`);

  const failed = results.filter((result) => !result.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed` +
      (failed.length
        ? `\nFAILED: ${failed.map((entry) => entry.name).join('\n       ')}`
        : ''),
  );
  return failed.length === 0;
}

/// Signs in as the demo company's administrator.
async function loginAs(base, username = 'admin', password = 'Admin@12345') {
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json().catch(() => ({}));
  return body?.accessToken ?? '';
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((error) => {
    console.error('The demo backup could not be built:', error);
    process.exit(2);
  });
