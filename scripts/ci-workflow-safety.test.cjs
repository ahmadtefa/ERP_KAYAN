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
const manualOnly = ['ci.yml', 'key-generator.yml', 'windows-candidate-preflight.yml', 'windows-integrated-candidate.yml', '_licence-step-diagnose.yml', 'installer-focused-tests.yml', 'licence-startup-focused.yml', 'windows-packaging-probe.yml', 'windows-installer-runtime-smoke.yml'];
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
const installer = read('windows-installer.yml');
assert.deepEqual(Object.keys(installer.on).sort(), ['pull_request', 'workflow_dispatch']);
assert.deepEqual(installer.on.pull_request.branches, ['main']);
assert.deepEqual(installer.permissions, { contents: 'read' });
const installerSource = fs.readFileSync(path.join(workflows, 'windows-installer.yml'), 'utf8');
assert.match(installerSource, /github\.event_name == 'pull_request' && 'product'/,
  'PRs must build an installable product payload using the pinned public key only');
assert.doesNotMatch(installerSource, /secrets\.(?:LICENSE_PRIVATE_KEY|KAYAN_PRIVATE_KEY)/);
const runtimeSmoke = installer.jobs['smoke-final'];
assert.equal(runtimeSmoke.if, "needs.build.outputs.build_mode == 'product'");
assert.ok(runtimeSmoke.steps.some(step => String(step.run || '').includes('-RuntimeOnly')),
  'PR Setup must be installed only in the bounded RuntimeOnly smoke');
const publisherJob = installer.jobs['publish-windows'];
assert.match(publisherJob.if, /github\.event_name == 'push'/);
assert.match(publisherJob.if, /refs\/heads\/main/);
const safe = read('safe-checks.yml');
assert.ok(safe.on.push && safe.on.pull_request, 'Safe checks must remain active on push and PR');
assert.deepEqual(safe.on.push.branches, ['main'], 'Main must retain push checks without duplicating open PR commits');
assert.ok(safe.on.pull_request.branches.includes('main'), 'PRs targeting main must retain code checks');
const source = fs.readFileSync(path.join(workflows, 'safe-checks.yml'), 'utf8');
// HMAC state integration runs on a disposable GitHub-hosted VM with synthetic keys only.
const isolated = safe.jobs['licence-store-isolation'];
assert.ok(isolated, 'licence-store integration must remain visible as its own job');
assert.equal(isolated.if, undefined);
assert.equal(isolated['continue-on-error'], undefined);
assert.equal(isolated.needs, undefined);
assert.deepEqual(isolated.permissions, { contents: 'read' });
assert.equal(isolated.steps[0].with['persist-credentials'], false);
assert.ok(isolated.steps.every(s => !(s.with && s.with.cache)), 'no dependency cache');
assert.ok(isolated.steps.some(s => /src\/modules\/licensing\/license-store\.spec\.ts/.test(String(s.run || ''))));
const backendSteps = safe.jobs['backend-safe'].steps;
assert.doesNotMatch(backendSteps.map(step => String(step.run || '')).join('\n'), /license-store\.spec\.ts/);
const ordinaryJest = backendSteps.find(step => step.name === 'Run reviewed non-signing backend and authorization tests');
assert.match(ordinaryJest.env.NODE_OPTIONS, /ci-no-hmac\.cjs/);
assert.ok(backendSteps.some(step => String(step.run || '').includes('ci-no-hmac-policy.test.mjs')), 'Scoped guard policy test must run');
for (const [name, job] of Object.entries(safe.jobs)) {
  assert.notEqual(job.needs, 'licence-store-isolation', `${name} must run independently of VM availability`);
  assert.ok(!Array.isArray(job.needs) || !job.needs.includes('licence-store-isolation'));
}
assert.doesNotMatch(source, /secrets\./, 'ordinary code CI must not receive production secrets');
for (const forbidden of ['smoke-test-installed-windows', 'memory-flow.test', 'verify-licensing-postgres', 'publish-verified-windows', 'license-generator.spec']) {
  assert.equal(source.includes(forbidden), false, `Safe checks reference forbidden path: ${forbidden}`);
}
assert.match(source, /ci-no-signing\.cjs/);
const integrity = read('code-integrity.yml');
assert.deepEqual(integrity.on, safe.on, 'Additional code checks must run on the same PR and main events');
assert.deepEqual(integrity.permissions, { contents: 'read' });
assert.deepEqual(Object.keys(integrity.jobs).sort(), ['accounting-and-packaging-policy', 'windows-build']);
const accounting = integrity.jobs['accounting-and-packaging-policy'];
assert.ok(!accounting.env?.NODE_OPTIONS, 'preload guard cannot run before checkout provides it');
for (const step of accounting.steps.filter((step) => step.run && /npm ci|prisma generate|npm test|node --test/.test(step.run))) {
  assert.match(step.env?.NODE_OPTIONS || '', /ci-no-signing\.cjs/, `missing non-signing guard: ${step.name}`);
}
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
assert.equal(gateJob.steps.length, 2, 'PR notice and main blocker require review');
const [prNotice, mainBlocker] = gateJob.steps;
assert.equal(prNotice.if, "github.event_name == 'pull_request'");
assert.match(prNotice.run, /BLOCKED.*APPROVED RELEASE ENVIRONMENT \/ EVIDENCE NOT AVAILABLE/);
assert.match(prNotice.run, /not release approval/);
assert.doesNotMatch(prNotice.run, /exit\s+[1-9]|continue-on-error/);
assert.equal(mainBlocker.if, "github.event_name == 'push'");
assert.match(mainBlocker.run, /Approved isolated Windows VM/);
assert.match(mainBlocker.run, /exit 1/);
for (const step of gateJob.steps) {
  assert.equal(step['continue-on-error'], undefined);
}
const publish = read('windows-installer.yml').jobs['publish-windows'];
assert.ok(publish.steps.some(step => String(step.run ?? '').includes('verify-release-evidence.mjs')),
  'Moving the CI evidence signal must not remove the independent publisher evidence check');
assert.equal(publish.environment, 'windows-production');
const publisher = fs.readFileSync(path.join(root, 'scripts/publish-verified-windows.mjs'), 'utf8');
assert.match(publisher, /verify-release-evidence\.mjs/, 'Publisher must independently verify evidence');
console.log('PASS: workflow trigger inventory, PR evidence notice, main blocker and independent publisher checks');
