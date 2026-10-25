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
//   5. say what state the database is in (empty / incomplete / ready /
//      unknown - see database-state.mjs), so the desktop shell knows
//      whether this machine still needs its first administrator
//   6. if it needs one AND a username and password were handed in for
//      that first administrator, create them (company, branch, roles,
//      chart of accounts), then ask the database again before claiming
//      it is ready
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

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import {
  classifyDatabaseState,
  needsFirstAdministrator,
} from './database-state.mjs';

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
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: adminUrl }),
  });
}

async function ensureRole(admin, target) {
  const rows = await admin.$queryRawUnsafe(
    `SELECT 1 FROM pg_roles WHERE rolname = ${literal(target.user)}`,
  );
  if (rows.length === 0) {
    await admin.$executeRawUnsafe(
      `CREATE ROLE ${quote(target.user)} WITH LOGIN CREATEDB PASSWORD ${literal(target.password)}`,
    );
    return 'created';
  }
  // Never change an existing role password during application startup.
  // Re-installs and upgrades must preserve credentials. If the configured
  // password is stale, the explicit authentication check below fails safely.
  return 'present';
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

/// What state the database is in - see database-state.mjs for the four
/// states and why "could not tell" is its own state ('unknown') instead
/// of being quietly treated as a brand-new database. Counting COMPANIES
/// as well as users matters: a company with no users (setup interrupted
/// halfway) is 'incomplete', not 'empty', and the log must say so.
///
/// Any failure to ask - unreachable database, missing schema - returns
/// 'unknown', so a broken connection is never mistaken for a fresh
/// install and never invites first-run setup over existing data.
async function databaseState() {
  let client = null;
  try {
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: appUrl }),
    });
    const [companies, users] = await Promise.all([
      client.company.count(),
      client.user.count(),
    ]);
    return classifyDatabaseState({ companies, users });
  } catch {
    return 'unknown';
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
        // Optional company profile the setup dialog collected; the seed
        // uses what is there and leaves the rest at its defaults.
        KAYAN_COMPANY_CODE: process.env.KAYAN_COMPANY_CODE ?? '',
        KAYAN_COMPANY_NAME_AR: process.env.KAYAN_COMPANY_NAME_AR ?? '',
        KAYAN_COMPANY_NAME_EN: process.env.KAYAN_COMPANY_NAME_EN ?? '',
        KAYAN_COMPANY_PHONE: process.env.KAYAN_COMPANY_PHONE ?? '',
        KAYAN_COMPANY_EMAIL: process.env.KAYAN_COMPANY_EMAIL ?? '',
        KAYAN_COMPANY_ADDRESS: process.env.KAYAN_COMPANY_ADDRESS ?? '',
        // The headquarters the dialog named, and the logo file the shell
        // wrote to a temporary folder.
        KAYAN_HQ_CODE: process.env.KAYAN_HQ_CODE ?? '',
        KAYAN_HQ_NAME_AR: process.env.KAYAN_HQ_NAME_AR ?? '',
        KAYAN_HQ_NAME_EN: process.env.KAYAN_HQ_NAME_EN ?? '',
        KAYAN_COMPANY_LOGO_FILE: process.env.KAYAN_COMPANY_LOGO_FILE ?? '',
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

async function canAuthenticate(url) {
  let client = null;
  try {
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url }),
    });
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client?.$disconnect().catch(() => {});
  }
}

async function main() {
  if (!appUrl) {
    console.error('  database: DATABASE_URL is not set');
    process.exit(2);
  }

  const target = parseUrl(appUrl);
  console.log(`  database: ${target.user}@${target.host}:${target.port}/${target.database}`);

  let adminSucceeded = false;
  const admin = adminClient();
  if (admin) {
    try {
      const role = await ensureRole(admin, target);
      const database = await ensureDatabase(admin, target);
      console.log(`  role: ${role}, database: ${database}`);
      adminSucceeded = true;
    } catch (error) {
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

  // If administrator configuration was skipped/failed, verify if application
  // user credentials can authenticate directly before running migration.
  if (!adminSucceeded) {
    const appCanAuth = await canAuthenticate(appUrl);
    if (!appCanAuth) {
      console.error(
        '\n  [خطأ مصادقة قاعدة البيانات - Prisma P1000]\n' +
        '  تعذر الاتصال بقاعدة البيانات بحساب المدير (postgres) أو بحساب التطبيق (erp_app).\n' +
        `  الهدف: ${target.host}:${target.port}/${target.database} (المستخدم: ${target.user})\n` +
        '  خطوات الحل:\n' +
        '  1. تأكد من تشغيل خدمة قاعدة بيانات كايان (KAYAN_PostgreSQL) على المنفذ ' + target.port + '.\n' +
        '  2. إذا كان لديك خادم مسبق، تأكد من صحة بيانات ADMIN_DATABASE_URL أو DATABASE_URL في:\n' +
        '     %APPDATA%\\KAYAN-ERP\\kayan.env\n' +
        '  3. أعد تشغيل البرنامج بعد التحقق.\n'
      );
      process.exit(1);
    }
  }

  if (adminSucceeded && !(await canAuthenticate(appUrl))) {
    console.error(
      '  database: the existing erp_app credentials do not authenticate. ' +
      'No existing role password or database was changed. Restore the valid ' +
      'protected KAYAN configuration before retrying.',
    );
    process.exit(1);
  }

  const code = await migrate();
  if (code !== 0) {
    console.error('  migrations: failed');
    process.exit(code);
  }
  console.log('  migrations: up to date');

  // What state is this database in, and - if it still needs its first
  // administrator - were we handed the credentials for one?
  const state = await databaseState();
  if (state === 'unknown') {
    // Could not tell: unreachable or schema missing. This is NOT a new
    // database, and it is never announced as one - the shell starts the
    // server so its own precise error can surface instead.
    console.log('  database state could not be determined (unreachable?)');
    announce('unknown');
    return;
  }
  if (!needsFirstAdministrator(state)) {
    announce('ready');
    return;
  }

  const username = process.env.KAYAN_ADMIN_USERNAME?.trim();
  const password = process.env.KAYAN_ADMIN_PASSWORD;
  if (!username || !password) {
    // Normal on a fresh machine: the program will ask for them. Say which
    // of the two setup states this is, so support can tell a brand-new
    // database from one whose first setup was interrupted halfway.
    console.log(
      state === 'incomplete'
        ? '  the database is partly set up: a company or users exist without the other'
        : '  the database is empty: no company or administrator yet',
    );
    announce(state);
    return;
  }

  console.log(`  creating the first administrator: ${username}`);
  const seeded = await seedFirstAdministrator(username, password);
  if (seeded !== 0) {
    console.error('  the first administrator could not be created');
    process.exit(seeded || 1);
  }
  // Do not take the seeding program's exit code as proof: ask the
  // database again. Announcing 'ready' over a database that still has
  // nobody in it would strand the user at a login form for an account
  // that does not exist.
  const after = await databaseState();
  if (after !== 'ready') {
    console.error(
      `  the first administrator was seeded but the database state is '${after}', not ready`,
    );
    process.exit(1);
  }
  announce('ready');
}

await main();
