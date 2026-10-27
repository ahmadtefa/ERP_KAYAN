import { generateKeyPairSync, KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LicensePayload, signPayload } from './license-key';
import { LicenseStore } from './license-store';
import { LicensingService } from './licensing.service';
import {
  FakeDb,
  MACHINE,
  OTHER_MACHINE,
  PUBLIC_PEM,
  expectCode,
  harness,
  privateKey,
} from './licensing.harness';

/**
 * The difference between "a licence system exists" and "an installed copy
 * cannot be used without a licence".
 *
 * Everything here is about the copy Setup installs on a customer's computer:
 * its key file and its recorded enforcement are files an ordinary user cannot
 * write, and nothing in that user's environment may lower what they say.
 */
describe('an installed copy', () => {
  let installed: string;
  const env = process.env;

  beforeEach(() => {
    installed = mkdtempSync(join(tmpdir(), 'kayan-installed-'));
    writeFileSync(join(installed, 'public-key.pem'), PUBLIC_PEM);
  });

  afterEach(() => {
    rmSync(installed, { recursive: true, force: true });
    process.env = { ...env };
  });

  const build = (overrides: { machineId?: string } = {}) => {
    const now = new Date('2026-05-01T09:00:00.000Z');
    const db = new FakeDb(() => now);
    const store = new LicenseStore(installed);
    const service = new LicensingService(db as any, {} as any, {
      installedDirectory: installed,
      clock: () => now,
      appVersion: '0.1.0-test',
      ...(overrides.machineId ? { machineId: overrides.machineId } : {}),
      trustStore: store,
    });
    return { db, store, service };
  };

  const signed = (
    payload: Partial<LicensePayload>,
    signWith: KeyObject = privateKey,
  ) =>
    signPayload(
      {
        v: 1,
        keyId: 'key_installed-1',
        type: 'ACTIVATION',
        licenseId: 'lic_installed',
        machineId: MACHINE,
        issuedAt: '2026-04-30T00:00:00.000Z',
        term: { kind: 'MONTHS', months: 12 },
        seats: { mode: 'INCREASE', value: 5 },
        state: null,
        note: null,
        ...payload,
      } as LicensePayload,
      signWith,
    );

  it('enforces licences because its key file is installed, whatever the environment says', async () => {
    process.env.LICENSE_ENFORCEMENT = 'off';
    const { service } = build({ machineId: MACHINE });
    const status = await service.status();
    expect(status.enforcement).toBe('enforce');
    expect(status.configured).toBe(true);
    expect(status.state).toBe('UNLICENSED');
    expect(status.blocked).toBe(true);
  });

  it('cannot be pointed at a key chosen by whoever starts the program', async () => {
    // The person using the program makes their own key pair, puts their own
    // public key in the environment and signs their own activation key. The
    // installed key file must be the only one consulted, so this is refused.
    const attacker = generateKeyPairSync('ed25519');
    process.env.LICENSE_PUBLIC_KEY = attacker.publicKey
      .export({ format: 'pem', type: 'spki' })
      .toString();
    const { service } = build({ machineId: MACHINE });
    await expectCode(
      service.activate(signed({}, attacker.privateKey)),
      'LICENSE_KEY_BAD_SIGNATURE',
    );
    expect((await service.status()).state).toBe('UNLICENSED');
  });

  it('ignores LICENSE_MACHINE_ID, so a key for another computer stays refused', async () => {
    process.env.LICENSE_MACHINE_ID = OTHER_MACHINE;
    const { service } = build();
    expect(service.machineId()).not.toBe(OTHER_MACHINE);
    const keyForOther = signed({ machineId: OTHER_MACHINE });
    await expectCode(
      service.activate(keyForOther),
      'LICENSE_KEY_WRONG_MACHINE',
    );
  });

  it('cannot be moved off its protected state folder by LICENSE_STATE_DIR', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'kayan-elsewhere-'));
    process.env.LICENSE_STATE_DIR = elsewhere;
    try {
      const { service } = build({ machineId: MACHINE });
      await service.status();
      const status = await service.status({ fresh: true });
      // The install id belongs to the protected folder's state file.
      expect(status.installId).toBe(
        new LicenseStore(installed).current.installId,
      );
      expect(status.installId).not.toBe(
        new LicenseStore(elsewhere).current.installId,
      );
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('accepts a genuine key and stops blocking business use', async () => {
    const { service } = build({ machineId: MACHINE });
    expect((await service.status()).blocked).toBe(true);
    const status = await service.activate(signed({}));
    expect(status.state).toBe('ACTIVE');
    expect(status.blocked).toBe(false);
  });
});

describe('enforcement that was already decided', () => {
  it('is never lowered by an environment variable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kayan-recorded-'));
    const previous = process.env.LICENSE_ENFORCEMENT;
    try {
      const store = new LicenseStore(dir);
      store.update((state) => {
        state.enforcement = 'enforce';
      });
      process.env.LICENSE_ENFORCEMENT = 'warn';
      const now = new Date('2026-05-01T09:00:00.000Z');
      const db = new FakeDb(() => now);
      const service = new LicensingService(db as any, {} as any, {
        directory: dir,
        installedDirectory: null,
        publicKeyText: PUBLIC_PEM,
        clock: () => now,
        machineId: MACHINE,
        trustStore: store,
      });
      const status = await service.status();
      expect(status.enforcement).toBe('enforce');
      expect(status.blocked).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      if (previous === undefined) delete process.env.LICENSE_ENFORCEMENT;
      else process.env.LICENSE_ENFORCEMENT = previous;
    }
  });
});

describe('a licence that cannot be read', () => {
  it('blocks business use instead of granting it', async () => {
    const h = harness();
    try {
      (h.db.licenseInstallation as any).findFirst = async () => {
        throw new Error('the database went away');
      };
      expect(await h.service.isBlocked()).toBe(true);
    } finally {
      h.dispose();
    }
  });
});
