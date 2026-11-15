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

test('runtime smoke reports complete recovery as blocked without removing the retained restore exercise', async () => {
  const smoke = await readFile(new URL('./smoke-test-installed-windows.ps1', import.meta.url), 'utf8');
  const workflow = await readFile(new URL('../.github/workflows/windows-installer.yml', import.meta.url), 'utf8');
  const capability = smoke.indexOf('$capabilities = Invoke-RestMethod -Uri "$base/backup/full/capabilities"');
  const supported = smoke.indexOf('if ($capabilities.fullBackupSupported -eq $true -and $capabilities.fullRestoreSupported -eq $true)', capability);
  const retainedRestore = smoke.indexOf('$fullRestored = Invoke-RestMethod -Method Post -Uri "$base/backup/full/restore"', supported);
  const blocked = smoke.indexOf('} elseif ($capabilities.fullBackupSupported -eq $false -and $capabilities.fullRestoreSupported -eq $false)', retainedRestore);
  assert.ok(capability >= 0 && capability < supported && supported < retainedRestore && retainedRestore < blocked);
  const guardChecks = smoke.slice(blocked, smoke.indexOf('$licenseDirectory', blocked));
  assert.match(guardChecks, /FULL_BACKUP_INCOMPLETE/);
  assert.match(guardChecks, /FULL_RESTORE_UNAVAILABLE/);
  assert.match(guardChecks, /complete backup and restore not tested/i);
  assert.match(guardChecks, /not release evidence/i);
  assert.match(guardChecks, /inconsistent or missing/);
  assert.match(workflow, /notTested=@\('Complete backup and restore with data, files and licence'/);
});
