#!/usr/bin/env node
/**
 * Smoke-test the packaged Windows operator and its bundled CLI service.
 * Uses a disposable home directory; never opens the operator's real key store.
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

const args = process.argv.slice(2);
function arg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const exeArg = arg('--exe');
const logArg = arg('--log');
if (!exeArg || !logArg) {
  console.error('Usage: node smoke.mjs --exe <KAYAN-Key-Generator.exe> --log <file>');
  process.exit(2);
}
const exe = resolve(exeArg);
const logPath = resolve(logArg);
const lines = [];
let failed = false;
function record(message, isFailure = false) {
  lines.push(message);
  console.log(message);
  failed ||= isFailure;
}
function writeLog() {
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(logPath, lines.join('\n') + '\n', 'utf8');
}

if (!existsSync(exe) || !statSync(exe).isFile()) {
  record(`FAIL packaged operator executable is missing: ${exe}`, true);
  writeLog();
  process.exit(1);
}
const server = join(dirname(exe), 'KAYAN-Key-Generator-Server.exe');
if (!existsSync(server) || !statSync(server).isFile()) {
  record(`FAIL bundled local service is missing: ${server}`, true);
  writeLog();
  process.exit(1);
}
record(`PASS operator executable exists: ${basename(exe)}`);
record('PASS bundled local service exists');

const version = spawnSync(server, ['version'], {
  encoding: 'utf8',
  timeout: 15000,
  windowsHide: true,
});
const versionOutput = `${version.stdout ?? ''}\n${version.stderr ?? ''}`.trim();
if (version.error || version.status !== 0 || !/^kayan-license \d/m.test(versionOutput)) {
  record(`FAIL bundled local service version check (status=${version.status}): ${versionOutput}`, true);
} else {
  record(`PASS bundled local service responds: ${versionOutput.split(/\r?\n/)[0]}`);
}

const home = mkdtempSync(join(tmpdir(), 'kayan-generator-smoke-'));
let child;
try {
  if (!failed) {
    child = spawn(exe, [], {
      env: { ...process.env, KAYAN_LICENSE_HOME: home },
      stdio: 'ignore',
      windowsHide: true,
    });
    const outcome = await new Promise((resolveOutcome) => {
      let settled = false;
      let timer;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolveOutcome(value);
      };
      child.once('error', (error) => settle({ kind: 'error', error }));
      child.once('exit', (code, signal) => settle({ kind: 'exit', code, signal }));
      timer = setTimeout(() => settle({ kind: 'alive' }), 5000);
    });
    if (outcome.kind === 'error') {
      record(`FAIL operator window failed to launch: ${outcome.error.message}`, true);
    } else if (outcome.kind !== 'alive') {
      record(`FAIL operator window exited during startup (code=${outcome.code}, signal=${outcome.signal})`, true);
    } else {
      record('PASS native operator window started and remained alive for 5 seconds');
    }
  }
} catch (error) {
  record(`FAIL smoke test threw: ${error.message}`, true);
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
    record('FAIL smoke test unexpectedly created signing-key material', true);
  } else {
    record(`PASS disposable operator home contains no private signing key${created.length ? ` (state files: ${created.join(', ')})` : ''}`);
  }
  rmSync(home, { recursive: true, force: true });
}
record(failed ? 'smoke test failed' : '5 passed, 0 failed', failed);
writeLog();
process.exit(failed ? 1 : 0);
