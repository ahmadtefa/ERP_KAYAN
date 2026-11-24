#!/usr/bin/env node
/**
 * Provisions the dedicated restore-admin PostgreSQL account that lets the
 * program rehearse a full restore in a scratch database.
 *
 *   * The account may ONLY create databases (LOGIN CREATEDB, no superuser, no
 *     role creation, no replication, no row-level bypass). The program's own
 *     runtime account is NOT widened.
 *   * Its random password is written to a credential file (mode 0600) outside
 *     the repository; it is never printed or logged.
 *   * The superuser URL used for this one-time step is read from the
 *     environment (KAYAN_PG_SUPERUSER_URL) or typed at a hidden prompt. It is
 *     never stored, never passed as a command-line argument, never written.
 *
 * Usage (PowerShell or bash, from the backend folder):
 *   set KAYAN_PG_SUPERUSER_URL=postgresql://postgres:<password>@127.0.0.1:5432/postgres
 *   npm run setup:restore-admin
 *
 * Optional: KAYAN_RESTORE_ADMIN_FILE=<absolute path> chooses where the
 * credential file is written (default: <home>/.kayan/restore-admin.url).
 * Re-running is safe: the role is repaired and its password rotated.
 *
 * Afterwards add this single line to backend/.env (the script prints it) and
 * restart the API:  KAYAN_RESTORE_ADMIN_FILE=<that path>
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

import pg from 'pg';

const ROLE = 'kayan_restore_admin';

export function buildRestoreAdminUrl(runtimeUrl, password) {
  const url = new URL(runtimeUrl);
  url.username = ROLE;
  url.password = password;
  url.pathname = '/postgres';
  url.search = '';
  return url.toString();
}

export function defaultCredentialFile() {
  return join(homedir(), '.kayan', 'restore-admin.url');
}

function askHidden(question) {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); done(answer.trim()); });
  });
}

async function main() {
  const runtimeUrl = (process.env.DATABASE_URL ?? '').trim();
  if (!runtimeUrl) throw new Error('DATABASE_URL is not set (the program\'s normal database URL, read from backend/.env or the environment).');
  let adminUrl = (process.env.KAYAN_PG_SUPERUSER_URL ?? '').trim();
  if (!adminUrl) {
    if (!process.stdin.isTTY) throw new Error('Set KAYAN_PG_SUPERUSER_URL, or run this in an interactive terminal.');
    const host = new URL(runtimeUrl);
    const pw = await askHidden(`PostgreSQL administrator (postgres) password for ${host.hostname}:${host.port || 5432}: `);
    const u = new URL(runtimeUrl);
    u.username = 'postgres'; u.password = pw; u.pathname = '/postgres'; u.search = '';
    adminUrl = u.toString();
  }
  const target = (process.env.KAYAN_RESTORE_ADMIN_FILE ?? '').trim() || defaultCredentialFile();
  if (!isAbsolute(target)) throw new Error('KAYAN_RESTORE_ADMIN_FILE must be an absolute path.');
  const password = randomBytes(24).toString('base64url');

  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const me = await client.query('SELECT rolsuper OR rolcreaterole AS ok FROM pg_roles WHERE rolname = current_user');
    if (me.rows[0]?.ok !== true) throw new Error('The account used for this one-time step must be able to create roles (the PostgreSQL administrator).');
    const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROLE]);
    const literal = (await client.query('SELECT quote_literal($1) AS v', [password])).rows[0].v;
    const attrs = 'LOGIN CREATEDB NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS';
    await client.query(`${exists.rowCount ? 'ALTER' : 'CREATE'} ROLE ${ROLE} WITH ${attrs} PASSWORD ${literal}`);
  } finally {
    await client.end().catch(() => {});
  }

  const restoreUrl = buildRestoreAdminUrl(runtimeUrl, password);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, restoreUrl + '\n', { mode: 0o600 });
  try { chmodSync(target, 0o600); } catch { /* Windows ignores POSIX modes */ }

  // Prove it works without printing anything secret.
  const probe = new pg.Client({ connectionString: restoreUrl });
  await probe.connect();
  const r = await probe.query('SELECT rolsuper, rolcreatedb FROM pg_roles WHERE rolname = current_user');
  await probe.end();
  if (r.rows[0].rolsuper || !r.rows[0].rolcreatedb) throw new Error('The account was created with unexpected privileges.');

  console.log(`Restore account "${ROLE}" is ready (create-database only).`);
  console.log(`Credential file: ${resolve(target)}`);
  console.log('Add this line to backend/.env, then restart the API:');
  console.log(`KAYAN_RESTORE_ADMIN_FILE=${resolve(target)}`);
}

const direct = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (direct) main().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
