import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { LicenseStore } from './license-store';
import { generateKeyPairSync } from 'node:crypto';
import { signPayloadV2, type LicensePayloadV2 } from './license-key';
import {
  Marker, MarkerStore, MigrationError, Step, KeyRefusal, applyKeyV2, assertInvariants, canonical, mac,
  migrate, provisionFirstAdmin, resolveAuthority, updateV2,
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
const ALL: Step[] = ['IN_STATE_BACKUP_COPY', 'AFTER_STATE_BAK_BEFORE_DIGEST', 'AFTER_STATE_BACKUP', 'IN_KEY_BACKUP_COPY', 'AFTER_KEY_BACKUP', 'AFTER_SCHEMA', 'AFTER_TEMP_WRITE', 'AFTER_RENAME', 'AFTER_MARKER'];

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


describe('review items 1-3: backups, mode, restored database', () => {
  it('a crash inside the backup copy or between the backup and its digest completes on restart (no raw ENOENT, no stuck DAMAGED)', () => {
    for (const at of ['IN_STATE_BACKUP_COPY', 'AFTER_STATE_BAK_BEFORE_DIGEST', 'IN_KEY_BACKUP_COPY'] as Step[]) {
      rmSync(dir, { recursive: true, force: true }); dir = mkdtempSync(join(tmpdir(), 'kayan-mig-'));
      m = { committed: false, schemaReady: false, genesis: null, sequence: null };
      seedV1(true);
      expect(crashAt(at)).toThrow(/crash/);
      if (at === 'AFTER_STATE_BAK_BEFORE_DIGEST') {
        expect(existsSync(join(dir, 'license-state.json.v1.bak'))).toBe(true);
        expect(existsSync(join(dir, 'license-state.json.v1.bak.sha256'))).toBe(false);
      }
      expect(() => run()).not.toThrow();
      expect(resolveAuthority(dir, secretBuf, marker)).toBe('V2');
    }
  });
  it('a backup without a digest that does NOT equal the source is refused, not trusted', () => {
    seedV1(false);
    expect(crashAt('AFTER_STATE_BAK_BEFORE_DIGEST')).toThrow();
    writeFileSync(join(dir, 'license-state.json.v1.bak'), 'partial', { mode: 0o600 });
    expect(() => run()).toThrow(/does not equal the v1 state/);
    expect(m.committed).toBe(false);
  });
  it('a 0644 source gives 0600 backups and the migration is not stuck', () => {
    seedV1(true);
    if (process.platform !== 'win32') { chmodSync(path(), 0o644); chmodSync(join(dir, 'state.key'), 0o644); }
    expect(() => run()).not.toThrow();
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'license-state.json.v1.bak')).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, 'state.key.v1.bak')).mode & 0o777).toBe(0o600);
    }
  });
  it('restored DB older than the file (marker row and schema gone, v2 file present): the schema step runs again, then the marker commits', () => {
    seedV1(false); run();
    m = { committed: false, schemaReady: false, genesis: null, sequence: null };   // old snapshot
    let schemaRuns = 0;
    migrate({ dir, secret: secretBuf, marker, companyId: 'company-1', schemaStep: () => { schemaRuns++; }, serviceStopped: true });
    expect(schemaRuns).toBe(1);
    expect(m.committed).toBe(true);
    expect(resolveAuthority(dir, secretBuf, marker)).toBe('V2');
  });
  it('restored DB NEWER than the file (floor above the file sequence): refused', () => {
    seedV1(false); run();
    updateV2(dir, secretBuf, marker, () => undefined);
    const doc = readDoc(); doc.state.sequence -= 1; resign(doc);           // older file, newer marker
    expect(() => resolveAuthority(dir, secretBuf, marker)).toThrow(/older than the marker floor/);
  });
});

describe('review item 4: invariants on every update and start', () => {
  const second = (s: any) => { s.licenses['lic-2'] = { ...s.licenses['lic-1'], companyId: 'company-2', companyRef: 'ref-company-2', origin: 'V2', setup: 'AWAITING_FIRST_ADMIN', appliedKeys: ['k9'], maxSeatsUsed: 0 }; };
  it.each([
    ['companyId changed', (s: any) => { s.licenses['lic-1'].companyId = 'company-9'; }],
    ['legacyLicenseId changed', (s: any) => { s.legacyLicenseId = 'lic-other'; }],
    ['bound companyRef changed', (s: any) => { s.licenses['lic-1'].companyRef = 'ref-bbbbbbbb'; }],
    ['applied key removed', (s: any) => { s.licenses['lic-1'].appliedKeys = ['k1']; }],
    ['applied keys reordered', (s: any) => { s.licenses['lic-1'].appliedKeys = ['k2', 'k1']; }],
    ['applied key duplicated', (s: any) => { s.licenses['lic-1'].appliedKeys = ['k1', 'k2', 'k1']; }],
    ['seat limit lowered', (s: any) => { s.licenses['lic-1'].maxSeatLimit = 1; }],
    ['expiry shortened', (s: any) => { s.licenses['lic-1'].licenseExpiresAt = '2026-02-01T00:00:00.000Z'; }],
    ['seat watermark lowered', (s: any) => { s.licenses['lic-1'].maxSeatsUsed = 1; }],
    ['licence removed', (s: any) => { s.licenses = {}; }],
    ['origin changed', (s: any) => { s.licenses['lic-1'].origin = 'V2'; }],
    ['company id shared by two licences', (s: any) => { second(s); s.licenses['lic-2'].companyId = 'company-1'; }],
    ['company ref shared by two licences', (s: any) => { second(s); s.licenses['lic-1'].companyRef = 'ref-company-2'; }],
    ['malformed companyRef', (s: any) => { s.licenses['lic-1'].companyRef = 'x'; }],
    ['unknown setup state', (s: any) => { s.licenses['lic-1'].setup = 'OPEN'; }],
  ])('update refused: %s (nothing written)', (_n, edit) => {
    seedV1(false); run();
    updateV2(dir, secretBuf, marker, (s) => { s.licenses['lic-1'].companyRef = 'ref-aaaaaaaa'; });  // null -> value is allowed once
    const before = readFileSync(path(), 'utf8');
    expect(() => updateV2(dir, secretBuf, marker, edit)).toThrow(MigrationError);
    expect(readFileSync(path(), 'utf8')).toBe(before);
  });
  it('setup is one-way: ACTIVE cannot return to AWAITING_FIRST_ADMIN', () => {
    seedV1(false); run();
    updateV2(dir, secretBuf, marker, (s) => second(s));
    updateV2(dir, secretBuf, marker, (s) => { s.licenses['lic-2'].setup = 'ACTIVE'; });
    expect(() => updateV2(dir, secretBuf, marker, (s) => { s.licenses['lic-2'].setup = 'AWAITING_FIRST_ADMIN'; })).toThrow(/one-way/);
  });
  it('a re-signed file that violates an invariant is refused at start (not only on update)', () => {
    seedV1(false); run();
    const doc = readDoc(); doc.state.licenses['lic-1'].appliedKeys = ['k1', 'k1']; resign(doc);
    expect(() => resolveAuthority(dir, secretBuf, marker)).toThrow(/invariant/);
    expect(() => assertInvariants({ v: 2, sequence: 1, legacyLicenseId: 'a', licenses: {} })).toThrow(MigrationError);
  });
  it('the marker genesis is audit only: no descent claim is made or tested', () => {
    seedV1(false); run();
    expect(typeof m.genesis).toBe('string');
  });
});

describe('review items 5-6: key rules and first-admin with the real verifier', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const other = generateKeyPairSync('ed25519');
  const MACHINE = process.env.TEST_MACHINE_ID ?? 'ABCD-EFGH-IJKL-MNOP';
  const keyId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const company = (n: number, over: Partial<LicensePayloadV2> = {}): LicensePayloadV2 => ({
    v: 2, keyId: keyId(n), type: 'COMPANY_ACTIVATION', licenseId: `lic-co-${n}-0000-0000`, machineId: MACHINE,
    issuedAt: '2026-11-26T00:00:00.000Z', term: { kind: 'MONTHS', months: 12 }, seats: { mode: 'CAP', value: 5 },
    companyRef: `company-ref-${n}00`, displayLabel: null, state: null, note: null, ...over,
  });
  const ctx = { machineId: MACHINE, newCompanyId: 'company-2', now: new Date('2026-11-26T00:00:00Z'), current: { expiresAt: new Date('2027-01-01T00:00:00Z'), seatLimit: 5, seatsUsed: 3 } };
  const ap = (st: any, p: LicensePayloadV2, c: any = ctx) => applyKeyV2(st, p, c).next;
  const stateOf = () => readDoc().state;

  it('companyRef rule: only 8-64 letters, digits, dash and underscore reach the state', () => {
    const { verifyKeyV2 } = jest.requireActual('./license-key');
    for (const bad of ['short', 'has space here', 'x'.repeat(65), 'bad/slash-ref', 'ref\u0000zero00']) {
      expect(() => verifyKeyV2(signPayloadV2(company(1, { companyRef: bad }), privateKey), publicKey)).toThrow();
    }
    expect(verifyKeyV2(signPayloadV2(company(1, { companyRef: 'ok-ref_0001' }), privateKey), publicKey).payload.companyRef).toBe('ok-ref_0001');
  });
  describe('state rules (applyKeyV2)', () => {
    beforeEach(() => { seedV1(false); run(); });
    it('COMPANY_ACTIVATION adds an AWAITING_FIRST_ADMIN entry with the key spent', () => {
      const next = ap(stateOf(), company(2), ctx);
      const e = next.licenses['lic-co-2-0000-0000'];
      expect(e.setup).toBe('AWAITING_FIRST_ADMIN'); expect(e.appliedKeys).toEqual([keyId(2)]); expect(e.maxSeatsUsed).toBe(0);
      assertInvariants({ ...next, sequence: 5 });
    });
    it('refused: a licenseId already known (legacy or another company), a keyId replay, a duplicate companyRef, wrong machine', () => {
      expect(() => ap(stateOf(), company(2, { licenseId: 'lic-1' }), ctx)).toThrow(/already known/);
      const once = ap(stateOf(), company(2), ctx);
      expect(() => ap(once, company(3, { licenseId: 'lic-co-2-0000-0000' }), ctx)).toThrow(/already known/);
      expect(() => ap(once, company(2, { licenseId: 'lic-other-0000-0000' }), ctx)).toThrow(/already used/);
      expect(() => ap(once, company(3, { companyRef: 'company-ref-200' }), ctx)).toThrow(/reference already exists/);
      expect(() => ap(stateOf(), company(4, { machineId: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' }), ctx)).toThrow(/another machine/);
    });
    it('a RENEWAL or SEATS key for company A is refused for B, and for an unknown licence', () => {
      const withB = ap(stateOf(), company(2), ctx);
      const renewalForA = company(5, { type: 'RENEWAL', licenseId: 'lic-co-2-0000-0000', machineId: null, seats: null, companyRef: 'company-ref-300' });
      expect(() => ap(withB, renewalForA, ctx)).toThrow(/another company/);
      expect(() => ap(withB, company(6, { type: 'SEATS', licenseId: 'lic-nope-0000-0000', machineId: null, term: null }), ctx)).toThrow(/does not have/);
      const ok = ap(withB, company(7, { type: 'SEATS', licenseId: 'lic-co-2-0000-0000', machineId: null, term: null, companyRef: 'company-ref-200', seats: { mode: 'INCREASE', value: 2 } }), ctx);
      expect(ok.licenses['lic-co-2-0000-0000'].maxSeatLimit).toBe(7);
      expect(ok.licenses['lic-1'].maxSeatLimit).toBe(5);       // the other company is untouched
    });
    it('the legacy licence binds its companyRef once; a different ref later is refused; a taken ref is refused', () => {
      const bind = (ref: string, n: number) => company(n, { type: 'RENEWAL', licenseId: 'lic-1', machineId: null, seats: null, companyRef: ref });
      const bound = ap(stateOf(), bind('legacy-ref-0001', 8), ctx);
      expect(bound.licenses['lic-1'].companyRef).toBe('legacy-ref-0001');
      expect(() => ap(bound, bind('legacy-ref-0002', 9), ctx)).toThrow(/another company/);
      const withB = ap(stateOf(), company(2), ctx);
      expect(() => ap(withB, bind('company-ref-200', 10), ctx)).toThrow(/reference already exists/);
    });
    it('a TRANSFER is not applied to a company (semantics undefined, refused, not guessed)', () => {
      expect(() => ap(stateOf(), company(11, { type: 'TRANSFER', licenseId: 'lic-1', machineId: MACHINE, companyRef: 'legacy-ref-0001' }), ctx)).toThrow(/transfer semantics/);
    });
  describe('v1 renewal and seat semantics are reproduced, not reinvented', () => {
    const renew = (months: number | 'P', extra: any = {}) => company(20 + (typeof months === 'number' ? months : 99), {
      type: 'RENEWAL', licenseId: 'lic-1', machineId: null, seats: null, companyRef: 'legacy-ref-0001',
      term: months === 'P' ? { kind: 'PERPETUAL' } : { kind: 'MONTHS', months }, ...extra,
    });
    const bound = () => ap(stateOf(), renew(1));          // binds the legacy ref once
    it('renewal of a still-valid term ADDS to the current end (never shortens)', () => {
      const r = applyKeyV2(stateOf(), renew(1), ctx);
      expect(r.outcome.expiresAt!.toISOString()).toBe('2027-02-01T00:00:00.000Z');
      expect(r.next.licenses['lic-1'].licenseExpiresAt).toBe('2027-02-01T00:00:00.000Z');
    });
    it('an expired term restarts from now, and a short renewal never lowers the protected expiry', () => {
      const expired = { ...ctx, current: { ...ctx.current, expiresAt: new Date('2026-01-01T00:00:00Z') } };
      const st = stateOf();                                         // watermark 2027-01-01
      const r = applyKeyV2(st, renew(1), expired);
      expect(r.outcome.expiresAt!.toISOString()).toBe('2026-12-26T00:00:00.000Z');   // DB row restarts from now
      expect(r.next.licenses['lic-1'].licenseExpiresAt).toBe('2027-01-01T00:00:00.000Z'); // watermark kept
    });
    it('a perpetual licence stays perpetual on a month renewal; a perpetual key makes a term perpetual', () => {
      const perp = { ...ctx, current: { ...ctx.current, expiresAt: null } };
      expect(applyKeyV2(stateOf(), renew(1), perp).outcome.expiresAt).toBeNull();
      const r = applyKeyV2(stateOf(), renew('P'), ctx);
      expect(r.next.licenses['lic-1'].perpetual).toBe(true);
      expect(r.next.licenses['lic-1'].licenseExpiresAt).toBeNull();
    });
    it('a SEATS CAP key lowers the CURRENT limit down to the seats in use, the highest-granted watermark stays', () => {
      const cap = (v: number, n: number) => company(n, { type: 'SEATS', licenseId: 'lic-1', machineId: null, term: null, companyRef: 'legacy-ref-0001', seats: { mode: 'CAP', value: v } });
      const r = applyKeyV2(stateOf(), cap(3, 30), ctx);                // limit 5 -> 3, used 3
      expect(r.outcome.seatLimit).toBe(3);
      expect(r.next.licenses['lic-1'].maxSeatLimit).toBe(5);
      expect(() => applyKeyV2(stateOf(), cap(2, 31), ctx)).toThrow(KeyRefusal);   // below used
      try { applyKeyV2(stateOf(), cap(2, 31), ctx); } catch (e: any) { expect(e.code).toBe('LICENSE_SEATS_BELOW_USED'); }
    });
    it('a business refusal writes nothing and is not a damaged-state failure', () => {
      const before = readFileSync(path(), 'utf8');
      const st = stateOf();
      const snapshot = JSON.stringify(st);
      let err: any;
      try { applyKeyV2(st, company(40, { type: 'SEATS', licenseId: 'lic-nope-0000-0000', machineId: null, term: null }), ctx); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(KeyRefusal);
      expect(err).not.toBeInstanceOf(MigrationError);
      expect(err.code).toBe('LICENSE_KEY_WRONG_LICENSE');
      expect(JSON.stringify(st)).toBe(snapshot);                       // input untouched
      expect(readFileSync(path(), 'utf8')).toBe(before);               // nothing written
      void bound;
    });
  });
    it('the machine id used here is a hard-coded shape (or TEST_MACHINE_ID), not read from a real machine', () => {
   expect(MACHINE).toMatch(/^[A-Z0-9-]+$/);
    });
  });
  describe('first admin (real Ed25519 verification, crash ordering)', () => {
    let admins: number;
    const setup = () => {
      seedV1(false); run();
      const next = ap(stateOf(), company(2));
      updateV2(dir, secretBuf, marker, (s) => { s.licenses['lic-co-2-0000-0000'] = next.licenses['lic-co-2-0000-0000']; });
      admins = 0;
    };
    const provision = (keyText: string, over: any = {}) => provisionFirstAdmin({
      dir, secret: secretBuf, marker, keyText, publicKey, machineId: MACHINE,
      adminExists: () => admins > 0, createAdmin: () => { admins++; }, ...over,
    });
    const good = () => signPayloadV2(company(2), privateKey);
    it('the activating key text creates exactly one admin and closes the door', () => {
      setup(); provision(good());
      expect(admins).toBe(1);
      expect(stateOf().licenses['lic-co-2-0000-0000'].setup).toBe('ACTIVE');
    });
    it('refused with no admin created: forged signature, tampered payload, keyId only, garbage', () => {
      setup();
      const forged = signPayloadV2(company(2), other.privateKey);
      const parts = good().split('.'); const edited = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      edited.companyRef = 'company-ref-999';
      const tampered = `${parts[0]}.${Buffer.from(JSON.stringify(edited)).toString('base64url')}.${parts[2]}`;
      for (const t of [forged, tampered, keyId(2), '', 'KYN2.a.b']) expect(() => provision(t)).toThrow(/verified signed activation key/);
      expect(admins).toBe(0);
    });
    it('refused: wrong machine, other company key, a non-activating key, a RENEWAL key', () => {
      setup();
      expect(() => provision(signPayloadV2(company(2, { machineId: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' }), privateKey))).toThrow(/another machine/);
      expect(() => provision(signPayloadV2(company(3), privateKey))).toThrow(/another company/);
      expect(() => provision(signPayloadV2(company(2, { keyId: keyId(77) }), privateKey))).toThrow(/activating key/);
      expect(() => provision(signPayloadV2(company(2, { type: 'RENEWAL', machineId: null, seats: null }), privateKey))).toThrow(/wrong key type/);
      expect(admins).toBe(0);
    });
    it('second admin and replay are refused after success; a restore of an older file is refused by the floor', () => {
      setup();
      const before = readFileSync(path(), 'utf8');
      provision(good());
      expect(() => provision(good())).toThrow(/closed/);
      expect(admins).toBe(1);
      writeFileSync(path(), before);                                   // restore the AWAITING file
      expect(() => provision(good())).toThrow(/older than the marker floor/);
      expect(admins).toBe(1);
    });
    it('crash after the admin exists but before the flip: retry only flips, never creates a second admin', () => {
      setup();
      expect(() => provision(good(), { hook: () => { throw new Error('crash after admin'); } })).toThrow(/crash/);
      expect(admins).toBe(1);
      expect(stateOf().licenses['lic-co-2-0000-0000'].setup).toBe('AWAITING_FIRST_ADMIN');
      provision(good());
      expect(admins).toBe(1);
      expect(stateOf().licenses['lic-co-2-0000-0000'].setup).toBe('ACTIVE');
    });
    it('a failed admin creation leaves the door open and the state unchanged', () => {
      setup();
      expect(() => provision(good(), { createAdmin: () => { throw new Error('db down'); } })).toThrow(/db down/);
      expect(stateOf().licenses['lic-co-2-0000-0000'].setup).toBe('AWAITING_FIRST_ADMIN');
      provision(good());
      expect(admins).toBe(1);
    });
  });
});

describe('refusal kinds stay distinct', () => {
  it('an invariant failure is MigrationError DAMAGED; a key-rule refusal is KeyRefusal (see the renewal/seat block above)', () => {
    seedV1(false); run();
    let damaged: any;
    try { updateV2(dir, secretBuf, marker, (x) => { x.licenses['lic-1'].appliedKeys = []; }); } catch (e) { damaged = e; }
    expect(damaged).toBeInstanceOf(MigrationError);
    expect(damaged.code).toBe('DAMAGED');
  });
});
