import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = new URL('../.github/workflows/windows-build-only.yml', import.meta.url);
const workflow = readFileSync(file, 'utf8');

test('the build-only path can never publish anything', () => {
  // Read permission only. A workflow that can write to contents could tag or
  // release; this one must stay read-only.
  assert.match(workflow, /permissions:\n  contents: read\n/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /gh release|softprops\/action-gh-release|actions\/create-release/);
  assert.doesNotMatch(workflow, /tags:\s/);
});

test('the build-only path does not request a protected environment', () => {
  // windows-installer-test gates the real smoke job. This path must not be a
  // second route into that gate.
  assert.doesNotMatch(workflow, /environment:\s*windows-installer-test/);
  assert.doesNotMatch(workflow, /environment:/);
});

test('the build-only path does not install the product', () => {
  // A silent install would start services and write to ProgramData. The
  // package must be unpacked, never run as an installer.
  assert.doesNotMatch(workflow, /VERYSILENT/);
  assert.doesNotMatch(workflow, /\/SILENT/);
  assert.match(workflow, /innoextract/);
});

test('the protected gate is untouched and still gates', () => {
  // The mention in this file's own comments is prose, not configuration: what
  // matters is that there is no `uses:` of another workflow and no dispatch.
  assert.doesNotMatch(workflow, /uses:\s*\.\/\.github\/workflows/);
  assert.doesNotMatch(workflow, /workflow_call/);

  const protectedFile = readFileSync(
    new URL('../.github/workflows/windows-installer.yml', import.meta.url), 'utf8');
  // The gate is still there, still bound to the approved environment, and the
  // smoke job is still gated on the product build mode.
  assert.match(protectedFile, /environment: windows-installer-test/);
  assert.match(protectedFile, /name: Install and exercise the inspected Setup offline/);
  // Publishing is still unreachable from a working branch.
  assert.match(protectedFile, /github\.ref == 'refs\/heads\/main'/);
});

test('the file is not claimed to prove an install', () => {
  assert.match(workflow, /Nothing was installed/);
});
