// Security review for .github/workflows/windows-build-only.yml, encoded so it
// cannot drift. Every assertion here is one of the guarantees the owner
// required before the workflow was added to the reviewed list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../.github/workflows/windows-build-only.yml', import.meta.url), 'utf8');

test('manual dispatch only: no push, pull_request or schedule trigger', () => {
  const on = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\npermissions:'));
  assert.match(on, /workflow_dispatch:/);
  for (const trigger of ['push:', 'pull_request', 'schedule:', 'release:', 'workflow_run']) {
    assert.ok(!on.includes(trigger), `must not trigger on ${trigger}`);
  }
});

test('read-only: cannot write contents, packages, deployments or releases', () => {
  assert.match(workflow, /permissions:\n\s+contents: read\n/);
  for (const scope of ['contents: write', 'packages: write', 'deployments: write',
                       'actions: write', 'id-token: write', 'security-events: write']) {
    assert.ok(!workflow.includes(scope), `must not request ${scope}`);
  }
});

test('no publish, release or deploy step of any kind', () => {
  for (const marker of ['gh release', 'softprops/action-gh-release', 'actions/create-release',
                        'upload-release-asset', 'npm publish', 'deploy-pages',
                        'gh workflow run', 'workflow_call']) {
    assert.ok(!workflow.includes(marker), `must not contain ${marker}`);
  }
});

test('no protected environment and no smoke job', () => {
  // The words appear in the header explaining what this path is not. What
  // matters is that no job is bound to an environment and no step runs smoke.
  assert.ok(!/^\s+environment:/m.test(workflow), 'no job may declare an environment');
  assert.ok(!/needs:\s*\[?[^\n]*smoke/m.test(workflow), 'no job may depend on smoke');
  assert.ok(!/^\s+- name:.*smoke/im.test(workflow), 'no step may be a smoke test');
});

test('nothing is installed and nothing is rebooted', () => {
  for (const marker of ['VERYSILENT', '/SILENT', 'Restart-Computer', 'shutdown',
                        'Start-Process', 'sc.exe create', 'New-Service']) {
    assert.ok(!workflow.includes(marker), `must not contain ${marker}`);
  }
  // The package is unpacked, never run.
  assert.match(workflow, /innoextract/);
  assert.match(workflow, /Extract the built Setup/);
});

test('no private key is generated or consumed', () => {
  assert.match(workflow, /--mode product/);
  assert.ok(!workflow.includes('--mode test-signed'));
  assert.ok(!workflow.includes('generateKeyPairSync'));
  // The only mention of a private key is the grep that refuses a package
  // carrying one; nothing writes or reads key material.
  const keyMentions = workflow.split('PRIVATE KEY').length - 1;
  assert.equal(keyMentions, 1, 'the only mention must be the leak check');
  assert.match(workflow, /A private key is inside the payload/);
  // Only the pinned public key already in the repository is referenced.
  assert.match(workflow, /public-key\.pem/);
});

test('the protected workflow is not modified by this file', () => {
  assert.ok(!/windows-installer\.yml\s*$/.test(workflow.trim()));
  assert.ok(!workflow.includes('uses: ./.github/workflows/'));
});

test('an artifact is uploaded with the commit and a hash is printed', () => {
  assert.match(workflow, /actions\/upload-artifact/);
  assert.match(workflow, /windows-build-only-\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /Get-FileHash -LiteralPath \$setup -Algorithm SHA256/);
  assert.ok(!/uses: actions\/upload-artifact@v4\n(\s+with:\n)?\s+name: [^\n]*release/i.test(workflow));
});

test('the payload checks cover the components the owner listed', () => {
  const report = workflow.slice(workflow.indexOf('Report what the payload contains'));
  for (const marker of [
    'migration.sql',            // every migration file, not just the folder
    'node.exe',                 // bundled Node runtime
    'pg_ctl.exe',               // bundled PostgreSQL runtime
    'pg_dump.exe',              // backup tool
    'pg_restore.exe',           // restore tool
    'RepairTool.exe',           // repair tool
    'erp_kayan.exe',            // Flutter desktop client
    'apply-migrations.mjs',     // the runner that writes _prisma_migrations
    'remove-everything.ps1',    // the complete-removal script
  ]) {
    assert.ok(report.includes(marker), `the payload report must check ${marker}`);
  }
});

test('a zero-byte file does not count as present', () => {
  assert.match(workflow, /\[ ! -s "\$file" \]/);
  assert.match(workflow, /MISSING OR EMPTY/);
});

test('the package is refused if it carries a private key', () => {
  assert.match(workflow, /BEGIN \.\*PRIVATE KEY/);
  assert.match(workflow, /A private key is inside the payload/);
});

test('the run states what it does not prove', () => {
  assert.match(workflow, /Nothing was installed/);
  assert.match(workflow, /are NOT proven by this run/);
});
