#!/usr/bin/env node
/**
 * Smoke-test the packaged Windows operator and its bundled CLI service.
 *
 * This deliberately uses a disposable home directory: it must never read,
 * replace, or create the operator's real signing key/register.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
function arg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
const exe = resolve(arg('--exe') ?? '');
const logPath = resolve(arg('--log') ?? 'SMOKE-TEST.txt');
const lines = [];
function record(message) {
  lines.push(message);
  console.log(message);
}
function fail(message) {
  record(`FAIL ${message}`);
  finish(1);
}
function finish(code) {
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(logPath, lines.join('\n') + '\n', 'utf8');
  process.exit(code);
}
if (!arg('--exe') || !arg('--log')) {
  console.error('Usage: node smoke.mjs --exe <KAYAN-Key-Generator.exe> --log <file>');
  process.exit(2);
}
if (!existsSync(exe) || !statSync(exe).isFile()) {
  record(`FAIL packaged operator executable is missing: ${exe}`);
  finish(1);
}
const server = join(dirname(exe), 'KAYAN-Key-Generator-Server.exe');
if (!existsSync(server) || !statSync(server).isFile()) {
  record(`FAIL bundled local service is missing: ${server}`);
  finish(1);
}
record(`PASS operator executable exists: ${basename(exe)}`);
record('PASS bundled local service exists');

const version = spawnSync(server, ['version'], {
  encoding: 'utf8',
  timeout: 15000,
  windowsHide: true,
});
const versionOutput = `${version.stdout ?? ''}\n${version.stderr ?? ''}`.trim();
if (version.error || version.status !== 0 || !/^kayan-license \\d/m.test(versionOutput)) {
  record(`FAIL bundled local service version check (status=${version.status}): ${versionOutput}`);
  finish(1);
}
record(`PASS bundled local service responds: ${versionOutput.split(/\r?\n/)[0]}`);

const home = mkdtempSync(join(tmpdir(), 'kayan-generator-smoke-'));
let child;
try {
  const env = { ...process.env, KAYAN_LICENSE_HOME: home };
  child = spawn(exe, [], { env, stdio: 'ignore', windowsHide: true });
  const outcome = await new Promise((resolveOutcome) => {
    let settled = false;
    const settle = (value) => {
      if (!settled) {
        settled = true;
        resolveOutcome(value);
      }
    };
    child.once('error', (error) => settle({ kind: 'error', error }));
    child.once('exit', (code, signal) => settle({ kind: 'exit', code, signal }));
    setTimeout(() => settle({ kind: 'alive' }), 5000);
  });
  if (outcome.kind === 'error') {
    record(`FAIL operator window failed to launch: ${outcome.error.message}`);
    finish(1);
  }
  if (outcome.kind !== 'alive') {
    record(`FAIL operator window exited during startup (code=${outcome.code}, signal=${outcome.signal})`);
    finish(1);
  }
  record('PASS native operator window started and remained alive for 5 seconds');
} finally {
  if (child?.pid) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
  }
  const keyFiles = ['private-key.pem', 'public-key.pem', 'register.json', 'register.mac'];
  const created = keyFiles.filter((name) => existsSync(join(home, name)));
  if (created.includes('private-key.pem')) {
    record('FAIL smoke test unexpectedly created signing-key material');
    rmSync(home, { recursive: true, force: true });
    finish(1);
  }
  record(`PASS disposable operator home contains no private signing key${created.length ? ` (created state files: ${created.join(', ')})` : ''}`);
  rmSync(home, { recursive: true, force: true });
}
record('5 passed, 0 failed');
finish(0);
