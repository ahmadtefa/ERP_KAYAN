import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LICENCE_BACKUP_DIR_NAME } from './licence-backup-archive';
import { LicenseStateError, LicenseStore } from './license-store';
import { LicenseGuard } from './license.guard';
import { LicensingService } from './licensing.service';
import { activation, expectCode, harness, MACHINE, PUBLIC_PEM } from './licensing.harness';

// Synthetic keys and FakeDb only. The installed directory below is a fresh
// test directory, never a customer path or a real database.
describe('installed licence state corruption safety', () => {
  it.each(['unreadable-json', 'wrong-mac', 'null-state'])('recovers %s primary from the authenticated mirror without unblocking an untrusted state', async (kind) => {
    const h = harness();
    try {
      const before = await activation(h);
      const path = join(h.dir, 'license-state.json');
      const backup = join(h.dir, 'license-state.backup.json');
      const keyPath = join(h.dir, 'state.key');
      const original = readFileSync(path);
      const keyHash = createHash('sha256').update(readFileSync(keyPath)).digest('hex');
      const dbBefore = structuredClone(h.db.installations);
      writeFileSync(join(h.dir, 'public-key.pem'), PUBLIC_PEM);
      const corrupt = kind === 'unreadable-json'
        ? 'not JSON'
        : JSON.stringify({ state: kind === 'null-state' ? null : { v: 1 }, mac: '00'.repeat(32) });
      writeFileSync(path, corrupt);
      const installed = new LicensingService(h.db as any, {} as any, {
        installedDirectory: h.dir, machineId: MACHINE, clock: () => new Date('2026-05-01T09:00:00.000Z'),
      });
      await installed.onModuleInit();
      // The mirror is authenticated with this installation's existing key.
      // Recovery must restore the original entitlement, never an empty state.
      expect(installed.licenseSummary().stateError).toBeUndefined();
      const recovered = await installed.status({ fresh: true });
      expect(recovered.state).toBe('ACTIVE');
      expect(recovered.blocked).toBe(false);
      expect(recovered.licenseId).toBe(before.licenseId);
      expect(recovered.expiresAt).toBe(before.expiresAt);
      expect(readFileSync(path, 'utf8')).toBe(readFileSync(backup, 'utf8'));
      expect(createHash('sha256').update(readFileSync(keyPath)).digest('hex')).toBe(keyHash);
      expect(h.db.installations).toEqual(dbBefore);
      expect(existsSync(backup)).toBe(true);
      expect(installed.isEnforced()).toBe(true);
    } finally {
      h.dispose();
    }
  });

  it('keeps damaged state blocked until both authenticated copies and database bootstrap are restored', async () => {
    const h = harness();
    try {
      await activation(h);
      // The activation above took a licence backup. This test is about the
      // installation that has *no* recoverable copy, so the backups are
      // removed first; the recovery path is covered separately below.
      rmSync(join(h.dir, LICENCE_BACKUP_DIR_NAME), { recursive: true, force: true });
      const path = join(h.dir, 'license-state.json');
      const backup = join(h.dir, 'license-state.backup.json');
      const original = readFileSync(path);
      const originalBackup = readFileSync(backup);
      writeFileSync(join(h.dir, 'public-key.pem'), PUBLIC_PEM);
      writeFileSync(path, 'broken-primary');
      writeFileSync(backup, 'broken-backup');
      const installed = new LicensingService(h.db as any, {} as any, {
        installedDirectory: h.dir, machineId: MACHINE, clock: () => new Date('2026-05-01T09:00:00.000Z'),
      });
      await installed.onModuleInit();
      const find = h.db.licenseInstallation.findFirst;
      let resume!: () => void;
      const wait = new Promise<void>((resolve) => { resume = resolve; });
      h.db.licenseInstallation.findFirst = async () => { await wait; return find(); };
      // While both copies are corrupt, status must fail closed. The public
      // controller converts this specific error into a blocked recovery
      // diagnostic; the service itself must never manufacture an entitlement.
      await expect(installed.status({ fresh: true })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'LICENSE_STATE_DAMAGED' }),
      });
      writeFileSync(path, original);
      writeFileSync(backup, originalBackup);
      resume();
      expect((await installed.status({ fresh: true })).state).toBe('ACTIVE');
      expect(installed.licenseSummary().stateError).toBeUndefined();
    } finally {
      h.dispose();
    }
  });

  it('does not create empty state during recovery even with an explicit state secret', async () => {
    const previous = process.env.LICENSE_STATE_SECRET;
    process.env.LICENSE_STATE_SECRET = 'synthetic-test-state-secret';
    const h = harness();
    try {
      await activation(h);
      rmSync(join(h.dir, LICENCE_BACKUP_DIR_NAME), { recursive: true, force: true });
      const path = join(h.dir, 'license-state.json');
      const backup = join(h.dir, 'license-state.backup.json');
      const original = readFileSync(path);
      const originalBackup = readFileSync(backup);
      writeFileSync(join(h.dir, 'public-key.pem'), PUBLIC_PEM);
      writeFileSync(path, 'broken-primary');
      writeFileSync(backup, 'broken-backup');
      const installed = new LicensingService(h.db as any, {} as any, {
        installedDirectory: h.dir, machineId: MACHINE, clock: () => new Date('2026-05-01T09:00:00.000Z'),
      });
      await installed.onModuleInit();
      await expect(installed.status({ fresh: true })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'LICENSE_STATE_DAMAGED' }),
      });
      expect(existsSync(path)).toBe(true);
      writeFileSync(path, original);
      writeFileSync(backup, originalBackup);
      expect((await installed.status({ fresh: true })).state).toBe('ACTIVE');
    } finally {
      h.dispose();
      if (previous === undefined) delete process.env.LICENSE_STATE_SECRET;
      else process.env.LICENSE_STATE_SECRET = previous;
    }
  });

  it('rejects a foreign primary and recovers only this installation’s authenticated mirror', async () => {
    const h = harness();
    const other = harness();
    try {
      await activation(h);
      await activation(other);
      writeFileSync(join(h.dir, 'public-key.pem'), PUBLIC_PEM);
      const path = join(h.dir, 'license-state.json');
      const foreign = readFileSync(join(other.dir, 'license-state.json'));
      writeFileSync(path, foreign);
      const dbBefore = structuredClone(h.db.installations);
      const installed = new LicensingService(h.db as any, {} as any, {
        installedDirectory: h.dir, machineId: MACHINE, clock: () => new Date('2026-05-01T09:00:00.000Z'),
      });
      const status = await installed.status({ fresh: true });
      expect(status.state).toBe('ACTIVE');
      expect(status.licenseId).toBe(h.db.installations[0].licenseId);
      expect(h.db.installations).toEqual(dbBefore);
      expect(readFileSync(path, 'utf8')).toBe(readFileSync(join(h.dir, 'license-state.backup.json'), 'utf8'));
    } finally {
      h.dispose();
      other.dispose();
    }
  });

  it('reconciles an older authentic state against a newer database and refuses replay there', async () => {
    const h = harness();
    try {
      await activation(h);
      writeFileSync(join(h.dir, 'public-key.pem'), PUBLIC_PEM);
      const path = join(h.dir, 'license-state.json');
      const oldState = readFileSync(path);
      const key = h.key({ type: 'SEATS', keyId: 'synthetic-seats-after-backup', machineId: null,
        term: null, seats: { mode: 'INCREASE', value: 3 } });
      expect((await h.service.addSeats(key)).seats.limit).toBe(8);
      writeFileSync(path, oldState);
      const restarted = new LicensingService(h.db as any, {} as any, {
        installedDirectory: h.dir, machineId: MACHINE, clock: () => new Date('2026-05-01T09:00:00.000Z'),
      });
      const status = await restarted.status({ fresh: true });
      expect(status.blocked).toBe(false);
      expect(status.seats.limit).toBe(8);
      expect(new LicenseStore(h.dir).current.maxSeatLimit).toBe(8);
      await expectCode(restarted.addSeats(key), 'LICENSE_KEY_ALREADY_USED');
      // This does NOT establish freshness if both database and state roll back.
    } finally { h.dispose(); }
  });

  it('reconciles an older database against newer intact watermarks and refuses replay', async () => {
    const h = harness();
    try {
      await activation(h);
      writeFileSync(join(h.dir, 'public-key.pem'), PUBLIC_PEM);
      const oldInstallations = structuredClone(h.db.installations);
      const oldKeys = structuredClone(h.db.keys);
      const key = h.key({ type: 'SEATS', keyId: 'synthetic-seats-before-db-restore', machineId: null,
        term: null, seats: { mode: 'INCREASE', value: 3 } });
      expect((await h.service.addSeats(key)).seats.limit).toBe(8);
      h.db.installations = oldInstallations;
      h.db.keys = oldKeys;
      const restarted = new LicensingService(h.db as any, {} as any, {
        installedDirectory: h.dir, machineId: MACHINE, clock: () => new Date('2026-05-01T09:00:00.000Z'),
      });
      const status = await restarted.status({ fresh: true });
      expect(status.blocked).toBe(false);
      expect(status.seats.limit).toBe(8);
      expect(h.db.installations[0].seatLimit).toBe(8);
      await expectCode(restarted.addSeats(key), 'LICENSE_KEY_ALREADY_USED');
    } finally { h.dispose(); }
  });

  it('recovers a missing primary state from its authenticated mirror when the key is still present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kayan-missing-state-'));
    try {
      const store = new LicenseStore(dir);
      const path = join(dir, 'license-state.json');
      const saved = join(dir, 'diagnostic-copy.json');
      renameSync(path, saved);
      expect(store.reload().sequence).toBe(0);
      expect(store.recoveredFromBackup).toBe(true);
      expect(existsSync(path)).toBe(true);
      expect(existsSync(saved)).toBe(true);
      const restarted = new LicenseStore(dir);
      expect(restarted.current.installId).toBe(store.current.installId);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not overwrite an invalid existing authentication key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kayan-invalid-state-key-'));
    try {
      const key = join(dir, 'state.key');
      writeFileSync(key, 'invalid-test-key');
      const before = createHash('sha256').update(readFileSync(key)).digest('hex');
      expect(() => new LicenseStore(dir)).toThrow(LicenseStateError);
      expect(createHash('sha256').update(readFileSync(key)).digest('hex')).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not generate a replacement authentication key for existing state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kayan-missing-state-key-'));
    try {
      const state = join(dir, 'license-state.json');
      writeFileSync(state, '{"state":{},"mac":"synthetic"}');
      expect(() => new LicenseStore(dir)).toThrow(LicenseStateError);
      expect(existsSync(join(dir, 'state.key'))).toBe(false);
      expect(readFileSync(state, 'utf8')).toBe('{"state":{},"mac":"synthetic"}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('restores both damaged copies from the authenticated licence backup and keeps serving', async () => {
    const h = harness();
    try {
      const before = await activation(h);
      const path = join(h.dir, 'license-state.json');
      const backup = join(h.dir, 'license-state.backup.json');
      writeFileSync(join(h.dir, 'public-key.pem'), PUBLIC_PEM);
      writeFileSync(path, 'broken-primary');
      writeFileSync(backup, 'broken-backup');
      const installed = new LicensingService(h.db as any, {} as any, {
        installedDirectory: h.dir, machineId: MACHINE, clock: () => new Date('2026-05-01T09:00:00.000Z'),
      });
      await installed.onModuleInit();
      // A verified, machine-bound backup is a recovery source: the program
      // comes back after the damage instead of staying blocked forever.
      const status = await installed.status({ fresh: true });
      expect(status.state).toBe('ACTIVE');
      expect(status.blocked).toBe(false);
      expect(status.licenseId).toBe(before.licenseId);
      expect(installed.licenseSummary().stateError).toBeUndefined();
      // The damaged originals were preserved for diagnosis, not overwritten.
      const { readdirSync } = require('node:fs') as typeof import('node:fs');
      expect(
        readdirSync(h.dir).filter((name: string) => name.includes('.damaged-')),
      ).not.toHaveLength(0);
    } finally {
      h.dispose();
    }
  });

  it('still fails closed when the licence backup is damaged as well', async () => {
    const h = harness();
    try {
      await activation(h);
      const { readdirSync } = require('node:fs') as typeof import('node:fs');
      const backupsDir = join(h.dir, LICENCE_BACKUP_DIR_NAME);
      for (const name of readdirSync(backupsDir)) {
        if (!name.startsWith('licence-')) continue;
        const statePath = join(backupsDir, name, 'license-state.json');
        if (existsSync(statePath)) writeFileSync(statePath, 'broken-copy');
      }
      writeFileSync(join(h.dir, 'public-key.pem'), PUBLIC_PEM);
      writeFileSync(join(h.dir, 'license-state.json'), 'broken-primary');
      writeFileSync(join(h.dir, 'license-state.backup.json'), 'broken-backup');
      const installed = new LicensingService(h.db as any, {} as any, {
        installedDirectory: h.dir, machineId: MACHINE, clock: () => new Date('2026-05-01T09:00:00.000Z'),
      });
      await installed.onModuleInit();
      await expect(installed.status({ fresh: true })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'LICENSE_STATE_DAMAGED' }),
      });
    } finally {
      h.dispose();
    }
  });
});
