'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const requireBackend = createRequire(path.join(root, 'backend/package.json'));
const yaml = requireBackend('js-yaml');
const workflows = path.join(root, '.github/workflows');
const read = name => yaml.load(fs.readFileSync(path.join(workflows, name), 'utf8'));
const manualOnly = ['ci.yml', 'key-generator.yml', 'windows-candidate-preflight.yml', 'windows-installer.yml', 'windows-integrated-candidate.yml', '_licence-step-diagnose.yml', 'installer-focused-tests.yml', 'licence-startup-focused.yml', 'windows-packaging-probe.yml', 'windows-installer-runtime-smoke.yml'];
for (const file of manualOnly) {
  const triggers = read(file).on;
  assert.deepEqual(Object.keys(triggers), ['workflow_dispatch'], `${file}: unsafe legacy workflow may only be dispatched manually`);
}
// Every other workflow is enumerated: adding a workflow requires a fresh audit.
const reviewed = [
  '_licence-step-diagnose.yml', 'ci.yml', 'code-integrity.yml', 'installer-focused-tests.yml',
  'installer-historical-inventory.yml', 'key-generator.yml', 'licence-startup-focused.yml',
  'safe-checks.yml', 'release-evidence-gate.yml', 'windows-candidate-preflight.yml', 'windows-installer-runtime-smoke.yml',
  'windows-installer.yml', 'windows-integrated-candidate.yml', 'windows-packaging-probe.yml',
].sort();
assert.deepEqual(fs.readdirSync(workflows).filter(name => /\.ya?ml$/.test(name)).sort(), reviewed, 'New or removed workflow needs a fresh safety review');
for (const name of reviewed) {
  const triggers = read(name).on;
  for (const event of ['pull_request_target', 'release', 'workflow_run', 'schedule']) {
    assert.equal(Object.hasOwn(triggers, event), false, `${name}: unreviewed ${event} trigger`);
  }
}
const safe = read('safe-checks.yml');
assert.ok(safe.on.push && safe.on.pull_request, 'Safe checks must remain active on push and PR');
assert.deepEqual(safe.on.push.branches, ['main'], 'Main must retain push checks without duplicating open PR commits');
assert.ok(safe.on.pull_request.branches.includes('main'), 'PRs targeting main must retain code checks');
const source = fs.readFileSync(path.join(workflows, 'safe-checks.yml'), 'utf8');
for (const forbidden of ['smoke-test-installed-windows', 'memory-flow.test', 'verify-licensing-postgres', 'publish-verified-windows', 'license-generator.spec']) {
  assert.equal(source.includes(forbidden), false, `Safe checks reference forbidden path: ${forbidden}`);
}
assert.match(source, /ci-no-signing\.cjs/);
const integrity = read('code-integrity.yml');
assert.deepEqual(integrity.on, safe.on, 'Additional code checks must run on the same PR and main events');
assert.deepEqual(integrity.permissions, { contents: 'read' });
assert.deepEqual(Object.keys(integrity.jobs).sort(), ['accounting-and-packaging-policy', 'windows-build']);
const integritySource = fs.readFileSync(path.join(workflows, 'code-integrity.yml'), 'utf8');
assert.doesNotMatch(integritySource, /secrets\.|contents:\s*write|generateKeyPair|createPrivateKey|publish-verified-windows|smoke-test-installed-windows/);
assert.match(integritySource, /ci-no-signing\.cjs/);
for (const path of ['opening-balances.controller.spec.ts', 'opening-balances.service.spec.ts', 'posting.service.spec.ts', 'year-end-close.service.spec.ts', 'migrate-deploy.test.mjs', 'windows-policy-non-signing.test.mjs']) {
  assert.ok(integritySource.includes(path), `Additional required code test missing: ${path}`);
}
for (const job of Object.values(integrity.jobs)) {
  assert.equal(job.if, undefined, 'Required code job must not be skipped');
  assert.equal(job['continue-on-error'], undefined, 'Required code job must not mask failures');
  const checkout = job.steps.find(step => String(step.uses ?? '').startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, '${{ github.event.pull_request.head.sha || github.sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  for (const step of job.steps) {
    assert.equal(step['continue-on-error'], undefined, 'Code step must not mask failures');
    assert.doesNotMatch(String(step.run ?? ''), /(?:\|\|\s*true|\bexit\s+0\b)/);
  }
}
for (const job of Object.values(safe.jobs)) {
  const checkout = job.steps.find(step => String(step.uses ?? '').startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, '${{ github.event.pull_request.head.sha || github.sha }}', 'Code checks must use the exact source head');
}
const gate = read('release-evidence-gate.yml');
assert.deepEqual(gate.on, safe.on, 'Code CI and the independent evidence gate must run for the same events');
assert.deepEqual(gate.permissions, { contents: 'read' }, 'Evidence gate must not publish or obtain write privileges');
assert.deepEqual(Object.keys(gate.jobs), ['licence-evidence-required']);
const gateJob = gate.jobs['licence-evidence-required'];
assert.equal(gateJob.if, undefined, 'Evidence gate must not be conditional');
assert.equal(gateJob['continue-on-error'], undefined, 'Evidence gate must not ignore a failure');
assert.equal(gateJob.steps.length, 1, 'Evidence gate changes require security review');
assert.match(gateJob.steps[0].run, /Signed licence, generator and installed product tests require the approved isolated VM/);
assert.match(gateJob.steps[0].run, /exit 1/);
assert.equal(gateJob.steps[0].if, undefined);
assert.equal(gateJob.steps[0]['continue-on-error'], undefined);
const publish = read('windows-installer.yml').jobs['publish-windows'];
assert.ok(publish.steps.some(step => String(step.run ?? '').includes('verify-release-evidence.mjs')),
  'Moving the CI evidence signal must not remove the independent publisher evidence check');
assert.equal(publish.environment, 'windows-production');
const publisher = fs.readFileSync(path.join(root, 'scripts/publish-verified-windows.mjs'), 'utf8');
assert.match(publisher, /verify-release-evidence\.mjs/, 'Publisher must independently verify evidence');
console.log('PASS: workflow trigger inventory, independent blocked evidence gate and publisher checks');
