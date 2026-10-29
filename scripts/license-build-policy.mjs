// Build-time policy only. It never reads a private key or changes licence data.
import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRODUCTION_FINGERPRINT = 'F932-38B0-CDC0-A81D-345F-160C-F8DC-DBB7';
export const BUILD_MODES = Object.freeze(['product', 'test-signed', 'evaluation']);

export function fingerprint(publicKey) {
  const digest = createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex').slice(0, 32).toUpperCase();
  return digest.match(/.{4}/g).join('-');
}

// expectedFingerprint is injectable for isolated synthetic-key tests. The CLI
// always uses the fixed production reference above; it accepts no override.
export function validatePem(pem, mode, expectedFingerprint = PRODUCTION_FINGERPRINT) {
  if (!BUILD_MODES.includes(mode)) throw new Error('Unknown licence build mode.');
  if (mode === 'evaluation') {
    if (pem != null) throw new Error('Evaluation builds must not contain a licence key.');
    return null;
  }
  if (typeof pem !== 'string' || !pem.trim()) {
    throw new Error(`${mode} build requires a licence public key.`);
  }
  // Reject private material before asking OpenSSL to parse anything. Never echo
  // the supplied file, including on a parse error.
  if (!/^\s*-----BEGIN PUBLIC KEY-----\s+[A-Za-z0-9+/=\s]+-----END PUBLIC KEY-----\s*$/.test(pem)) {
    throw new Error('Expected one public-key PEM; private keys are forbidden.');
  }
  let key;
  try {
    key = createPublicKey(pem);
  } catch {
    throw new Error('The licence public key is malformed.');
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('The licence public key must be Ed25519.');
  const actual = fingerprint(key);
  if (mode === 'product' && actual !== expectedFingerprint) {
    throw new Error('The licence public key does not match the approved production fingerprint.');
  }
  if (mode === 'test-signed' && actual === expectedFingerprint) {
    throw new Error('Test-signed builds must not use the production public key.');
  }
  return actual;
}

export function validateFile(mode, path) {
  if (!BUILD_MODES.includes(mode)) throw new Error('Unknown licence build mode.');
  if (mode === 'evaluation') return validatePem(path ? '' : null, mode);
  if (!path) throw new Error(`${mode} build requires a licence public key file.`);
  let pem;
  try {
    pem = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`${mode} licence public key file is missing or unreadable.`);
  }
  return validatePem(pem, mode);
}

function main(args) {
  if (args.length !== 2 && args.length !== 4) throw new Error('Usage: --mode <product|test-signed|evaluation> [--public-key <path>]');
  if (args[0] !== '--mode' || (args.length === 4 && args[2] !== '--public-key')) {
    throw new Error('Invalid licence build policy arguments.');
  }
  const mode = args[1];
  const result = validateFile(mode, args.length === 4 ? args[3] : undefined);
  console.log(result ? `Licence build policy passed (${mode}); public fingerprint ${result}.` : `Licence build policy passed (${mode}; no public key).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`Licence build policy refused: ${error.message}`);
    process.exitCode = 1;
  }
}
