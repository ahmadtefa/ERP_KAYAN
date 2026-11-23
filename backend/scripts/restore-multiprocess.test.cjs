'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fork, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const execute = promisify(execFile);
const server = process.env.KAYAN_TEST_PG_URL;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await pause(25);
  }
  throw new Error(`Timeout waiting for ${label}`);
}
async function query(url, text, values = []) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try { return await client.query(text, values); } finally { await client.end(); }
}
function startApi(env) {
  const child = fork(join(__dirname, 'fixtures/restore-api.cjs'), [], { env, silent: true });
  let output = '';
  child.stderr.on('data', (chunk) => { output += chunk; });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`API readiness timeout: ${output}`)), 15000);
    child.on('message', (message) => {
      if (message.type === 'ready') { clearTimeout(timer); resolve(`http://127.0.0.1:${message.port}`); }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`API exited: ${output}`)); });
  });
  return { child, ready };
}
function post(base, path, body) {
  return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

test('two independent APIs drain writes, reject maintenance requests, recover after killed DUMP owner', { skip: !server, timeout: 120000 }, async () => {
  const database = `kayan_work_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(server); url.pathname = `/${database}`;
  const db = url.toString();
  const dir = await mkdtemp(join(tmpdir(), 'kayan-work-pg-'));
  const otherDir = await mkdtemp(join(tmpdir(), 'kayan-work-wrong-folder-'));
  const env = { ...process.env, DATABASE_URL: db, KAYAN_BACKUP_DIR: dir, NODE_ENV: 'test' };
  const children = [];
  try {
    await query(server, `CREATE DATABASE "${database}"`);
    await query(db, `CREATE TABLE fixture (id int PRIMARY KEY, value text NOT NULL);
      INSERT INTO fixture VALUES (1, 'A'); CREATE TABLE refresh_tokens (id int);
      CREATE FUNCTION restore_delay() RETURNS text LANGUAGE plpgsql AS $$
      BEGIN IF current_setting('application_name') LIKE 'kayan-restore-%' THEN PERFORM pg_sleep(30); END IF; RETURN 'done'; END $$;
      CREATE MATERIALIZED VIEW delay_restore AS SELECT restore_delay() AS value;`);
    const archive = join(dir, 'source.dump');
    await execute(process.env.KAYAN_PG_DUMP || 'pg_dump', ['-Fc', '--file', archive, `--dbname=${db}`]);
    const a = startApi(env); const b = startApi(env); children.push(a.child, b.child);
    const c = startApi({ ...env, KAYAN_BACKUP_DIR: otherDir }); children.push(c.child);
    const [apiA, apiB, apiC] = await Promise.all([a.ready, b.ready, c.ready]);
    assert.equal((await fetch(apiC + '/fixture')).status, 200);

    let writing;
    const started = new Promise((resolve) => { writing = (message) => { if (message.type === 'writing') resolve(); }; b.child.on('message', writing); });
    const write = post(apiB, '/fixture', { value: 'B-after-admission', delay: 500 });
    await started; b.child.off('message', writing);
    const restore = post(apiA, '/backup/full/restore', { name: 'source.dump' }).catch(() => null);
    assert.equal((await write).status, 201);

    await until(async () => {
      try { return JSON.parse(await readFile(join(dir, 'restore-journal.json'), 'utf8')).phase === 'db-replacing'; }
      catch { return false; }
    }, 'durable destructive DUMP phase');
    await until(async () => (await query(db, "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND application_name LIKE 'kayan-restore-%' AND wait_event = 'PgSleep'")).rowCount > 0, 'live supervised pg_restore');
    const originalTool = (await query(db, "SELECT application_name FROM pg_stat_activity WHERE datname = current_database() AND application_name LIKE 'kayan-restore-%' AND wait_event = 'PgSleep'")).rows[0].application_name;
    assert.equal((await post(apiB, '/fixture', { value: 'forbidden' })).status, 503);
    assert.equal((await fetch(apiB + '/fixture')).status, 503);
    const killed = new Promise((resolve) => a.child.once('exit', resolve));
    a.child.kill('SIGKILL'); await killed; await restore;
    await until(async () => (await query(db, 'SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND application_name = $1', [originalTool])).rowCount === 0, 'orphan restore sessions to stop');
    assert.equal((await post(apiB, '/fixture', { value: 'still-forbidden' })).status, 503);
    assert.equal((await post(apiC, '/fixture', { value: 'wrong-folder-write' })).status, 503);
    assert.equal((await query(db, 'SELECT active FROM kayan_restore_control.state WHERE id = 1')).rows[0].active, true);
    const journal = JSON.parse(await readFile(join(dir, 'restore-journal.json'), 'utf8'));
    assert.equal(journal.kind, 'dump');
    assert.ok(journal.safetyBackup);
    // Safety archives also contain the delay view. Remove its delay from the
    // source DB is irrelevant: recovering an archive invokes the old function.
    // The supervisor should complete normally here; allow its 30s rehearsal.
    // No session table or authenticated recovery endpoint is required: the
    // local worker only replays the safety copy of the authorized restore.
    await until(async () => (await fetch(apiB + '/fixture')).status === 200,
      'automatic safety recovery without a surviving login', 60000);
    assert.deepEqual((await query(db, 'SELECT value FROM fixture WHERE id = 1')).rows, [{ value: 'B-after-admission' }]);
    assert.equal((await fetch(apiB + '/fixture')).status, 200);
    assert.equal((await fetch(apiC + '/fixture')).status, 200);
    assert.equal((await query(db, 'SELECT active FROM kayan_restore_control.state WHERE id = 1')).rows[0].active, false);
    assert.equal((await post(apiB, '/fixture', { value: 'C-after-recovery' })).status, 201);
    assert.deepEqual((await query(db, 'SELECT value FROM fixture')).rows, [{ value: 'C-after-recovery' }]);
    // Losing the barrier connection alone must stop the owning API, rather
    // than leave a delayed business handler running without its shared lock.
    const entered = new Promise((resolve) => b.child.once('message', resolve));
    const delayed = post(apiB, '/fixture', { value: 'must-not-run-without-lease', delay: 10000 }).catch(() => null);
    await entered;
    const exited = new Promise((resolve) => b.child.once('exit', resolve));
    await until(async () => (await query(db, "SELECT pid FROM pg_stat_activity WHERE application_name LIKE 'kayan-api-%-barrier'")).rowCount === 1, 'completed read leases to close');
    const leases = await query(db, "SELECT pid FROM pg_stat_activity WHERE application_name LIKE 'kayan-api-%-barrier'");
    assert.equal(leases.rowCount, 1);
    await query(db, 'SELECT pg_terminate_backend($1)', [leases.rows[0].pid]);
    const exitCode = await exited;
    assert.equal(exitCode, 1);
    assert.equal(await delayed, null);
    assert.deepEqual((await query(db, 'SELECT value FROM fixture')).rows, [{ value: 'C-after-recovery' }]);
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill('SIGKILL'); await exited;
      }
    }
    await query(server, `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await rm(dir, { recursive: true, force: true });
    await rm(otherDir, { recursive: true, force: true });
  }
});
