import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { deployMigrations, prismaCliAvailable } from './migrate-deploy.mjs';

function isolatedBackend() {
  return mkdtempSync(join(tmpdir(), 'kayan-migration-check-'));
}
function fakeCli(root, script) {
  const path = join(root, 'node_modules', 'prisma', 'build');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'index.js'), script, { flag: 'wx' });
}

test('missing packaged Prisma CLI fails instead of reporting migrations current', async () => {
  const root = isolatedBackend();
  assert.equal(prismaCliAvailable(root), false);
  assert.equal(await deployMigrations(root), 1);
});

test('invokes migrate deploy and preserves success and failure exit codes', async () => {
  const ok = isolatedBackend();
  fakeCli(ok, "if (process.argv.slice(2).join(' ') !== 'migrate deploy') process.exit(42);\n");
  assert.equal(prismaCliAvailable(ok), true);
  assert.equal(await deployMigrations(ok), 0);
  const fail = isolatedBackend();
  fakeCli(fail, 'process.exit(7);\n');
  assert.equal(await deployMigrations(fail), 7);
});
