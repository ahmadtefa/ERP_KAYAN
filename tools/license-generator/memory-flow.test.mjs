import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { generateKeyPairSync, verify } from 'node:crypto';

// Source-only test. The virtual home is backed exclusively by a Map; no
// private key is written to disk, logged, used for production, or packaged.
// This does not establish that the Windows generator executable works.
const home = path.resolve('kayan-virtual-test-home-do-not-create');
const oldHome = process.env.KAYAN_LICENSE_HOME;
const names = ['existsSync', 'readFileSync', 'writeFileSync', 'appendFileSync', 'mkdirSync', 'chmodSync'];
const original = Object.fromEntries(names.map(name => [name, fs[name]]));
if (original.existsSync(home)) throw new Error('Virtual test home must not exist');
const files = new Map();
const isVirtual = p => typeof p === 'string' && (p === home || p.startsWith(home + path.sep));
const pair = generateKeyPairSync('ed25519');
files.set(path.join(home, 'private-key.pem'), pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
files.set(path.join(home, 'public-key.pem'), pair.publicKey.export({ type: 'spki', format: 'pem' }));
fs.existsSync = p => isVirtual(p) ? p === home || files.has(p) : original.existsSync(p);
fs.readFileSync = (p, options) => {
  if (!isVirtual(p)) return original.readFileSync(p, options);
  if (!files.has(p)) throw Object.assign(new Error('Virtual file not found'), { code: 'ENOENT' });
  const value = files.get(p);
  return typeof options === 'string' || options?.encoding ? String(value) : Buffer.from(value);
};
fs.writeFileSync = (p, data, options) => {
  if (!isVirtual(p)) return original.writeFileSync(p, data, options);
  files.set(p, Buffer.isBuffer(data) ? Buffer.from(data) : String(data));
};
fs.appendFileSync = (p, data, options) => {
  if (!isVirtual(p)) return original.appendFileSync(p, data, options);
  files.set(p, String(files.get(p) ?? '') + String(data));
};
fs.mkdirSync = (p, options) => isVirtual(p) ? undefined : original.mkdirSync(p, options);
fs.chmodSync = (p, mode) => isVirtual(p) ? undefined : original.chmodSync(p, mode);
process.env.KAYAN_LICENSE_HOME = home;
syncBuiltinESMExports();
const generator = await import('./kayan-license.mjs');
after(() => {
  files.clear();
  Object.assign(fs, original);
  if (oldHome === undefined) delete process.env.KAYAN_LICENSE_HOME;
  else process.env.KAYAN_LICENSE_HOME = oldHome;
  syncBuiltinESMExports();
});

test('register, select ID, issue and verify using an in-memory synthetic Ed25519 key', () => {
  const api = generator.guiApi();
  assert.throws(() => api.issueKey({ type: 'activation', licenceId: '', machineId: 'KM-SYNTHETIC-DEVICE' }), /no licence/i);
  const { licence } = api.createLicence({ ref: 'synthetic', seats: 3, term: '1y' });
  assert.match(licence.licenseId, /^lic_[0-9a-f]{16}$/);
  assert.equal(api.state().licences.some(entry => entry.licenseId === licence.licenseId), true);
  const result = api.issueKey({ type: 'activation', licenceId: licence.licenseId, machineId: 'KM-SYNTHETIC-DEVICE' });
  const checked = api.verifyKey(result.key);
  assert.equal(checked.valid, true);
  assert.equal(checked.payload.licenseId, licence.licenseId);
  assert.equal(checked.payload.machineId, 'KM-SYNTHETIC-DEVICE');
  assert.equal(checked.payload.seats.value, 3);
  const [prefix, encoded, signature] = result.key.split('.');
  assert.equal(verify(null, Buffer.from(`${prefix}.${encoded}`), pair.publicKey, Buffer.from(signature, 'base64url')), true);
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  payload.machineId = 'KM-OTHER-SYNTHETIC';
  const changed = `${prefix}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`;
  assert.equal(api.verifyKey(changed).valid, false);
});
