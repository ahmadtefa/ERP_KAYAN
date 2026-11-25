'use strict';
// Proof of the bridge helper with FAKE children: no Flutter, no database, no network.
// Run from the repo root:  node --test backend/scripts/bridge-harness.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const harness = require('./bridge-harness.cjs');
const cluster = require('./isolated-pg-cluster.cjs');

const COMMIT = 'a'.repeat(40);
const checker = () => import(path.join(__dirname, '..', '..', 'scripts', 'verify-location-bridge-evidence.mjs'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-test-'));

function fakeFlutter(dir, {lines, code = 0, name = 'flutter'}) {
  const file = path.join(dir, name);
  const body = lines.map((l) => `printf '%s\\n' '${l.replace(/'/g, `'\\''`)}'`).join('\n');
  fs.writeFileSync(file, `#!/bin/sh\n# fake child: ${'$@'} is recorded\necho "$@" > "${dir}/argv"\n${body}\nexit ${code}\n`, {mode: 0o755});
  return file;
}
async function goodEvents() {
  const {bridges} = await checker();
  const b = bridges[0];
  return {b, lines: [
    {type: 'suite', suite: {id: 1, path: '/repo/test/widget/' + b.file}},
    {type: 'testStart', test: {id: 2, suiteID: 1, name: b.name}},
    {type: 'testDone', testID: 2, result: 'success', skipped: false, hidden: false},
    {type: 'done', success: true},
  ].map((e) => JSON.stringify(e))};
}
const run = (dir, evidence, bin, id = 'receipt') => harness.runFlutterBridge({id, testFile: 'test/widget/x_test.dart', cwd: dir, env: {...process.env, FLUTTER_BIN: bin, KAYAN_BRIDGE_EVIDENCE_DIR: evidence, KAYAN_SOURCE_COMMIT: COMMIT}});

test('success: json reporter and no-pub flags, evidence files, checker accepts child and receipt', async () => {
  const dir = tmp(), evidence = path.join(dir, 'ev');
  const {b, lines} = await goodEvents();
  const bin = fakeFlutter(dir, {lines});
  await run(dir, evidence, bin);
  assert.match(fs.readFileSync(path.join(dir, 'argv'), 'utf8'), /^test --reporter json --no-pub test\/widget\/x_test\.dart/);
  assert.equal(fs.readFileSync(path.join(evidence, 'receipt.flutter.status'), 'utf8').trim(), '0');
  const jsonl = fs.readFileSync(path.join(evidence, 'receipt.flutter.jsonl'), 'utf8');
  harness.writeParentReceipt('receipt', {...process.env, KAYAN_BRIDGE_EVIDENCE_DIR: evidence, KAYAN_SOURCE_COMMIT: COMMIT});
  const {inspectChild, inspectParent} = await checker();
  assert.equal(inspectChild(jsonl, b, '0').id, 'receipt');
  assert.equal(inspectParent(JSON.parse(fs.readFileSync(path.join(evidence, 'receipt.parent.json'), 'utf8')), b), COMMIT);
});

test('corrupt stdout beside valid success events: helper refuses, status non-zero, raw stdout kept, checker refuses, no receipt', async () => {
  const dir = tmp(), evidence = path.join(dir, 'ev');
  const {b, lines} = await goodEvents();
  const bin = fakeFlutter(dir, {lines: ['Running Gradle task...', ...lines]});
  await assert.rejects(run(dir, evidence, bin), /non-JSON stdout/);
  const status = fs.readFileSync(path.join(evidence, 'receipt.flutter.status'), 'utf8').trim();
  assert.notEqual(status, '0');
  const jsonl = fs.readFileSync(path.join(evidence, 'receipt.flutter.jsonl'), 'utf8');
  assert.match(jsonl, /Running Gradle task/); // nothing is filtered away
  const {inspectChild} = await checker();
  assert.throws(() => inspectChild(jsonl, b, status));
  assert.equal(fs.existsSync(path.join(evidence, 'receipt.parent.json')), false);
});

test('nonzero child exit throws and records the code, even with passing events', async () => {
  const dir = tmp(), evidence = path.join(dir, 'ev');
  const {lines} = await goodEvents();
  await assert.rejects(run(dir, evidence, fakeFlutter(dir, {lines, code: 3})), /status 3/);
  assert.equal(fs.readFileSync(path.join(evidence, 'receipt.flutter.status'), 'utf8').trim(), '3');
});

test('no evidence dir: nothing is written and the receipt is a no-op', async () => {
  const dir = tmp();
  const {lines} = await goodEvents();
  const env = {...process.env, FLUTTER_BIN: fakeFlutter(dir, {lines})};
  delete env.KAYAN_BRIDGE_EVIDENCE_DIR;
  await harness.runFlutterBridge({id: 'receipt', testFile: 't.dart', cwd: dir, env});
  assert.equal(harness.writeParentReceipt('receipt', env), null);
});

test('receipt refuses unknown ids and a malformed commit', () => {
  const env = {...process.env, KAYAN_BRIDGE_EVIDENCE_DIR: path.join(tmp(), 'ev')};
  assert.throws(() => harness.writeParentReceipt('nope', {...env, KAYAN_SOURCE_COMMIT: COMMIT}), /Unknown bridge/);
  assert.throws(() => harness.writeParentReceipt('receipt', {...env, KAYAN_SOURCE_COMMIT: 'abc'}), /40 hex/);
  assert.throws(() => harness.writeParentReceipt('receipt', {...env, KAYAN_BRIDGE_EVIDENCE_DIR: 'relative'}), /absolute/);
});

test('FLUTTER_BIN, PATH and legacy fallback resolve in that order and fail loudly', () => {
  const dir = tmp();
  const bin = fakeFlutter(dir, {lines: []});
  assert.equal(harness.resolveFlutterBin({FLUTTER_BIN: bin, PATH: ''}), bin);
  assert.throws(() => harness.resolveFlutterBin({FLUTTER_BIN: path.join(dir, 'missing'), PATH: dir}), /not an executable/);
  assert.equal(harness.resolveFlutterBin({PATH: dir}), bin);
  if (!fs.existsSync(harness.LEGACY_FLUTTER)) assert.throws(() => harness.resolveFlutterBin({PATH: path.join(dir, 'empty')}), /Set FLUTTER_BIN/);
});

test('cluster teardown removes only a root it can prove it made', async () => {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'kayan-pg-'));
  fs.mkdirSync(path.join(owned, 'data'));
  fs.writeFileSync(path.join(owned, 'data', cluster.SENTINEL_NAME), cluster.SENTINEL_TEXT + '\n');
  assert.equal(cluster.isOwnedRoot(owned), true);
  await cluster.stopCluster({root: owned, data: path.join(owned, 'data'), bin: '/nonexistent', started: false});
  assert.equal(fs.existsSync(owned), false);

  const foreign = tmp(); // no kayan-pg- prefix, no sentinel
  fs.writeFileSync(path.join(foreign, 'keep'), 'x');
  await cluster.stopCluster({root: foreign, data: path.join(foreign, 'data'), bin: '/nonexistent', started: true, created: true});
  assert.equal(fs.existsSync(path.join(foreign, 'keep')), true);

  const noSentinel = fs.mkdtempSync(path.join(os.tmpdir(), 'kayan-pg-'));
  fs.writeFileSync(path.join(noSentinel, 'keep'), 'x');
  assert.equal(cluster.isOwnedRoot(noSentinel), false);
  await cluster.stopCluster({root: noSentinel, data: path.join(noSentinel, 'data'), bin: '/nonexistent', started: false});
  assert.equal(fs.existsSync(path.join(noSentinel, 'keep')), true, 'a kayan-pg- lookalike without sentinel or creation flag is never removed');
  fs.rmSync(noSentinel, {recursive: true});
  const outside = path.join(os.homedir(), 'kayan-pg-outside');
  fs.mkdirSync(outside, {recursive: true});
  await cluster.stopCluster({root: outside, data: path.join(outside, 'data'), bin: '/nonexistent', started: true, created: true});
  assert.equal(fs.existsSync(outside), true, 'a directory outside the temp dir is never removed');
  fs.rmSync(outside, {recursive: true});
});

test('cluster refuses to start without server binaries and leaves nothing behind', async () => {
  const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('kayan-pg-')).length;
  await assert.rejects(cluster.startCluster({KAYAN_PG_BIN: '/nonexistent', PATH: ''}), /No PostgreSQL server binaries|Temp path/);
  assert.equal(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('kayan-pg-')).length, before);
});
