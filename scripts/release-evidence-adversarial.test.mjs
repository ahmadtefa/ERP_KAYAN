// New adversarial cases only: no production material or private-key files.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import { REQUIRED_CHECKS, verifyEvidence } from './verify-release-evidence.mjs';

const authority = generateKeyPairSync('ed25519');
const adversary = generateKeyPairSync('ed25519');
const sha = data => createHash('sha256').update(data).digest('hex');
const now = Date.parse('2026-10-29T12:00:00Z');
const expected = { platform: 'windows', sha256: sha('candidate A'), commit: 'ab'.repeat(20), runId: '17', runAttempt: '1' };
const claims = () => ({ version: 1, platform: expected.platform, artifactSha256: expected.sha256,
  commit: expected.commit, runId: expected.runId, runAttempt: expected.runAttempt,
  issuedAt: '2026-10-29T11:55:00Z', expiresAt: '2026-10-29T12:30:00Z',
  checks: Object.fromEntries(REQUIRED_CHECKS.windows.map(check => [check, true])) });
const seal = (payload, privateKey = authority.privateKey) => {
  const bytes = Buffer.from(JSON.stringify(payload));
  return { payload: bytes.toString('base64url'), signature: sign(null, bytes, privateKey).toString('base64url') };
};

test('missing or malformed release evidence is refused', () => {
  for (const envelope of [undefined, null, {}, { payload: '', signature: '' },
    { payload: '***', signature: 'not_base64!' }, { payload: 'AA', signature: 'AA' }]) {
    assert.throws(() => verifyEvidence(envelope, authority.publicKey, expected, now));
  }
});

test('signed evidence cannot authorize changed installer bytes, commit, run or attempt', () => {
  const signed = seal(claims());
  assert.equal(verifyEvidence(signed, authority.publicKey, expected, now), true);
  for (const altered of [
    { ...expected, sha256: sha('candidate B') }, { ...expected, commit: 'cd'.repeat(20) },
    { ...expected, runId: '18' }, { ...expected, runAttempt: '2' },
  ]) assert.throws(() => verifyEvidence(signed, authority.publicKey, altered, now));
});

test('forged authority and omitted or non-boolean required checks are refused', () => {
  assert.throws(() => verifyEvidence(seal(claims(), adversary.privateKey), authority.publicKey, expected, now), /signature/);
  for (const value of [false, 'true', null]) {
    const payload = claims(); payload.checks['final-installer-inspected'] = value;
    assert.throws(() => verifyEvidence(seal(payload), authority.publicKey, expected, now));
  }
  const payload = claims(); delete payload.checks['isolated-active-licence-upgrade'];
  assert.throws(() => verifyEvidence(seal(payload), authority.publicKey, expected, now));
});
