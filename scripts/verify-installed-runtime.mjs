// Verifies an INSTALLED KAYAN ERP tree, not the source and not the Setup.
//
// The distinction matters: a staged package can be complete while the installed
// one is not, and every failure reported from a real machine so far was found
// after installation - a migration runner missing from Program Files, a script
// that could not write there, a Node process started with the wrong working
// directory. build-installer.ps1 already refuses to build an incomplete stage;
// this refuses to accept an incomplete install.
//
// Usage (on Windows, after Setup has run):
//     node scripts/verify-installed-runtime.mjs "C:\Program Files\KAYAN ERP"
//
// Exit code 0 means every required file is present, readable and non-empty.
// Every missing item is printed, not just the first, so one repair pass can
// address all of them.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

/// Files the installed program cannot run without, with the reason each one is
/// on the list. A bare path in a list invites deletion of the explanation, and
/// the explanation is what stops the next person removing an entry.
const REQUIRED = [
  ['erp_kayan.exe', 'the desktop shell'],
  ['backend\\dist\\src\\main.js', 'the NestJS entry point'],
  ['backend\\dist\\prisma\\seed.js', 'first-company seeding'],
  ['backend\\scripts\\prepare-database.mjs', 'the database preparation step'],
  ['backend\\scripts\\database-state.mjs', 'telling a new database from a used one'],
  ['backend\\scripts\\migrate-deploy.mjs', 'the migration chain'],
  ['backend\\scripts\\apply-migrations.mjs', 'applying the migrations themselves'],
  ['backend\\node_modules\\prisma\\build\\index.js', 'the bundled Prisma CLI'],
  ['backend\\node_modules\\pg\\package.json', 'the PostgreSQL driver'],
  ['backend\\prisma\\schema.prisma', 'the schema Prisma reads'],
  ['backend\\prisma\\migrations\\migration_lock.toml', 'the migration lock'],
  ['backend\\node\\node.exe', 'the bundled Node runtime'],
  ['backend\\postgres\\bin\\pg_ctl.exe', 'PostgreSQL control'],
  ['backend\\postgres\\bin\\pg_isready.exe', 'PostgreSQL readiness checks'],
  ['backend\\postgres\\bin\\initdb.exe', 'creating a new cluster'],
  ['backend\\postgres\\bin\\psql.exe', 'database inspection'],
  ['backend\\postgres\\bin\\pg_dump.exe', 'backups'],
  ['backend\\postgres\\bin\\pg_restore.exe', 'restores'],
  ['build\\web\\index.html', 'the Flutter web bundle'],
  ['install-runtime.ps1', 'first run and upgrade'],
  ['repair-runtime.ps1', 'the repair action'],
  ['reset-kayan.ps1', 'starting a new company'],
  ['repair-kayan.bat', 'the Start menu repair entry'],
  ['remove-runtime.ps1', 'uninstall cleanup'],
  ['database-control.ps1', 'starting and stopping the database'],
  ['RepairTool.exe', 'the repair tool'],
  ['prerequisites\\vc_redist.x64.exe', 'the Visual C++ runtime'],
];

/// Node options that must never appear in a shipped package: they would change
/// how the bundled runtime behaves on a customer's machine.
const FORBIDDEN = [
  ['backend\\.env', 'a development environment file'],
  ['backend\\dist\\src\\main.js.map', 'build maps that leak source paths'],
];

/// The list is written with Windows separators because it names a Windows
/// install. `join` then has to accept it on any host - this script is also run
/// on Linux against an extracted package - so separators are normalised in one
/// place instead of in every caller.
const at = (base, relative) => join(base, ...relative.split('\\'));

const root = process.argv[2];
if (!root) {
  console.error('usage: node scripts/verify-installed-runtime.mjs "<install root>"');
  process.exit(2);
}

const problems = [];

if (!existsSync(root)) {
  console.error(`FAIL: the install root does not exist: ${root}`);
  process.exit(1);
}

for (const [relative, reason] of REQUIRED) {
  const full = at(root, relative);
  if (!existsSync(full)) {
    problems.push(`missing: ${relative} (${reason})`);
    continue;
  }
  let stat;
  try {
    stat = statSync(full);
  } catch (error) {
    problems.push(`unreadable: ${relative} (${reason}): ${error.message}`);
    continue;
  }
  if (stat.isFile() && stat.size === 0) {
    problems.push(`empty: ${relative} (${reason})`);
  }
}

// The migration directory is the one requirement that cannot be a single path:
// a package with the lock file and no migrations would pass the list above.
const migrationsDir = at(root, 'backend\\prisma\\migrations');
if (existsSync(migrationsDir)) {
  const found = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => existsSync(join(migrationsDir, entry.name, 'migration.sql')));
  if (found.length === 0) {
    problems.push('the install carries no migration.sql under backend\\prisma\\migrations');
  } else {
    console.log(`migrations present: ${found.length}`);
  }
} else {
  problems.push('missing: backend\\prisma\\migrations (the schema history)');
}

for (const [relative, reason] of FORBIDDEN) {
  if (existsSync(at(root, relative))) {
    problems.push(`forbidden: ${relative} (${reason})`);
  }
}

// The migration runner must be the real one, not an empty placeholder that
// happens to satisfy an existence check.
const runner = at(root, 'backend\\scripts\\apply-migrations.mjs');
if (existsSync(runner)) {
  const text = readFileSync(runner, 'utf8');
  if (!text.includes('_prisma_migrations')) {
    problems.push(
      'backend\\scripts\\apply-migrations.mjs does not mention _prisma_migrations, '
        + 'so it is not the migration runner',
    );
  }
  if (text.length < 2000) {
    problems.push(
      `backend\\scripts\\apply-migrations.mjs is only ${text.length} bytes, `
        + 'which is too small to be the runner',
    );
  }
}

if (problems.length > 0) {
  console.error(`FAIL: the installed tree at ${root} is incomplete:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`PASS: ${REQUIRED.length} required files, ${FORBIDDEN.length} forbidden paths and the migration set verified under ${root}`);
