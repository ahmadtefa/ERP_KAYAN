// Proves the Windows installer payload requirements are actually declared and
// enforced, without building or installing anything. This does not replace the
// on-Windows install test; it catches the class of defect where a staged
// package is silently incomplete (missing Node, PostgreSQL, VC++ runtime,
// RepairTool or Prisma migrations) and Setup still "succeeds".

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
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

test('local persistent caches are opt-in and every cached installer is verified before reuse', async () => {
  const build = await read('distribution/windows/build-installer.ps1');
  assert.match(build, /\[string\]\$DownloadsCache\s*=\s*''/);
  assert.match(build, /\[string\]\$NpmCache\s*=\s*''/);
  assert.match(build, /\[string\]\$PubCache\s*=\s*''/);
  assert.match(build, /\[string\]\$TempRoot\s*=\s*''/);
  assert.match(build, /\$env:npm_config_cache\s*=\s*\$npmCachePath/);
  assert.match(build, /\$env:PUB_CACHE\s*=\s*\$pubCachePath/);
  assert.match(build, /\$env:TEMP\s*=\s*\$tempRootPath/);
  assert.match(build, /function Import-VerifiedCachedArtifact/);
  assert.match(build, /Test-VerifiedArtifact \$cached \$Sha256/,
    'a cache hit must be checked before the cached file is copied into staging');
  assert.match(build, /function Save-VerifiedCachedArtifact/);
  assert.match(build, /Test-VerifiedArtifact \$Source \$Sha256/,
    'only verified downloads may be added to the persistent cache');
  assert.match(build, /Import-VerifiedCachedArtifact \$nodeArchive \$nodeZip \$nodeSha256/);
  assert.match(build, /Import-VerifiedCachedArtifact \$postgresArchive \$pgZip \$postgresSha256/);
  assert.match(build, /Import-VerifiedCachedArtifact 'vc_redist\.x64\.exe' \$vcRuntime '' -RequireMicrosoftSignature/,
    'the VC++ redistributable cache hit must pass Microsoft Authenticode verification');
});

test('Windows Setup provisions a private, least-privilege restore administrator on install and upgrade', async () => {
  const install = await read('distribution/windows/install-runtime.ps1');
  assert.match(install, /function Set-RestoreAdministrator\(/);
  assert.match(install, /CREATE ROLE \$role WITH LOGIN PASSWORD '\$restorePassword' CREATEDB NOSUPERUSER NOCREATEROLE NOREPLICATION NOINHERIT NOBYPASSRLS/);
  assert.match(install, /ALTER ROLE \$role WITH LOGIN PASSWORD '\$restorePassword' CREATEDB NOSUPERUSER NOCREATEROLE NOREPLICATION NOINHERIT NOBYPASSRLS/);
  assert.match(install, /Set-PrivateAcl \$credentialFile \$principals/,
    'the generated URL file must be ACL-restricted to system administrators and the authorized user');
  assert.match(install, /\$Values\['KAYAN_RESTORE_ADMIN_FILE'\] = \$credentialFile/,
    'the backend must receive the protected credential-file path through normal runtime settings');
  assert.match(install, /Set-RestoreAdministrator -Values \$settings -PostgresPassword \$dbPassword/,
    'both fresh installations and upgrades must pass through restore-admin provisioning');
  assert.match(install, /\$ready -ne 'true'.*Setup will not claim restore rehearsal is ready/);
});

test('PostgreSQL extraction skips pgAdmin while retaining the verified runtime and notices', async () => {
  const build = await read('distribution/windows/build-installer.ps1');

  // PostgreSQL 17.7's archive includes pgAdmin 4, whose deeply nested Python
  // files can exceed the Windows extraction path limit.  The builder must read
  // only the database runtime entries straight from the verified ZIP instead
  // of expanding that unrelated tree first.
  assert.doesNotMatch(build, /Expand-Archive\s+-LiteralPath\s+\$pgZip\b/i,
    'the complete PostgreSQL archive must never be expanded');
  assert.match(build, /System\.IO\.Compression\.ZipFile\]::OpenRead\(\$Archive\)/,
    'PostgreSQL must be selectively read from the ZIP archive');
  assert.match(build, /Copy-PostgresRuntimeFromArchive\s+-Archive\s+\$pgZip\b/,
    'the verified PostgreSQL archive must be passed to the selective extractor');
  assert.match(build, /@\('bin',\s*'lib',\s*'share'\)/,
    'only PostgreSQL bin, lib and share runtime trees may be extracted');
  assert.match(build, /Get-VerifiedArchive\s+\$postgresUrl\s+\$pgZip\s+\$postgresSha256/,
    'the PostgreSQL ZIP must remain SHA-256 verified before extraction');
  assert.match(build, /@\('LICENSE','COPYRIGHT','README'\)/,
    'PostgreSQL licence notices must remain staged');
});

test('the staged scripts include every file the migration chain shells out to', async () => {
  const build = await read('distribution/windows/build-installer.ps1');

  // This is a real installer failure, not a hypothetical one: an installed
  // build reached "applying the database upgrade" on a clean Windows runner and
  // stopped with
  //
  //     migrations: ...\backend\scripts\apply-migrations.mjs is missing
  //
  // The staged-copy list had three of the four runtime scripts. Setup and the
  // program prepare the database by running prepare-database.mjs, which calls
  // migrate-deploy.mjs, which runs apply-migrations.mjs - so a package missing
  // the last one installs a program that cannot create its own schema.
  const staging = build.match(/foreach \(\$script in @\(([^)]*)\)\)/);
  assert.ok(staging, 'the runtime-script staging list must exist');
  const staged = staging[1];
  for (const script of [
    'prepare-database.mjs',
    'database-state.mjs',
    'migrate-deploy.mjs',
    'apply-migrations.mjs',
  ]) {
    assert.ok(staged.includes(script), `${script} must be staged into the package`);
  }

  // Every staged script must also exist in the repository, or the copy fails at
  // build time with a path that names nothing.
  for (const script of ['prepare-database.mjs', 'database-state.mjs', 'migrate-deploy.mjs', 'apply-migrations.mjs']) {
    assert.ok(existsSync(new URL(`../backend/scripts/${script}`, import.meta.url)),
      `${script} must exist in backend/scripts`);
  }

  // The verifier must name the file too, so a package that quietly loses it is
  // rejected before an installer is produced.
  const requiredLine = build.split('\n').find((l) => l.includes('$required = @(')) ?? '';
  assert.ok(requiredLine.includes('backend\\scripts\\apply-migrations.mjs'),
    'the staged-payload gate must require the migration runner');
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

test('nothing the install or the repair runs reaches the network', async () => {
  // The requirement is that a machine with no Internet installs, upgrades,
  // repairs and runs. Every script on those paths is checked, not just the
  // installer: a repair that downloads a file is an installation that cannot
  // be repaired offline, and the customer sees "Repair failed" with no reason.
  const offline = [
    'distribution/windows/install-runtime.ps1',
    'distribution/windows/repair-runtime.ps1',
    'distribution/windows/database-control.ps1',
    'distribution/windows/remove-runtime.ps1',
    'distribution/windows/remove-everything.ps1',
    'backend/scripts/prepare-database.mjs',
    'backend/scripts/apply-migrations.mjs',
    'backend/scripts/migrate-deploy.mjs',
  ];
  for (const file of offline) {
    const text = await read(file);
    assert.doesNotMatch(
      text,
      /Invoke-WebRequest|Start-BitsTransfer|DownloadFile|curl |wget /,
      `${file} must not download anything at runtime`,
    );
  }
  // The Inno script must not fetch either.
  const inno = await read('distribution/windows/installer.iss');
  assert.doesNotMatch(inno, /https?:\/\//, 'installer.iss must not reference a URL');
});

test('a support script prefers the bundled runtime over the network', async () => {
  // install-vc-runtime.ps1 is not on the install path, but it is the script a
  // person reaches for when the runtime is missing. Downloading first made an
  // offline machine unrepairable; it now looks for the copy the product ships.
  const text = await read('scripts/install-vc-runtime.ps1');
  const bundledIndex = text.indexOf('Using the bundled Visual C++ Redistributable');
  const downloadIndex = text.indexOf('Invoke-WebRequest');
  assert.ok(bundledIndex > 0, 'the script must look for the bundled copy');
  assert.ok(downloadIndex > 0, 'the download fallback must still exist for a bare machine');
  assert.ok(
    bundledIndex < downloadIndex,
    'the bundled copy must be tried before the network',
  );
});
