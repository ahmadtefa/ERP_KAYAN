import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { REQUIRED_CHECKS, verifyEvidence } from './verify-release-evidence.mjs';

// All private keys in these tests exist only in memory.
const authority = generateKeyPairSync('ed25519');
const other = generateKeyPairSync('ed25519');
const now = Date.parse('2026-05-01T00:00:00Z');
const expected = { platform: 'windows', sha256: 'ab'.repeat(32), commit: 'cd'.repeat(20), runId: '12345', runAttempt: '1' };
const make = changes => ({
  version: 1, platform: expected.platform, artifactSha256: expected.sha256,
  commit: expected.commit, runId: expected.runId, runAttempt: expected.runAttempt,
  issuedAt: '2026-04-30T23:59:00Z', expiresAt: '2026-05-01T01:00:00Z',
  checks: Object.fromEntries(REQUIRED_CHECKS.windows.map(name => [name, true])),
  ...changes,
});
const wrap = (payload, key = authority.privateKey) => {
  const bytes = Buffer.from(JSON.stringify(payload));
  return { payload: bytes.toString('base64url'), signature: sign(null, bytes, key).toString('base64url') };
};

test('valid independent evidence is bound to the exact package and workflow run', () => {
  assert.equal(verifyEvidence(wrap(make()), authority.publicKey, expected, now), true);
  for (const mismatch of [
    { ...expected, sha256: '11'.repeat(32) }, { ...expected, commit: '22'.repeat(20) },
    { ...expected, runId: '12346' }, { ...expected, runAttempt: '2' }, { ...expected, platform: 'android' },
  ]) assert.throws(() => verifyEvidence(wrap(make()), authority.publicKey, mismatch, now));
});

test('wrong authority, modified payload, missing checks, and expired evidence are rejected', () => {
  assert.throws(() => verifyEvidence(wrap(make(), other.privateKey), authority.publicKey, expected, now), /signature/);
  const env = wrap(make());
  env.payload = Buffer.from(JSON.stringify(make({ runId: '99999' }))).toString('base64url');
  assert.throws(() => verifyEvidence(env, authority.publicKey, expected, now), /signature/);
  const checks = { ...make().checks }; delete checks['isolated-active-licence-upgrade'];
  assert.throws(() => verifyEvidence(wrap(make({ checks })), authority.publicKey, expected, now), /required/);
  assert.throws(() => verifyEvidence(wrap(make({ expiresAt: '2026-04-30T23:59:59Z' })), authority.publicKey, expected, now), /expired/);
});

test('there is no CLI option to provide an arbitrary authority or enable publication', () => {
  const proc = spawnSync(process.execPath, ['scripts/verify-release-evidence.mjs', '--authority', 'fake', '--artifact', 'fake'], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8', env: { ...process.env, GITHUB_REPOSITORY: 'ahmadtefa/ERP_KAYAN', GITHUB_REF: 'refs/heads/main' },
  });
  assert.notEqual(proc.status, 0);
});
