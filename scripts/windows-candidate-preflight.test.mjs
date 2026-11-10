import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { summarize, failedTestNames } from './report-flutter-test-failures.mjs';

// Static safety checks only: they do not prove GitHub actually ran this job.
const workflow = readFileSync(new URL('../.github/workflows/windows-candidate-preflight.yml', import.meta.url), 'utf8');

test('preflight checks out the event SHA without persisting credentials', () => {
  // The legacy preflight still generates keys and must never run on push/PR.
  // Dispatch is restricted by policy to an approved isolated VM.
  const requireBackend = createRequire(new URL('../backend/package.json', import.meta.url));
  const parsed = requireBackend('js-yaml').load(workflow);
  assert.deepEqual(Object.keys(parsed.on), ['workflow_dispatch']);
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
  assert.match(workflow, /-DisposableSource -TestSignedBuild/);
  assert.match(workflow, /synthetic-inno-probe-raw-\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /diagnostic-inno-raw-\$\{\{ github\.sha \}\}/);
  const inspector = workflow.match(/\n  diagnostic-inspect:([\s\S]*)$/);
  assert.ok(inspector);
  assert.match(inspector[1], /needs: \[inno-probe, preflight\]/);
  assert.match(inspector[1], /34f65747e4a57d5de2582bb1ad3d540f440a3983/);
  assert.match(inspector[1], /check-fixtures\.py/);
  assert.match(inspector[1], /verify-synthetic-inno-probe\.mjs/);
  assert.match(inspector[1], /Incomplete synthetic installer was not rejected/);
  assert.match(inspector[1], /node scripts\/inspect-final-inno\.mjs --artifact diagnostic\/KAYAN-ERP-TEST-ONLY-Setup\.exe --mode test-signed/);
  assert.match(inspector[1], /--extractor-sha256 "\$KAYAN_INNOEXTRACT_SHA256"/);
  const inspect = inspector[1].indexOf('node scripts/inspect-final-inno.mjs --artifact diagnostic/');
  const upload = inspector[1].indexOf('name: Upload inspected non-installable diagnostic only');
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


test('photo diagnostics include only safe assertion shape and file location', () => {
  const log = [
    {type:'testStart',test:{id:17,name:'photo refreshes after upload and delete commit with lost responses'}},
    {type:'print',testID:17,message:'Expected: exactly 1 matching candidates\nActual: private synthetic payload\ntest/widget/user_photo_test.dart:91:5'},
    {type:'error',testID:17,error:'Test failed.'},
  ].map(JSON.stringify).join('\n');
  const summary = summarize(log);
  assert.match(summary,/Expected: exactly 1 matching candidates/);
  assert.match(summary,/test\/widget\/user_photo_test\.dart:91:5/);
  assert.doesNotMatch(summary,/private synthetic payload/);
});

test('stock document diagnostics keep the assertion shape and line, not the screen text', () => {
  const log = [
    {type:'testStart',test:{id:23,name:'says why it cannot create when the branch has no warehouse'}},
    {type:'print',testID:23,message:'Expected: exactly one matching candidate\nActual: Found 0 widgets with text "New document": []\ntest/widget/stock_documents_screen_test.dart:343:5'},
    {type:'error',testID:23,error:'Test failed.'},
  ].map(JSON.stringify).join('\n');
  const summary = summarize(log);
  assert.match(summary,/Expected: exactly one matching candidate/);
  assert.match(summary,/test\/widget\/stock_documents_screen_test\.dart:343:5/);
  assert.doesNotMatch(summary,/New document/);
});

test('a failure with no error event is still named in the summary', () => {
  const log = [
    {type:'testStart',test:{id:31,name:'screenshot: a golden that failed'}},
    {type:'error',testID:31,error:'Golden "goldens/x.png": Pixel test failed, 1.00%, 10px diff detected.'},
    {type:'testDone',testID:31,result:'failure',hidden:false,skipped:false},
    {type:'testStart',test:{id:32,name:'a test that failed without printing an error'}},
    {type:'testDone',testID:32,result:'failure',hidden:false,skipped:false},
    {type:'testStart',test:{id:33,name:'a passing test'}},
    {type:'testDone',testID:33,result:'success',hidden:false,skipped:false},
  ].map(JSON.stringify).join('\n');
  const summary = summarize(log);
  // The counter would report two failures; before this, the annotation named
  // one, and the other could not be identified from the run at all.
  assert.match(summary, /screenshot: a golden that failed/);
  assert.match(summary, /a test that failed without printing an error/);
  assert.doesNotMatch(summary, /a passing test/);
});

test('a run whose failures all have error events is unchanged', () => {
  const log = [
    {type:'testStart',test:{id:41,name:'screenshot: only failure'}},
    {type:'error',testID:41,error:'Golden "goldens/y.png": Pixel test failed.'},
    {type:'testDone',testID:41,result:'failure',hidden:false,skipped:false},
  ].map(JSON.stringify).join('\n');
  assert.doesNotMatch(summarize(log), /also failed/);
});

test('a skipped test is not reported as a failure', () => {
  const log = [
    {type:'testStart',test:{id:51,name:'screenshot: skipped on purpose'}},
    {type:'testDone',testID:51,result:'success',hidden:false,skipped:true},
  ].map(JSON.stringify).join('\n');
  assert.doesNotMatch(summarize(log), /also failed/);
});

test('every failing test is named, including one that emitted no error event', () => {
  const log = [
    {type:'testStart',test:{id:61,name:'loading design screenshots'}},
    {type:'testDone',testID:61,result:'failure',hidden:false,skipped:false},
    {type:'testStart',test:{id:62,name:'screenshot: dashboard inside the shell (Arabic RTL)'}},
    {type:'error',testID:62,error:'Golden "goldens/dashboard_ar.png": Pixel test failed.'},
    {type:'testDone',testID:62,result:'failure',hidden:false,skipped:false},
    {type:'testStart',test:{id:63,name:'a passing test'}},
    {type:'testDone',testID:63,result:'success',hidden:false,skipped:false},
    {type:'testStart',test:{id:64,name:'a skipped test'}},
    {type:'testDone',testID:64,result:'success',hidden:false,skipped:true},
  ].map(JSON.stringify).join('\n');
  assert.deepEqual(failedTestNames(log), [
    'loading design screenshots',
    'screenshot: dashboard inside the shell (Arabic RTL)',
  ]);
});
