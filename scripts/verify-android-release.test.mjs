import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanChunk, validateApkMetadata } from './verify-android-release.mjs';

const pin = 'ab'.repeat(32);
const signer = `Signer #1 certificate DN: CN=KAYAN Release, O=Example\nSigner #1 certificate SHA-256 digest: ${pin}\n`;
const badging = "package: name='com.kayan.kayan_key_generator' versionCode='1'\napplication-label:'KAYAN Key Generator'\n";

test('requires exactly one approved signer, a production package and non-debuggable manifest', () => {
  assert.equal(validateApkMetadata(pin, signer, badging), true);
  assert.throws(() => validateApkMetadata('zz', signer, badging));
  assert.throws(() => validateApkMetadata('cd'.repeat(32), signer, badging));
  assert.throws(() => validateApkMetadata(pin, signer + `Signer #2 certificate SHA-256 digest: ${pin}\n`, badging));
  assert.throws(() => validateApkMetadata(pin, signer.replace('KAYAN Release', 'Android Debug'), badging));
  assert.throws(() => validateApkMetadata(pin, signer, `${badging}application-debuggable\n`));
  assert.throws(() => validateApkMetadata(pin, signer, badging.replace('generator\'', 'generator.testonly\'')));
});

test('recognizes split plaintext markers without storing key material', () => {
  const first = scanChunk(Buffer.from('-----BEGIN PRIVATE '));
  assert.equal(first.found, false);
  assert.equal(scanChunk(Buffer.from('KEY-----'), first.tail).found, true);
  assert.equal(scanChunk(Buffer.from('ordinary data')).found, false);
});
