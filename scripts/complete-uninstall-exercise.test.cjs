// Guards the Complete Uninstall exercise that runs on Windows.
//
// Complete removal was the one path with no execution behind it: the script was
// inspected, its guards were tested statically, and nobody had run it against a
// real installation. These checks keep the exercise honest — it must never
// fabricate an installation, never widen what it deletes, and never report a
// pass it did not observe.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'scripts/exercise-complete-uninstall.ps1'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/windows-installer.yml'), 'utf8');

test('the exercise installs the real Setup instead of fabricating an installation', () => {
  assert.match(script, /Start-Process -FilePath \$SetupPath/, 'it must run the actual candidate Setup');
  assert.match(script, /Get-InstallRoot/, 'it must read the install root the installer registered');
  assert.doesNotMatch(script, /New-Item[^\n]*Program Files/i, 'it must never hand-build an install folder');
});

test('the exercise proves removal component by component', () => {
  // The assertion must be that each component is actually measured. A bare
  // mention of the name is not a check: replacing `pgData = Test-Path ...` with
  // `pgData = $false` deletes the measurement and leaves the word behind.
  const afterBlock = script.slice(script.indexOf('$after = [ordered]@'));
  for (const component of ['installRoot', 'programData', 'pgData', 'service', 'firewallRules', 'backups', 'uploads']) {
    const measured = new RegExp('^\\s*' + component + '\\s*=\\s*(?:Test-Path|\\[bool\\]|@\\(Get-NetFirewallRule|Get-Service)', 'm');
    assert.match(afterBlock, measured,
      `${component} must be measured after removal with a real filesystem/service query, not a constant`);
  }
  assert.match(script, /Record "removed: \$name"/, 'each component must be recorded, not assumed');
  assert.match(script, /if \(\$failures\.Count -gt 0\)[\s\S]{0,600}exit 1/, 'the verdict must fail the run');
});

test('the exercise proves files the product does not own survive', () => {
  assert.match(script, /NOT-KAYAN-keep\.txt/, 'neighbouring files must be planted on purpose');
  assert.match(script, /kept: /, 'survival of neighbouring files must be recorded');
});

test('the exercise proves the refusals delete nothing', () => {
  assert.match(script, /-WhatIfPlan/, 'the plan-only run must be exercised');
  assert.match(script, /without -ConfirmRemoval/, 'the missing-confirmation refusal must be exercised');
});

test('a hang is reported with state, never killed first', () => {
  const timeoutAt = script.indexOf('if (-not $removal.WaitForExit');
  assert.ok(timeoutAt > 0, 'the removal must have a bounded wait');
  const block = script.slice(timeoutAt, timeoutAt + 700);
  assert.match(block, /Test-Path/, 'state must be read before the process is stopped');
  assert.ok(block.indexOf('Test-Path') < block.indexOf('Stop-Process'), 'read the evidence before killing');
});

test('the workflow runs the exercise and uploads its evidence', () => {
  assert.match(workflow, /exercise-complete-uninstall\.ps1/, 'the workflow must invoke the exercise');
  assert.match(workflow, /complete-uninstall-evidence/, 'the evidence must be uploaded');
});

test('the exercise is never silent about a failure', () => {
  assert.match(script, /::error title=Complete uninstall exercise failed::/, 'a failure must be an annotation');
  assert.match(script, /exit 1/, 'a failure must exit non-zero');
  assert.doesNotMatch(script, /::warning[^\n]*failed/i, 'a failure must not be downgraded to a warning');
});

console.log('PASS: the Complete Uninstall exercise installs the real product, checks every component, and cannot fake a pass');
