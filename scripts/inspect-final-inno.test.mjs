import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { inspectChunk, inspectListing } from './inspect-final-inno.mjs';

const listing = files => 'Path = setup.exe\nType = Inno\n----------\n' + files.map(p => `Path = ${p}\nFolder = -\nEncrypted = -\n`).join('\n');

/// The smallest listing that satisfies every runtime requirement. Tests that
/// are about naming or encryption start from this so they exercise the rule
/// they name instead of accidentally failing the completeness rule.
const complete = (extra = [], drop = []) => [
  'app/public-key.pem',
  'app/erp_kayan.exe',
  'app/backend/scripts/apply-migrations.mjs',
  'app/backend/scripts/migrate-deploy.mjs',
  'app/backend/scripts/prepare-database.mjs',
  'app/backend/scripts/database-state.mjs',
  'app/backend/node/node.exe',
  'app/backend/node_modules/prisma/build/index.js',
  'app/backend/prisma/schema.prisma',
  'app/backend/prisma/migrations/migration_lock.toml',
  'app/backend/prisma/migrations/20260101000000_init/migration.sql',
  'app/backend/postgres/bin/pg_ctl.exe',
  ...extra,
].filter(p => !drop.includes(p));

test('Inno listing requires public key entries and rejects unsafe names and ambiguous payloads', () => {
  assert.deepEqual(inspectListing(listing(complete())), ['app/public-key.pem']);
  assert.equal(
    inspectListing(listing(complete(['tmp/public-key.pem']))).length,
    2,
  );
  for (const text of [
    listing(complete()).replace('Type = Inno', 'Type = PE'),
    listing(complete(['app/private-key.pem'])),
    listing(complete(['app/config.env', 'app/.env'])),
    listing(complete(['app/credentials.pfx'])),
    listing(complete(['app/public-key.pem'])),
    listing(complete()).replace('Encrypted = -', 'Encrypted = +'),
  ]) assert.throws(() => inspectListing(text));
});

test('the final installer is refused when a runtime file is missing', () => {
  // The binary inspected here is the only evidence of what the customer will
  // actually get. A package that carries the migration lock but not the runner
  // installs a program that cannot build its own schema, and a Setup that is
  // structurally valid would otherwise pass.
  for (const [file, why] of [
    ['app/backend/scripts/apply-migrations.mjs', 'the migration runner'],
    ['app/backend/node/node.exe', 'the Node runtime'],
    ['app/backend/node_modules/prisma/build/index.js', 'the Prisma CLI'],
    ['app/backend/prisma/migrations/20260101000000_init/migration.sql', 'the migrations'],
    ['app/erp_kayan.exe', 'the application'],
  ]) {
    assert.throws(
      () => inspectListing(listing(complete([], [file]))),
      /missing required runtime files/,
      `a payload without ${why} must be refused`,
    );
  }
  // A lock file with no migration beside it is the specific case a filename
  // list cannot catch: nothing is missing by name, the history is empty.
  assert.throws(
    () => inspectListing(listing(complete([], ['app/backend/prisma/migrations/20260101000000_init/migration.sql']))),
    /the schema history/,
  );
});

test('private key marker split across stream chunks is refused', () => {
  const first = inspectChunk(Buffer.from('prefix -----BEGIN PRIVATE '));
  assert.equal(first.found, false);
  assert.equal(inspectChunk(Buffer.from('KEY----- suffix'), first.tail).found, true);
});

test('a failed inspection is reported in Actions without reading payload content', () => {
  const env = { ...process.env, GITHUB_ACTIONS: 'true' };
  const result = spawnSync(process.execPath, ['scripts/inspect-final-inno.mjs', '--artifact', 'definitely-missing-test-installer.exe'], { encoding: 'utf8', env });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /::error title=Inno inspection refused::/);
});

test('publication entrypoint rejects direct invocation without CI identity', () => {
  const env = { ...process.env, GITHUB_REPOSITORY: '', GITHUB_REF: '', GITHUB_EVENT_NAME: '', GH_TOKEN: '' };
  const result = spawnSync(process.execPath, ['scripts/publish-verified-windows.mjs'], { encoding: 'utf8', env });
  assert.notEqual(result.status, 0);
});

test('CLI refuses missing or mismatched extractor identity and failed extraction', async () => {
  const { createHash } = await import('node:crypto');
  const { readFile } = await import('node:fs/promises');
  const identity = createHash('sha256').update(await readFile(process.execPath)).digest('hex');
  const source = '0123456789abcdef0123456789abcdef01234567';
  const args = ['scripts/inspect-final-inno.mjs', '--artifact', 'scripts/inspect-final-inno.test.mjs', '--extractor', process.execPath, '--source-commit', source];
  for (const [extra, expected] of [
    [[], /pinned extractor hash/],
    [['--extractor-sha256', '0'.repeat(64)], /Extractor binary SHA-256 mismatch/],
    [['--extractor-sha256', identity], /extractor failed or refused/],
  ]) {
    const result = spawnSync(process.execPath, [...args, ...extra], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
  }
});
