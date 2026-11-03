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
const manualOnly = ['ci.yml', 'key-generator.yml', 'windows-candidate-preflight.yml', 'windows-installer.yml', 'windows-integrated-candidate.yml'];
for (const file of manualOnly) {
  const triggers = read(file).on;
  assert.deepEqual(Object.keys(triggers), ['workflow_dispatch'], `${file}: unsafe legacy workflow may only be dispatched manually`);
}
// Every other workflow is enumerated: adding a workflow requires a fresh audit.
const reviewed = [
  '_licence-step-diagnose.yml', 'ci.yml', 'installer-focused-tests.yml',
  'installer-historical-inventory.yml', 'key-generator.yml', 'licence-startup-focused.yml',
  'safe-checks.yml', 'windows-candidate-preflight.yml', 'windows-installer-runtime-smoke.yml',
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
const source = fs.readFileSync(path.join(workflows, 'safe-checks.yml'), 'utf8');
for (const forbidden of ['smoke-test-installed-windows', 'memory-flow.test', 'verify-licensing-postgres', 'publish-verified-windows', 'license-generator.spec']) {
  assert.equal(source.includes(forbidden), false, `Safe checks reference forbidden path: ${forbidden}`);
}
assert.match(source, /ci-no-signing\.cjs/);
assert.match(source, /Signed licence, generator and installed product tests require the approved isolated VM/);
assert.match(source, /exit 1/);
console.log('PASS: workflow trigger inventory and explicit blocked security-evidence gate');
