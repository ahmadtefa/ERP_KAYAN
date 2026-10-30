import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LicenseStateError, LicenseStore } from './license-store';
import { LicenseGuard } from './license.guard';
import { LicensingService } from './licensing.service';
import { activation, expectCode, harness, MACHINE, PUBLIC_PEM } from './licensing.harness';

// Synthetic keys and FakeDb only. The installed directory below is a fresh
// test directory, never a customer path or a real database.
describe('installed licence state corruption safety', () => {
  it.each(['unreadable-json', 'wrong-mac', 'null-state'])('preserves %s and resumes an active licence after restoring its intact state', async (kind) => {
    const h = harness();
    try {
      const before = await activation(h);
      expect(before.state).toBe('ACTIVE');
      const path = join(h.dir, 'license-state.json');
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
      expect(installed.isEnforced()).toBe(true);
      expect(installed.licenseSummary().stateError).toBe('LICENSE_STATE_DAMAGED');
      const guard = new LicenseGuard(installed);
      const context = (path: string) => ({
        switchToHttp: () => ({ getRequest: () => ({ path }) }),
      }) as any;
      expect(await guard.canActivate(context('/api/v1/health'))).toBe(true);
      await expect(guard.canActivate(context('/api/v1/invoices'))).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'LICENSE_STATE_DAMAGED' }),
      });
      await expect(installed.status({ fresh: true })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'LICENSE_STATE_DAMAGED' }),
      });
      expect(readFileSync(path, 'utf8')).toBe(corrupt);
      expect(createHash('sha256').update(readFileSync(keyPath)).digest('hex')).toBe(keyHash);
      expect(h.db.installations).toEqual(dbBefore);
      // Preserve this test's corrupt file for diagnosis before restoring its
      // intact synthetic state. The service itself never moves either file.
      const diagnostic = join(h.dir, 'diagnostic-corrupt-state.json');
      renameSync(path, diagnostic);
      writeFileSync(path, original);
      expect(readFileSync(diagnostic, 'utf8')).toBe(corrupt);
      // Health starts a background retry without waiting for the database.
      expect(installed.licenseSummary().stateError).toBe('LICENSE_STATE_DAMAGED');
      await new Promise<void>((done) => setImmediate(done));
      expect(installed.licenseSummary().stateError).toBeUndefined();
      const recovered = await installed.status({ fresh: true });
      expect(recovered.state).toBe('ACTIVE');
      expect(recovered.blocked).toBe(false);
      expect(recovered.licenseId).toBe(before.licenseId);
      expect(recovered.expiresAt).toBe(before.expiresAt);
      expect(installed.licenseSummary().stateError).toBeUndefined();
    } finally {
      h.dispose();
    }
  });

  it('keeps the error visible until restored state and database bootstrap both finish', async () => {
    const h = harness();
    try {
      await activation(h);
      const path = join(h.dir, 'license-state.json');
      const original = readFileSync(path);
      writeFileSync(join(h.dir, 'public-key.pem'), PUBLIC_PEM);
      writeFileSync(path, 'broken');
      const installed = new LicensingService(h.db as any, {} as any, {
        installedDirectory: h.dir, machineId: MACHINE, clock: () => new Date('2026-05-01T09:00:00.000Z'),
      });
      await installed.onModuleInit();
      const find = h.db.licenseInstallation.findFirst;
      let resume!: () => void;
      const wait = new Promise<void>((resolve) => { resume = resolve; });
      h.db.licenseInstallation.findFirst = async () => { await wait; return find(); };
      writeFileSync(path, original);
      expect(installed.licenseSummary().stateError).toBe('LICENSE_STATE_DAMAGED');
      expect(installed.licenseSummary().stateError).toBe('LICENSE_STATE_DAMAGED');
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
      const path = join(h.dir, 'license-state.json');
      const original = readFileSync(path);
      writeFileSync(join(h.dir, 'public-key.pem'), PUBLIC_PEM);
      writeFileSync(path, 'broken');
      const installed = new LicensingService(h.db as any, {} as any, {
        installedDirectory: h.dir, machineId: MACHINE, clock: () => new Date('2026-05-01T09:00:00.000Z'),
      });
      await installed.onModuleInit();
      renameSync(path, join(h.dir, 'diagnostic-corrupt-state.json'));
      await expect(installed.status({ fresh: true })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'LICENSE_STATE_DAMAGED' }),
      });
      expect(existsSync(path)).toBe(false);
      writeFileSync(path, original);
      expect((await installed.status({ fresh: true })).state).toBe('ACTIVE');
    } finally {
      h.dispose();
      if (previous === undefined) delete process.env.LICENSE_STATE_SECRET;
      else process.env.LICENSE_STATE_SECRET = previous;
    }
  });

  it('rejects a valid backup belonging to another synthetic installation', async () => {
    const h = harness();
    const other = harness();
    try {
      await activation(h);
      await activation(other);
      writeFileSync(join(h.dir, 'public-key.pem'), PUBLIC_PEM);
      const path = join(h.dir, 'license-state.json');
      const foreign = readFileSync(join(other.dir, 'license-state.json'));
      writeFileSync(path, foreign);
      const before = createHash('sha256').update(foreign).digest('hex');
      const dbBefore = structuredClone(h.db.installations);
      const installed = new LicensingService(h.db as any, {} as any, {
        installedDirectory: h.dir, machineId: MACHINE, clock: () => new Date('2026-05-01T09:00:00.000Z'),
      });
      await expect(installed.status({ fresh: true })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'LICENSE_STATE_DAMAGED' }),
      });
      expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(before);
      expect(h.db.installations).toEqual(dbBefore);
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

  it('does not recreate a missing state when its key is still present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kayan-missing-state-'));
    try {
      const store = new LicenseStore(dir);
      const path = join(dir, 'license-state.json');
      const saved = join(dir, 'diagnostic-copy.json');
      renameSync(path, saved);
      expect(() => store.reload()).toThrow(LicenseStateError);
      expect(() => new LicenseStore(dir)).toThrow(LicenseStateError);
      expect(existsSync(path)).toBe(false);
      expect(existsSync(saved)).toBe(true);
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
});
