#!/usr/bin/env node
/**
 * Verifies what the Android app produced with the two things that matter:
 *
 *  1. the product's own verifier (`backend/src/modules/licensing/license-key.ts`),
 *     the same code path a customer's installation uses;
 *  2. the Windows generator (`kayan-license.mjs`): it must open the key folder
 *     the app created, list its register, and issue a further key into it.
 *
 * Usage: node tool/verify_with_product.mjs <outdir>
 *
 * Exits non-zero on the first disagreement, and prints one PASS line per
 * check so the CI log says what was proven.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const outdir = resolve(process.argv[2] ?? '.');
const here = dirname(fileURLToPath(import.meta.url));
const repo = (() => {
  let at = here;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(at, 'backend')) && existsSync(join(at, 'tools'))) return at;
    at = dirname(at);
  }
  throw new Error(`could not find the repository root above ${here}`);
})();
const summary = JSON.parse(readFileSync(join(outdir, 'dart-keys.json'), 'utf8'));

let failures = 0;
const ok = (name, detail = '') => console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
const bad = (name, detail) => {
  failures += 1;
  console.error(`FAIL  ${name} — ${detail}`);
};

const product = await import(
  join(repo, 'backend', 'dist', 'src', 'modules', 'licensing', 'license-key.js')
);

// 1. the product's verifier accepts every key the app made
const publicKey = product.loadPublicKey(summary.publicKeyPem);
const byLabel = new Map();
for (const entry of summary.keys) byLabel.set(entry.label, entry);
for (const entry of summary.keys) {
  try {
    const parsed = product.verifyKey(entry.key, publicKey);
    if (parsed.payload.type !== entry.type) {
      bad(`the product reads ${entry.label}`, `type came back as ${parsed.payload.type}`);
    } else {
      ok(`the product accepts ${entry.label}`, `${parsed.payload.type}, key ${parsed.payload.keyId}`);
    }
  } catch (error) {
    bad(`the product accepts ${entry.label}`, error.message);
  }
}

// 2. the fingerprint the app shows is the one the product computes
const fingerprint = product.publicKeyFingerprint(publicKey);
if (fingerprint === summary.fingerprint) {
  ok('the app shows the same fingerprint as the product', fingerprint);
} else {
  bad('the app shows the same fingerprint as the product', `${summary.fingerprint} vs ${fingerprint}`);
}

// 3. the Windows generator opens the folder the app wrote
const cli = join(repo, 'tools', 'license-generator', 'kayan-license.mjs');
const run = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

const listed = run(['list', '--home', summary.folder]);
if (listed.status === 0 && listed.stdout.includes(summary.licenceId)) {
  ok('the Windows tool opens the register the app wrote', `licence ${summary.licenceId} found`);
} else {
  bad(
    'the Windows tool opens the register the app wrote',
    `exit ${listed.status}: ${(listed.stderr || listed.stdout).trim().split('\n').slice(-3).join(' ')}`,
  );
}

// 4. it can issue into that register: the checksum it recomputes is accepted
const renewal = run([
  'issue', 'renewal', '--licence', summary.licenceId, '--term', '3m', '--home', summary.folder,
]);
const nodeKey = /(KYN1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/.exec(renewal.stdout)?.[1];
if (renewal.status === 0 && nodeKey) {
  ok('the Windows tool issues a further key into the app folder', `key ${nodeKey.length} chars`);
} else {
  bad(
    'the Windows tool issues a further key into the app folder',
    `exit ${renewal.status}: ${(renewal.stderr || renewal.stdout).trim().split('\n').slice(-3).join(' ')}`,
  );
}

// 5. and the product accepts that Windows-made key too
if (nodeKey) {
  try {
    product.verifyKey(nodeKey, publicKey);
    ok('the product accepts the key the Windows tool added to the app folder');
  } catch (error) {
    bad('the product accepts the key the Windows tool added to the app folder', error.message);
  }
  // hand it back for the Dart side to check in the other direction
  writeFileSync(join(outdir, 'node-key.txt'), nodeKey);
}

// 6. nothing secret travelled in the summary the CI prints
const summaryText = readFileSync(join(outdir, 'dart-keys.json'), 'utf8');
if (/PRIVATE KEY/.test(summaryText)) {
  bad('the report carries no private key', 'a PEM private key was found in dart-keys.json');
} else {
  ok('the report carries no private key');
}

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}`);
process.exitCode = failures === 0 ? 0 : 1;
