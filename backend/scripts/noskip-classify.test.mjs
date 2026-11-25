import assert from 'node:assert/strict';
import test from 'node:test';
import { classify } from './noskip-classify.mjs';

const c = (status, fullName) => ({ status, fullName });
const base = (cases, over = {}) => ({
  exitStatus: 0,
  report: { numPassedTests: cases.filter((x) => x.status === 'passed').length, numFailedTests: 0 },
  registered: cases.map((x) => x.fullName).sort(),
  cases,
  allowedIdentities: [],
  ...over,
});

test('all passed is PASS', () => {
  assert.equal(classify(base([c('passed', 'a')])).verdict, 'PASS');
});
test('a pending case that is not in the manifest fails', () => {
  const r = classify(base([c('passed', 'a'), c('pending', 'b')]));
  assert.equal(r.verdict, 'FAIL');
  assert.match(r.reason, /not in the bridge manifest/);
});
test('a pending-only file with nothing manifested fails (zero pass is not a waiver)', () => {
  const r = classify(base([c('pending', 'b')]));
  assert.equal(r.verdict, 'FAIL');
  assert.match(r.reason, /not in the bridge manifest/);
});
test('a file with no cases at all fails as no case ran', () => {
  const r = classify(base([], { registered: ['x'] }));
  assert.equal(r.verdict, 'FAIL');
});
test('zero executed and zero pending reports no case ran', () => {
  const r = classify({ exitStatus: 0, report: { numPassedTests: 0 }, registered: [], cases: [], allowedIdentities: [] });
  assert.equal(r.verdict, 'FAIL');
});
test('a manifested pending-only bridge file is reconciled', () => {
  const r = classify(base([c('pending', 'bridge')], { allowedIdentities: ['bridge'] }));
  assert.equal(r.verdict, 'PASS_BRIDGE_MANIFESTED_PENDING');
});
test('a manifested identity does not excuse a second pending case', () => {
  const r = classify(base([c('passed', 'a'), c('pending', 'bridge'), c('pending', 'other')], { allowedIdentities: ['bridge'] }));
  assert.equal(r.verdict, 'FAIL');
});
test('a manifested identity does not excuse a failure', () => {
  const r = classify(base([c('failed', 'bridge')], { allowedIdentities: ['bridge'], report: { numFailedTests: 1, numPassedTests: 0 } }));
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.reason, 'failed cases or suites');
});
test('todo cases fail', () => {
  const r = classify(base([c('passed', 'a')], { report: { numPassedTests: 1, numTodoTests: 1 } }));
  assert.equal(r.verdict, 'FAIL');
});
