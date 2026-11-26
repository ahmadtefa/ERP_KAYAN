import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Client } from 'pg';

import { AuditService } from '../../common/audit/audit.service';
import { MaintenanceService } from '../../common/maintenance/maintenance';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SetupService } from '../company/setup.service';
import { FullBackupService } from './full-backup.service';

/**
 * First-run setup, then a DUMP backup, damage, and restore, on REAL PostgreSQL
 * (throwaway database, synthetic data, no live data). Real Prisma, the real
 * SetupService and FullBackupService with real pg_dump/pg_restore. The licence
 * engine is stubbed (not the subject here); the JSON company backup is not
 * covered by this spec.
 */
const databaseName = (() => {
  try { return new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//, ''); } catch { return ''; }
})();
const run = process.env.KAYAN_COMPANY_ISOLATION_PG === '1' || /(_specs?|_test)$/.test(databaseName);

(run ? describe : describe.skip)('setup, backup, damage, restore the DUMP (PostgreSQL)', () => {
  jest.setTimeout(240_000);
  let prisma: PrismaService;
  let isoDb = '';
  let adminUrl = '';
  let dir = '';
  let setup: SetupService;
  let backups: FullBackupService;
  const previous = { url: process.env.DATABASE_URL, dir: process.env.KAYAN_BACKUP_DIR };

  beforeAll(async () => {
    const base = new URL(process.env.DATABASE_URL as string);
    const admin = new URL(base.toString()); admin.pathname = '/postgres'; admin.search = '';
    isoDb = `kayan_sbr_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const c = new Client({ connectionString: admin.toString() });
    await c.connect();
    try { await c.query(`CREATE DATABASE ${isoDb}`); } finally { await c.end(); }
    adminUrl = admin.toString();
    const u = new URL(base.toString()); u.pathname = `/${isoDb}`;
    execFileSync('node', ['scripts/apply-migrations.mjs'], {
      cwd: path.resolve(__dirname, '../../..'),
      env: { ...process.env, DATABASE_URL: u.toString() }, stdio: 'pipe',
    });
    dir = mkdtempSync(path.join(tmpdir(), 'kayan-sbr-'));
    process.env.DATABASE_URL = u.toString();
    process.env.KAYAN_BACKUP_DIR = dir;
    prisma = new PrismaService();
    await prisma.$connect();
    const audit = new AuditService(prisma);
    const licensing = { reserveSeat: async () => undefined, reconcile: async () => undefined, status: async () => ({}) };
    backups = new FullBackupService(prisma, audit, new MaintenanceService(), licensing as never);
    setup = new SetupService(prisma, audit, licensing as never);
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

  it('brings back what a DUMP held after the data was damaged', async () => {
    await setup.initialSetup({
      companyCode: 'SBR-TEST', companyNameAr: 'شركة اختبار', companyNameEn: 'Backup Test Co',
      adminUsername: 'sbr-admin', adminPassword: 'Synthetic-Pass-1234', seedChartOfAccounts: true,
    } as never);
    const company = await prisma.company.findFirstOrThrow({ where: { deletedAt: null } });
    const admin = await prisma.user.findFirstOrThrow({ where: { username: 'sbr-admin' } });
    await prisma.customer.create({ data: {
      companyId: company.id, code: 'CU-SBR', nameEn: 'Restore Me', nameAr: 'استرجعني', creditLimit: 0,
    } as never });
    const accountsBefore = await prisma.account.count({ where: { companyId: company.id } });
    expect(accountsBefore).toBeGreaterThan(0);

    const { file } = await backups.createFull(admin.id);
    expect(file.name).toMatch(/\.dump$/);
    expect((await backups.verify(file.name)).entries).toBeGreaterThan(0);

    // Damage: remove the customer and a leaf account.
    await prisma.customer.deleteMany({ where: { code: 'CU-SBR' } });
    expect(await prisma.customer.count({ where: { code: 'CU-SBR' } })).toBe(0);

    const restored = await backups.restore({ fileName: file.name, confirm: true }, admin.id);
    expect(restored.restored).toBe(true);
    await prisma.$disconnect();
    await prisma.$connect();
    expect(await prisma.customer.count({ where: { code: 'CU-SBR' } })).toBe(1);
    expect(await prisma.account.count({ where: { companyId: company.id } })).toBe(accountsBefore);
    expect((await setup.status()).needsSetup).toBe(false);
    expect(await prisma.user.count({ where: { username: 'sbr-admin', isActive: true } })).toBe(1);
  });
});
