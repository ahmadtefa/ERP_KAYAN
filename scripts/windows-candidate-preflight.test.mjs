import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { summarize } from './report-flutter-test-failures.mjs';

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
  assert.match(workflow, /name: Probe Inno inspection on Windows/);
  assert.match(workflow, /inspect-final-inno\.mjs --artifact \(Join-Path \$dir 'probe\.exe'\) --mode test-signed/);
  assert.match(workflow, /path:\s*build\/windows-installer\/KAYAN-ERP-TEST-ONLY-Setup\.exe/);
  assert.match(workflow, /-DisposableSource -TestSignedBuild/);
  const inspect = workflow.indexOf('node scripts/inspect-final-inno.mjs --artifact build/windows-installer/KAYAN-ERP-TEST-ONLY-Setup.exe --mode test-signed');
  const upload = workflow.indexOf('actions/upload-artifact@');
  assert.ok(inspect >= 0 && inspect < upload);
  assert.doesNotMatch(workflow, /smoke-test-installed-windows|Start-Process.*Setup/);
  assert.match(workflow, /steps\.flutter_test\.outcome == 'failure'/);
  assert.match(workflow, /throw "Flutter tests failed/);
});

test('lint debt remains visible without gating the build; private-key-writing tests are excluded', () => {
  assert.match(workflow, /npm\.cmd run lint/);
  assert.match(workflow, /flutter analyze --no-pub --machine/);
  assert.match(workflow, /::error title=Flutter analyzer diagnostics/);
  assert.match(workflow, /continue-on-error:\s*true/);
  assert.match(workflow, /steps\.lint\.outcome == 'failure'/);
  assert.match(workflow, /::warning title=Known lint debt/);
  assert.doesNotMatch(workflow, /throw 'Backend lint failed/);
  assert.match(workflow, /--testPathIgnorePatterns=license-generator\.spec\.ts/);
  assert.match(workflow, /npx prisma generate/);
  assert.doesNotMatch(workflow, /PRISMA_SCHEMA_ENGINE_BINARY|PRISMA_QUERY_ENGINE_LIBRARY/);
});

test('Flutter test diagnostics associate failures with test names and escape workflow commands', () => {
  const log = [
    { type: 'testStart', test: { id: 4, name: 'protected read' } },
    { type: 'error', testID: 4, error: 'expected 100%\nactual 0', stackTrace: 'at test.dart:5' },
  ].map(JSON.stringify).join('\n');
  const summary = summarize(log);
  assert.match(summary, /protected read/);
  assert.match(summary, /100%25%0Aactual 0/);
  assert.equal(summarize('plain failure'), 'plain failure');
  assert.equal(summarize('postgresql://user:dummy@127.0.0.1/db'), 'postgresql://[redacted]@127.0.0.1/db');
  assert.match(workflow, /test\/screenshots\/design_screenshots_test\.dart --update-goldens/);
});
