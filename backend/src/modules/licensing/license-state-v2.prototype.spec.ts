import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { LicenseStore } from './license-store';
import {
  Marker, MarkerStore, MigrationError, Step, canonical, consumeFirstAdmin, mac,
  migrate, resolveAuthority, updateV2,
} from './license-state-v2.prototype';

const SECRET = 'prototype-secret-for-tests-only-0123456789';
let secretBuf = createHash('sha256').update(SECRET).digest();
let dir: string;
let m: Marker;
const marker: MarkerStore = {
  read: () => ({ ...m }),
  setSchemaReady: () => { m.schemaReady = true; },
  commit: (genesis, sequence) => { m = { committed: true, schemaReady: true, genesis, sequence }; },
  raiseSequence: (sequence) => { m.sequence = Math.max(m.sequence ?? 0, sequence); },
};
const run = (h?: (s: Step) => void, serviceStopped = true) =>
  migrate({ dir, secret: secretBuf, marker, companyId: 'company-1', schemaStep: () => undefined, hook: h, serviceStopped });
const crashAt = (at: Step) => () => run((s) => { if (s === at) throw new Error(`crash ${at}`); });
const path = () => join(dir, 'license-state.json');
const readDoc = () => JSON.parse(readFileSync(path(), 'utf8'));
const resign = (doc: any) => { doc.mac = mac(secretBuf, doc.state); writeFileSync(path(), JSON.stringify(doc)); };

function seedV1(useKeyFile: boolean) {
  const s = new LicenseStore(dir, useKeyFile ? {} : { secret: SECRET });
  if (useKeyFile) secretBuf = createHash('sha256').update(readFileSync(join(dir, 'state.key'), 'utf8').trim()).digest();
  s.update((x) => {
    x.licenseId = 'lic-1'; x.maxSeatLimit = 5; x.maxSeatsUsed = 3;
    x.appliedKeys = ['k1', 'k2']; x.licenseExpiresAt = '2027-01-01T00:00:00.000Z';
    x.clockState = 'WARNING'; x.enforcement = 'enforce'; x.clockSuspects = ['2026-01-01T00:00:00.000Z'];
  });
}
const ALL: Step[] = ['AFTER_STATE_BACKUP', 'AFTER_KEY_BACKUP', 'AFTER_SCHEMA', 'AFTER_TEMP_WRITE', 'AFTER_RENAME', 'AFTER_MARKER'];

beforeEach(() => {
  secretBuf = createHash('sha256').update(SECRET).digest();
  dir = mkdtempSync(join(tmpdir(), 'kayan-mig-'));
  m = { committed: false, schemaReady: false, genesis: null, sequence: null };
  delete process.env.LICENSE_STATE_SECRET;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('canonical HMAC covers nested data', () => {
  it('canonical() includes nested keys (the replacer-array form would drop them)', () => {
    expect(canonical({ b: { z: 1, a: 2 }, a: [1, { y: 1, x: 2 }] })).toBe('{"a":[1,{"x":2,"y":1}],"b":{"a":2,"z":1}}');
    const bad = JSON.stringify({ b: { z: 1, a: 2 } }, ['b']);
    expect(bad).toBe('{"b":{}}');           // documents the defect main found
  });
  it.each([
    ['companyId', (e: any) => { e.companyId = 'company-2'; }],
    ['companyRef', (e: any) => { e.companyRef = 'x'; }],
    ['maxSeatLimit', (e: any) => { e.maxSeatLimit = 500; }],
    ['licenseExpiresAt', (e: any) => { e.licenseExpiresAt = '2099-01-01T00:00:00.000Z'; }],
    ['appliedKeys', (e: any) => { e.appliedKeys = ['k1']; }],
    ['suspended', (e: any) => { e.suspended = true; }],
    ['perpetual', (e: any) => { e.perpetual = true; }],
  ])('editing nested %s without re-signing is rejected by the HMAC', (_n, edit) => {
    seedV1(false); run();
    const doc = readDoc(); edit(doc.state.licenses['lic-1']);
    writeFileSync(path(), JSON.stringify(doc));
    expect(() => resolveAuthority(dir, secretBuf, marker)).toThrow(/HMAC/);
  });
  it('a new nested licence entry added without re-signing is rejected too', () => {
    seedV1(false); run();
    const doc = readDoc(); doc.state.licenses['lic-evil'] = { ...doc.state.licenses['lic-1'] };
    writeFileSync(path(), JSON.stringify(doc));
    expect(() => resolveAuthority(dir, secretBuf, marker)).toThrow(/HMAC/);
  });
});

describe('migration crash recovery (file and in-memory marker; in-process crashes)', () => {
  it.each(ALL)('crash %s then restart completes with exact result and verified backups', (at) => {
    seedV1(true);
    expect(crashAt(at)).toThrow(/crash/);
    run();
    expect(resolveAuthority(dir, secretBuf, marker)).toBe('V2');
    const v2 = readDoc().state;
    expect(v2.licenses['lic-1'].appliedKeys).toEqual(['k1', 'k2']);
    expect(v2.clockState).toBe('WARNING'); expect(v2.enforcement).toBe('enforce');
    expect(v2.clockSuspects).toEqual(['2026-01-01T00:00:00.000Z']);
    expect(readdirSync(dir).filter((f) => f.includes('.v1.bak')).sort())
      .toEqual(['license-state.json.v1.bak', 'license-state.json.v1.bak.sha256', 'state.key.v1.bak']);
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'state.key.v1.bak')).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, 'license-state.json.v1.bak')).mode & 0o777).toBe(0o600);
    }
  });
  it('state backup done but key backup missing recovers: key backup is completed on re-run', () => {
    seedV1(true);
    expect(crashAt('AFTER_STATE_BACKUP')).toThrow();
    expect(existsSync(join(dir, 'state.key.v1.bak'))).toBe(false);
    run();
    expect(readFileSync(join(dir, 'state.key.v1.bak')).equals(readFileSync(join(dir, 'state.key')))).toBe(true);
  });
  it('a key backup that differs from the key stops the migration', () => {
    seedV1(true);
    expect(crashAt('AFTER_KEY_BACKUP')).toThrow();
    writeFileSync(join(dir, 'state.key.v1.bak'), 'not the key');
    expect(() => run()).toThrow(/key backup/);
  });
  it('pre-marker: a tampered but validly re-signed v2 (extra entry) is refused, nothing committed', () => {
    seedV1(false); expect(crashAt('AFTER_RENAME')).toThrow();
    const doc = readDoc(); doc.state.licenses['lic-x'] = { ...doc.state.licenses['lic-1'] }; resign(doc);
    expect(() => run()).toThrow(/exact expected migration/);
    expect(m.committed).toBe(false);
  });
  it.each([
    ['wrong companyId', (s: any) => { s.licenses['lic-1'].companyId = 'company-9'; }],
    ['applied keys reordered', (s: any) => { s.licenses['lic-1'].appliedKeys = ['k2', 'k1']; }],
    ['extra applied key', (s: any) => { s.licenses['lic-1'].appliedKeys.push('k3'); }],
    ['clock state altered', (s: any) => { s.clockState = 'OK'; }],
    ['enforcement altered', (s: any) => { s.enforcement = 'off'; }],
    ['suspension set', (s: any) => { s.licenses['lic-1'].suspended = true; }],
    ['sequence not v1+1', (s: any) => { s.sequence += 5; }],
  ])('pre-marker: re-signed v2 with %s is refused (exact transformation)', (_n, edit) => {
    seedV1(false); expect(crashAt('AFTER_RENAME')).toThrow();
    const doc = readDoc(); edit(doc.state); resign(doc);
    expect(() => run()).toThrow(/exact expected migration/);
    expect(m.committed).toBe(false);
  });
  it('without the stopped-service assertion nothing is written', () => {
    seedV1(false);
    expect(() => run(undefined, false)).toThrow(MigrationError);
    expect(existsSync(join(dir, 'license-state.json.v1.bak'))).toBe(false);
  });
  it('a v1 edit after the backup stops the migration', () => {
    seedV1(false); expect(crashAt('AFTER_STATE_BACKUP')).toThrow();
    new LicenseStore(dir, { secret: SECRET }).update((x) => { x.maxSeatsUsed = 4; });
    expect(() => run()).toThrow(/changed after backup/);
  });
});

describe('after commit', () => {
  it('a legitimate state update (clock/key write) keeps the marker valid across restarts', () => {
    seedV1(false); run();
    updateV2(dir, secretBuf, marker, (s) => { s.lastSeenAt = '2026-11-26T00:00:00.000Z'; s.licenses['lic-1'].appliedKeys.push('k3'); });
    expect(resolveAuthority(dir, secretBuf, marker)).toBe('V2');
    expect(m.sequence).toBe(readDoc().state.sequence);
  });
  it('crash between the file write and the marker floor raise is accepted', () => {
    seedV1(false); run();
    const floor = m.sequence!;
    updateV2(dir, secretBuf, { ...marker, raiseSequence: () => undefined }, (s) => { s.lastSeenAt = '2026-11-26T00:00:00.000Z'; });
    expect(m.sequence).toBe(floor);
    expect(resolveAuthority(dir, secretBuf, marker)).toBe('V2');
  });
  it('an older v2 file (rolled back below the floor) is refused', () => {
    seedV1(false); run();
    const old = readFileSync(path());
    updateV2(dir, secretBuf, marker, (s) => { s.licenses['lic-1'].appliedKeys.push('k3'); });
    writeFileSync(path(), old);
    expect(() => resolveAuthority(dir, secretBuf, marker)).toThrow(/older than the marker/);
  });
  it('restoring the v1 file does not fall back to v1', () => {
    seedV1(false); run();
    writeFileSync(path(), readFileSync(join(dir, 'license-state.json.v1.bak')));
    expect(() => resolveAuthority(dir, secretBuf, marker)).toThrow(/no fallback/);
  });
  it('missing state, or a wrong key, is damaged and nothing is regenerated', () => {
    seedV1(false); run();
    const good = readFileSync(path()); rmSync(path());
    expect(() => resolveAuthority(dir, secretBuf, marker)).toThrow(/missing/);
    expect(existsSync(path())).toBe(false);
    writeFileSync(path(), good);
    expect(() => resolveAuthority(dir, createHash('sha256').update('other').digest(), marker)).toThrow(/HMAC/);
  });
});

describe('real old code', () => {
  it('the current LicenseStore refuses the v2 file and writes nothing', () => {
    seedV1(false); run();
    const before = readFileSync(path());
    // Observed, not assumed: the old loader checks its top-level-only MAC first, so it
    // reports the v2 file as failing the integrity check (TAMPERED), not as 'format 2'.
    // The service maps both TAMPERED and UNREADABLE to LICENSE_STATE_DAMAGED.
    let code = '';
    try { new LicenseStore(dir, { secret: SECRET }); } catch (e: any) { code = e.code; }
    expect(['TAMPERED', 'UNREADABLE']).toContain(code);
    expect(readFileSync(path()).equals(before)).toBe(true);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
  it('HAZARD, proven: an old process that was already running keeps its v1 state in memory and OVERWRITES v2 on its next update; the new build detects it (no fallback) but cannot prevent it', () => {
    seedV1(false);
    const live = new LicenseStore(dir, { secret: SECRET });   // old process, started before migration
    run();                                                     // migration run while that process still lives
    live.update((x) => { x.maxSeatsUsed = 4; });               // old process persists its v1 state
    expect(readDoc().state.v).toBe(1);                         // v2 was clobbered
    expect(() => resolveAuthority(dir, secretBuf, marker)).toThrow(/no fallback/);
  });
});

describe('first-admin capability', () => {
  const entry = () => ({ companyRef: 'ref-1', setup: 'AWAITING_FIRST_ADMIN', appliedKeys: ['kc'] });
  const ok = { signatureValid: true, type: 'COMPANY_ACTIVATION', companyRef: 'ref-1', keyId: 'kc' };
  it('needs a verified signed key; keyId alone, wrong company, replay and closed state are refused', () => {
    expect(() => consumeFirstAdmin(entry(), null)).toThrow();
    expect(() => consumeFirstAdmin(entry(), { ...ok, signatureValid: false })).toThrow();
    expect(() => consumeFirstAdmin(entry(), { ...ok, companyRef: 'ref-2' })).toThrow();
    const e = entry(); consumeFirstAdmin(e, ok);
    expect(e.setup).toBe('ACTIVE');
    expect(() => consumeFirstAdmin(e, ok)).toThrow(/closed/);
  });
});
