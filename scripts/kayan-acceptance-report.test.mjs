import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('missing execution never becomes PASS, and failures and skips remain visible', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kayan-acceptance-'));
  try {
    const input = join(dir, 'results.json');
    const output = join(dir, 'report.json');
    writeFileSync(input, JSON.stringify({ form_widget: { status: 'PASS' },
      backend_contract: { status: 'FAIL', evidence: 'Jest failed' },
      skipped: [{ path: 'test/widget/skip_test.dart', name: 'pending case' }] }));
    const result = spawnSync(process.execPath, ['scripts/kayan-acceptance-report.mjs', input, output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(report.checks.find(check => check.id === 'A09').status, 'FAIL');
    assert.equal(report.checks.find(check => check.id === 'A10').status, 'NOT TESTED');
    assert.equal(report.skipped.length, 1);
    assert.equal(report.checks.find(check => check.id === 'A01').status, 'NOT TESTED');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Flutter JSON events distinguish passing, failing, and skipped tests', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kayan-events-'));
  try {
    const log = join(dir, 'flutter.jsonl');
    const output = join(dir, 'results.json');
    writeFileSync(log, [
      { type: 'suite', suite: { id: 1, path: 'test/widget/form_sheet_test.dart' } },
      { type: 'testStart', test: { id: 2, suiteID: 1, name: 'field error' } },
      { type: 'testDone', testID: 2, result: 'success', skipped: false },
      { type: 'testStart', test: { id: 3, suiteID: 1, name: 'pending' } },
      { type: 'testDone', testID: 3, result: 'success', skipped: true },
    ].map(event => JSON.stringify(event)).join('\n'));
    const result = spawnSync(process.execPath, ['scripts/kayan-acceptance-results.mjs', log, output],
      { encoding: 'utf8', env: { ...process.env, BACKEND_STATUS: '1', FLUTTER_STATUS: '0' } });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(parsed.form_widget.status, 'NOT TESTED');
    assert.equal(parsed.backend_contract.status, 'FAIL');
    assert.equal(parsed.skipped.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a failure outside mapped widget groups fails full Flutter acceptance', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kayan-full-suite-'));
  try {
    const log = join(dir, 'flutter.jsonl');
    const output = join(dir, 'results.json');
    const reportPath = join(dir, 'report.json');
    writeFileSync(log, [
      { type: 'suite', suite: { id: 1, path: 'test/features/orders/order_flow_test.dart' } },
      { type: 'testStart', test: { id: 2, suiteID: 1, name: 'posting failure' } },
      { type: 'error', testID: 2, error: 'Expected one result, got none' },
      { type: 'testDone', testID: 2, result: 'failure', skipped: false },
    ].map(event => JSON.stringify(event)).join('\n'));
    const result = spawnSync(process.execPath, ['scripts/kayan-acceptance-results.mjs', log, output],
      { encoding: 'utf8', env: { ...process.env, BACKEND_STATUS: '0', FLUTTER_STATUS: '1' } });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(parsed.flutter_full_suite.status, 'FAIL');
    assert.match(parsed.flutter_full_suite.failures[0].path, /order_flow_test\.dart/);
    assert.equal(parsed.flutter_full_suite.failures[0].error, 'Expected one result, got none');
    const report = spawnSync(process.execPath, ['scripts/kayan-acceptance-report.mjs', output, reportPath], { encoding: 'utf8' });
    assert.equal(report.status, 0, report.stderr);
    assert.equal(JSON.parse(readFileSync(reportPath, 'utf8')).checks.find(check => check.id === 'X10').status, 'FAIL');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('acceptance gate fails for a skipped or failed test', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kayan-gate-'));
  try {
    const report = join(dir, 'report.json');
    writeFileSync(report, JSON.stringify({ checks: [{ status: 'FAIL' }], skipped: [], counts: { 'NOT TESTED': 0 } }));
    const result = spawnSync(process.execPath, ['scripts/kayan-acceptance-gate.mjs', report], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    writeFileSync(report, JSON.stringify({ checks: [], skipped: [{ name: 'pending' }], counts: { 'NOT TESTED': 1 } }));
    const skipped = spawnSync(process.execPath, ['scripts/kayan-acceptance-gate.mjs', report], { encoding: 'utf8' });
    assert.notEqual(skipped.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
