import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REQUIRED_CHECKS, verifyEvidence } from './verify-release-evidence.mjs';

// This checks only the fail-closed evidence contract. It does not sign or
// verify any actual licence or release attestation, and is not release proof.
test('Windows release claims include the requested product and recovery evidence', () => {
  const expected = [
    'approved-licence-public-key', 'licence-signature-compatibility',
    'isolated-clean-install', 'isolated-active-licence-upgrade',
    'final-installer-inspected', 'no-private-material-inspected',
    'legacy-and-new-licence-verification',
    'invalid-signature-machine-expiry-revocation-rejected',
    'licence-restoration-proof-and-revalidation',
    'windows-10-fresh-install-offline', 'windows-11-fresh-install-offline',
    'services-restart-health-and-migrations', 'installed-login-and-basic-operations',
    'repair-and-upgrade-preserve-data', 'uninstall-reinstall-preserves-data',
    'full-backup-restore-database-and-files', 'restore-failure-crash-and-concurrency',
    'tls-certificate-validation', 'real-stock-posting-reversal-and-rollback',
  ];
  assert.deepEqual(REQUIRED_CHECKS.windows, expected);
  assert.ok(Object.isFrozen(REQUIRED_CHECKS));
  assert.ok(Object.isFrozen(REQUIRED_CHECKS.windows));
  assert.equal(new Set(expected).size, expected.length);
});

test('release evidence refuses a missing authority before considering any claims', () => {
  assert.throws(() => verifyEvidence({}, null, {}), /approved evidence authority/);
});
