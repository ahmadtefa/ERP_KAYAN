// Synthetic pairs live in memory only. This runs the actual backend verifier;
// it does not open a database, start a service, or touch any licence state.
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { test } from 'node:test';
import { loadPublicKey, publicKeyFingerprint, signPayload, signPayloadV2, verifyKey, verifyKeyV2 } from '../backend/src/modules/licensing/license-key.ts';
import { signPayload as generatorSign } from '../tools/license-generator/kayan-license.mjs';
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

// Golden vector for format 2. Ed25519 is deterministic, so every implementation
// (product verifier, Node generator, and later the Windows and Android tools)
// must produce exactly this text from this payload and this synthetic test seed.
const GOLDEN_V2_PAYLOAD = {
  v: 2, keyId: 'key_golden-v2-1', type: 'COMPANY_ACTIVATION', licenseId: 'lic_golden-v2-1',
  machineId: 'KM-AAAA-BBBB-CCCC', issuedAt: '2026-05-01T00:00:00.000Z',
  term: { kind: 'MONTHS', months: 12 }, seats: { mode: 'CAP', value: 5 }, state: null, note: null,
  companyRef: 'cmp-golden-0001', displayLabel: null,
};
const GOLDEN_V2_KEY = 'KYN2.eyJ2IjoyLCJrZXlJZCI6ImtleV9nb2xkZW4tdjItMSIsInR5cGUiOiJDT01QQU5ZX0FDVElWQVRJT04iLCJsaWNlbnNlSWQiOiJsaWNfZ29sZGVuLXYyLTEiLCJtYWNoaW5lSWQiOiJLTS1BQUFBLUJCQkItQ0NDQyIsImlzc3VlZEF0IjoiMjAyNi0wNS0wMVQwMDowMDowMC4wMDBaIiwidGVybSI6eyJraW5kIjoiTU9OVEhTIiwibW9udGhzIjoxMn0sInNlYXRzIjp7Im1vZGUiOiJDQVAiLCJ2YWx1ZSI6NX0sInN0YXRlIjpudWxsLCJub3RlIjpudWxsLCJjb21wYW55UmVmIjoiY21wLWdvbGRlbi0wMDAxIiwiZGlzcGxheUxhYmVsIjpudWxsfQ.5BwVhaguMAHfVKUC9mHFPfH6Btezzcxf9kxxbDacgAsqW2dcDh_-C3hsTVTTdaPBXa9fQz3zG0IVkLhtofvTBQ';
const goldenPrivate = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 7)]),
  format: 'der', type: 'pkcs8',
});

test('format 2 golden vector: product and Node generator produce identical key text', () => {
  assert.equal(signPayloadV2(GOLDEN_V2_PAYLOAD, goldenPrivate), GOLDEN_V2_KEY);
  assert.equal(generatorSign(GOLDEN_V2_PAYLOAD, goldenPrivate), GOLDEN_V2_KEY);
  const parsed = verifyKeyV2(GOLDEN_V2_KEY, createPublicKey(goldenPrivate));
  assert.equal(parsed.payload.companyRef, 'cmp-golden-0001');
});

test('format 1 vectors are unchanged and a format 1 verifier refuses format 2 cleanly', () => {
  assert.throws(() => verifyKey(GOLDEN_V2_KEY, createPublicKey(goldenPrivate)), { code: 'MALFORMED' });
  assert.equal(generatorSign(payload, oldPair.privateKey), signPayload(payload, oldPair.privateKey));
});
