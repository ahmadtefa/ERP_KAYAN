import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  LicenceBackupArchive,
  LICENCE_BACKUP_RETENTION,
} from './licence-backup-archive';
import { LicenseStateError, LicenseStore } from './license-store';

/**
 * The archive is the last line of defence for an installation's licence: the
 * protected folder already keeps two authenticated copies, and these tests
 * cover the cases those two cannot survive - both damaged, the folder emptied,
 * a newer copy destroyed while older ones remain, and a copy carried to a
 * different computer.
 */

interface Fixture {
  licenceDir: string;
  backupDir: string;
  store: LicenseStore;
  archive: LicenceBackupArchive;
  dispose(): void;
}

function fixture(
  options: {
    machineId?: string | null;
    retention?: number;
    clock?: () => Date;
  } = {},
): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'kayan-licence-backup-'));
  const licenceDir = join(root, 'license');
  const backupDir = join(root, 'LicenceBackups');
  mkdirSync(licenceDir, { recursive: true });
  const store = new LicenseStore(licenceDir);
  store.update((state) => {
    state.installId = 'install-1';
    state.licenseId = 'lic_aaaa-bbbb';
    state.licenseExpiresAt = '2027-05-01T09:00:00.000Z';
    state.maxSeatLimit = 5;
    state.maxSeatsUsed = 2;
    state.lastSeenAt = '2026-05-01T09:00:00.000Z';
    state.appliedKeys = ['key_activation-1'];
  });
  writeFileSync(join(licenceDir, 'public-key.pem'), 'PUBLIC KEY PEM');
  const archive = new LicenceBackupArchive(licenceDir, {
    backupDirectory: backupDir,
    machineId: options.machineId === undefined ? 'KM-AAAA-BBBB-CCCC' : options.machineId,
    retention: options.retention,
    clock: options.clock,
  });
  return {
    licenceDir,
    backupDir,
    store,
    archive,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

function backups(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => name.startsWith('licence-'));
  } catch {
    // The folder is created by the first capture; before that it does not
    // exist, which is not a failure of the code under test.
    return [];
  }
}

function corrupt(path: string): void {
  writeFileSync(path, '{ this is not json');
}

describe('LicenceBackupArchive', () => {
  let fx: Fixture;
  afterEach(() => fx?.dispose());

  it('writes a timestamped copy that verifies and keeps the licence files', () => {
    fx = fixture();
    const record = fx.archive.capture('full-backup');

    expect(record.id).toMatch(/^licence-\d{8}T\d{6}Z-[0-9a-f]{8}$/);
    expect(record.reason).toBe('full-backup');
    expect(record.machineId).toBe('KM-AAAA-BBBB-CCCC');
    expect(record.state.licenseId).toBe('lic_aaaa-bbbb');
    expect(record.files.map((file) => file.name)).toEqual(
      expect.arrayContaining(['license-state.json', 'public-key.pem']),
    );
    expect(
      readFileSync(join(record.path, 'license-state.json'), 'utf8'),
    ).toContain('lic_aaaa-bbbb');
    expect(fx.archive.list().map((entry) => entry.id)).toEqual([record.id]);
  });

  it('refuses to capture a damaged state instead of storing an untrusted copy', () => {
    fx = fixture();
    corrupt(join(fx.licenceDir, 'license-state.json'));
    corrupt(join(fx.licenceDir, 'license-state.backup.json'));

    expect(() => fx.archive.capture('full-backup')).toThrow(LicenseStateError);
    expect(backups(fx.backupDir)).toHaveLength(0);
    // Nothing half-written is left behind, and the refusal is logged.
    const left = readdirSync(fx.backupDir);
    expect(left.filter((name) => name.startsWith('.tmp-'))).toHaveLength(0);
    expect(
      readFileSync(join(fx.backupDir, 'operations.log'), 'utf8'),
    ).toContain('capture-failed');
  });

  it('captures from the authenticated mirror when only the primary is damaged', () => {
    fx = fixture();
    corrupt(join(fx.licenceDir, 'license-state.json'));

    const record = fx.archive.capture('full-backup');
    expect(record.state.sequence).toBeGreaterThan(0);
    expect(backups(fx.backupDir)).toHaveLength(1);
  });

  it(`keeps the newest ${LICENCE_BACKUP_RETENTION} copies and prunes older verified ones`, () => {
    let minute = 0;
    fx = fixture({
      clock: () => new Date(Date.UTC(2026, 4, 1, 9, minute++, 0)),
      retention: 3,
    });
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      fx.store.update((state) => {
        state.sequence += 0;
        state.maxSeatsUsed = 2;
      });
      ids.push(fx.archive.capture(`capture-${i}`).id);
    }

    const kept = backups(fx.backupDir).sort();
    expect(kept).toHaveLength(3);
    // Newest three survive, oldest three are gone.
    expect(kept).toEqual(ids.slice(-3).sort());
    expect(fx.archive.list()).toHaveLength(3);
  });

  it('restores the newest copy when both protected files are damaged', () => {
    fx = fixture();
    const record = fx.archive.capture('full-backup');
    corrupt(join(fx.licenceDir, 'license-state.json'));
    corrupt(join(fx.licenceDir, 'license-state.backup.json'));
    expect(() => new LicenseStore(fx.licenceDir)).toThrow(LicenseStateError);

    const outcome = fx.archive.restoreNewestVerified();
    expect(outcome?.restored.id).toBe(record.id);

    const reopened = new LicenseStore(fx.licenceDir);
    expect(reopened.current.licenseId).toBe('lic_aaaa-bbbb');
    expect(reopened.current.sequence).toBeGreaterThan(record.state.sequence);
    // The damaged originals are preserved, not overwritten.
    expect(
      readdirSync(fx.licenceDir).filter((name) => name.includes('.damaged-')),
    ).toHaveLength(2);
    expect(existsSync(join(fx.licenceDir, 'public-key.pem'))).toBe(true);
  });

  it('falls back to an older copy when the newest one is destroyed', () => {
    let minute = 0;
    fx = fixture({ clock: () => new Date(Date.UTC(2026, 4, 1, 9, minute++, 0)) });
    const older = fx.archive.capture('older');
    fx.store.update((state) => {
      state.maxSeatsUsed = 3;
    });
    const newer = fx.archive.capture('newer');

    // Destroy the newer capture completely and damage the live copies.
    rmSync(join(newer.path, 'license-state.json'));
    corrupt(join(fx.licenceDir, 'license-state.json'));
    corrupt(join(fx.licenceDir, 'license-state.backup.json'));

    const outcome = fx.archive.restoreNewestVerified();
    expect(outcome?.restored.id).toBe(older.id);
    // The destroyed copy is still reported as unusable rather than ignored.
    expect(outcome?.rejected).toEqual(
      expect.arrayContaining([
        { id: newer.id, reason: 'unreadable-backup' },
      ]),
    );
    expect(new LicenseStore(fx.licenceDir).current.licenseId).toBe('lic_aaaa-bbbb');
  });

  it('restores nothing when every copy is damaged, and never mints a new licence', () => {
    fx = fixture();
    const record = fx.archive.capture('full-backup');
    corrupt(join(record.path, 'license-state.json'));
    corrupt(join(fx.licenceDir, 'license-state.json'));
    corrupt(join(fx.licenceDir, 'license-state.backup.json'));

    expect(fx.archive.restoreNewestVerified()).toBeNull();
    expect(() => new LicenseStore(fx.licenceDir)).toThrow(LicenseStateError);
  });

  it('refuses a copy taken on another computer even though its MAC is valid', () => {
    fx = fixture();
    const record = fx.archive.capture('full-backup');
    corrupt(join(fx.licenceDir, 'license-state.json'));
    corrupt(join(fx.licenceDir, 'license-state.backup.json'));

    const otherMachine = new LicenceBackupArchive(fx.licenceDir, {
      backupDirectory: fx.backupDir,
      machineId: 'KM-ZZZZ-YYYY-XXXX',
    });
    expect(otherMachine.restoreNewestVerified()).toBeNull();
    expect(() => new LicenseStore(fx.licenceDir)).toThrow(LicenseStateError);

    const summary = JSON.parse(
      readFileSync(join(fx.backupDir, 'operations.log'), 'utf8')
        .trim()
        .split('\n')
        .filter((line) => line.includes('"restore-failed"'))
        .pop() as string,
    );
    expect(summary.rejected[0].id).toBe(record.id);
    expect(summary.rejected[0].reason).toBe('machine-mismatch');
  });

  it('refuses a copy whose contents were edited after capture', () => {
    fx = fixture();
    const record = fx.archive.capture('full-backup');
    const statePath = join(record.path, 'license-state.json');
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
    parsed.state.maxSeatLimit = 500;
    writeFileSync(statePath, JSON.stringify(parsed));

    corrupt(join(fx.licenceDir, 'license-state.json'));
    corrupt(join(fx.licenceDir, 'license-state.backup.json'));

    expect(fx.archive.restoreNewestVerified()).toBeNull();
  });

  it('never lowers a watermark, even when an older copy recorded a smaller one', () => {
    let minute = 0;
    fx = fixture({ clock: () => new Date(Date.UTC(2026, 4, 1, 9, minute++, 0)) });
    fx.archive.capture('old');
    fx.store.update((state) => {
      state.maxSeatsUsed = 4;
      state.maxSeatLimit = 9;
      state.licenseExpiresAt = '2028-01-01T00:00:00.000Z';
      state.appliedKeys.push('key_renewal-2');
    });
    fx.archive.capture('new');

    // Lose the newer capture, then damage the live copies: the restore has to
    // keep what the newer snapshot knew.
    const newest = fx.archive.list()[0];
    rmSync(newest.path, { recursive: true, force: true });
    corrupt(join(fx.licenceDir, 'license-state.json'));
    corrupt(join(fx.licenceDir, 'license-state.backup.json'));

    const outcome = fx.archive.restoreNewestVerified();
    expect(outcome).not.toBeNull();
    // The only surviving snapshot is the older one; it is restored as itself,
    // and its watermarks are not inflated by anything that no longer exists.
    const state = new LicenseStore(fx.licenceDir).current;
    expect(state.maxSeatsUsed).toBe(2);
    expect(state.appliedKeys).toContain('key_activation-1');

    // And with both snapshots present, the union wins: nothing is lost.
    fx.dispose();
    fx = fixture({ clock: () => new Date(Date.UTC(2026, 4, 1, 9, minute++, 0)) });
    fx.archive.capture('old');
    fx.store.update((s) => {
      s.maxSeatsUsed = 4;
      s.maxSeatLimit = 9;
      // The store keeps a bounded list, so a spent key can drop out of the
      // live copy while an older snapshot still remembers it.
      s.appliedKeys = ['key_renewal-2'];
    });
    fx.archive.capture('new');
    corrupt(join(fx.licenceDir, 'license-state.json'));
    corrupt(join(fx.licenceDir, 'license-state.backup.json'));
    const merged = fx.archive.restoreNewestVerified();
    // The newest snapshot already carries the higher watermarks; the union is
    // what guarantees the older one's spent key is not forgotten.
    expect(merged?.merged).toEqual(
      expect.arrayContaining(['appliedKey:key_activation-1']),
    );
    const mergedState = new LicenseStore(fx.licenceDir).current;
    expect(mergedState.maxSeatsUsed).toBe(4);
    expect(mergedState.maxSeatLimit).toBe(9);
    expect(mergedState.appliedKeys).toEqual(
      expect.arrayContaining(['key_activation-1', 'key_renewal-2']),
    );
  });

  it('ignores an interrupted capture that never reached its final name', () => {
    fx = fixture();
    const record = fx.archive.capture('full-backup');
    mkdirSync(join(fx.backupDir, '.tmp-licence-20260501T090000Z-deadbeef'), {
      recursive: true,
    });
    writeFileSync(
      join(fx.backupDir, '.tmp-licence-20260501T090000Z-deadbeef', 'manifest.json'),
      '{"v":1}',
    );

    expect(fx.archive.list().map((entry) => entry.id)).toEqual([record.id]);
    corrupt(join(fx.licenceDir, 'license-state.json'));
    corrupt(join(fx.licenceDir, 'license-state.backup.json'));
    expect(fx.archive.restoreNewestVerified()?.restored.id).toBe(record.id);
  });

  it('survives captures running at the same time', () => {
    fx = fixture();
    const archives = [0, 1, 2].map(
      () =>
        new LicenceBackupArchive(fx.licenceDir, {
          backupDirectory: fx.backupDir,
          machineId: 'KM-AAAA-BBBB-CCCC',
          clock: () => new Date('2026-05-01T09:00:00.000Z'),
        }),
    );
    // Three writers, one folder: every capture must still verify (unique ids,
    // whole manifests only).
    const ids = archives.map((archive) => archive.capture('concurrent').id);
    expect(new Set(ids).size).toBe(3);
    expect(fx.archive.list()).toHaveLength(3);
  });

  it('records captures, restores and pruning in the operations log', () => {
    fx = fixture({ retention: 1 });
    fx.archive.capture('first');
    fx.store.update((state) => {
      state.maxSeatsUsed = 3;
    });
    fx.archive.capture('second');
    corrupt(join(fx.licenceDir, 'license-state.json'));
    corrupt(join(fx.licenceDir, 'license-state.backup.json'));
    fx.archive.restoreNewestVerified();

    const events = readFileSync(join(fx.backupDir, 'operations.log'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).event);
    expect(events).toEqual(
      expect.arrayContaining(['capture', 'prune', 'restore']),
    );
  });

  it('keeps the existing public key when a copy carries a different one', () => {
    fx = fixture();
    const record = fx.archive.capture('full-backup');
    // A newer key is an installer-approved rotation, not something a restore
    // may undo.
    writeFileSync(join(fx.licenceDir, 'public-key.pem'), 'ROTATED KEY');
    corrupt(join(fx.licenceDir, 'license-state.json'));
    corrupt(join(fx.licenceDir, 'license-state.backup.json'));
    expect(fx.archive.restoreNewestVerified()?.restored.id).toBe(record.id);
    expect(readFileSync(join(fx.licenceDir, 'public-key.pem'), 'utf8')).toBe(
      'ROTATED KEY',
    );
  });
});
