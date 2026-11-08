import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { deployMigrations, prismaCliAvailable } from './migrate-deploy.mjs';

function isolatedBackend() {
  return mkdtempSync(join(tmpdir(), 'kayan-migration-check-'));
}

function fakeCli(root) {
  const path = join(root, 'node_modules', 'prisma', 'build');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'index.js'), '// packaged CLI marker\n', { flag: 'wx' });
}

function fakeMigrator(root, script) {
  const path = join(root, 'scripts');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'apply-migrations.mjs'), script, { flag: 'wx' });
}

test('missing packaged Prisma CLI fails instead of reporting migrations current', async () => {
  const root = isolatedBackend();
  assert.equal(prismaCliAvailable(root), false);
  assert.equal(await deployMigrations(root), 1);
});

test('missing packaged migrator fails closed even when the Prisma CLI exists', async () => {
  const root = isolatedBackend();
  fakeCli(root);
  assert.equal(prismaCliAvailable(root), true);
  assert.equal(await deployMigrations(root), 1);
});

test('runs the packaged apply-migrations script and preserves success and failure exit codes', async () => {
  const ok = isolatedBackend();
  fakeCli(ok);
  fakeMigrator(ok, "if (process.argv.length !== 2) process.exit(42);\n");
  assert.equal(prismaCliAvailable(ok), true);
  assert.equal(await deployMigrations(ok), 0);

  const fail = isolatedBackend();
  fakeCli(fail);
  fakeMigrator(fail, 'process.exit(7);\n');
  assert.equal(await deployMigrations(fail), 7);
});
