// Synthetic keys are kept in process memory. No key folders, private files,
// licence state, database or production material are involved.
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const app = fileURLToPath(new URL('../', import.meta.url));
const product = await import(join(repo, 'backend/dist/src/modules/licensing/license-key.js'));
const pair = generateKeyPairSync('ed25519');
const payload = {
  v: 1, keyId: 'key_synthetic-1', type: 'ACTIVATION', licenseId: 'lic_synthetic-1',
  machineId: 'KM-AAAA-BBBB-CCCC', issuedAt: '2026-05-01T00:00:00.000Z',
  term: { kind: 'MONTHS', months: 12 }, seats: { mode: 'INCREASE', value: 5 }, state: null, note: null,
};
const token = product.signPayload(payload, pair.privateKey);
// JWK x contains only the 32-byte public key.
const input = JSON.stringify({ token, publicRaw: pair.publicKey.export({ format: 'jwk' }).x });
const child = spawnSync('dart', ['run', 'tool/cross_memory.dart'], {
  cwd: app, input, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 120000,
});
if (child.error || child.status !== 0) throw new Error('The synthetic Dart verification/signing check failed.');
let output;
try { output = JSON.parse(child.stdout); } catch { throw new Error('The Dart cross-check returned invalid output.'); }
const dartPublic = product.loadPublicKey(output.publicPem);
const verified = product.verifyKey(output.token, dartPublic);
if (verified.payload.licenseId !== 'lic_synthetic-2') throw new Error('The product rejected the synthetic Dart payload.');
let rejected = false;
try { product.verifyKey(output.token, pair.publicKey); } catch { rejected = true; }
if (!rejected) throw new Error('The product accepted the Dart signature using the wrong synthetic public key.');
console.log('Synthetic Node-to-Dart and Dart-to-product signature checks passed in memory.');
