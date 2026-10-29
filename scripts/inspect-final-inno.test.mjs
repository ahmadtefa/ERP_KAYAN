import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { inspectChunk, inspectListing } from './inspect-final-inno.mjs';

const listing = files => 'Path = setup.exe\nType = Inno\n----------\n' + files.map(p => `Path = ${p}\nFolder = -\nEncrypted = -\n`).join('\n');

test('Inno listing requires public key entries and rejects unsafe names and ambiguous payloads', () => {
  assert.deepEqual(inspectListing(listing(['app/public-key.pem', 'app/main.js'])), ['app/public-key.pem']);
  assert.equal(inspectListing(listing(['app/public-key.pem', 'tmp/public-key.pem'])).length, 2);
  for (const text of [
    listing(['app/public-key.pem']).replace('Type = Inno', 'Type = PE'),
    listing(['app/main.js']), listing(['app/public-key.pem', 'app/private-key.pem']),
    listing(['app/public-key.pem', 'app/config.env', 'app/.env']),
    listing(['app/public-key.pem', 'app/credentials.pfx']),
    listing(['app/public-key.pem', 'app/public-key.pem']),
    listing(['app/public-key.pem']).replace('Encrypted = -', 'Encrypted = +'),
  ]) assert.throws(() => inspectListing(text));
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
