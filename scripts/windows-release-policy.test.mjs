import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fingerprint, validatePem } from './license-build-policy.mjs';

// Windows release checks only. Synthetic private halves never leave memory.
test('product and diagnostic modes require the right public-key fingerprint', () => {
  const trusted = generateKeyPairSync('ed25519');
  const other = generateKeyPairSync('ed25519');
  const pem = pair => pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const approved = fingerprint(trusted.publicKey);
  assert.equal(validatePem(pem(trusted), 'product', approved), approved);
  assert.throws(() => validatePem(pem(other), 'product', approved));
  assert.throws(() => validatePem(pem(trusted), 'test-signed', approved));
  assert.equal(validatePem(pem(other), 'test-signed', approved), fingerprint(other.publicKey));
});

test('checked-in verification material matches the pinned product policy', () => {
  const publicKey = readFileSync(new URL('../distribution/windows/public-key.pem', import.meta.url), 'utf8');
  assert.equal(validatePem(publicKey, 'product'), '9153-E15E-475B-A2E2-251A-7E40-D8EB-5855');
});

test('diagnostic Inno setup stays non-installable and production paths stay disabled', () => {
  const inno = readFileSync(new URL('../distribution/windows/installer.iss', import.meta.url), 'utf8');
  const workflow = readFileSync(new URL('../.github/workflows/windows-installer.yml', import.meta.url), 'utf8');
  const build = readFileSync(new URL('../distribution/windows/build-installer.ps1', import.meta.url), 'utf8');
  assert.match(build, /foreach \(\$runtimeDir in @\('bin', 'lib', 'share'\)\)/);
  assert.doesNotMatch(build, /Copy-Item \(Join-Path \$pgBin\.FullName '\*'\)/);
  assert.doesNotMatch(build, /\$demoBackupSource|backend\\\\demo-data\\\\kayan-company-backup-demo\.json/);
  assert.match(build, /@\('prepare-database\.mjs', 'database-state\.mjs', 'migrate-deploy\.mjs'\)/);
  assert.match(build, /backend\\node_modules\\prisma\\build\\index\.js/);
  assert.match(build, /seed-demo/);
  assert.match(inno, /#if KayanBuildKind != "product"[\s\S]*?Result := False;/);
  const smoke = workflow.match(/- name: Smoke-test the actual installed Windows application([\s\S]*?)(?=\n      - name:|\n  [a-z-]+:|$)/);
  assert.ok(smoke && /if:\s*\$\{\{ false \}\}/.test(smoke[1]));
  assert.doesNotMatch(workflow, /secrets\.LICENSE_PRIVATE_KEY/);
  const inspect = workflow.indexOf('node scripts/inspect-final-inno.mjs --artifact build/windows-installer/KAYAN-ERP-TEST-ONLY-Setup.exe --mode test-signed');
  const upload = workflow.indexOf('- name: Upload TEST ONLY installer');
  assert.ok(inspect >= 0 && inspect < upload);
});
