import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Static safety checks only: they do not prove GitHub actually ran this job.
const workflow = readFileSync(new URL('../.github/workflows/windows-candidate-preflight.yml', import.meta.url), 'utf8');

test('preflight checks out the event SHA without persisting credentials', () => {
  assert.match(workflow, /branches:\s*\['arena\/2d794f08-erp-kayan'\]/);
  assert.match(workflow, /ref:\s*\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /EXPECTED_SHA:\s*\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /git status --porcelain=v1 --untracked-files=all/);
});

test('preflight pins actions and tool versions and enforces the Flutter lockfile', () => {
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/);
  assert.match(workflow, /subosito\/flutter-action@[0-9a-f]{40}/);
  assert.match(workflow, /node-version:\s*'22\.22\.3'/);
  assert.match(workflow, /flutter-version:\s*'3\.47\.6'/);
  assert.match(workflow, /flutter pub get --enforce-lockfile/);
});

test('preflight cannot publish, receives no secrets and uploads only the labelled test-only diagnostic', () => {
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
  assert.doesNotMatch(workflow, /softprops\/action-gh-release|gh release create|secrets\./);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /path:\s*build\/windows-installer\/KAYAN-ERP-TEST-ONLY-Setup\.exe/);
  assert.match(workflow, /-DisposableSource -TestSignedBuild/);
  const inspect = workflow.indexOf('node scripts/inspect-final-inno.mjs --artifact build/windows-installer/KAYAN-ERP-TEST-ONLY-Setup.exe --mode test-signed');
  const upload = workflow.indexOf('actions/upload-artifact@');
  assert.ok(inspect >= 0 && inspect < upload);
  assert.doesNotMatch(workflow, /smoke-test-installed-windows|Start-Process.*Setup/);
});

test('lint debt remains visible without gating the build; private-key-writing tests are excluded', () => {
  assert.match(workflow, /run:\s*npm run lint/);
  assert.match(workflow, /continue-on-error:\s*true/);
  assert.match(workflow, /steps\.lint\.outcome == 'failure'/);
  assert.match(workflow, /::warning title=Known lint debt/);
  assert.doesNotMatch(workflow, /throw 'Backend lint failed/);
  assert.match(workflow, /--testPathIgnorePatterns=license-generator\.spec\.ts/);
  assert.match(workflow, /npx prisma generate/);
  assert.doesNotMatch(workflow, /PRISMA_SCHEMA_ENGINE_BINARY|PRISMA_QUERY_ENGINE_LIBRARY/);
});
