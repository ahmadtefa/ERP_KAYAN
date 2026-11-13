// Guards the uninstall step of the installed-Windows smoke.
//
// Run 42901077717 installed, upgraded, repaired and reset the product, then the
// job hit its 30 minute budget inside the uninstall step. The smoke called
// unins000.exe with `-Wait`, which has no timeout, so a stopped uninstaller
// consumed the whole budget and the run reported only "timed out" — no exit
// code, no state, nothing to diagnose.
//
// An open wait is never allowed to come back. These checks fail if the step
// loses its bound, stops recording evidence, or kills the process before the
// evidence is read.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'smoke-test-installed-windows.ps1'), 'utf8');

const startAt = source.indexOf('$uninstaller = Join-Path $installRoot');
const endAt = source.indexOf('PASS: uninstall kept the company data');
assert.ok(startAt > 0 && endAt > startAt, 'the uninstall step must exist');
// Comments are prose, not behaviour. A comment explaining why `-Wait` is
// banned must not trip the check that bans it.
const step = source
  .slice(startAt, endAt)
  .split(/\r?\n/)
  .map((line) => line.replace(/\s*#.*$/, ''))
  .join('\n');

test('the uninstaller is never waited on without a timeout', () => {
  assert.doesNotMatch(step, /-Wait\b(?!ForExit)/,
    'Start-Process -Wait has no timeout and swallows the job budget when the uninstaller hangs');
  assert.match(step, /WaitForExit\(\$uninstallTimeoutSeconds \* 1000\)/,
    'the uninstaller must be awaited with an explicit timeout');
  assert.match(step, /\$uninstallTimeoutSeconds\s*=\s*\d+/,
    'the timeout must be a concrete number of seconds');
});

test('a hung uninstaller is reported as a failure, not as an unexplained timeout', () => {
  const deadline = step.slice(step.indexOf('if (-not $uninstallExited)'));
  const deadlineBlock = deadline.slice(0, deadline.indexOf(String.fromCharCode(10) + '}'));
  assert.match(deadlineBlock, /Fail\s*\(/,
    'a process still running at the deadline must fail the run with its own message');
  assert.match(step, /::error title=Uninstaller did not finish::/,
    'the failure must be published as an annotation that names the cause');
});

test('evidence is recorded before anything is killed', () => {
  const evidenceAt = step.indexOf('$uninstallEvidence = @(');
  const killAt = step.indexOf('Stop-Process');
  assert.ok(evidenceAt > 0, 'the step must build an evidence block');
  if (killAt > 0) {
    assert.ok(evidenceAt < killAt, 'evidence must be read while the process state is still observable');
  }
  for (const field of ['exit code', 'process alive', 'program file', 'service', 'uninstall key']) {
    assert.ok(step.includes(field), `the evidence must record ${field}`);
  }
});

test('no kill happens before the deadline', () => {
  const deadlineAt = step.indexOf('if (-not $uninstallExited)');
  const killAt = step.indexOf('Stop-Process');
  if (killAt > 0) {
    assert.ok(killAt > deadlineAt,
      'the process may only be stopped after the bounded wait has failed, never to hide a slow removal');
  }
});

test('a hung uninstaller cannot be mistaken for a successful uninstall', () => {
  // Fail() is the only allowed response to a hang; a pass must require exit 0.
  const deadline = step.slice(step.indexOf('if (-not $uninstallExited)'));
  assert.match(deadline.slice(0, deadline.indexOf(String.fromCharCode(10) + '}')), /Fail\s*\(/, 'a hang must fail');
  assert.match(step, /if \(\$uninstallExitCode -ne 0\)/,
    'a non-zero exit must fail rather than continue to the cleanliness checks');
});

console.log('PASS: the uninstall step waits with a deadline, records evidence, and cannot hide a hang');
