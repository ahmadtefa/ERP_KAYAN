/**
 * Vectors the Android port must reproduce byte for byte.
 *
 * Everything here is produced by the real Windows generator
 * (tools/license-generator/kayan-license.mjs) with the clock fixed, and every
 * key is then checked with the product's own verifier
 * (backend/src/modules/licensing/license-key.ts). The output is committed at
 * tools/license-generator/android-app/test/goldens/vectors.json.
 */
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root: the folder that holds backend/ and tools/. */
const here = dirname(fileURLToPath(import.meta.url));
const repo = (() => {
  let at = here;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(at, 'backend')) && existsSync(join(at, 'tools'))) return at;
    at = dirname(at);
  }
  throw new Error(`could not find the repository root above ${here}`);
})();

const T0 = Date.UTC(2026, 2, 1, 9, 0, 0, 0);
const RealDate = Date;
let nowMs = T0;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [nowMs])); }
  static now() { return nowMs; }
};
const at = (iso) => { nowMs = RealDate.parse(iso); };
const tick = () => { nowMs += 1000; };

const SEED = Buffer.from('5f3d9c1a7b2e4d6089ab12cdef34567890abcdef1234567890abcdef12345678', 'hex');
const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), SEED]);
const priv = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
const pub = createPublicKey(priv);

const home = mkdtempSync(join(tmpdir(), 'kayan-golden-'));
writeFileSync(join(home, 'private-key.pem'), priv.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
writeFileSync(join(home, 'public-key.pem'), pub.export({ format: 'pem', type: 'spki' }), { mode: 0o644 });
process.argv.push('--home', home);

const gen = await import(join(repo, 'tools/license-generator/kayan-license.mjs'));
const product = await import(join(repo, 'backend/dist/src/modules/licensing/license-key.js'));

const steps = [];
const clockNow = () => new RealDate(nowMs).toISOString();

at('2026-03-01T09:00:01.000Z');
const first = gen.createLicence({ ref: 'شركة النور', seats: 5, term: '1y' });
steps.push({ label: 'licence create', action: 'createLicence', clock: clockNow(), licenseId: first.licence.licenseId,
  input: { ref: 'شركة النور', seats: 5, term: '1y' } });

const issue = (label, input) => {
  tick();
  const before = clockNow();
  const r = gen.issueKey(input);
  steps.push({ label, action: 'issueKey', clock: before, keyId: r.payload.keyId, key: r.key, input });
  return r;
};

const L1 = first.licence.licenseId;
issue('activation', { type: 'ACTIVATION', licenceId: L1, machineId: 'KM-TEST-AAAA-BBBB-CCCC', note: 'INV-2026-001' });
issue('seats increase', { type: 'SEATS', licenceId: L1, increase: 3 });
issue('renewal 6m', { type: 'RENEWAL', licenceId: L1, term: '6m' });
issue('transfer', { type: 'TRANSFER', licenceId: L1, machineId: 'KM-TEST-DDDD-EEEE-FFFF', used: 4 });

// Past the expiry: a renewal starts at the moment it is applied.
at('2028-01-15T10:00:00.000Z');
issue('renewal after expiry', { type: 'RENEWAL', licenceId: L1, term: '6m' });
issue('renewal with awkward note', {
  type: 'RENEWAL', licenceId: L1, term: '3m', note: 'سطر أول\nسطر ثانٍ\t"مقتبس"',
});

at('2028-01-15T11:00:00.000Z');
const second = gen.createLicence({ ref: 'Mining Co.', seats: 2, term: 'P' });
steps.push({ label: 'perpetual licence', action: 'createLicence', clock: clockNow(),
  licenseId: second.licence.licenseId, input: { ref: 'Mining Co.', seats: 2, term: 'P' } });
const L2 = second.licence.licenseId;
issue('perpetual activation', { type: 'ACTIVATION', licenceId: L2, machineId: 'KM-PERP-1111-2222-3333' });
issue('perpetual cap 6', { type: 'SEATS', licenceId: L2, cap: 6 });
issue('seats +2', { type: 'SEATS', licenceId: L1, increase: 2 });

// A key the customer applied, and one the operator withdrew.
tick();
const seatKey = steps.find((s) => s.label === 'seats +2');
gen.markUsed(seatKey.keyId);
steps.push({ label: 'mark used', action: 'markUsed', clock: clockNow(), keyId: seatKey.keyId });
tick();
gen.revokeKey(steps.find((s) => s.label === 'renewal 6m').keyId, 'wrong machine sent');
steps.push({ label: 'revoke', action: 'revokeKey', clock: clockNow(),
  keyId: steps.find((s) => s.label === 'renewal 6m').keyId, reason: 'wrong machine sent' });
tick();
gen.guiApi; // no-op: the window talks to the same functions
const setBefore = clockNow();
const api = gen.guiApi();
api.verifyKey(steps.find((s) => s.label === 'activation').key);
steps.push({ label: 'verify', action: 'verifyKey', clock: setBefore,
  keyId: steps.find((s) => s.label === 'activation').keyId, key: steps.find((s) => s.label === 'activation').key });

// Dates that have to clamp at month end.
const addMonths = (iso, months) => gen.addMonths(new RealDate(iso), months).toISOString();
const monthCases = [
  ['2024-01-31T10:00:00.000Z', 1, addMonths('2024-01-31T10:00:00.000Z', 1)],
  ['2023-01-31T10:00:00.000Z', 1, addMonths('2023-01-31T10:00:00.000Z', 1)],
  ['2026-08-31T10:00:00.000Z', 6, addMonths('2026-08-31T10:00:00.000Z', 6)],
  ['2026-12-15T10:00:00.000Z', 1, addMonths('2026-12-15T10:00:00.000Z', 1)],
  ['2026-03-01T09:00:00.000Z', 36, addMonths('2026-03-01T09:00:00.000Z', 36)],
  ['2025-02-28T23:59:59.000Z', 12, addMonths('2025-02-28T23:59:59.000Z', 12)],
  ['2028-02-29T00:00:00.000Z', 12, addMonths('2028-02-29T00:00:00.000Z', 12)],
];

const terms = ['1m', '3m', '6m', '1y', '2y', '3y', 'P', 'perpetual', 'دائم', '12m', '18y', '2 months']
  .map((text) => {
    const term = gen.parseTerm(text);
    return { text, term };
  });

const request = product.buildRequestCode({
  v: 1, machineId: 'KM-REQ1-AAAA-BBBB-CCCC', installId: 'inst-9f2c',
  appVersion: '0.2.0', requestedAt: '2026-02-28T18:30:00.000Z', nonce: 'n-77aa',
});

const registerText = readFileSync(join(home, 'register.json'), 'utf8');
const registerMac = readFileSync(join(home, 'register.mac'), 'utf8').trim();
const auditText = readFileSync(join(home, 'audit.log'), 'utf8');
const publicPem = readFileSync(join(home, 'public-key.pem'), 'utf8');
const register = JSON.parse(registerText);

const golden = {
  note: 'Produced by tools/license-generator/kayan-license.mjs with a frozen clock. Do not edit by hand: regenerate with tool/make_goldens.mjs.',
  keyPair: {
    seedHex: SEED.toString('hex'),
    privateKeyPem: priv.export({ format: 'pem', type: 'pkcs8' }),
    publicKeyPem: publicPem,
    spkiBase64url: pub.export({ format: 'der', type: 'spki' }).toString('base64url'),
    spkiHex: pub.export({ format: 'der', type: 'spki' }).toString('hex'),
    fingerprint: gen.folderSnapshot().fingerprint,
    toolVersion: gen.VERSION,
  },
  steps,
  terms,
  monthCases,
  requestCode: request,
  registerText,
  registerMac,
  auditText,
  licences: register.licences,
  keys: register.keys,
};

const target = join(here, '..', 'test', 'goldens', 'vectors.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(golden, null, 2)}\n`);

console.log(`steps ${steps.length}, keys ${register.keys.length}, register ${registerText.length} bytes, audit ${auditText.trim().split('\n').length} lines`);
console.log('fingerprint', golden.keyPair.fingerprint, 'mac', registerMac);
let bad = 0;
for (const step of steps.filter((s) => s.key)) {
  const parsed = product.verifyKey(step.key, pub);
  if (!parsed?.payload) { bad += 1; console.error('REJECTED', step.label); }
}
console.log(bad === 0 ? 'the product accepts every key in this file' : `${bad} keys were rejected`);
process.exitCode = bad === 0 ? 0 : 1;
