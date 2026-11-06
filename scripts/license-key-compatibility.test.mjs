// Synthetic pairs live in memory only. This runs the actual backend verifier;
// it does not open a database, start a service, or touch any licence state.
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { test } from 'node:test';
import { loadPublicKey, publicKeyFingerprint, signPayload, verifyKey } from '../backend/src/modules/licensing/license-key.ts';
import { fingerprint } from './license-build-policy.mjs';

const oldPair = generateKeyPairSync('ed25519');
const newPair = generateKeyPairSync('ed25519');
const payload = {
  v: 1,
  keyId: 'key_synthetic-1',
  type: 'ACTIVATION',
  licenseId: 'lic_synthetic-1',
  machineId: 'KM-AAAA-BBBB-CCCC',
  issuedAt: '2026-05-01T00:00:00.000Z',
  term: { kind: 'MONTHS', months: 12 },
  seats: { mode: 'INCREASE', value: 5 },
  state: null,
  note: null,
};

test('build policy and product verifier calculate identical public fingerprints', () => {
  assert.equal(fingerprint(oldPair.publicKey), publicKeyFingerprint(oldPair.publicKey));
  const pem = oldPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  assert.equal(publicKeyFingerprint(loadPublicKey(pem)), fingerprint(oldPair.publicKey));
});

test('generator-format signature is accepted by the product verifier', () => {
  const signedText = `KYN1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  const signature = sign(null, Buffer.from(signedText), oldPair.privateKey).toString('base64url');
  assert.equal(verifyKey(`${signedText}.${signature}`, oldPair.publicKey).payload.licenseId, payload.licenseId);
});

test('product signature is accepted by Node Ed25519 and rejects altered payload', () => {
  const key = signPayload(payload, oldPair.privateKey);
  const [prefix, encoded, signature] = key.split('.');
  assert.equal(verify(null, Buffer.from(`${prefix}.${encoded}`), oldPair.publicKey, Buffer.from(signature, 'base64url')), true);
  const changed = Buffer.from(JSON.stringify({ ...payload, licenseId: 'lic_changed-1' })).toString('base64url');
  assert.throws(() => verifyKey(`${prefix}.${changed}.${signature}`, oldPair.publicKey), { code: 'BAD_SIGNATURE' });
});

test('replacing the verification key rejects old signed tokens; keeping it accepts them', () => {
  const oldToken = signPayload(payload, oldPair.privateKey);
  assert.equal(verifyKey(oldToken, oldPair.publicKey).payload.keyId, payload.keyId);
  assert.throws(() => verifyKey(oldToken, newPair.publicKey), { code: 'BAD_SIGNATURE' });
});
