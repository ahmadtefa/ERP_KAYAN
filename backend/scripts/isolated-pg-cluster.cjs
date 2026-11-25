'use strict';
// Fresh, disposable, Unix-socket-only PostgreSQL cluster for the native bridge
// parents. Synthetic data only. It never connects to anything it did not create:
// every step is checked against the sentinel and the temp root it made itself.
//
//   node scripts/isolated-pg-cluster.cjs run -- node scripts/isolated-pg-purchase-concurrency.cjs
//
// The child receives KAYAN_ISOLATED_PG_ROOT and KAYAN_ISOLATED_PG_PORT, the same
// contract the native scripts already enforce. Teardown always runs.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {execFileSync, spawn, spawnSync} = require('node:child_process');

const SENTINEL_NAME = 'KAYAN-ISOLATED-TEST-ONLY';
const SENTINEL_TEXT = 'KAYAN ISOLATED TEST CLUSTER - NO CUSTOMER DATA';
const USER = 'kayan_test';
const MAX_SOCKET_PATH = 100; // sun_path limit is 107 on Linux

function findPgBin(env = process.env, fsApi = fs) {
  const has = (dir) => ['initdb', 'pg_ctl', 'postgres'].every((n) => { try { fsApi.accessSync(path.join(dir, n), fsApi.constants.X_OK); return true; } catch { return false; } });
  const candidates = [];
  if (env.KAYAN_PG_BIN) candidates.push(env.KAYAN_PG_BIN);
  try { candidates.push(execFileSync('pg_config', ['--bindir'], {encoding: 'utf8'}).trim()); } catch { /* not installed */ }
  try {
    const root = '/usr/lib/postgresql';
    for (const v of fsApi.readdirSync(root).sort((a, b) => Number(b) - Number(a))) candidates.push(path.join(root, v, 'bin'));
  } catch { /* none */ }
  for (const dir of String(env.PATH || '').split(path.delimiter).filter(Boolean)) candidates.push(dir);
  const found = candidates.find((dir) => dir && has(dir));
  if (!found) throw new Error('No PostgreSQL server binaries (initdb, pg_ctl, postgres) found. Set KAYAN_PG_BIN to a bin directory.');
  return found;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    // The port only names the socket file (listen_addresses is empty), so no TCP port is ever opened by PostgreSQL.
    server.listen(0, '127.0.0.1', () => { const {port} = server.address(); server.close(() => resolve(port)); });
  });
}

/// True only for a directory this module created: under the OS temp dir, named
/// kayan-pg-*, holding the sentinel. Teardown refuses anything else.
function isOwnedRoot(root, fsApi = fs) {
  try {
    const real = fsApi.realpathSync(root);
    const tmp = fsApi.realpathSync(os.tmpdir());
    if (!path.isAbsolute(real) || path.dirname(real) !== tmp || !path.basename(real).startsWith('kayan-pg-')) return false;
    return fsApi.readFileSync(path.join(real, 'data', SENTINEL_NAME), 'utf8').trim() === SENTINEL_TEXT;
  } catch { return false; }
}

async function startCluster(env = process.env) {
  const bin = findPgBin(env);
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kayan-pg-')));
  const data = path.join(root, 'data');
  const socket = path.join(root, 'socket');
  const cluster = {root, data, socket, bin, port: await freePort(), started: false, created: true};
  try {
    if (path.join(socket, `.s.PGSQL.${cluster.port}`).length > MAX_SOCKET_PATH) throw new Error('Temp path is too long for a Unix socket. Set TMPDIR to a shorter directory.');
    fs.mkdirSync(socket, {mode: 0o700});
    execFileSync(path.join(bin, 'initdb'), ['-D', data, '-U', USER, '--auth=trust', '--encoding=UTF8', '--no-sync'], {stdio: 'pipe'});
    fs.writeFileSync(path.join(data, SENTINEL_NAME), SENTINEL_TEXT + '\n');
    execFileSync(path.join(bin, 'pg_ctl'), ['-D', data, '-w', '-t', '60', '-l', path.join(root, 'server.log'),
      '-o', `-c listen_addresses='' -c unix_socket_directories='${socket}' -c port=${cluster.port} -c fsync=off`, 'start'], {stdio: 'pipe'});
    cluster.started = true;
    await verifyIdentity(cluster);
    return cluster;
  } catch (error) {
    await stopCluster(cluster);
    throw error;
  }
}

/// Identity before any parent writes: a socket-only server, running on the data
/// directory this module created, carrying the sentinel.
async function verifyIdentity(cluster) {
  const {Client} = require('pg');
  const client = new Client({host: cluster.socket, port: cluster.port, user: USER, database: 'postgres'});
  await client.connect();
  try {
    const row = (await client.query("SELECT current_setting('listen_addresses') AS listen, current_setting('data_directory') AS dir, current_setting('unix_socket_directories') AS sockets")).rows[0];
    if (row.listen !== '') throw new Error('Cluster is listening on a network address; refusing to continue.');
    if (fs.realpathSync(row.dir) !== fs.realpathSync(cluster.data)) throw new Error('Cluster data directory is not the one created for this run.');
    if (!isOwnedRoot(cluster.root)) throw new Error('Cluster root failed the sentinel check.');
  } finally { await client.end(); }
}

/// Idempotent. Stops only a server on a directory it owns, then removes only an owned root.
async function stopCluster(cluster) {
  if (!cluster || !cluster.root) return;
  // Owned = carries the sentinel, or we made it a moment ago (mkdtemp) and failed before writing it.
  const underTmp = (() => { try { const real = fs.realpathSync(cluster.root); return path.dirname(real) === fs.realpathSync(os.tmpdir()) && path.basename(real).startsWith('kayan-pg-'); } catch { return false; } })();
  const owned = isOwnedRoot(cluster.root) || (cluster.created === true && underTmp);
  if (!owned) return; // never touch anything we cannot prove we made
  if (cluster.started || fs.existsSync(path.join(cluster.data, 'postmaster.pid'))) {
    try {
      execFileSync(path.join(cluster.bin, 'pg_ctl'), ['-D', cluster.data, '-m', 'immediate', '-w', '-t', '30', 'stop'], {stdio: 'pipe'});
    } catch {
      // pg_ctl status=3 is documented as not running. Any other result is
      // unresolved, so preserve the directory instead of deleting a live server.
      const status = spawnSync(path.join(cluster.bin, 'pg_ctl'), ['-D', cluster.data, 'status'], {encoding: 'utf8'});
      if (status.status !== 3) throw new Error('Isolated cluster shutdown unverified; preserved owned root: ' + cluster.root);
    }
  }
  fs.rmSync(cluster.root, {recursive: true, force: true});
  cluster.started = false;
}

async function runWithCluster(command, args, env = process.env) {
  let cluster; let child; let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; if (child && !child.killed) child.kill('SIGTERM'); await stopCluster(cluster); };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stop().finally(() => process.exit(130)); });
  try {
    cluster = await startCluster(env);
    const code = await new Promise((resolve, reject) => {
      child = spawn(command, args, {stdio: 'inherit', env: {...env, KAYAN_ISOLATED_PG_ROOT: cluster.root, KAYAN_ISOLATED_PG_PORT: String(cluster.port)}});
      child.once('error', reject);
      child.once('exit', (c, s) => resolve(c ?? (s ? 128 : 1)));
    });
    return code;
  } finally { await stop(); }
}

module.exports = {startCluster, stopCluster, isOwnedRoot, findPgBin, runWithCluster, SENTINEL_NAME, SENTINEL_TEXT};

if (require.main === module) {
  const dash = process.argv.indexOf('--');
  if (process.argv[2] !== 'run' || dash < 0 || dash === process.argv.length - 1) {
    console.error('Usage: node isolated-pg-cluster.cjs run -- <command> [args]');
    process.exit(2);
  }
  runWithCluster(process.argv[dash + 1], process.argv.slice(dash + 2)).then((code) => process.exit(code), (error) => { console.error(error.message); process.exit(1); });
}
