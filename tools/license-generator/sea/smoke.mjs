#!/usr/bin/env node
/**
 * Smoke test for the packaged key generator.
 *
 * It runs against the binary itself - not the source - and checks the two
 * things that only a packaged build can get wrong:
 *
 *   1. the executable starts on a machine with nothing installed, and every
 *      command the operator needs works from it;
 *   2. the signed key it prints is accepted by the *product's* verification
 *      code (backend/dist), not by a copy of the format kept beside the test.
 *
 * The signing key used here is generated into a temporary folder on the spot.
 * It is a test key: it never leaves the machine and is deleted at the end,
 * so no production credential is involved.
 *
 *   node smoke.mjs --exe dist/KAYAN-Key-Generator.exe
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const BACKEND_KEY = join(ROOT, 'backend', 'dist', 'src', 'modules', 'licensing', 'license-key.js');

const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : fallback;
};

const exe = resolve(arg('exe', join(HERE, '..', 'dist', process.platform === 'win32'
  ? 'KAYAN-Key-Generator.exe'
  : 'kayan-key-generator')));

let failures = 0;
let passes = 0;

function ok(name, detail = '') {
  passes += 1;
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}

function bad(name, detail) {
  failures += 1;
  console.log(`FAIL  ${name} — ${detail}`);
}

async function check(name, body) {
  try {
    const detail = await body();
    ok(name, detail ?? '');
  } catch (error) {
    bad(name, error?.message ?? String(error));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(exe, args, { windowsHide: true, ...options });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => resolveRun({ code, stdout, stderr }));
  });
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function startWindow(home, port) {
  const child = spawn(exe, ['gui', '--no-browser', '--port', String(port), '--home', home], {
    windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });

  const deadline = Date.now() + 30_000;
  let url = null;
  while (Date.now() < deadline) {
    const match = /KAYAN-GUI-URL=(\S+)/.exec(output);
    if (match) {
      url = match[1];
      break;
    }
    if (child.exitCode !== null) break;
    await new Promise((done) => setTimeout(done, 200));
  }
  return { child, url, output: () => output };
}

async function main() {
  console.log(`Key generator smoke test\n  executable: ${exe}\n`);

  if (!existsSync(exe)) {
    console.error(`The executable does not exist: ${exe}`);
    process.exit(2);
  }

  const home = mkdtempSync(join(tmpdir(), 'kayan-keygen-smoke-'));
  const cleanup = [home];
  let keyText = null;
  let licenceId = null;

  try {
    await check('the executable starts and reports its version', async () => {
      const { code, stdout } = await run(['version']);
      assert(code === 0, `exit code ${code}`);
      const version = /kayan-license ([\d.]+) \(node ([^,]+), (\w+)\)/.exec(stdout);
      assert(version, `unexpected output: ${stdout.trim()}`);
      return `version ${version[1]}, bundled node ${version[2]}, ${version[3]}, ` +
        `${Math.round(statSync(exe).size / 1048576)} MB`;
    });

    await check('help runs without opening anything', async () => {
      const { code, stdout } = await run(['--help']);
      assert(code === 0, `exit code ${code}`);
      assert(/issue activation/.test(stdout), 'help does not mention issue activation');
      return 'usage printed';
    });

    await check('the executable creates no key material by itself', async () => {
      const entries = readdirSync(dirname(exe));
      const forbidden = entries.filter((name) => /\.pem$|register\.json$|audit\.log$/i.test(name));
      assert(forbidden.length === 0, `the package contains ${forbidden.join(', ')}`);
      return 'no .pem, register or audit file beside the executable';
    });

    await check('a test operator can initialise a key folder', async () => {
      const { code, stdout } = await run(['init', '--home', home]);
      assert(code === 0, `exit code ${code}: ${stdout}`);
      assert(existsSync(join(home, 'private-key.pem')), 'no private key written');
      const pem = readFileSync(join(home, 'private-key.pem'), 'utf8');
      assert(pem.includes('PRIVATE KEY'), 'the test key file is not a PEM private key');
      return 'key pair created in a temporary folder';
    });

    await check('a licence can be registered and a key issued from the executable', async () => {
      const created = await run([
        'licence', 'create', '--ref', 'smoke test', '--seats', '3', '--term', '6m', '--home', home,
      ]);
      assert(created.code === 0, `licence create: ${created.stdout}${created.stderr}`);
      licenceId = /lic_[0-9a-f]{16}/.exec(created.stdout)?.[0];
      assert(licenceId, 'no licence id in the output');

      const issued = await run([
        'issue', 'activation', '--licence', licenceId,
        '--machine', 'KM-SMOKE-1111-2222-3333', '--term', '6m', '--seats', '3', '--home', home,
      ]);
      assert(issued.code === 0, `issue: ${issued.stdout}${issued.stderr}`);
      keyText = /KYN1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.exec(issued.stdout)?.[0];
      assert(keyText, 'no key in the output');
      return `licence ${licenceId}, key ${keyText.length} characters`;
    });

    await check('the product accepts the key the packaged generator signed', async () => {
      assert(existsSync(BACKEND_KEY), `the product build is missing: ${BACKEND_KEY}`);
      const product = await import(pathToFileURL(BACKEND_KEY).href);
      const pem = readFileSync(join(home, 'public-key.pem'), 'utf8');
      const publicKey = product.loadPublicKey(pem);
      const parsed = product.verifyKey(keyText, publicKey);
      assert(parsed.payload.type === 'ACTIVATION', 'the product read a different key type');
      assert(parsed.payload.machineId === 'KM-SMOKE-1111-2222-3333', 'machine id differs');
      assert(parsed.payload.seats.mode === 'CAP' && parsed.payload.seats.value === 3, 'seats differ');
      assert(parsed.payload.term.months === 6, 'term differs');
      return `verified by backend/dist (type ${parsed.payload.type}, seats ${parsed.payload.seats.value})`;
    });

    await check('the product refuses the same key after one character changes', async () => {
      const product = await import(pathToFileURL(BACKEND_KEY).href);
      const publicKey = product.loadPublicKey(readFileSync(join(home, 'public-key.pem'), 'utf8'));
      const parts = keyText.split('.');
      const last = parts[2].slice(-1) === 'A' ? 'B' : 'A';
      const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -1)}${last}`;
      let refused = false;
      try {
        product.verifyKey(tampered, publicKey);
      } catch (error) {
        refused = /BAD_SIGNATURE|signature/i.test(String(error.message));
      }
      assert(refused, 'the product accepted a key whose signature was altered');
      return 'refused';
    });

    await check('the operator window serves its page and answers only with its token', async () => {
      const port = await freePort();
      const window = await startWindow(home, port);
      cleanup.push(window.child);
      try {
        assert(window.url, `the window did not report an address:\n${window.output()}`);
        const token = window.url.split('#')[1];
        assert(token && token.length > 20, 'the address carries no token');

        const page = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' });
        assert(page.status === 200, `page status ${page.status}`);
        const html = await page.text();
        assert(/مولّد مفاتيح ترخيص كيان|KAYAN/.test(html), 'the page is not the operator window');
        assert(html.includes('/api/issue'), 'the page has no issue action');

        const unauthorised = await fetch(`http://127.0.0.1:${port}/api/state`);
        assert(unauthorised.status === 401, `unauthenticated status ${unauthorised.status}`);

        const state = await fetch(`http://127.0.0.1:${port}/api/state`, {
          headers: { 'x-kayan-token': token },
        });
        assert(state.status === 200, `authenticated status ${state.status}`);
        const body = await state.json();
        assert(body.hasKey === true, 'the window does not see the key folder');
        assert(Array.isArray(body.licences) && body.licences.length >= 1, 'the register is empty');

        const issuedFromWindow = await fetch(`http://127.0.0.1:${port}/api/issue`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-kayan-token': token },
          body: JSON.stringify({
            type: 'SEATS',
            licenceId,
            increase: 2,
          }),
        });
        assert(issuedFromWindow.status === 200, `issue over HTTP ${issuedFromWindow.status}`);
        const issued = await issuedFromWindow.json();
        assert(/^KYN1\./.test(issued.key ?? ''), 'the window returned no key');

        const product = await import(pathToFileURL(BACKEND_KEY).href);
        const publicKey = product.loadPublicKey(readFileSync(join(home, 'public-key.pem'), 'utf8'));
        const parsed = product.verifyKey(issued.key, publicKey);
        assert(parsed.payload.type === 'SEATS' && parsed.payload.seats.value === 2, 'window key differs');

        return `page 200, unauthenticated 401, key issued from the window verified by the product`;
      } finally {
        window.child.kill();
        await new Promise((done) => setTimeout(done, 300));
        if (window.child.exitCode === null) window.child.kill('SIGKILL');
      }
    });

    await check('the audit log records the work without the key or the private key', async () => {
      const audit = readFileSync(join(home, 'audit.log'), 'utf8');
      const lines = audit.trim().split('\n').map((line) => JSON.parse(line));
      assert(lines.length >= 3, `only ${lines.length} audit line(s)`);
      assert(lines.some((line) => line.action === 'issue'), 'no issue entry');
      assert(!audit.includes('PRIVATE KEY'), 'the audit log contains private-key material');
      assert(!audit.includes(keyText), 'the audit log contains the key text');
      assert(!audit.includes('smoke test'), 'the audit log contains the customer note');
      return `${lines.length} entries, no secret and no key text`;
    });

    await check('the package and the key folder hold no production signing key', async () => {
      const binary = readFileSync(exe);
      const pemMarker = Buffer.from('-----BEGIN PRIVATE KEY-----');
      assert(!binary.includes(pemMarker), 'the executable embeds a private key');
      const shipped = readdirSync(dirname(exe));
      assert(!shipped.some((name) => /\.pem$/.test(name)), 'a key file ships beside the executable');
      return 'binary scanned for PEM private-key blocks: none';
    });
  } finally {
    for (const entry of cleanup.reverse()) {
      try {
        if (typeof entry === 'string') rmSync(entry, { recursive: true, force: true });
        else entry.kill?.();
      } catch {
        /* best effort */
      }
    }
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`The smoke test could not run: ${error?.stack ?? error}`);
  process.exit(2);
});
