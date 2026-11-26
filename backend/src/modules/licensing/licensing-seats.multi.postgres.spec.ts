import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Client } from 'pg';

import { PrismaService } from '../../common/prisma/prisma.service';
import { LicenseStore } from './license-store';
import { LicensingService } from './licensing.service';
import { MACHINE, PUBLIC_PEM, privateKey } from './licensing.harness';
import { signPayload, type LicensePayload } from './license-key';

/**
 * S2: seat counts per licence on REAL PostgreSQL (throwaway database, synthetic
 * keys, no live data). The installation holds licence A (activated the normal
 * way, which adopts the unowned legacy rows) and licences added directly as
 * rows: today's activation refuses a second licence, so company activation is
 * not claimed here. Unowned (null) rows belong to the oldest licence only. The
 * single-licence results are covered unchanged by licensing-seats.postgres.spec.ts.
 */
const databaseName = (() => {
  try { return new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//, ''); } catch { return ''; }
})();
const run = process.env.KAYAN_COMPANY_ISOLATION_PG === '1' || /(_specs?|_test)$/.test(databaseName);

(run ? describe : describe.skip)('per-licence seats on PostgreSQL (several licences)', () => {
  jest.setTimeout(120_000);
  let prisma: PrismaService;
  let isoDb = '';
  let adminUrl = '';
  let dir = '';
  let service: LicensingService;
  let store: LicenseStore;
  const now = new Date('2026-05-01T09:00:00.000Z');

  const key = (over: Partial<LicensePayload>) => signPayload({
    v: 1, keyId: `key_${randomUUID()}`, type: 'ACTIVATION', licenseId: 'lic_pg-baseline', machineId: MACHINE,
    issuedAt: '2026-04-30T00:00:00.000Z', term: { kind: 'MONTHS', months: 12 },
    seats: { mode: 'CAP', value: 3 }, state: null, note: null, ...over,
  } as LicensePayload, privateKey);

  const reserve = (n: string, extra: Record<string, unknown> = {}) =>
    prisma.$transaction((tx) => service.reserveSeat(tx as any, { userId: randomUUID(), username: n, reason: 'USER_CREATE', ...extra } as any));

  beforeAll(async () => {
    const base = new URL(process.env.DATABASE_URL as string);
    const admin = new URL(base.toString()); admin.pathname = '/postgres'; admin.search = '';
    isoDb = `kayan_seatm_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const c = new Client({ connectionString: admin.toString() });
    await c.connect();
    try { await c.query(`CREATE DATABASE ${isoDb}`); } finally { await c.end(); }
    adminUrl = admin.toString();
    const isoUrl = new URL(base.toString()); isoUrl.pathname = `/${isoDb}`;
    // Explicit pool: far more connections than concurrent callers, so a race
    // is never serialised by pool starvation instead of by the lock.
    isoUrl.searchParams.set('connection_limit', '30');
    isoUrl.searchParams.set('pool_timeout', '30');
    execFileSync('node', ['scripts/apply-migrations.mjs'], {
      cwd: path.resolve(__dirname, '../../..'),
      env: { ...process.env, DATABASE_URL: isoUrl.toString() }, stdio: 'pipe',
    });
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = isoUrl.toString();
    try { prisma = new PrismaService(); } finally { process.env.DATABASE_URL = previous; }
    await prisma.$connect();
    dir = mkdtempSync(path.join(tmpdir(), 'kayan-seatm-pg-'));
    service = new LicensingService(prisma as any, {} as any, {
      installedDirectory: null, directory: dir, publicKeyText: PUBLIC_PEM, enforcement: 'enforce',
      clock: () => now, appVersion: '0.1.0-test', machineId: MACHINE, trustStore: (store = new LicenseStore(dir)),
    });
    // Rows written before any licence exists (setup admin, migration backfill).
    await prisma.licenseSeatUsage.createMany({ data: [
      { username: 'pre-1', reason: 'SETUP_ADMIN', licenseId: null },
      { username: 'pre-2', reason: 'MIGRATION_EXISTING', licenseId: null },
    ] });
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect().catch(() => undefined);
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (isoDb && adminUrl) {
      const c = new Client({ connectionString: adminUrl });
      await c.connect();
      try { await c.query(`DROP DATABASE IF EXISTS ${isoDb} WITH (FORCE)`); } finally { await c.end(); }
    }
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect().catch(() => undefined);
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (isoDb && adminUrl) {
      const c = new Client({ connectionString: adminUrl });
      await c.connect();
      try { await c.query(`DROP DATABASE IF EXISTS ${isoDb} WITH (FORCE)`); } finally { await c.end(); }
    }
  });

  const addLicence = (licenseId: string, seatLimit: number, minutesLater: number) =>
    prisma.licenseInstallation.create({ data: {
      licenseId, machineId: MACHINE, issuedAt: now, startsAt: now,
      expiresAt: new Date('2027-05-01T09:00:00.000Z'), seatLimit, status: 'ACTIVE',
      createdAt: new Date(now.getTime() + minutesLater * 60_000),
    } });
  const reserveFor = (licenseId: string, n: string, extra: Record<string, unknown> = {}) =>
    prisma.$transaction((tx) => service.reserveSeat(tx as any, { userId: randomUUID(), username: n, reason: 'USER_CREATE', licenseId, ...extra } as any));
  const code = (e: any) => e?.response?.code ?? e?.code;

  it('licence A adopts the unowned rows; licences B and C start empty and count only their own', async () => {
    await service.activate(key({ licenseId: 'lic_A', seats: { mode: 'CAP', value: 2 } }));
    await addLicence('lic_B', 1, 5);
    await addLicence('lic_C', 2, 10);
    expect(await service.seatsUsedForLicense('lic_A')).toBe(2);
    expect(await service.seatsUsedForLicense('lic_B')).toBe(0);
    expect(await service.seatsUsedForLicense('lic_C')).toBe(0);
  });

  it('A is full, and that does not stop B: B takes its one seat, then is full itself', async () => {
    await expect(reserveFor('lic_A', 'a-3')).rejects.toMatchObject({ response: { code: 'LICENSE_SEATS_EXHAUSTED' } });
    await expect(reserveFor('lic_B', 'b-1')).resolves.toMatchObject({ reserved: true, used: 1, limit: 1 });
    await expect(reserveFor('lic_B', 'b-2')).rejects.toMatchObject({ response: { code: 'LICENSE_SEATS_EXHAUSTED' } });
    expect(await service.seatsUsedForLicense('lic_A')).toBe(2);
    expect(await service.seatsUsedForLicense('lic_B')).toBe(1);
    const rows = await prisma.licenseSeatUsage.findMany({ where: { username: 'b-1' } });
    expect(rows.map((r) => r.licenseId)).toEqual(['lic_B']);
  });

  it("another licence's seats do not move this licence's file watermark", async () => {
    const before = store.current.maxSeatsUsed;
    await reserveFor('lic_C', 'c-1');
    expect(store.current.maxSeatsUsed).toBe(before);
  });

  it('a late unowned row counts for the oldest licence only', async () => {
    await prisma.licenseSeatUsage.create({ data: { username: 'late-legacy', reason: 'MIGRATION_EXISTING', licenseId: null } });
    expect(await service.seatsUsedForLicense('lic_A')).toBe(3);
    expect(await service.seatsUsedForLicense('lic_B')).toBe(1);
    expect(await service.seatsUsedForLicense('lic_C')).toBe(1);
  });

  it('concurrent creations on one licence never exceed its limit, and leave the others alone', async () => {
    const beforeA = await service.seatsUsedForLicense('lic_A');
    const beforeB = await service.seatsUsedForLicense('lic_B');
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => reserveFor('lic_C', `c-race-${i}`)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);        // C: limit 2, 1 used
    for (const r of results.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
      expect(code(r.reason)).toBe('LICENSE_SEATS_EXHAUSTED');
    }
    expect(await service.seatsUsedForLicense('lic_C')).toBe(2);
    expect(await service.seatsUsedForLicense('lic_A')).toBe(beforeA);
    expect(await service.seatsUsedForLicense('lic_B')).toBe(beforeB);
  });

  it('a seat for an unknown licence is refused and writes nothing', async () => {
    const before = await prisma.licenseSeatUsage.count();
    await expect(reserveFor('lic_NOPE', 'x')).rejects.toMatchObject({ response: { code: 'LICENSE_NOT_FOUND_FOR_COMPANY' } });
    expect(await prisma.licenseSeatUsage.count()).toBe(before);
  });

  it('a malformed licence id never reaches the lock statement', async () => {
    await expect(reserveFor("x'); DROP TABLE users; --", 'x')).rejects.toBeDefined();
    expect(await prisma.licenseSeatUsage.count({ where: { username: 'x' } })).toBe(0);
  });
});
