// Verify an independent release attestation. No private key is accepted here.
// The authority public key is intentionally not present until independently
// approved and committed under protected-branch review.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_CHECKS = Object.freeze({
  windows: Object.freeze([
    'approved-licence-public-key', 'licence-signature-compatibility',
    'isolated-clean-install', 'isolated-active-licence-upgrade',
    'final-installer-inspected', 'no-private-material-inspected',
  ]),
  android: Object.freeze([
    'approved-licence-key-policy', 'licence-signature-compatibility',
    'approved-app-signing-certificate', 'debug-signing-rejected',
    'final-apk-inspected', 'no-private-material-inspected',
  ]),
});

function decodePart(value, limit) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > limit) {
    throw new Error('Invalid evidence encoding.');
  }
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) throw new Error('Non-canonical evidence encoding.');
  return bytes;
}

// The payload is signed as exact bytes, not reparsed or reserialized for
// verification. Expected identity comes from the running workflow, not evidence.
export function verifyEvidence(envelope, publicKey, expected, now = Date.now()) {
  if (!publicKey || publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('The approved evidence authority must be an Ed25519 public key.');
  }
  if (!expected || !Object.hasOwn(REQUIRED_CHECKS, expected.platform) ||
      !/^[0-9a-f]{64}$/.test(expected.sha256 || '') ||
      !/^[0-9a-f]{40}$/.test(expected.commit || '') ||
      !/^[1-9][0-9]*$/.test(expected.runId || '') ||
      !/^[1-9][0-9]*$/.test(expected.runAttempt || '')) {
    throw new Error('Missing or invalid expected release identity.');
  }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('Invalid evidence envelope.');
  const payload = decodePart(envelope.payload, 16000);
  const signature = decodePart(envelope.signature, 100);
  if (signature.length !== 64 || !verify(null, payload, publicKey, signature)) {
    throw new Error('Release evidence signature is invalid.');
  }
  let data;
  try { data = JSON.parse(payload.toString('utf8')); } catch { throw new Error('Release evidence payload is invalid.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1 ||
      data.platform !== expected.platform || data.artifactSha256 !== expected.sha256 ||
      data.commit !== expected.commit || data.runId !== expected.runId || data.runAttempt !== expected.runAttempt) {
    throw new Error('Release evidence does not identify this exact artifact, commit, platform and workflow run attempt.');
  }
  const issued = Date.parse(data.issuedAt), expires = Date.parse(data.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > now + 300000 ||
      expires <= now || expires <= issued || expires - issued > 24 * 60 * 60 * 1000) {
    throw new Error('Release evidence is expired or has an invalid validity window.');
  }
  if (!data.checks || typeof data.checks !== 'object' || Array.isArray(data.checks) ||
      REQUIRED_CHECKS[expected.platform].some(name => data.checks[name] !== true)) {
    throw new Error('Release evidence does not attest every required inspection and isolated test.');
  }
  return true;
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function main(args) {
  if (args.length !== 2 || args[0] !== '--artifact') throw new Error('Usage: --artifact <final-package>');
  if (process.env.GITHUB_REPOSITORY !== 'ahmadtefa/ERP_KAYAN' || process.env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Release evidence may only be checked for this repository on main.');
  }
  const authorityPath = fileURLToPath(new URL('../distribution/release/approved-evidence-public.pem', import.meta.url));
  let key;
  try {
    const pem = readFileSync(authorityPath, 'utf8');
    if (!/^\s*-----BEGIN PUBLIC KEY-----\s+[A-Za-z0-9+/=\s]+-----END PUBLIC KEY-----\s*$/.test(pem)) throw new Error();
    key = createPublicKey(pem);
  } catch { throw new Error('Approved release evidence authority public key is missing or invalid.'); }
  let envelope;
  try { envelope = JSON.parse(process.env.KAYAN_WINDOWS_RELEASE_EVIDENCE || ''); }
  catch { throw new Error('Signed release evidence is missing or invalid.'); }
  const expected = {
    platform: 'windows', sha256: await hashFile(args[1]),
    commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  };
  verifyEvidence(envelope, key, expected);
  console.log('Independent evidence verified for the exact Windows artifact and run.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    // Do not echo the envelope, files, keys, or other environment values.
    console.error(`Release gate refused: ${error.message}`);
    process.exitCode = 1;
  });
}
