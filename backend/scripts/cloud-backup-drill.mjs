#!/usr/bin/env node
// External backup and restore drill for the Supabase cloud pilot.
//
//   backup: node scripts/cloud-backup-drill.mjs backup --url <SOURCE_URL> --out <dir>
//           Creates a custom-format dump (pg_dump -Fc) of the source database.
//           For *.supabase.* hosts the connection MUST verify TLS with the
//           Supabase CA (SUPABASE_DB_CA_CERT or _FILE); ssl-mode query
//           parameters are stripped and verify-full is forced. With
//           KAYAN_BACKUP_PASSPHRASE set the dump is AES-256 encrypted and the
//           plaintext removed; without it the dump is kept with mode 0600.
//
//   drill:  node scripts/cloud-backup-drill.mjs drill --dump <file> --admin-url <LOCAL_URL>
//           Restores the dump into a fresh scratch database on an ISOLATED
//           local PostgreSQL (admin URL must be loopback - it refuses remote
//           hosts so a drill can never touch Supabase), verifies the restored
//           schema/RLS/policies/migration history, then drops the scratch DB.
//
// No password, connection string, or secret is ever printed. The drill makes
// no changes to the backup source.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const SUPABASE_HOST_RE = /(^|\.)(supabase\.(co|com)|pooler\.supabase\.com)$/i;

export function stripSslParams(url) {
  const u = new URL(url);
  for (const key of [...u.searchParams.keys()]) {
    if (/^ssl/i.test(key)) u.searchParams.delete(key);
  }
  return u.toString();
}

export function assertLoopbackAdminUrl(url) {
  const u = new URL(url);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('drill admin URL must target an isolated local PostgreSQL (loopback host only); refusing remote host');
  }
  return u;
}

export function tlsEnvForUrl(url, env = process.env) {
  const u = new URL(url);
  if (!SUPABASE_HOST_RE.test(u.hostname)) return {};
  let ca = (env.SUPABASE_DB_CA_CERT || '').trim();
  if (!ca && env.SUPABASE_DB_CA_CERT_FILE) {
    ca = readFileSync(env.SUPABASE_DB_CA_CERT_FILE, 'utf8').trim();
  }
  if (!ca.includes('BEGIN CERTIFICATE')) {
    throw new Error('verified TLS requires the Supabase CA: set SUPABASE_DB_CA_CERT or SUPABASE_DB_CA_CERT_FILE (see certs/README.md)');
  }
  const caFile = join(tmpdir(), 'kayan-backup-ca-' + randomUUID() + '.pem');
  writeFileSync(caFile, ca + '\n', { mode: 0o600 });
  return { PGSSLMODE: 'verify-full', PGSSLROOTCERT: caFile, __CA_FILE: caFile };
}

function urlPasswordEnv(url) {
  const u = new URL(url);
  return u.password ? { PGPASSWORD: decodeURIComponent(u.password) } : {};
}

function run(cmd, args, { env, input, label }) {
  const res = spawnSync(cmd, args, {
    env: { ...process.env, ...env },
    input,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.error) throw new Error(label + ' failed to start: ' + res.error.message);
  return res;
}

function fail(label, res) {
  const tail = (res.stderr || '')
    .split('\n')
    .filter((l) => l && !/password/i.test(l) && !/:\/\/[^ ]*@/.test(l))
    .slice(-6)
    .join(' | ');
  throw new Error(label + ' failed (exit ' + res.status + ')' + (tail ? ': ' + tail : ''));
}

function secureFile(path) {
  chmodSync(path, 0o600);
  return path;
}

export function backup({ url, out, passphrase }, env = process.env) {
  if (!url || !out) throw new Error('backup requires --url and --out');
  const clean = stripSslParams(url);
  const tlsEnv = tlsEnvForUrl(clean, env);
  mkdirSync(resolve(out), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dumpPath = join(resolve(out), 'kayan-backup-' + stamp + '.dump');
  const res = run('pg_dump', ['-Fc', '--schema=public', '--no-owner', '--no-privileges', '-d', clean, '-f', dumpPath], {
    env: { ...urlPasswordEnv(clean), ...tlsEnv },
    label: 'pg_dump',
  });
  if (res.status !== 0) fail('pg_dump', res);
  secureFile(dumpPath);
  let artifact = dumpPath;
  if (passphrase) {
    const encPath = dumpPath + '.enc';
    const enc = run('openssl', ['enc', '-aes-256-cbc', '-pbkdf2', '-md', 'sha256', '-salt', '-in', dumpPath, '-out', encPath, '-pass', 'env:KAYAN_BACKUP_PASSPHRASE'], {
      env: { KAYAN_BACKUP_PASSPHRASE: passphrase },
      label: 'openssl enc',
    });
    if (enc.status !== 0) fail('openssl enc', enc);
    secureFile(encPath);
    rmSync(dumpPath);
    artifact = encPath;
  }
  if (tlsEnv.__CA_FILE) rmSync(tlsEnv.__CA_FILE);
  const bytes = statSync(artifact).size;
  const sha = createHash('sha256').update(readFileSync(artifact)).digest('hex');
  console.log('backup_ok path=' + artifact + ' bytes=' + bytes + ' sha256=' + sha + ' encrypted=' + Boolean(passphrase));
  return artifact;
}

function psqlScalar(adminUrlStr, query, env) {
  const res = run('psql', [adminUrlStr, '-At', '-c', query], { env, label: 'psql' });
  if (res.status !== 0) fail('psql', res);
  return (res.stdout || '').trim();
}

export function drill({ dump, adminUrl, passphrase }, env = process.env) {
  if (!dump || !adminUrl) throw new Error('drill requires --dump and --admin-url');
  if (!existsSync(dump)) throw new Error('dump not found: ' + dump);
  const adminU = assertLoopbackAdminUrl(adminUrl);
  const adminEnv = urlPasswordEnv(adminU.toString());
  const scratch = 'kayan_restore_drill_' + Date.now().toString(36);
  const targetU = new URL(adminU.toString());
  targetU.pathname = '/' + scratch;
  const target = targetU.toString();

  let restoreFile = dump;
  let decrypted = false;
  if (dump.endsWith('.enc')) {
    if (!passphrase) throw new Error('encrypted dump requires KAYAN_BACKUP_PASSPHRASE');
    restoreFile = dump + '.tmp.dump';
    const dec = run('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-md', 'sha256', '-in', dump, '-out', restoreFile, '-pass', 'env:KAYAN_BACKUP_PASSPHRASE'], {
      env: { KAYAN_BACKUP_PASSPHRASE: passphrase },
      label: 'openssl dec',
    });
    if (dec.status !== 0) fail('openssl dec', dec);
    secureFile(restoreFile);
    decrypted = true;
  }

  psqlScalar(target.replace(/\/[^/?]+(\?|$)/, '/postgres$1'), 'CREATE DATABASE ' + scratch, adminEnv);
  try {
    // A custom-format dump taken with --schema=public carries CREATE SCHEMA
    // public; drop the fresh database's default schema so restore is clean.
    psqlScalar(target, 'DROP SCHEMA IF EXISTS public CASCADE', adminEnv);
    const restore = run('pg_restore', ['-d', target, '--no-owner', '--no-privileges', restoreFile], {
      env: adminEnv,
      label: 'pg_restore',
    });
    if (restore.status !== 0) fail('pg_restore', restore);
    const tables = psqlScalar(target, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'", adminEnv);
    const rls = psqlScalar(target, "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity", adminEnv);
    const policies = psqlScalar(target, "SELECT count(*) FROM pg_policies WHERE schemaname='public'", adminEnv);
    const hasMigrations = psqlScalar(target, "SELECT to_regclass('_prisma_migrations') IS NOT NULL", adminEnv) === 't';
    const migrations = hasMigrations ? (psqlScalar(target, 'SELECT count(*) FROM _prisma_migrations', adminEnv) || '0') : '0';
    console.log('restore_verify scratch=' + scratch + ' tables=' + tables + ' rls_enabled=' + rls + ' policies=' + policies + ' migrations=' + migrations);
    console.log('drill_restored=1 verified=1');
  } finally {
    psqlScalar(adminU.toString(), 'DROP DATABASE IF EXISTS ' + scratch, adminEnv);
    if (decrypted) rmSync(restoreFile);
    console.log('drill_ok scratch_dropped=1');
  }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      out[key] = argv[i + 1];
      i += 1;
    } else out._.push(argv[i]);
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('cloud-backup-drill.mjs')) {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  try {
    if (cmd === 'backup') {
      backup({ url: args.url, out: args.out, passphrase: process.env.KAYAN_BACKUP_PASSPHRASE });
    } else if (cmd === 'drill') {
      drill({ dump: args.dump, adminUrl: args['admin-url'], passphrase: process.env.KAYAN_BACKUP_PASSPHRASE });
    } else {
      console.error('usage: backup --url <SOURCE_URL> --out <dir> | drill --dump <file> --admin-url <LOCAL_URL>');
      process.exit(2);
    }
  } catch (err) {
    console.error('cloud-backup-drill: ' + err.message);
    process.exit(1);
  }
}
