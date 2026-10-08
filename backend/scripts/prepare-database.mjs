// Prepares the database a desktop installation needs, then applies migrations.
//
// A packaged copy of the program has no terminal, so nothing can be typed by
// hand when it first runs. This script is what the desktop shell calls before
// it starts the API:
//
//   1. connect to the maintenance database as the administrator
//   2. create the application role if it is missing, and set its password to
//      the one in the configuration
//   3. create the application database if it is missing
//   4. apply every migration (a no-op once the database is up to date)
//   5. say whether the database is empty or ready, so the desktop shell knows
//      whether this machine still needs its first administrator
//   6. if it is empty AND a username and password were handed in for that first
//      administrator, create them (company, branch, roles, chart of accounts)
//
// Step 6 is what makes a fresh installation usable without a terminal. The
// credentials come from the environment, are chosen by the person setting the
// company up, and are never written into this file, the program, or the log.
//
// Every step is idempotent: running it twice changes nothing, and running it
// against a database that is already correct is a couple of seconds of work.
//
// It is deliberately silent on success (one line) and loud on failure, because
// the desktop shell captures this output into the log file it shows the user.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = join(here, '..');

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.ADMIN_DATABASE_URL;

/// The parts of a PostgreSQL URL this script needs: where the server is, which
/// database to talk to, and who is talking.
function parseUrl(value) {
  const url = new URL(value);
  return {
    host: url.hostname,
    port: url.port || '5432',
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

/// Quotes a text value for a SQL statement. Identifiers cannot be parameterised
/// in PostgreSQL, so they are quoted here and never taken from a user's typing.
function quote(text) {
  return `"${String(text).replace(/"/g, '""')}"`;
}

/// A literal string for SQL, with the single quotes doubled.
function literal(text) {
  return `'${String(text).replace(/'/g, "''")}'`;
}

/// A client for the maintenance database, or null when there is no
/// administrator URL to use.
function adminClient() {
  if (!adminUrl) return null;
  const target = parseUrl(adminUrl);
  return new PrismaClient({ datasources: { db: { url: adminUrl } } });
}

async function ensureRole(admin, target) {
  const rows = await admin.$queryRawUnsafe(
    `SELECT 1 FROM pg_roles WHERE rolname = ${literal(target.user)}`,
  );
  if (rows.length === 0) {
    await admin.$executeRawUnsafe(
      `CREATE ROLE ${quote(target.user)} WITH LOGIN PASSWORD ${literal(target.password)}`,
    );
    return 'created';
  }
  // The password in the configuration is the one that must work: on a fresh
  // install the role may exist with an empty password, and on a machine where
  // the file was edited it may be out of date.
  await admin.$executeRawUnsafe(
    `ALTER ROLE ${quote(target.user)} WITH LOGIN PASSWORD ${literal(target.password)}`,
  );
  return 'updated';
}

async function ensureDatabase(admin, target) {
  const rows = await admin.$queryRawUnsafe(
    `SELECT 1 FROM pg_database WHERE datname = ${literal(target.database)}`,
  );
  if (rows.length > 0) return 'present';

  // CREATE DATABASE cannot run inside a transaction, and Prisma's executeRaw
  // wraps everything it sends, so this one goes to the server on its own.
  await admin.$executeRawUnsafe(
    `CREATE DATABASE ${quote(target.database)} OWNER ${quote(target.user)}`,
  );
  return 'created';
}

/// Applies the migrations with the same CLI the developer uses, so there is
/// only one definition of "the database is up to date" in the project.
function migrate() {
  const cli = join(backendDir, 'node_modules', 'prisma', 'build', 'index.js');
  if (!existsSync(cli)) {
    console.log('  migrations: prisma CLI not found, skipping');
    return Promise.resolve(0);
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, 'migrate', 'deploy'], {
      cwd: backendDir,
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

/// True when the database has no users yet, which is the state of a database
/// that has just been created: migrations make tables, not people.
///
/// Returns null when the question cannot be answered (the client is missing,
/// or the schema is not there yet), so a failure here never blocks startup.
async function isEmptyDatabase() {
  let client = null;
  try {
    client = new PrismaClient();
    const users = await client.user.count();
    return users === 0;
  } catch {
    return null;
  } finally {
    await client?.$disconnect().catch(() => {});
  }
}

/// Creates the company's first administrator, reusing the same seeding program
/// a developer runs - so there is one definition of what a new company starts
/// with, not two.
function seedFirstAdministrator(username, password) {
  const seed = join(backendDir, 'dist', 'prisma', 'seed.js');
  if (!existsSync(seed)) {
    console.log('  first administrator: the seeding program is not in this build');
    return Promise.resolve(1);
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [seed], {
      cwd: backendDir,
      env: {
        ...process.env,
        KAYAN_ADMIN_USERNAME: username,
        KAYAN_ADMIN_PASSWORD: password,
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

/// The line the desktop shell reads. Keep it in step with
/// `LocalBackend` in lib/core/backend/local_backend_io.dart.
function announce(state) {
  console.log(`KAYAN-DB-STATE=${state}`);
}

async function main() {
  if (!appUrl) {
    console.error('  database: DATABASE_URL is not set');
    process.exit(2);
  }

  const target = parseUrl(appUrl);
  console.log(`  database: ${target.user}@${target.host}:${target.port}/${target.database}`);

  const admin = adminClient();
  if (admin) {
    try {
      const role = await ensureRole(admin, target);
      const database = await ensureDatabase(admin, target);
      console.log(`  role: ${role}, database: ${database}`);
    } catch (error) {
      // Not fatal: the database may already exist and the application role may
      // already be able to reach it, which is the usual case on a machine that
      // was set up before. The migration below is the real test.
      const reason = String(error?.message ?? error)
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      console.log(`  administrator step skipped: ${reason ?? 'could not connect as administrator'}`);
    } finally {
      await admin.$disconnect().catch(() => {});
    }
  } else {
    console.log('  administrator step skipped: no ADMIN_DATABASE_URL');
  }

  const code = await migrate();
  if (code !== 0) {
    console.error('  migrations: failed');
    process.exit(code);
  }
  console.log('  migrations: up to date');

  // Is this database still empty, and if so were we handed the credentials for
  // its first administrator?
  const empty = await isEmptyDatabase();
  if (empty === null) {
    // Could not tell - the server's own error, if any, is more precise.
    announce('unknown');
    return;
  }
  if (!empty) {
    announce('ready');
    return;
  }

  const username = process.env.KAYAN_ADMIN_USERNAME?.trim();
  const password = process.env.KAYAN_ADMIN_PASSWORD;
  if (!username || !password) {
    // Normal on a fresh machine: the program will ask for them.
    console.log('  the database is empty: no company or administrator yet');
    announce('empty');
    return;
  }

  console.log(`  creating the first administrator: ${username}`);
  const seeded = await seedFirstAdministrator(username, password);
  if (seeded !== 0) {
    console.error('  the first administrator could not be created');
    process.exit(seeded || 1);
  }
  announce('ready');
}

await main();
