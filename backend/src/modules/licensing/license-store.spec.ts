import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LicenseStateError, LicenseStore, emptyState } from './license-store';

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
});
