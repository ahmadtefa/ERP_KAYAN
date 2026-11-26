import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Client } from 'pg';

import { AuditService } from '../../common/audit/audit.service';
import { AuditPurgeService } from '../../common/audit/audit-purge.service';
import { MaintenanceService } from '../../common/maintenance/maintenance';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FullBackupService } from '../backup/full-backup.service';
import { SetupService } from '../company/setup.service';
import { ResetService } from './reset.service';

/**
 * Reset -> setup again -> restore the pre-reset DUMP, on REAL PostgreSQL
 * (throwaway database, synthetic data, no live data). Real Prisma, real
 * SetupService, ResetService and FullBackupService (real pg_dump/pg_restore).
 * The licence engine is stubbed (not the subject here), and the JSON company
 * backup path is NOT covered by this spec.
 */
const databaseName = (() => {
  try { return new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//, ''); } catch { return ''; }
})();
const run = process.env.KAYAN_COMPANY_ISOLATION_PG === '1' || /(_specs?|_test)$/.test(databaseName);

(run ? describe : describe.skip)('reset, setup again, restore the DUMP (PostgreSQL)', () => {
  jest.setTimeout(240_000);
  let prisma: PrismaService;
  let isoDb = '';
  let isoUrl = '';
  let adminUrl = '';
  let dir = '';
  let setup: SetupService;
  let reset: ResetService;
  let backups: FullBackupService;
  const previous = { url: process.env.DATABASE_URL, dir: process.env.KAYAN_BACKUP_DIR };
  const PASSWORD = 'Synthetic-Pass-1234';

  const dto = (over: Record<string, unknown> = {}) => ({
    companyCode: 'RSR-TEST', companyNameAr: 'شركة اختبار', companyNameEn: 'Reset Test Co',
    adminUsername: 'rsr-admin', adminPassword: PASSWORD, seedChartOfAccounts: true, ...over,
  }) as never;

  beforeAll(async () => {
    const base = new URL(process.env.DATABASE_URL as string);
    const admin = new URL(base.toString()); admin.pathname = '/postgres'; admin.search = '';
    isoDb = `kayan_rsr_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const c = new Client({ connectionString: admin.toString() });
    await c.connect();
    try { await c.query(`CREATE DATABASE ${isoDb}`); } finally { await c.end(); }
    adminUrl = admin.toString();
    const u = new URL(base.toString()); u.pathname = `/${isoDb}`;
    isoUrl = u.toString();
    execFileSync('node', ['scripts/apply-migrations.mjs'], {
      cwd: path.resolve(__dirname, '../../..'),
      env: { ...process.env, DATABASE_URL: isoUrl }, stdio: 'pipe',
    });
    dir = mkdtempSync(path.join(tmpdir(), 'kayan-rsr-'));
    process.env.DATABASE_URL = isoUrl;
    process.env.KAYAN_BACKUP_DIR = dir;
    prisma = new PrismaService();
    await prisma.$connect();
    const audit = new AuditService(prisma);
    const licensing = {
      reserveSeat: async () => undefined, reconcile: async () => undefined, status: async () => ({}),
    };
    const maintenance = new MaintenanceService();
    backups = new FullBackupService(prisma, audit, maintenance, licensing as never);
    setup = new SetupService(prisma, audit, licensing as never);
    reset = new ResetService(prisma, audit, new AuditPurgeService(), maintenance, backups);
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect().catch(() => undefined);
    process.env.DATABASE_URL = previous.url;
    if (previous.dir === undefined) delete process.env.KAYAN_BACKUP_DIR; else process.env.KAYAN_BACKUP_DIR = previous.dir;
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (isoDb && adminUrl) {
      const c = new Client({ connectionString: adminUrl });
      await c.connect();
      try { await c.query(`DROP DATABASE IF EXISTS ${isoDb} WITH (FORCE)`); } finally { await c.end(); }
    }
  });

  it('restores the pre-reset company after reset and a second setup', async () => {
    // 1. First setup, then some business data.
    await setup.initialSetup(dto());
    const company = await prisma.company.findFirstOrThrow({ where: { deletedAt: null } });
    const admin = await prisma.user.findFirstOrThrow({ where: { username: 'rsr-admin' } });
    await prisma.customer.create({ data: {
      companyId: company.id, code: 'CU-RSR', nameEn: 'Restore Me', nameAr: 'استرجعني', creditLimit: 0,
    } as never });
    const accountsBefore = await prisma.account.count({ where: { companyId: company.id } });
    expect(accountsBefore).toBeGreaterThan(0);
    expect((await setup.status()).needsSetup).toBe(false);

    // 2. Reset (takes its own verified DUMP first).
    const result = await reset.reset(
      { userId: admin.id, isSuperAdmin: true, companyId: company.id } as never, PASSWORD, 'RESET',
    );
    expect(result.needsSetup).toBe(true);
    expect(result.backupFile).toMatch(/\.dump$/);
    expect(await prisma.customer.count({ where: { code: 'CU-RSR' } })).toBe(0);
    expect(await prisma.account.count({ where: { companyId: company.id } })).toBe(0);
    expect((await setup.status()).needsSetup).toBe(true);

    // 3. Set up again over the retired company, as the kept administrator.
    await setup.initialSetup(dto());
    expect((await setup.status()).needsSetup).toBe(false);
    expect(await prisma.customer.count({ where: { code: 'CU-RSR' } })).toBe(0);

    // 4. Restore the pre-reset DUMP.
    const restored = await backups.restore({ fileName: result.backupFile, confirm: true }, admin.id);
    expect(restored.restored).toBe(true);
    await prisma.$disconnect();
    await prisma.$connect();
    expect(await prisma.customer.count({ where: { code: 'CU-RSR' } })).toBe(1);
    expect(await prisma.account.count({ where: { companyId: company.id } })).toBe(accountsBefore);
    expect(await prisma.company.count({ where: { deletedAt: null } })).toBe(1);
    expect((await setup.status()).needsSetup).toBe(false);
    const stillThere = await prisma.user.findFirst({ where: { username: 'rsr-admin', isActive: true } });
    expect(stillThere).not.toBeNull();
  });
});
