import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { validatePem } from './license-build-policy.mjs';
import { scanPrivateMaterialStream } from './verify-extracted-windows-installer.mjs';

// Existing public verification material only; no keys are created, imported
// as private keys or used for signing. This is not a cryptographic licence test.
test('installer policy distinguishes the approved and different public keys', async () => {
  const approved = await readFile(new URL('../distribution/windows/public-key.pem', import.meta.url), 'utf8');
  const different = await readFile(new URL('../distribution/windows/public-key-next.pem', import.meta.url), 'utf8');
  const fingerprint = validatePem(approved, 'product');
  assert.throws(() => validatePem(different, 'product'));
  assert.throws(() => validatePem(approved, 'test-signed'));
  assert.notEqual(validatePem(different, 'test-signed'), fingerprint);
  assert.equal(validatePem(null, 'evaluation'), null);
  assert.throws(() => validatePem(approved, 'evaluation'));
});

test('payload scanner detects split synthetic markers without key material', async () => {
  // This is not a key: it only exercises marker recognition across chunks.
  const marker = '-----BEGIN RSA PRIVATE KEY-----\n' + 'A'.repeat(40);
  assert.equal(await scanPrivateMaterialStream(Readable.from([marker.slice(0, 14), marker.slice(14)])), 'PEM private-key material');
  assert.equal(await scanPrivateMaterialStream(Readable.from(['Example: -----BEGIN PRIVATE KEY-----\\n...'])), null);
});
