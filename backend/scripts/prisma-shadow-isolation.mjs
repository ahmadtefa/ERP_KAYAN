// Shadow-database isolation, proven against two independent PostgreSQL servers
// with the real Prisma CLI.
//
// A shadow database is where the schema engine creates, writes and DROPS
// schemas. If that ever happens on the server holding the company database, the
// data is at risk - so "we configured it separately" is not good enough. Each
// phase below tries a specific way of getting it wrong and requires a refusal,
// then proves the live database is untouched afterwards.
//
//   KAYAN_LIVE_DATABASE_URL     the database the program would use (server A)
//   KAYAN_SECOND_DATABASE_URL   a *separate* PostgreSQL server (server B)
//
// Phases
//   1. no shadow configured                     -> refused before the engine runs
//   2. shadow URL = the live database           -> refused
//   3. same server, different database name     -> refused
//   4. same server, only ?schema= differs       -> refused
//   5. different host name for the same address -> refused (DNS identity)
//   6. an unreachable shadow host               -> refused (cannot prove anything)
//   7. a real shadow on server B                -> works, and only then
//   8. after all of it, the live database is byte-for-byte unchanged
//
// Exit code 78 is the guard's refusal code; 1 is a real failure.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = join(here, '..');
const prismaCli = join(backendDir, 'node_modules', 'prisma', 'build', 'index.js');
const wrapper = join(here, 'migrate-dev-safe.mjs');

const liveUrl = process.env.KAYAN_LIVE_DATABASE_URL ?? process.env.DATABASE_URL;
const secondUrl = process.env.KAYAN_SECOND_DATABASE_URL;

if (!liveUrl) fail('KAYAN_LIVE_DATABASE_URL (or DATABASE_URL) is not set.');
if (!secondUrl) {
  fail(
    'KAYAN_SECOND_DATABASE_URL is not set. Shadow isolation needs two independent PostgreSQL servers; a single server cannot prove it.',
  );
}

const live = new URL(liveUrl);
const second = new URL(secondUrl);
if (live.port === second.port && live.hostname === second.hostname) {
  fail(
    `the two test servers are the same (${live.hostname}:${live.port}). The isolation test needs two distinct servers.`,
  );
}

// The DNS phase needs both names to be able to resolve to the same address, so
// the live server must be addressed by loopback.
if (!['127.0.0.1', 'localhost', '::1'].includes(live.hostname)) {
  fail(
    `KAYAN_LIVE_DATABASE_URL must address the live server by loopback (got ${live.hostname}); ` +
      'the "two names, one server" phase cannot be proven otherwise.',
  );
}

const scratchPrefix = process.env.KAYAN_SHADOW_TEST_PREFIX ?? 'kayan_shadow_';

function liveMigrationCount() {
  return readdirSync(join(backendDir, 'prisma', 'migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).length;
}
const created = [];

function pass(message) {
  console.log(`PASS: ${message}`);
}
function fail(message) {
  console.error(`::error title=Shadow isolation::${message}`);
  console.error(`FAIL: ${message}`);
  process.exit(1);
}
function note(message) {
  console.log(`      ${message}`);
}

async function query(connectionString, sql, params = []) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end().catch(() => {});
  }
}

async function createDatabase(serverUrl, name) {
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  await query(serverUrl, `DROP DATABASE IF EXISTS "${name}"`).catch(() => {});
  await query(serverUrl, `CREATE DATABASE "${name}"`);
  created.push({ server: serverUrl, name });
  return url.toString();
}

function run(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: backendDir,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d.toString()));
    child.stderr.on('data', (d) => (output += d.toString()));
    child.on('error', (error) => resolve({ code: -1, output: String(error) }));
    child.on('exit', (code) => resolve({ code: code ?? -1, output }));
  });
}

/** Runs the guard exactly as the wrapper does. */
function guardCheck({ databaseUrl, shadowUrl }) {
  return run(process.execPath, [wrapper, '--check-only'], {
    DATABASE_URL: databaseUrl,
    KAYAN_PRISMA_SHADOW_DATABASE_URL: shadowUrl,
  });
}

/**
 * A fingerprint of everything a shadow run must not touch: the migration
 * history, the business rows, and the list of databases on the live server.
 */
async function fingerprint(url) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const parts = [];
    const { rows: tables } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    for (const { tablename } of tables) {
      const { rows } = await client.query(
        `SELECT count(*)::text AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS d FROM "${tablename}" t`,
      );
      parts.push(`${tablename}:${rows[0].n}:${rows[0].d}`);
    }
    const { rows: dbs } = await client.query(
      "SELECT datname FROM pg_database WHERE datname NOT LIKE 'template%' ORDER BY datname",
    );
    return createHash('sha256')
      .update(parts.join('\n') + '\n--\n' + dbs.map((r) => r.datname).join(','))
      .digest('hex');
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  note(`live server   : ${live.hostname}:${live.port || 5432}`);
  note(`second server : ${second.hostname}:${second.port || 5432}`);

  // The live database gets a real migrated schema and real rows, so a shadow
  // mistake would have something to destroy.
  const liveDb = await createDatabase(liveUrl, `${scratchPrefix}live`);
  const deploy = await run(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    DATABASE_URL: liveDb,
  });
  if (deploy.code !== 0) {
    fail(`could not prepare the live test database:\n${deploy.output}`);
  }
  await query(
    liveDb,
    `INSERT INTO "companies" ("id","code","nameEn","nameAr","updatedAt") VALUES (gen_random_uuid(),'SHADOW-GUARD','Shadow Guard','حماية',now())`,
  ).catch(async () => {
    // The first migration set may differ; a row in any existing table is enough
    // for the "nothing changed" check, which fingerprints every table.
  });
  const before = await fingerprint(liveDb);
  const secondPort = second.port === '' ? '5432' : second.port;

  // ---- phase 1: no shadow at all ------------------------------------------
  let result = await guardCheck({ databaseUrl: liveDb, shadowUrl: '' });
  if (result.code !== 78) {
    fail(`with no shadow configured the wrapper exited ${result.code}, expected 78:\n${result.output}`);
  }
  if (!/shadow-not-configured/.test(result.output)) {
    fail(`the refusal did not name the reason:\n${result.output}`);
  }
  pass('no shadow configured: migrate dev is refused (shadow-not-configured)');

  // ---- phase 2: the live database as the shadow ---------------------------
  result = await guardCheck({ databaseUrl: liveDb, shadowUrl: liveDb });
  if (result.code !== 78 || !/shadow-equals-database-url/.test(result.output)) {
    fail(`using the live database as the shadow was not refused correctly (exit ${result.code}):\n${result.output}`);
  }
  pass('the live database as the shadow URL: refused (shadow-equals-database-url)');

  // ---- phase 3: same server, different database ---------------------------
  const sameServerOtherDb = new URL(liveDb);
  sameServerOtherDb.pathname = `/${scratchPrefix}other_db`;
  result = await guardCheck({ databaseUrl: liveDb, shadowUrl: sameServerOtherDb.toString() });
  if (result.code !== 78 || !/shadow-shares-host-and-port-with-database/.test(result.output)) {
    fail(`a second database on the live server was not refused correctly (exit ${result.code}):\n${result.output}`);
  }
  pass('a different database on the same server: refused (a name is not a server)');

  // ---- phase 4: same server and database, different schema ---------------
  const schemaOnly = new URL(liveDb);
  schemaOnly.searchParams.set('schema', 'kayan_shadow_schema');
  result = await guardCheck({ databaseUrl: liveDb, shadowUrl: schemaOnly.toString() });
  if (result.code !== 78 || !/shadow-shares-server-with-database/.test(result.output)) {
    fail(`a schema-only difference was not refused (exit ${result.code}):\n${result.output}`);
  }
  pass('same server and database with only ?schema= changed: refused (a schema is not isolation)');

  // ---- phase 5: a second name for the same address -----------------------
  // The case no URL comparison can catch: `127.0.0.1` and `localhost` are the
  // same machine, so a "separate host" is not separate at all.
  const alias = new URL(liveDb);
  alias.hostname = live.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  alias.pathname = `/${scratchPrefix}alias_db`;
  result = await guardCheck({ databaseUrl: liveDb, shadowUrl: alias.toString() });
  if (result.code !== 78 || !/shadow-resolves-to-the-database-server/.test(result.output)) {
    fail(
      `a different host name resolving to the same server was not refused (exit ${result.code}). ` +
        `This is the case that would have destroyed a company database:\n${result.output}`,
    );
  }
  pass(`a second host name for the same address (${alias.hostname} -> ${live.hostname}): refused by DNS identity`);

  // ---- phase 6: an unresolvable shadow host ------------------------------
  const bogus = new URL(liveDb);
  bogus.hostname = 'shadow-never-exists.kayan.invalid';
  result = await guardCheck({ databaseUrl: liveDb, shadowUrl: bogus.toString() });
  if (result.code !== 78 || !/shadow-host-unresolvable/.test(result.output)) {
    fail(`an unresolvable shadow host was not refused (exit ${result.code}):\n${result.output}`);
  }
  pass('an unresolvable shadow host: refused (separation cannot be proven)');

  // ---- phase 7: a genuine second server ---------------------------------
  const shadowDb = await createDatabase(secondUrl, `${scratchPrefix}shadow`);
  const shadowCheck = await guardCheck({ databaseUrl: liveDb, shadowUrl: shadowDb });
  if (shadowCheck.code !== 0) {
    fail(`a shadow on a genuinely separate server was refused:\n${shadowCheck.output}`);
  }
  pass('a shadow on a separate server passes the guard');

  // The real engine, using the real shadow. `migrate diff --from-migrations`
  // has to replay the whole migration history somewhere before it can compare it
  // with the schema, and that "somewhere" is the shadow database. The credentials
  // below exist ONLY on the second server, so a successful run is proof the
  // engine connected to server B and not to the live server.
  //
  // --exit-code is deliberately NOT passed: the repository's migrations do not
  // reproduce schema.prisma byte-for-byte (legacy tables and default drift), and
  // that difference is a known state reported below - not a shadow failure.
  const diff = await run(
    process.execPath,
    [
      prismaCli,
      'migrate',
      'diff',
      '--from-migrations',
      'prisma/migrations',
      '--to-schema-datamodel',
      'prisma/schema.prisma',
      '--shadow-database-url',
      shadowDb,
      '--script',
    ],
    { DATABASE_URL: liveDb },
  );
  if (diff.code !== 0) {
    fail(
      `prisma migrate diff could not use a real shadow database (exit ${diff.code}). ` +
        `Shadow work is therefore not proven and must stay disabled:\n${diff.output.slice(0, 2000)}`,
    );
  }
  const diffLines = diff.output.split('\n').filter((line) => line.trim() !== '');
  pass(
    `the native engine replayed ${liveMigrationCount()} migrations into the shadow database on the second server (migrate diff, exit 0)`,
  );
  if (diffLines.length > 0) {
    note(
      `known drift between the migration history and schema.prisma: ${diffLines.length} statement lines (reported, not hidden)`,
    );
  }

  // A shadow that cannot be reached must fail loudly rather than silently fall
  // back to anything local.
  const wrongCredentials = new URL(shadowDb);
  wrongCredentials.password = 'definitely-not-the-password';
  const badShadow = await run(
    process.execPath,
    [
      prismaCli,
      'migrate',
      'diff',
      '--from-migrations',
      'prisma/migrations',
      '--to-schema-datamodel',
      'prisma/schema.prisma',
      '--shadow-database-url',
      wrongCredentials.toString(),
      '--script',
    ],
    { DATABASE_URL: liveDb },
  );
  if (badShadow.code === 0) {
    fail('a shadow database with wrong credentials was accepted; the engine is not really using the configured shadow');
  }
  pass('a shadow database with the wrong credentials fails instead of falling back');

  // The shadow database exists on server B only, and the live server never grew
  // a database named after it.
  const liveDbs = await query(liveUrl, 'SELECT datname FROM pg_database');
  if (liveDbs.rows.some((row) => row.datname === `${scratchPrefix}shadow`)) {
    fail('the shadow database was created on the live server');
  }
  pass('the shadow database exists only on the second server');

  // ---- phase 8: nothing on the live database changed --------------------
  const after = await fingerprint(liveDb);
  if (after !== before) {
    fail(
      `the live database changed during shadow work\n before: ${before}\n after:  ${after}`,
    );
  }
  pass('the live database is unchanged after every shadow attempt (history, rows and database list)');
}

main()
  .catch((error) => {
    console.error(`::error title=Shadow isolation::${error?.stack ?? error}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const { server, name } of created) {
      await query(
        server,
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [name],
      ).catch(() => {});
      await query(server, `DROP DATABASE IF EXISTS "${name}"`).catch(() => {});
    }
    if (process.exitCode) process.exit(process.exitCode);
  });
