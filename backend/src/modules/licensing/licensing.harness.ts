import { ForbiddenException } from '@nestjs/common';
import { generateKeyPairSync, KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LicensePayload, signPayload } from './license-key';
import { LicenseStore } from './license-store';
import { LicensingService } from './licensing.service';

/**
 * The service is tested against an in-memory ledger that behaves like the four
 * Prisma models it uses, including transaction rollback. That is enough to
 * prove the decisions this service makes - which key is refused, what a grant
 * is worth, how a replay is caught, how the clock policy escalates - and it is
 * not a substitute for the SQL-level test of the unique index and the advisory
 * lock, which needs PostgreSQL (see the licensing report).
 */

export const MACHINE = 'KM-AAAA-BBBB-CCCC';
export const OTHER_MACHINE = 'KM-ZZZZ-YYYY-XXXX';
export const LICENSE = 'lic_aaaa-bbbb';
export const SECOND_LICENSE = 'lic_qqqq-rrrr';

export const { privateKey, publicKey } = generateKeyPairSync('ed25519');
export const PUBLIC_PEM = publicKey.export({ format: 'pem', type: 'spki' }).toString();

type Row = Record<string, any>;

export class FakeDb {
  installations: Row[] = [];
  keys: Row[] = [];
  seats: Row[] = [];
  events: Row[] = [];
  users: Row[] = [];
  clockLog: string[] = [];
  private sequence = 0;

  constructor(private readonly now: () => Date) {}

  private snapshot() {
    return structuredClone({
      installations: this.installations,
      keys: this.keys,
      seats: this.seats,
      events: this.events,
    });
  }

  private restore(snap: ReturnType<FakeDb['snapshot']>) {
    this.installations = snap.installations;
    this.keys = snap.keys;
    this.seats = snap.seats;
    this.events = snap.events;
  }

  $transaction = async <T>(fn: (tx: FakeDb) => Promise<T>): Promise<T> => {
    const snap = this.snapshot();
    try {
      return await fn(this);
    } catch (error) {
      this.restore(snap);
      throw error;
    }
  };

  $queryRawUnsafe = async (query: string) => {
    this.clockLog.push(query);
    return [{ pg_advisory_xact_lock: null }];
  };

  licenseInstallation = {
    findFirst: async () =>
      [...this.installations].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      )[0] ?? null,
    create: async ({ data }: { data: Row }) => {
      const row = {
        ...data,
        id: `install-${++this.sequence}`,
        createdAt: this.now(),
        updatedAt: this.now(),
      };
      this.installations.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { licenseId: string }; data: Row }) => {
      const row = this.installations.find((r) => r.licenseId === where.licenseId);
      if (!row) throw new Error('installation not found');
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { licenseId: string };
      create: Row;
      update: Row;
    }) => {
      const row = this.installations.find((r) => r.licenseId === where.licenseId);
      if (row) {
        Object.assign(row, update, { updatedAt: this.now() });
        return row;
      }
      const created = {
        ...create,
        id: `install-${++this.sequence}`,
        createdAt: this.now(),
        updatedAt: this.now(),
      };
      this.installations.push(created);
      return created;
    },
  };

  licenseKeyRecord = {
    findUnique: async ({ where }: { where: { keyId: string } }) =>
      this.keys.find((row) => row.keyId === where.keyId) ?? null,
    create: async ({ data }: { data: Row }) => {
      if (this.keys.some((row) => row.keyId === data.keyId)) {
        const error = new Error('Unique constraint failed on the fields: (`keyId`)');
        (error as any).code = 'P2002';
        throw error;
      }
      const row = { ...data, appliedAt: this.now() };
      this.keys.push(row);
      return row;
    },
  };

  licenseSeatUsage = {
    count: async () => this.seats.length,
    findUnique: async ({ where }: { where: { idempotencyKey?: string } }) =>
      this.seats.find((row) => row.idempotencyKey === where.idempotencyKey) ?? null,
    create: async ({ data }: { data: Row }) => {
      const row = { ...data, createdAt: this.now() };
      this.seats.push(row);
      return row;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { licenseId: string | null };
      data: Row;
    }) => {
      let count = 0;
      for (const row of this.seats) {
        if (row.licenseId === where.licenseId) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    },
  };

  licenseEvent = {
    create: async ({ data }: { data: Row }) => {
      const row = { ...data, occurredAt: this.now() };
      this.events.push(row);
      return row;
    },
    findFirst: async ({ orderBy }: { orderBy: { occurredAt: 'desc' } }) => {
      const sorted = [...this.events].sort(
        (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime(),
      );
      return orderBy ? sorted[0] ?? null : null;
    },
    findMany: async ({ take }: { take: number }) =>
      [...this.events]
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
        .slice(0, take),
  };

  user = {
    findFirst: async () => {
      const sorted = [...this.users].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );
      return sorted[0] ?? null;
    },
  };
}

export interface Harness {
  db: FakeDb;
  store: LicenseStore;
  service: LicensingService;
  dir: string;
  setNow(iso: string): void;
  key(overrides: Partial<LicensePayload>): string;
  dispose(): void;
}

export function harness(
  options: {
    enforcement?: 'off' | 'warn' | 'enforce';
    machineId?: string;
    /** The operator's public key; the generator spec supplies its own. */
    publicKeyText?: string;
    /** Signs the keys built by `h.key`, for a key pair of the caller's making. */
    signWith?: KeyObject;
    /** The wall clock the service starts at; real time for real issued keys. */
    clockIso?: string;
  } = {},
): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'kayan-license-'));
  const store = new LicenseStore(dir);
  let now = new Date(options.clockIso ?? '2026-05-01T09:00:00.000Z');
  const db = new FakeDb(() => now);
  const service = new LicensingService(db as any, {} as any, {
    directory: dir,
    publicKeyText: options.publicKeyText ?? PUBLIC_PEM,
    enforcement: options.enforcement ?? 'enforce',
    clock: () => now,
    appVersion: '0.1.0-test',
    machineId: options.machineId ?? MACHINE,
    trustStore: store,
  });

  const base: LicensePayload = {
    v: 1,
    keyId: 'key_activation-1',
    type: 'ACTIVATION',
    licenseId: LICENSE,
    machineId: MACHINE,
    issuedAt: '2026-04-30T00:00:00.000Z',
    term: { kind: 'MONTHS', months: 12 },
    seats: { mode: 'INCREASE', value: 5 },
    state: null,
    note: null,
  };

  return {
    db,
    store,
    service,
    dir,
    setNow: (iso) => {
      now = new Date(iso);
    },
    key: (overrides) =>
      signPayload(
        { ...base, ...overrides } as LicensePayload,
        options.signWith ?? privateKey,
      ),
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export const activation = (h: Harness, overrides: Partial<LicensePayload> = {}) =>
  h.service.activate(h.key({ type: 'ACTIVATION', ...overrides }));

export const renewal = (h: Harness, overrides: Partial<LicensePayload> = {}) =>
  h.service.renew(
    h.key({
      type: 'RENEWAL',
      keyId: 'key_renewal-1',
      machineId: null,
      seats: null,
      ...overrides,
    }),
  );

export const seatsKey = (h: Harness, overrides: Partial<LicensePayload> = {}) =>
  h.service.addSeats(
    h.key({
      type: 'SEATS',
      keyId: 'key_seats-1',
      machineId: null,
      term: null,
      ...overrides,
    }),
  );

export const transferKey = (h: Harness, overrides: Partial<LicensePayload> = {}) =>
  h.service.transfer(
    h.key({
      type: 'TRANSFER',
      keyId: 'key_transfer-1',
      term: null,
      seats: null,
      state: {
        expiresAt: '2027-05-01T00:00:00.000Z',
        seatLimit: 5,
        seatsUsed: 3,
        startsAt: '2026-05-01T00:00:00.000Z',
        issuedAt: '2026-05-01T00:00:00.000Z',
      },
      ...overrides,
    }),
  );

export const expectCode = async (promise: Promise<unknown>, code: string) => {
  await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
  await promise.catch((error: ForbiddenException) => {
    expect((error.getResponse() as any).code).toBe(code);
  });
};


/** The operator's public key, in the shape the service wants it. */
export const PUBLIC_KEY_OBJECT: KeyObject = publicKey;
