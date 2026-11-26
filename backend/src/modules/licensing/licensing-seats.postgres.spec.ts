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
 * Baseline of today's (v1, one-licence) seat reservation on REAL PostgreSQL:
 * the advisory lock and the unique idempotency key under concurrent
 * transactions, and the licenceId null-row stamping at activation. Recorded
 * BEFORE any seat code is made per-licence (S2); S2 must keep these results for
 * the single-licence case. Throwaway database, synthetic keys, no live data.
 * Runs on the isolated scratch database (name ends in "specs" or "test") or
 * when KAYAN_COMPANY_ISOLATION_PG=1.
 */
const databaseName = (() => {
  try { return new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//, ''); } catch { return ''; }
})();
const run = process.env.KAYAN_COMPANY_ISOLATION_PG === '1' || /(_specs?|_test)$/.test(databaseName);

(run ? describe : describe.skip)('licence seats on PostgreSQL (v1 baseline)', () => {
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
    isoDb = `kayan_seat_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
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
    dir = mkdtempSync(path.join(tmpdir(), 'kayan-seat-pg-'));
    service = new LicensingService(prisma as any, {} as any, {
      installedDirectory: null, directory: dir, publicKeyText: PUBLIC_PEM, enforcement: 'enforce',
      clock: () => now, appVersion: '0.1.0-test', machineId: MACHINE, trustStore: (store = new LicenseStore(dir)),
    });
    // Rows written before a licence exists (setup admin, migration backfill).
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

  it('activation stamps the null-licence rows with the new licence id and counts them as used', async () => {
    const status = await service.activate(key({}));
    expect(status.state).toBe('ACTIVE');
    const rows = await prisma.licenseSeatUsage.findMany({ orderBy: { username: 'asc' } });
    expect(rows.map((r) => [r.username, r.licenseId])).toEqual([['pre-1', 'lic_pg-baseline'], ['pre-2', 'lic_pg-baseline']]);
  });

  it('concurrent reservations never exceed the limit (limit 3, 2 in use: exactly one of eight wins)', async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => reserve(`race-${i}`)));
    const ok = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(7);
    for (const r of refused) expect((r.reason as any)?.response?.code).toBe('LICENSE_SEATS_EXHAUSTED');
    expect(await prisma.licenseSeatUsage.count()).toBe(3);
    expect(store.current.maxSeatsUsed).toBe(3);                   // protected watermark follows the winner
  });

  it('a seat key then lets exactly the new capacity through concurrently', async () => {
    await service.addSeats(key({ type: 'SEATS', seats: { mode: 'INCREASE', value: 2 } }));
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => reserve(`more-${i}`)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(await prisma.licenseSeatUsage.count()).toBe(5);
    expect(store.current.maxSeatsUsed).toBe(5);
    expect(store.current.maxSeatLimit).toBe(5);
  });

  it('the same idempotency key under concurrency takes at most one seat', async () => {
    await service.addSeats(key({ type: 'SEATS', seats: { mode: 'INCREASE', value: 3 } }));
    const idem = `idem-${randomUUID()}`;
    const before = await prisma.licenseSeatUsage.count();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => reserve('same', { idempotencyKey: idem })));
    const outcomes = results.map((r) => r.status === 'fulfilled'
      ? (r.value.alreadyApplied ? 'already-applied' : r.value.reserved ? 'reserved' : 'other')
      : ((r.reason as any)?.code ?? (r.reason as any)?.response?.code ?? 'rejected'));
    // eslint-disable-next-line no-console
    console.log(`idempotency race outcomes: ${JSON.stringify(outcomes)}`);
    expect(outcomes.filter((o) => o === 'reserved')).toHaveLength(1);
    for (const o of outcomes) expect(['reserved', 'already-applied', 'P2002']).toContain(o);
    expect(await prisma.licenseSeatUsage.count()).toBe(before + 1);
  });

  // Mutation check, run on every CI: the same race with the advisory-lock
  // statement turned into a no-op MUST overshoot the limit at least once.
  // If it never does, the races above are not discriminating and prove nothing
  // about the lock.
  it('discriminates: without the advisory lock the same race exceeds the limit', async () => {
    const noLock = (tx: any) => new Proxy(tx, {
      get(target, prop) {
        if (prop === '$executeRawUnsafe') {
          return (sql: string, ...rest: unknown[]) =>
            /advisory_xact_lock/.test(sql) ? Promise.resolve(0) : target.$executeRawUnsafe(sql, ...rest);
        }
        const v = target[prop];
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    let overshoot = false;
    for (let round = 0; round < 8 && !overshoot; round += 1) {
      const used = await prisma.licenseSeatUsage.count();
      await service.addSeats(key({ type: 'SEATS', seats: { mode: 'CAP', value: Math.max(used + 1, 1) } }));
      const limit = used + 1;
      await Promise.allSettled(Array.from({ length: 12 }, (_, i) =>
        prisma.$transaction((tx) => service.reserveSeat(noLock(tx) as any, { userId: randomUUID(), username: `nolock-${round}-${i}`, reason: 'USER_CREATE' } as any))));
      overshoot = (await prisma.licenseSeatUsage.count()) > limit;
    }
    expect(overshoot).toBe(true);
  });
});
