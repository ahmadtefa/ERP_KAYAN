import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyExtractedPayload } from './verify-extracted-windows-installer.mjs';

const sourceCommit = '0123456789abcdef0123456789abcdef01234567';
const required = [
  'erp_kayan.exe',
  'flutter_windows.dll',
  'data/icudtl.dat',
  'data/flutter_assets/AssetManifest.bin',
  'build/web/index.html',
  'backend/dist/src/main.js',
  'backend/dist/prisma/seed.js',
  'backend/node/node.exe',
  'backend/postgres/bin/initdb.exe',
  'backend/postgres/bin/postgres.exe',
  'backend/postgres/bin/libpq.dll',
  'backend/postgres/bin/pg_ctl.exe',
  'backend/postgres/bin/pg_isready.exe',
  'backend/postgres/bin/psql.exe',
  'backend/postgres/bin/pg_dump.exe',
  'backend/postgres/bin/pg_restore.exe',
  'backend/node_modules/prisma/build/index.js',
  'backend/node_modules/@prisma/client/package.json',
  'backend/node_modules/@prisma/adapter-pg/package.json',
  'backend/node_modules/@prisma/engines/package.json',
  'backend/node_modules/@prisma/engines/schema-engine-windows.exe',
  'backend/node_modules/pg/package.json',
  'backend/node_modules/argon2/package.json',
  'backend/node_modules/argon2/argon2.node',
  'backend/node_modules/sharp/package.json',
  'backend/node_modules/@img/sharp-win32-x64/package.json',
  'backend/node_modules/@img/sharp-win32-x64/sharp-win32-x64.node',
  'backend/node_modules/.prisma/client/index.js',
  'backend/prisma/schema.prisma',
  'backend/prisma/migrations/migration_lock.toml',
  'backend/prisma/migrations/20261029000000_test/migration.sql',
  'backend/scripts/prepare-database.mjs',
  'backend/scripts/database-state.mjs',
  'backend/scripts/migrate-deploy.mjs',
  'backend/postgres/share/extension/plpgsql.control',
  'prerequisites/vc_redist.x64.exe',
  'runtime-manifest.json',
  'public-key.pem',
  'install-runtime.ps1',
  'repair-runtime.ps1',
  'reset-kayan.ps1',
  'remove-runtime.ps1',
  'repair-kayan.bat',
  'database-control.ps1',
  'UnelevatedProcess.cs',
  'RepairTool.exe',
  'licenses/LICENSE',
  'licenses/PostgreSQL-LICENSE',
];

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'kayan-payload-verify-'));
  const root = join(base, 'extracted');
  await mkdir(root, { recursive: true });
  const artifact = join(base, 'candidate.exe');
  await writeFile(artifact, 'candidate executable fixture');
  for (const relative of required) {
    const path = join(root, ...relative.split('/'));
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, 'fixture payload file');
  }
  const key = await readFile('distribution/windows/public-key.pem');
  await writeFile(join(root, 'public-key.pem'), key);
  const manifest = {
    product: 'KAYAN ERP',
    productVersion: '0.2.0',
    architecture: 'x64',
    sourceCommit,
    licenseBuildKind: 'product',
    licenseEnforcement: 'enforce',
    licensePublicKeySha256: createHash('sha256').update(key).digest('hex'),
  };
  await writeFile(join(root, 'runtime-manifest.json'), JSON.stringify(manifest));
  return { base, root, artifactPath: artifact };
}

test('accepts a complete product payload with the pinned production public key', async () => {
  const f = await fixture();
  try {
    const result = await verifyExtractedPayload({ ...f, expectedSourceCommit: sourceCommit });
    assert.equal(result.result, 'payload-inspection-passed-not-install-tested');
    assert.equal(result.licensing.privateKeyMarkersFound, false);
    assert.ok(result.payload.fileCount >= required.length);
    assert.equal(result.installer.sha256, createHash('sha256').update(await readFile(f.artifactPath)).digest('hex'));
  } finally {
    await rm(f.base, { recursive: true, force: true });
  }
});

test('refuses a missing native Windows runtime binding', async () => {
  const f = await fixture();
  try {
    const { rm: removeFile } = await import('node:fs/promises');
    await removeFile(join(f.root, 'backend/node_modules/argon2/argon2.node'));
    await assert.rejects(
      verifyExtractedPayload({ ...f, expectedSourceCommit: sourceCommit }),
      /Missing native Windows runtime binding: Argon2 Windows native binding/,
    );
  } finally {
    await rm(f.base, { recursive: true, force: true });
  }
});

test('refuses a missing PostgreSQL runtime executable', async () => {
  const f = await fixture();
  try {
    const { rm: removeFile } = await import('node:fs/promises');
    await removeFile(join(f.root, 'backend/postgres/bin/pg_dump.exe'));
    await assert.rejects(
      verifyExtractedPayload({ ...f, expectedSourceCommit: sourceCommit }),
      /Required runtime payload entries are missing/,
    );
  } finally {
    await rm(f.base, { recursive: true, force: true });
  }
});

test('refuses private-key material in any extracted payload file', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, 'backend/dist/secret.txt'), '-----BEGIN PRIVATE KEY-----');
    await assert.rejects(
      verifyExtractedPayload({ ...f, expectedSourceCommit: sourceCommit }),
      /private-key marker.*backend\\/dist\\/secret\\.txt/,
    );
  } finally {
    await rm(f.base, { recursive: true, force: true });
  }
});

test('refuses build-only npm/Corepack files in the bundled Node runtime', async () => {
  const f = await fixture();
  try {
    const path = join(f.root, 'backend/node/node_modules/npm/docs/content/using-npm/config.md');
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, 'npm documentation only; no runtime dependency');
    await assert.rejects(
      verifyExtractedPayload({ ...f, expectedSourceCommit: sourceCommit }),
      /Build-only npm\/Corepack files.*backend\/node\/node_modules\/npm/,
    );
  } finally {
    await rm(f.base, { recursive: true, force: true });
  }
});

test('refuses a payload manifest from a different commit', async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      verifyExtractedPayload({ ...f, expectedSourceCommit: 'fedcba9876543210fedcba9876543210fedcba98' }),
      /source commit does not match/,
    );
  } finally {
    await rm(f.base, { recursive: true, force: true });
  }
});
