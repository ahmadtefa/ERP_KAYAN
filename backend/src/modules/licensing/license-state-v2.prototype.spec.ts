import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { LicenseStore } from './license-store';
import {
  Marker, MarkerStore, MigrationError, Step, migrate, resolveAuthority,
} from './license-state-v2.prototype';

const SECRET = 'prototype-secret-for-tests-only-0123456789';
const secretBuf = createHash('sha256').update(SECRET).digest();
let dir: string;
let m: Marker;
const marker: MarkerStore = {
  read: () => ({ ...m }),
  setSchemaReady: () => { m.schemaReady = true; },
  commit: (digest, sequence) => { m = { committed: true, digest, sequence, schemaReady: true }; },
};
let schemaRuns = 0;
const run = (hook?: (s: Step) => void, lockHeld = true) =>
  migrate({ dir, secret: secretBuf, marker, companyId: 'company-1', schemaStep: () => { schemaRuns++; }, hook, lockHeld });
const crashAt = (at: Step) => () => run((s) => { if (s === at) throw new Error(`crash ${at}`); });

function seedV1() {
  const s = new LicenseStore(dir, { secret: SECRET });
  s.update((x) => {
    x.licenseId = 'lic-1'; x.maxSeatLimit = 5; x.maxSeatsUsed = 3;
    x.appliedKeys = ['k1', 'k2']; x.licenseExpiresAt = '2027-01-01T00:00:00.000Z';
  });
}
const files = () => readdirSync(dir).sort();

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kayan-mig-')); m = { committed: false, digest: null, sequence: null, schemaReady: false }; schemaRuns = 0; seedV1(); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('v1 to v2 protected-state migration prototype', () => {
  it('migrates, preserves identity, keys and watermarks, and keeps the v1 backup byte for byte', () => {
    const before = readFileSync(join(dir, 'license-state.json'));
    run();
    expect(readFileSync(join(dir, 'license-state.json.v1.bak')).equals(before)).toBe(true);
    expect(resolveAuthority(dir, secretBuf, marker)).toBe('V2');
    const v2 = JSON.parse(readFileSync(join(dir, 'license-state.json'), 'utf8')).state;
    expect(v2.legacyLicenseId).toBe('lic-1');
    expect(v2.licenses['lic-1'].appliedKeys).toEqual(['k1', 'k2']);
    expect(v2.licenses['lic-1'].maxSeatLimit).toBe(5);
  });

  it.each<Step>(['AFTER_BACKUP', 'AFTER_SCHEMA', 'AFTER_TEMP_WRITE', 'AFTER_RENAME', 'AFTER_MARKER'])(
    'a crash %s is recovered by re-running, with no watermark lost and one backup',
    (at) => {
      expect(crashAt(at)).toThrow(/crash/);
      run();                                       // restart completes it
      expect(resolveAuthority(dir, secretBuf, marker)).toBe('V2');
      const v2 = JSON.parse(readFileSync(join(dir, 'license-state.json'), 'utf8')).state;
      expect(v2.licenses['lic-1'].appliedKeys).toEqual(['k1', 'k2']);
      expect(v2.licenses['lic-1'].maxSeatsUsed).toBe(3);
      expect(files().filter((f) => f.endsWith('.v1.bak'))).toEqual(['license-state.json.v1.bak']);
    },
  );

  it('refuses to run without the lock (application not stopped)', () => {
    expect(() => run(undefined, false)).toThrow(MigrationError);
    expect(existsSync(join(dir, 'license-state.json.v1.bak'))).toBe(false);
  });

  it('a v1 edit after the backup (concurrent old process) stops the migration', () => {
    expect(crashAt('AFTER_BACKUP')).toThrow();
    new LicenseStore(dir, { secret: SECRET }).update((x) => { x.maxSeatsUsed = 4; });
    expect(() => run()).toThrow(/changed after backup/);
  });

  it('once committed, restoring the v1 file does not fall back to v1', () => {
    run();
    writeFileSync(join(dir, 'license-state.json'), readFileSync(join(dir, 'license-state.json.v1.bak')));
    expect(() => resolveAuthority(dir, secretBuf, marker)).toThrow(/no fallback/);
  });

  it('a missing or altered v2 state, or a wrong key, is damaged and nothing is regenerated', () => {
    run();
    const path = join(dir, 'license-state.json');
    const good = readFileSync(path);
    rmSync(path);
    expect(() => resolveAuthority(dir, secretBuf, marker)).toThrow(/missing/);
    expect(existsSync(path)).toBe(false);
    writeFileSync(path, good);
    const wrong = createHash('sha256').update('other').digest();
    expect(() => resolveAuthority(dir, wrong, marker)).toThrow(/integrity/);
    writeFileSync(path, good.toString().replace('"maxSeatLimit": 5', '"maxSeatLimit": 1'));
    expect(() => resolveAuthority(dir, secretBuf, marker)).toThrow(MigrationError);
  });

  it('a v2 state whose applied keys differ from the v1 backup is refused at recovery', () => {
    expect(crashAt('AFTER_RENAME')).toThrow();
    const path = join(dir, 'license-state.json');
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    doc.state.licenses['lic-1'].appliedKeys = ['k2', 'k1'];
    const { createHmac } = require('node:crypto');
    doc.mac = createHmac('sha256', secretBuf).update(JSON.stringify(doc.state, Object.keys(doc.state).sort())).digest('hex');
    writeFileSync(path, JSON.stringify(doc));
    expect(() => run()).toThrow(/applied keys/);
    expect(m.committed).toBe(false);
  });

  it('the real current store code refuses the v2 file and writes nothing (old-code refusal)', () => {
    run();
    const path = join(dir, 'license-state.json');
    const before = readFileSync(path);
    expect(() => new LicenseStore(dir, { secret: SECRET })).toThrow(/format 2/);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
