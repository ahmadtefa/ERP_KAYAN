import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_FINGERPRINT, fingerprint, validateFile, validatePem } from './license-build-policy.mjs';

// Synthetic keys only; private halves remain in this process's memory.
const first = generateKeyPairSync('ed25519');
const other = generateKeyPairSync('ed25519');
const firstPem = first.publicKey.export({ format: 'pem', type: 'spki' }).toString();
const otherPem = other.publicKey.export({ format: 'pem', type: 'spki' }).toString();
const syntheticReference = fingerprint(first.publicKey);
const root = fileURLToPath(new URL('../', import.meta.url));

const cli = (...args) => spawnSync(process.execPath, ['scripts/license-build-policy.mjs', ...args], {
  cwd: root, encoding: 'utf8',
});

test('the project fingerprint is SHA-256 SPKI, 128 bits in groups', async () => {
  const { createHash } = await import('node:crypto');
  const expected = createHash('sha256').update(first.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex').slice(0, 32).toUpperCase().match(/.{4}/g).join('-');
  assert.equal(syntheticReference, expected);
  assert.equal(PRODUCTION_FINGERPRINT, 'F932-38B0-CDC0-A81D-345F-160C-F8DC-DBB7');
});

test('product accepts only its reference public key (synthetic reference)', () => {
  assert.equal(validatePem(firstPem, 'product', syntheticReference), syntheticReference);
  assert.throws(() => validatePem(otherPem, 'product', syntheticReference), /does not match/);
  assert.throws(() => validatePem(firstPem, 'product'), /does not match/);
  assert.throws(() => validatePem(null, 'product'), /requires/);
  assert.throws(() => validateFile('product'), /requires/);
  assert.throws(() => validateFile('product', 'this-key-does-not-exist.pem'), /missing or unreadable/);
  assert.notEqual(cli('--mode', 'product').status, 0);
  assert.notEqual(cli('--mode', 'product', '--public-key', 'this-key-does-not-exist.pem').status, 0);
});

test('test-signed and evaluation are explicit, separate, and cannot accept the product reference', () => {
  assert.equal(validatePem(otherPem, 'test-signed', syntheticReference), fingerprint(other.publicKey));
  assert.throws(() => validatePem(firstPem, 'test-signed', syntheticReference), /must not use/);
  assert.throws(() => validatePem(null, 'test-signed'), /requires/);
  assert.equal(validatePem(null, 'evaluation'), null);
  assert.throws(() => validatePem(firstPem, 'evaluation'), /must not contain/);
  assert.throws(() => validatePem(firstPem, 'typo'), /Unknown/);
  assert.equal(cli('--mode', 'evaluation').status, 0);
  assert.notEqual(cli('--mode', 'product', '--expected-fingerprint', syntheticReference).status, 0);
});

test('refuses malformed, non-Ed25519 and private PEM without echoing contents', () => {
  assert.throws(() => validatePem('not a public key', 'product'), /public-key PEM/);
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => validatePem(rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString(), 'product'), /Ed25519/);
  const privatePem = first.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  assert.throws(() => validatePem(privatePem, 'product'), error => !error.message.includes(privatePem) && /private keys are forbidden/.test(error.message));
});

test('Windows build checks both selected and staged keys and marks non-product installers', () => {
  const script = readFileSync(new URL('../distribution/windows/build-installer.ps1', import.meta.url), 'utf8');
  const inno = readFileSync(new URL('../distribution/windows/installer.iss', import.meta.url), 'utf8');
  assert.match(script, /\[switch\]\$TestSignedBuild/);
  assert.match(script, /--mode \$buildKind --public-key \$licencePublicKey/);
  assert.match(script, /--mode \$buildKind --public-key \$stagedPublicKey/);
  assert.match(script, /KAYAN-ERP-TEST-ONLY-Setup/);
  assert.match(script, /KAYAN-ERP-EVALUATION-ONLY-Setup/);
  assert.match(inno, /#ifndef KayanBuildKind/);
  assert.match(inno, /OutputBaseFilename=\{#SetupBase\}/);
  assert.match(inno, /function InitializeSetup\(\): Boolean/);
  assert.match(inno, /#if KayanBuildKind != "product"[\s\S]*?Result := False/);
  assert.match(inno, /GetSHA256OfFile\(ExistingKey\).*GetSHA256OfFile\(IncomingKey\)/);
  const runtime = readFileSync(new URL('../distribution/windows/install-runtime.ps1', import.meta.url), 'utf8');
  assert.ok(runtime.indexOf("$runtimeManifest.licenseBuildKind -ne 'product'") < runtime.indexOf("Write-RuntimeMarker 'KAYAN-RUNTIME-START'"));
  assert.match(runtime, /existing licence key differs/i);
  assert.doesNotMatch(runtime, /Copy-Item -LiteralPath \$source -Destination \$target -Force/);
  const smoke = readFileSync(new URL('../scripts/smoke-test-installed-windows.ps1', import.meta.url), 'utf8');
  assert.ok(smoke.indexOf("throw 'Installed smoke testing is disabled") < smoke.indexOf('$installLog ='));
  assert.match(runtime, /Existing licence state has no protected public key/);
  const legacyBuild = readFileSync(new URL('../scripts/build-desktop-windows.ps1', import.meta.url), 'utf8');
  const legacyInno = readFileSync(new URL('../scripts/installer-windows.iss', import.meta.url), 'utf8');
  assert.ok(legacyBuild.indexOf("throw 'Legacy Windows packaging is disabled") < legacyBuild.indexOf('Set-Location $root'));
  assert.match(legacyInno, /#error "Legacy Windows installer is disabled/);
});

test('all release paths fail closed; test artifacts have a distinct path and name', () => {
  const workflow = readFileSync(new URL('../.github/workflows/windows-installer.yml', import.meta.url), 'utf8');
  const steps = workflow.split(/\n      - name: /);
  const releases = steps.filter(step => step.includes('uses: ncipollo/release-action@v1'));
  assert.equal(releases.length, 2);
  for (const step of releases) {
    assert.match(step, /if: \$\{\{ false \}\}/);
    assert.match(step, /artifacts: build\/windows-installer\/KAYAN-ERP-Setup\.exe/);
  }
  assert.match(workflow, /github\.event_name == 'pull_request' && 'test-signed'/);
  assert.match(workflow, /if \(\$env:KAYAN_BUILD_MODE -eq 'product'\)/);
  assert.match(workflow, /if \(\$env:KAYAN_BUILD_MODE -ne 'test-signed'\) \{ throw/);
  assert.match(workflow, /Product build refused: the approved licence public key is missing/);
  assert.match(workflow, /--mode product --public-key \$operatorKey/);
  assert.match(workflow, /-TestSignedBuild -LicencePublicKeyPath \$key/);
  assert.doesNotMatch(workflow, /secrets\.KAYAN_LICENCE_PRIVATE_KEY/);
  assert.doesNotMatch(workflow, /WriteAllText\([^\n]*private-key\.pem/);
  const smoke = steps.find(step => step.startsWith('Smoke-test the actual installed Windows application'));
  assert.match(smoke, /if: \$\{\{ false \}\}/);
  const testArtifact = steps.find(step => step.startsWith('Upload TEST ONLY installer'));
  assert.match(testArtifact, /if: \$\{\{ false \}\}/);
  const productArtifact = steps.find(step => step.startsWith('Upload product installer'));
  assert.match(productArtifact, /if: \$\{\{ false \}\}/);
  assert.match(testArtifact, /name: KAYAN-ERP-Windows-x64-TEST-ONLY-Installer/);
  assert.match(testArtifact, /path: build\/windows-installer\/KAYAN-ERP-TEST-ONLY-Setup\.exe/);
});

test('Windows production publication is gated by same-run evidence and environment checks', () => {
  const workflow = readFileSync(new URL('../.github/workflows/windows-installer.yml', import.meta.url), 'utf8');
  const job = workflow.slice(workflow.indexOf('\n  publish-windows:'));
  assert.match(job, /needs: build/);
  assert.match(job, /github\.ref == 'refs\/heads\/main'/);
  assert.match(job, /needs\.build\.outputs\.build_mode == 'product'/);
  assert.match(job, /environment: windows-production/);
  assert.ok(job.indexOf('check-release-environment.mjs') < job.indexOf('actions/download-artifact@v4'));
  assert.ok(job.indexOf('inspect-final-inno.mjs') < job.indexOf('verify-release-evidence.mjs'));
  assert.ok(job.indexOf('verify-release-evidence.mjs') < job.indexOf('publish-verified-windows.mjs'));
  assert.doesNotMatch(job, /run-id:|artifact-id:/);
  const publisher = readFileSync(new URL('./publish-verified-windows.mjs', import.meta.url), 'utf8');
  for (const check of ['check-release-environment.mjs', 'inspect-final-inno.mjs', 'verify-release-evidence.mjs']) {
    assert.ok(publisher.indexOf(check) < publisher.indexOf("['release', 'create'"));
  }
});

test('Android generator debug APK is named and uploaded as test-only after a successful build', () => {
  const workflow = readFileSync(new URL('../.github/workflows/key-generator-android.yml', import.meta.url), 'utf8');
  assert.match(workflow, /KAYAN-Key-Generator-Android-TEST-ONLY\.apk/);
  assert.match(workflow, /name: KAYAN-Key-Generator-Android-TEST-ONLY-apk/);
  assert.match(workflow, /name: Upload the TEST ONLY debug-signed APK\s+if: success\(\)/);
  assert.doesNotMatch(workflow, /uses: ncipollo\/release-action/);
  assert.match(workflow, /flutter build apk --debug/);
  assert.doesNotMatch(workflow, /flutter build apk --release/);
  const gradle = readFileSync(new URL('../tools/license-generator/android-app/android/app/build.gradle.kts', import.meta.url), 'utf8');
  assert.match(gradle, /variant\.buildType != "debug"\) variant\.enable = false/);
  assert.match(gradle, /applicationIdSuffix = "\.testonly"/);
  assert.doesNotMatch(gradle, /signingConfig = signingConfigs\.getByName\("debug"\)/);
  const androidPolicy = readFileSync(new URL('../tools/license-generator/android-app/lib/src/register.dart', import.meta.url), 'utf8');
  assert.match(androidPolicy, /policy == LicenceKeyPolicy\.production &&\s*fingerprint != approvedProductionFingerprint/);
  assert.match(androidPolicy, /policy == LicenceKeyPolicy\.testOnly &&\s*fingerprint == approvedProductionFingerprint/);
  assert.match(androidPolicy, /enforceLicenceKeyPolicy\(policy, await key\.fingerprint\(\)\);\s*await ensure\(\)/);
  const bundle = readFileSync(new URL('../tools/license-generator/android-app/lib/src/bundle.dart', import.meta.url), 'utf8');
  assert.ok(bundle.indexOf('enforceLicenceKeyPolicy(folder.policy') < bundle.indexOf('await folder.ensure()'));
  assert.match(bundle, /validateRegisterText\(signing/);
  assert.doesNotMatch(bundle, /Directory\.systemTemp\.createTemp/);
});

test('Sandbox preparation does not start installers on the host', () => {
  const script = readFileSync(new URL('../scripts/prepare-isolated-windows-install-test.ps1', import.meta.url), 'utf8');
  assert.match(script, /<Networking>Disable<\/Networking>/);
  assert.match(script, /<ReadOnly>true<\/ReadOnly>/);
  assert.match(script, /activeLicenceTested = \$false; releaseApproved = \$false/);
  assert.match(script, /This basic check does not activate an old synthetic licence/);
  // The Start-Process is embedded only in the guest here-string.
  const guestStart = script.indexOf("$guest = @'");
  const guestEnd = script.indexOf("\n'@", guestStart);
  assert.ok(guestStart >= 0 && guestEnd > guestStart);
  assert.doesNotMatch(script.slice(0, guestStart) + script.slice(guestEnd + 3), /Start-Process/);
});

test('diagnostic workflow does not receive the production signing secret', () => {
  const diagnostic = readFileSync(new URL('../.github/workflows/_licence-step-diagnose.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(diagnostic, /secrets\.KAYAN_LICENCE_PRIVATE_KEY/);
});
