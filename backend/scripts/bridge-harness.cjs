'use strict';
// Shared harness for the nine Flutter HTTP bridge parents. Test-only: it runs a
// Flutter widget test against a loopback server the parent started, and records
// evidence files. It never talks to a database and never reads secrets.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFile, execFileSync} = require('node:child_process');

const BRIDGE_IDS = ['receipt','transfer','purchase','sales','stockdoc','count','opening','stockdoc-lot','stockdoc-split'];
const LEGACY_FLUTTER = '/tmp/flutter/bin/flutter';

function isExecutable(file, fsApi = fs) {
  try { fsApi.accessSync(file, fsApi.constants.X_OK); return fsApi.statSync(file).isFile(); } catch { return false; }
}

/// FLUTTER_BIN when set (and it must work), else `flutter` on PATH, else the
/// old /tmp location. Fails loudly naming what was tried, never silently skips.
function resolveFlutterBin(env = process.env, fsApi = fs) {
  const tried = [];
  if (env.FLUTTER_BIN) {
    if (isExecutable(env.FLUTTER_BIN, fsApi)) return env.FLUTTER_BIN;
    throw new Error(`FLUTTER_BIN is set to ${env.FLUTTER_BIN} but it is not an executable file.`);
  }
  const names = process.platform === 'win32' ? ['flutter.bat', 'flutter.exe', 'flutter'] : ['flutter'];
  for (const dir of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      tried.push(candidate);
      if (isExecutable(candidate, fsApi)) return candidate;
    }
  }
  if (isExecutable(LEGACY_FLUTTER, fsApi)) return LEGACY_FLUTTER;
  throw new Error(`Flutter was not found. Set FLUTTER_BIN, or put flutter on PATH, or install it at ${LEGACY_FLUTTER}. Looked on PATH (${tried.length} entries).`);
}

function evidenceDir(env = process.env) {
  const dir = env.KAYAN_BRIDGE_EVIDENCE_DIR;
  if (!dir) return null;
  if (!path.isAbsolute(dir)) throw new Error('KAYAN_BRIDGE_EVIDENCE_DIR must be an absolute path.');
  fs.mkdirSync(dir, {recursive: true});
  return dir;
}

function checkId(id) {
  if (!BRIDGE_IDS.includes(id)) throw new Error(`Unknown bridge id: ${id}`);
  return id;
}

/// Runs `flutter test --reporter json --no-pub <file>`. Evidence (when a dir is
/// configured) is written for success AND failure, then a non-zero exit throws.
async function runFlutterBridge({id, testFile, cwd, timeoutMs = 90000, env = process.env}) {
  checkId(id);
  const bin = resolveFlutterBin(env);
  const args = ['test', '--reporter', 'json', '--no-pub', testFile];
  const result = await new Promise((resolve) => {
    execFile(bin, args, {cwd, env, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024}, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : (error.killed ? 124 : 1)) : 0;
      resolve({code, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), error});
    });
  });
  // Under --reporter json every stdout line must be JSON. Nothing is filtered:
  // the raw stdout is the evidence, and any other line fails the bridge.
  const stray = result.stdout.split(/\r?\n/).filter((line) => {
    if (!line.trim()) return false;
    try { JSON.parse(line); return false; } catch { return true; }
  });
  const code = result.code === 0 && stray.length > 0 ? 65 : result.code;
  const dir = evidenceDir(env);
  if (dir) {
    fs.writeFileSync(path.join(dir, `${id}.flutter.jsonl`), result.stdout);
    fs.writeFileSync(path.join(dir, `${id}.flutter.stderr`), result.stderr + (stray.length ? `\n[bridge helper: ${stray.length} non-JSON stdout line(s); run refused]\n` : ''));
    fs.writeFileSync(path.join(dir, `${id}.flutter.status`), String(code) + '\n');
  }
  if (stray.length > 0 && result.code === 0) {
    console.log(result.stdout, result.stderr);
    throw new Error(`Flutter bridge ${id} printed ${stray.length} non-JSON stdout line(s) under --reporter json; refusing.`);
  }
  if (result.code !== 0) {
    console.log(result.stdout, result.stderr);
    throw new Error(`Flutter bridge ${id} exited with status ${result.code}.`);
  }
  return {stdout: result.stdout, stderr: result.stderr, status: 0};
}

function sourceCommit(env = process.env, cwd = process.cwd()) {
  const fromEnv = env.KAYAN_SOURCE_COMMIT;
  if (fromEnv) {
    if (!/^[a-f0-9]{40}$/.test(fromEnv)) throw new Error('KAYAN_SOURCE_COMMIT must be a 40 hex commit.');
    return fromEnv;
  }
  const out = execFileSync('git', ['rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim();
  if (!/^[a-f0-9]{40}$/.test(out)) throw new Error('Could not determine the source commit.');
  return out;
}

/// Call ONLY after the parent's last SQL assertion has passed, never from a
/// finally block. No-op without an evidence dir.
function writeParentReceipt(id, env = process.env) {
  checkId(id);
  const dir = evidenceDir(env);
  if (!dir) return null;
  const receipt = {bridgeId: id, exitStatus: 0, sqlAssertionsPassed: true, sourceCommit: sourceCommit(env)};
  fs.writeFileSync(path.join(dir, `${id}.parent.json`), JSON.stringify(receipt) + '\n');
  return receipt;
}

module.exports = {BRIDGE_IDS, resolveFlutterBin, runFlutterBridge, writeParentReceipt, sourceCommit, evidenceDir, LEGACY_FLUTTER, os};
