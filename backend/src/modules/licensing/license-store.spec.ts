import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  LicenseStateError,
  LicenseStore,
  emptyState,
  mergeTrustStates,
} from './license-store';

/**
 * The state file is the one part of the licence that is not in PostgreSQL, so
 * the tests here are about the two things it must guarantee: a change is on
 * disk before the caller is told it happened, and an edit by hand is noticed.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kayan-store-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('LicenseStore', () => {
  it('creates its file and a separate secret on first use', () => {
    const store = new LicenseStore(dir);
    expect(existsSync(join(dir, 'license-state.json'))).toBe(true);
    expect(existsSync(join(dir, 'state.key'))).toBe(true);
    expect(existsSync(join(dir, 'license-state.backup.json'))).toBe(true);
    expect(store.current.installId).toMatch(/^[0-9a-f]{32}$/);
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'state.key')).mode & 0o777).toBe(0o600);
    }
  });

  it('writes a change to disk before returning it', () => {
    const store = new LicenseStore(dir);
    store.update((state) => {
      state.maxSeatsUsed = 7;
    });
    const reopened = new LicenseStore(dir);
    expect(reopened.current.maxSeatsUsed).toBe(7);
    expect(reopened.current.sequence).toBe(store.current.sequence);
  });

  it('never lowers a watermark, even if a caller asks it to', () => {
    const store = new LicenseStore(dir);
    store.update((state) => {
      state.maxSeatsUsed = 9;
      state.maxSeatLimit = 12;
    });
    store.update((state) => {
      state.maxSeatsUsed = 1;
      state.maxSeatLimit = 3;
    });
    expect(store.current.maxSeatsUsed).toBe(9);
    expect(store.current.maxSeatLimit).toBe(12);
  });

  it('recovers a hand-edited primary from the authenticated mirror and preserves the damaged file', () => {
    const store = new LicenseStore(dir);
    store.update((state) => {
      state.maxSeatsUsed = 2;
    });
    const path = join(dir, 'license-state.json');
    const body = JSON.parse(readFileSync(path, 'utf8'));
    body.state.maxSeatsUsed = 0; // the "restore the counter" edit
    writeFileSync(path, JSON.stringify(body));

    const reopened = new LicenseStore(dir);
    expect(reopened.recoveredFromBackup).toBe(true);
    expect(reopened.current.maxSeatsUsed).toBe(2);
    expect(JSON.parse(readFileSync(path, 'utf8')).state.maxSeatsUsed).toBe(2);
    expect(readdirSync(dir).some((name) => name.startsWith('license-state.damaged-'))).toBe(true);
  });

  it('recovers a primary whose MAC was removed from the authenticated mirror', () => {
    const store = new LicenseStore(dir);
    store.update((state) => {
      state.appliedKeys = ['key_1'];
    });
    const path = join(dir, 'license-state.json');
    const body = JSON.parse(readFileSync(path, 'utf8'));
    delete body.mac;
    writeFileSync(path, JSON.stringify(body));

    const reopened = new LicenseStore(dir);
    expect(reopened.recoveredFromBackup).toBe(true);
    expect(reopened.current.appliedKeys).toEqual(['key_1']);
  });

  it('recovers a primary that is not JSON from the authenticated mirror', () => {
    const store = new LicenseStore(dir);
    store.update((state) => {
      state.maxSeatLimit = 8;
    });
    writeFileSync(join(dir, 'license-state.json'), 'not json');

    const reopened = new LicenseStore(dir);
    expect(reopened.recoveredFromBackup).toBe(true);
    expect(reopened.current.maxSeatLimit).toBe(8);
  });

  it('fails closed when both the primary and authenticated mirror are damaged', () => {
    new LicenseStore(dir);
    writeFileSync(join(dir, 'license-state.json'), 'not json');
    writeFileSync(join(dir, 'license-state.backup.json'), 'also not json');
    expect(() => new LicenseStore(dir)).toThrow(LicenseStateError);
  });

  it('keeps the applied-key list bounded, dropping the oldest', () => {
    const store = new LicenseStore(dir);
    store.update((state) => {
      state.appliedKeys = Array.from({ length: 505 }, (_, index) => `key_${index}`);
    });
    expect(store.current.appliedKeys).toHaveLength(500);
    expect(store.current.appliedKeys[0]).toBe('key_5');
  });

  it('uses a configured secret instead of the file beside it', () => {
    const explicit = new LicenseStore(dir, { secret: 'operator-secret' });
    explicit.update((state) => {
      state.maxSeatsUsed = 4;
    });
    // Another store with the same explicit secret reads the same state.
    expect(new LicenseStore(dir, { secret: 'operator-secret' }).current.maxSeatsUsed).toBe(4);
    // A different secret cannot authenticate it: the file is not portable.
    expect(() => new LicenseStore(dir, { secret: 'someone-else' })).toThrow(
      /integrity check/i,
    );
  });
});

describe('emptyState', () => {
  it('starts with no licence and no spend', () => {
    expect(emptyState('abc')).toMatchObject({
      v: 1,
      installId: 'abc',
      maxSeatsUsed: 0,
      maxSeatLimit: 0,
      appliedKeys: [],
      licenseId: null,
      perpetual: false,
      clockState: 'OK',
      enforcement: null,
    });
  });

  it('survives a power cut between the mirror write and the primary write', () => {
    const store = new LicenseStore(dir);
    store.update((state) => {
      state.maxSeatsUsed = 3;
      state.appliedKeys = ['key_first'];
    });
    // The state as it was written by the update above (sequence n).
    const primaryBefore = readFileSync(join(dir, 'license-state.json'));
    store.update((state) => {
      state.maxSeatsUsed = 4;
      state.appliedKeys.push('key_second');
    });
    // Simulate the machine losing power after the mirror was renamed into
    // place but before the primary was: the primary is one step behind, and
    // both copies are still authentic.
    writeFileSync(join(dir, 'license-state.json'), primaryBefore);

    const reopened = new LicenseStore(dir);
    // The newer copy wins, so the interrupted update is not lost.
    expect(reopened.current.maxSeatsUsed).toBe(4);
    expect(reopened.current.appliedKeys).toEqual(['key_first', 'key_second']);
    // ...and the stale copy is brought forward instead of being left behind.
    expect(readFileSync(join(dir, 'license-state.json'))).toEqual(
      readFileSync(join(dir, 'license-state.backup.json')),
    );
  });

  it('ignores a temporary file left behind by a killed write', () => {
    const store = new LicenseStore(dir);
    store.update((state) => {
      state.maxSeatLimit = 5;
    });
    writeFileSync(
      join(dir, `license-state.json.${process.pid}.1234abcd.tmp`),
      '{"state":',
    );
    expect(new LicenseStore(dir).current.maxSeatLimit).toBe(5);
  });

  it('merges two authenticated copies that raced to the same sequence', () => {
    // Both copies are honest: the union must not lose what either one knew.
    const base = emptyState('install-1');
    const first = { ...base, sequence: 4, maxSeatsUsed: 2, appliedKeys: ['key_a'] };
    const second = {
      ...base,
      sequence: 4,
      maxSeatLimit: 9,
      appliedKeys: ['key_b'],
      lastSeenAt: '2026-05-01T10:00:00.000Z',
    };
    const merged = mergeTrustStates(first, second);
    expect(merged.sequence).toBe(5);
    expect(merged.maxSeatsUsed).toBe(2);
    expect(merged.maxSeatLimit).toBe(9);
    expect(merged.appliedKeys).toEqual(['key_a', 'key_b']);
    expect(merged.lastSeenAt).toBe('2026-05-01T10:00:00.000Z');
  });

  it('refuses to merge copies from different installations', () => {
    const first = emptyState('install-1');
    const second = { ...emptyState('install-2'), sequence: 1 };
    expect(() => mergeTrustStates(first, second)).toThrow(LicenseStateError);
  });

  it('stays readable when two writers interleave', () => {
    const store = new LicenseStore(dir);
    // A second process that read the state before the first one wrote: the
    // realistic stale writer (a second window, or the repair tool).
    const stale = new LicenseStore(dir, {
      secret: readFileSync(join(dir, 'state.key'), 'utf8').trim(),
    });
    store.update((state) => {
      state.appliedKeys.push('key_from_first');
    });
    stale.update((state) => {
      state.appliedKeys.push('key_from_second');
    });
    stale.update((state) => {
      state.maxSeatLimit = 9;
    });
    const reopened = new LicenseStore(dir);
    // Two processes writing at once cannot produce a half state: each write is
    // a whole authenticated document. Which write survives is last-writer-wins,
    // and the key ledger itself is PostgreSQL's, not this file's.
    expect(reopened.current.installId).toBe(store.current.installId);
    expect(reopened.current.maxSeatLimit).toBe(9);
    expect(reopened.current.sequence).toBeGreaterThan(0);
    expect(
      readFileSync(join(dir, 'license-state.json'), 'utf8'),
    ).toBe(readFileSync(join(dir, 'license-state.backup.json'), 'utf8'));
  });
});
