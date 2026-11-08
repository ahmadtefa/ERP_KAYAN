// Proves the Windows installer payload requirements are actually declared and
// enforced, without building or installing anything. This does not replace the
// on-Windows install test; it catches the class of defect where a staged
// package is silently incomplete (missing Node, PostgreSQL, VC++ runtime,
// RepairTool or Prisma migrations) and Setup still "succeeds".

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');

test('the build script stages every runtime the product needs', async () => {
  const build = await read('distribution/windows/build-installer.ps1');

  // Bundled Node.js (no manual install required by the customer).
  assert.match(build, /nodeVersion\s*=\s*'24\.21\.0'/);
  assert.match(build, /node-.*win-x64/i, 'Node.js win-x64 archive must be staged');
  assert.match(build, /[0-9a-f]{64}/i, 'a pinned SHA-256 must guard the downloaded archive');

  // Bundled PostgreSQL binaries.
  assert.match(build, /postgres/i);
  assert.match(build, /17\.7-1|17\.7/, 'PostgreSQL 17.7 must be staged');

  // VC++ redistributable for the native modules (argon2, sharp).
  assert.match(build, /vc_redist\.x64\.exe/);

  // Repair tool, compiled with in-box csc.exe (no SDK on the build host).
  assert.match(build, /RepairTool\.exe/);
  assert.match(build, /repair-runtime\.ps1/);

  // Prisma client and migrations are part of the payload.
  assert.match(build, /prisma/i);
  assert.match(build, /migration\.sql/, 'the build must refuse a package with no migration');
});

test('the staged-payload gate lists Node, PostgreSQL, VC++, RepairTool and migrations', async () => {
  const build = await read('distribution/windows/build-installer.ps1');
  const line = build.split('\n').find((l) => l.includes('$required = @('));
  assert.ok(line, 'the staged-file verification list must exist');

  for (const required of [
    'backend\\node\\node.exe',
    'backend\\postgres\\bin\\pg_ctl.exe',
    'backend\\postgres\\bin\\initdb.exe',
    'backend\\postgres\\bin\\pg_dump.exe',
    'backend\\scripts\\prepare-database.mjs',
    'backend\\scripts\\migrate-deploy.mjs',
    'backend\\prisma\\schema.prisma',
    'backend\\prisma\\migrations\\migration_lock.toml',
    'prerequisites\\vc_redist.x64.exe',
    'RepairTool.exe',
    'repair-runtime.ps1',
    'install-runtime.ps1',
  ]) {
    assert.ok(line.includes(required), `staged payload gate must require ${required}`);
  }
});

test('the extracted-payload verifier still requires the full runtime', async () => {
  const verifier = await read('scripts/verify-extracted-windows-installer.mjs');
  for (const required of [
    'backend/node/node.exe',
    'backend/postgres/bin/initdb.exe',
    'backend/postgres/bin/pg_ctl.exe',
    'backend/postgres/bin/pg_dump.exe',
    'backend/node_modules/prisma/build/index.js',
    'backend/prisma/migrations/migration_lock.toml',
    'prerequisites/vc_redist.x64.exe',
    'RepairTool.exe',
  ]) {
    assert.ok(verifier.includes(required), `payload verifier must require ${required}`);
  }
  // A package with no migration is incomplete even if every listed file exists.
  assert.ok(verifier.includes('migration\\.sql'), 'the verifier must require a migration.sql file');
});

test('Setup declares Windows 10/11 as the supported floor', async () => {
  const iss = await read('distribution/windows/installer.iss');
  assert.match(iss, /^MinVersion=10\.0$/m, 'Setup must refuse Windows versions below 10');
  assert.match(iss, /ArchitecturesAllowed=x64compatible/);
  assert.match(iss, /PrivilegesRequired=admin/);
});

test('install-runtime registers the database service to survive a reboot', async () => {
  const install = await read('distribution/windows/install-runtime.ps1');
  assert.ok(
    install.includes("'-S','auto'") || install.includes("'-S', 'auto'"),
    'the PostgreSQL service must be registered with automatic start so it survives a reboot',
  );
  assert.ok(install.includes("'register','-N',$serviceName"), 'the service must be registered by pg_ctl');
  // Offline install: the runtime must not fetch anything at install time.
  assert.doesNotMatch(install, /Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer/);
  assert.doesNotMatch(install, /https:\/\//, 'install must not reach the network');
});
