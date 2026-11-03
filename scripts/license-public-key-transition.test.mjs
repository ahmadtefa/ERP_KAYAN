import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Public-material inventory only: this test does not generate or sign keys,
// accept any licence, or assert that the product is ready for key rotation.
function spkiHash(relativePath) {
  const pem = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  assert.match(pem, /^\s*-----BEGIN PUBLIC KEY-----\s+[A-Za-z0-9+/=\s]+-----END PUBLIC KEY-----\s*$/);
  const key = createPublicKey(pem);
  assert.equal(key.asymmetricKeyType, 'ed25519');
  return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
}

test('preserve the existing product public key and pin the operator-approved successor', () => {
  const old = spkiHash('../distribution/windows/public-key.pem');
  const next = spkiHash('../distribution/windows/public-key-next.pem');
  assert.equal(old, '9153e15e475ba2e2251a7e40d8eb58559006bbba2923ee8ba564d8d59cc602c4');
  assert.equal(next, 'f93238b0cdc0a81d345f160cf8dcdbb7de5e4d20fa99959b7e4b165ac1ebb5c3');
  assert.notEqual(old, next);
});
