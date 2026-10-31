import { ExecutionContext } from '@nestjs/common';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LicenseGuard } from './license.guard';
import { LicenseStore } from './license-store';
import { LicensingService } from './licensing.service';
import { FakeDb, MACHINE, PUBLIC_PEM, expectCode } from './licensing.harness';

/**
 * An installation whose verification key is unusable.
 *
 * The installed `public-key.pem` is a file on a customer's computer: it can go
 * missing after a bad restore, end up empty after a truncated copy, or be
 * replaced by something that is not a key at all. Every one of those is the
 * same verdict - nothing on this machine can authenticate a licence - and the
 * same requirement:
 *
 *  * the server keeps running and stays reachable, so the desktop shell can
 *    open, show the state and offer the licence screen;
 *  * it reports `configured: false`, `blocked: true`, `enforcement: enforce`;
 *  * it refuses every business route and every licence key;
 *  * it does not invent a key, a licence, or a new trust state;
 *  * restoring the approved key restores exactly the previous behaviour.
 *
 * What this suite deliberately does *not* claim is that the Flutter shell opens
 * on such an installation - that is proved by the installed-app smoke test on
 * a real Windows runner, which moves the file, empties it and garbles it.
 */
describe('an installation with an unusable verification key', () => {
  const cases: Array<{ problem: string; damage: () => void }> = [
    { problem: 'missing', damage: () => undefined },
    { problem: 'empty', damage: () => undefined },
    { problem: 'malformed', damage: () => undefined },
    { problem: 'a different key', damage: () => undefined },
  ];

  let installed: string;
  const previousEnforcement = process.env.LICENSE_ENFORCEMENT;

  beforeEach(() => {
    installed = mkdtempSync(join(tmpdir(), 'kayan-keyless-'));
    // The installer writes the approved key; each case damages it afterwards.
    writeFileSync(join(installed, 'public-key.pem'), PUBLIC_PEM);
    delete process.env.LICENSE_ENFORCEMENT;
  });

  afterEach(() => {
    rmSync(installed, { recursive: true, force: true });
    if (previousEnforcement === undefined) delete process.env.LICENSE_ENFORCEMENT;
    else process.env.LICENSE_ENFORCEMENT = previousEnforcement;
  });

  /** One start of the program: a fresh store, a fresh service over the folder. */
  const start = () => {
    const now = new Date('2026-05-01T09:00:00.000Z');
    const db = new FakeDb(() => now);
    const store = new LicenseStore(installed);
    const service = new LicensingService(db as any, {} as any, {
      installedDirectory: installed,
      clock: () => now,
      appVersion: '0.1.0-test',
      machineId: MACHINE,
      trustStore: store,
    });
    const guard = new LicenseGuard(service);
    const ctx = (path: string) =>
      ({ switchToHttp: () => ({ getRequest: () => ({ path }) }) }) as unknown as ExecutionContext;
    return { db, store, service, guard, ctx };
  };

  const keyPath = () => join(installed, 'public-key.pem');

  const damage = (problem: string, path: string) => {
    if (problem === 'missing') rmSync(path, { force: true });
    if (problem === 'empty') writeFileSync(path, '');
    if (problem === 'malformed') writeFileSync(path, 'not a public key');
    if (problem === 'a different key') {
      writeFileSync(
        path,
        generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' }).toString(),
      );
    }
  };

  it.each(cases)(
    'keeps running, blocks business and invents nothing when the key is $problem',
    async ({ problem }) => {
      // A first start with the approved key records this installation's
      // identity and its trusted fingerprint. That record is what makes a
      // different key a fault rather than a first-run choice.
      const first = start();
      const healthy = await first.service.status({ fresh: true });
      expect(healthy.configured).toBe(true);
      const installId = first.store.current.installId;
      const fingerprint = first.store.current.publicKeyFingerprint;
      expect(fingerprint).toBeTruthy();

      damage(problem, keyPath());
      const damaged = start();
      const status = await damaged.service.status({ fresh: true });

      expect(status.enforcement).toBe('enforce');
      expect(status.configured).toBe(false);
      expect(status.blocked).toBe(true);
      expect(damaged.service.licenseSummary().configured).toBe(false);
      // Damage to the key is not the same verdict as damage to the trust
      // state: the store itself still verifies, and no recovery is attempted.
      expect(damaged.service.licenseSummary().stateError).toBeUndefined();

      // Reachable: health, signing in, and the licence routes the activation
      // screen uses. Blocked: everything that touches the books.
      expect(await damaged.guard.canActivate(damaged.ctx('/api/v1/health'))).toBe(true);
      expect(await damaged.guard.canActivate(damaged.ctx('/api/v1/auth/login'))).toBe(true);
      expect(await damaged.guard.canActivate(damaged.ctx('/api/v1/license/status'))).toBe(true);
      expect(await damaged.guard.canActivate(damaged.ctx('/api/v1/backup/download'))).toBe(true);
      expect(await damaged.service.requestCode()).toMatchObject({ machineId: MACHINE });
      await expectCode(
        damaged.guard.canActivate(damaged.ctx('/api/v1/parties/customers')),
        'LICENSE_PUBLIC_KEY_MISSING',
      );
      await expectCode(
        damaged.guard.canActivate(damaged.ctx('/api/v1/sales/invoices')),
        'LICENSE_PUBLIC_KEY_MISSING',
      );

      // No key can be applied without a key that could verify it, and nothing
      // reaches the ledger.
      await expect(damaged.service.activate('KAYAN1.NOT-A-REAL-LICENCE')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'LICENSE_PUBLIC_KEY_MISSING' }),
      });
      expect(damaged.db.installations).toEqual([]);
      expect(damaged.db.keys).toEqual([]);
      expect(damaged.db.seats).toEqual([]);

      // The program neither writes a replacement key nor forgets who it is.
      if (problem === 'missing') {
        expect(existsSync(keyPath())).toBe(false);
      } else {
        const expected = problem === 'empty' ? '' : problem === 'malformed' ? 'not a public key' : null;
        const written = readFileSync(keyPath(), 'utf8');
        if (expected !== null) expect(written).toBe(expected);
        else expect(written).not.toBe(PUBLIC_PEM);
      }
      expect(damaged.store.current.installId).toBe(installId);
      expect(damaged.store.current.publicKeyFingerprint).toBe(fingerprint);
      expect(existsSync(join(installed, 'license-state.json'))).toBe(true);
      expect(damaged.store.current.enforcement).toBe('enforce');
    },
  );

  it('recovers the previous behaviour exactly when the approved key is put back', async () => {
    const first = start();
    expect((await first.service.status({ fresh: true })).configured).toBe(true);
    const installId = first.store.current.installId;

    // The restart that discovers the missing file.
    rmSync(keyPath(), { force: true });
    const damaged = start();
    expect((await damaged.service.status({ fresh: true })).configured).toBe(false);

    // The restart after support puts the approved key back.
    writeFileSync(keyPath(), PUBLIC_PEM);
    const restored = start();
    const status = await restored.service.status({ fresh: true });
    expect(status.configured).toBe(true);
    expect(status.enforcement).toBe('enforce');
    // Still unlicensed: this product build carries no licence, so business
    // stays blocked with the ordinary activation-required answer - not with a
    // key-missing answer.
    expect(status.blocked).toBe(true);
    await expectCode(
      restored.guard.canActivate(restored.ctx('/api/v1/parties/customers')),
      'LICENSE_REQUIRED',
    );
    expect(restored.store.current.installId).toBe(installId);
    expect(await restored.guard.canActivate(restored.ctx('/api/v1/health'))).toBe(true);
  });

  it('does not create a licence from a key that does not verify, even with a key present', async () => {
    const { service, db, store } = start();
    expect((await service.status({ fresh: true })).configured).toBe(true);
    const fingerprint = store.current.publicKeyFingerprint;

    await expect(service.activate('KAYAN1.FORGED-SIGNATURE')).rejects.toBeDefined();

    expect(db.installations).toEqual([]);
    expect(db.keys).toEqual([]);
    expect(db.seats).toEqual([]);
    expect(store.current.publicKeyFingerprint).toBe(fingerprint);
  });
});

describe('the guard names a missing key, not a missing licence', () => {
  it('is a distinct code so support can tell the two apart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kayan-keyless-guard-'));
    try {
      const now = new Date('2026-05-01T09:00:00.000Z');
      const db = new FakeDb(() => now);
      const store = new LicenseStore(dir);
      const service = new LicensingService(db as any, {} as any, {
        installedDirectory: dir,
        clock: () => now,
        appVersion: '0.1.0-test',
        machineId: MACHINE,
        trustStore: store,
      });
      const guard = new LicenseGuard(service);
      const ctx = (path: string) =>
        ({ switchToHttp: () => ({ getRequest: () => ({ path }) }) }) as unknown as ExecutionContext;
      await expectCode(
        guard.canActivate(ctx('/api/v1/parties/customers')),
        'LICENSE_PUBLIC_KEY_MISSING',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
