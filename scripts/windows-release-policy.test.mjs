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
  assert.match(inno, /Length\(ExistingHash\) <> 64/);
  assert.match(inno, /Length\(IncomingHash\) <> 64/);
  assert.match(inno, /function GetCustomSetupExitCode: Integer/);
  assert.match(inno, /RuntimeFailed := True;/);
  const smoke = workflow.match(/- name: Smoke-test the actual installed Windows application([\s\S]*?)(?=\n      - name:|\n  [a-z-]+:|$)/);
  assert.ok(smoke && /if:\s*\$\{\{ false \}\}/.test(smoke[1]));
  assert.doesNotMatch(workflow, /secrets\.LICENSE_PRIVATE_KEY/);
  // The raw same-run transport is not a release candidate. Both build modes
  // must pass the pinned extractor on Linux before the inspected artifact or
  // product-only runtime smoke; the old test-only upload remains disabled.
  const testUpload = workflow.match(/- name: Upload TEST ONLY installer \(diagnostic artifact\)([\s\S]*?)(?=\n      - name:|\n  [a-z-]+:|$)/);
  assert.ok(testUpload && /if:\s*\$\{\{ false \}\}/.test(testUpload[1]));
  const inspect = workflow.match(/\n  inspect-final:([\s\S]*?)(?=\n  [a-z-]+:|$)/);
  assert.ok(inspect);
  assert.match(inspect[1], /needs: build/);
  assert.match(inspect[1], /34f65747e4a57d5de2582bb1ad3d540f440a3983/);
  assert.match(inspect[1], /check-fixtures\.py/);
  assert.match(inspect[1], /node scripts\/inspect-final-inno\.mjs --artifact "candidate\/\$BASE\.exe" --mode "\$MODE"/);
  assert.match(inspect[1], /--extractor-sha256 "\$KAYAN_INNOEXTRACT_SHA256"/);
  assert.match(inspect[1], /--source-commit "\$GITHUB_SHA"/);
  assert.ok(inspect[1].indexOf('node scripts/inspect-final-inno.mjs --artifact') < inspect[1].indexOf('windows-installer-inspected-internal-'));
  const runtimeSmoke = workflow.match(/\n  smoke-final:([\s\S]*?)(?=\n  [a-z-]+:|$)/);
  assert.ok(runtimeSmoke);
  assert.match(runtimeSmoke[1], /needs: \[build, inspect-final\]/);
  assert.match(runtimeSmoke[1], /needs\.build\.outputs\.build_mode == 'product'/);
  const smokeScript = readFileSync(new URL('./smoke-test-installed-windows.ps1', import.meta.url), 'utf8');
  assert.ok(smokeScript.indexOf('& $pgDump --no-password -h 127.0.0.1') > 0);
  assert.ok(smokeScript.indexOf('& $pgRestore --list $preUpgradeBackup') < smokeScript.indexOf('$upgrade = Start-Process'));
  assert.match(smokeScript, /not signed-licence reconstruction or activation/);
  const licenseCalls = smokeScript.split('\n').filter((line) => line.includes('"$base/license/status"'));
  assert.equal(licenseCalls.length, 6);
  assert.equal(licenseCalls.filter((line) => line.includes('-Headers $headers')).length, 5);
  assert.match(smokeScript, /\[int\]\$anonymousStatus\.StatusCode -ne 401/);
  for (const stage of ['corrupt-state', 'saved-state-restored', 'public-key-missing', 'public-key-restored']) {
    assert.ok(smokeScript.includes(`$restart = Start-KayanSmokeClient -Stage '${stage}'`));
  }
  assert.match(smokeScript, /\$deadline = \[DateTime\]::UtcNow\.AddMinutes\(4\)/);
  assert.match(smokeScript, /\$missingKeyBusiness = Invoke-WebRequest[^\n]+\$base\/parties\/customers[^\n]+-Headers \$headers/);
  assert.match(smokeScript, /\[int\]\$missingKeyBusiness\.StatusCode -ne 403 -or \$missingKeyBusinessBody\.code -ne 'LICENSE_PUBLIC_KEY_MISSING'/);
});
