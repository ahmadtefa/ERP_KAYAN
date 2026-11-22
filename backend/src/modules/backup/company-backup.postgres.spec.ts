import { randomUUID } from 'node:crypto';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthService } from '../auth/auth.service';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MaintenanceService } from '../../common/maintenance/maintenance';
import { AuditService } from '../../common/audit/audit.service';
import { AuditPurgeService } from '../../common/audit/audit-purge.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BackupFile, BackupService } from './backup.service';

const run = process.env.KAYAN_COMPANY_BACKUP_PG === '1';
(run ? describe : describe.skip)('company JSON backup on isolated PostgreSQL', () => {
  jest.setTimeout(120_000);
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const customerId = randomUUID();
  const otherCustomerId = randomUUID();
  let prisma: PrismaService;
  let service: BackupService;
  let backupDir: string;
  const originalBackupDir = process.env.KAYAN_BACKUP_DIR;
  const purge = new AuditPurgeService();

  beforeAll(async () => {
    // This test deletes/replaces only generated fixture rows, but must never
    // run against an installed customer database even if the flag is set.
    const database = new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
    if (database !== 'erp_kayan_acceptance' || process.env.NODE_ENV !== 'test') {
      throw new Error('Company backup test requires the isolated CI acceptance database');
    }
    backupDir = await mkdtemp(join(tmpdir(), 'kayan-company-pg-'));
    process.env.KAYAN_BACKUP_DIR = backupDir;
    prisma = new PrismaService();
    await prisma.$connect();
    await prisma.company.createMany({ data: [
      { id: companyId, code: `JSON-${companyId.slice(0, 8)}`, nameEn: 'Original company', nameAr: 'الشركة الأصلية' },
      // The installation permits only one non-deleted company. A historical
      // soft-deleted company still exercises isolation of its existing rows.
      { id: otherCompanyId, code: `JSON-${otherCompanyId.slice(0, 8)}`, nameEn: 'Other company', nameAr: 'الشركة الأخرى', isActive: false, deletedAt: new Date() },
    ] });
    await prisma.customer.createMany({ data: [
      { id: customerId, companyId, code: 'C-1', nameEn: 'Original customer', nameAr: 'العميل الأصلي' },
      { id: otherCustomerId, companyId: otherCompanyId, code: 'C-2', nameEn: 'Other customer', nameAr: 'عميل آخر' },
    ] });
    service = new BackupService(prisma, new AuditService(prisma), purge, { reconcile: async () => {} } as never, new MaintenanceService());
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.$transaction(async (tx) => {
      await purge.openGuard(tx);
      try {
        await tx.auditLog.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
      } finally {
        await purge.closeGuard(tx);
      }
      await tx.customer.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
      await tx.supplier.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
      await tx.user.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
      await tx.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
    });
    await prisma.$disconnect();
    if (originalBackupDir === undefined) delete process.env.KAYAN_BACKUP_DIR;
    else process.env.KAYAN_BACKUP_DIR = originalBackupDir;
    if (backupDir) await rm(backupDir, { recursive: true, force: true });
  });

  it('invalidates all restored company sessions without changing the other company', async () => {
    const originalSecret = process.env.JWT_ACCESS_SECRET;
    process.env.JWT_ACCESS_SECRET = 'isolated-company-backup-test-secret';
    const userId = randomUUID();
    const otherUserId = randomUUID();
    const password = 'Synthetic password 123!';
    const passwordHash = await argon2.hash(password);
    const username = `backup-${userId}`;
    const otherUsername = `backup-${otherUserId}`;
    await prisma.user.createMany({ data: [
      { id: userId, companyId, username, fullNameEn: 'Restore user', fullNameAr: 'مستخدم', passwordHash },
      { id: otherUserId, companyId: otherCompanyId, username: otherUsername, fullNameEn: 'Other user', fullNameAr: 'آخر', passwordHash },
    ] });
    const jwt = new JwtService();
    const auth = new AuthService(prisma, jwt, { record: async () => {} } as never);
    const guard = new JwtAuthGuard({ getAllAndOverride: () => false } as unknown as Reflector, jwt, prisma);
    const check = (token: string) => guard.canActivate({
      getHandler: () => () => {},
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` }, query: {} }) }),
    } as unknown as ExecutionContext);
    try {
      const first = await auth.login(username, password);
      const second = await auth.login(username, password);
      const other = await auth.login(otherUsername, password);
      const snapshot = JSON.parse(JSON.stringify(await service.create(companyId))) as BackupFile;
      await expect(check(first.accessToken)).resolves.toBe(true);
      await expect(check(second.accessToken)).resolves.toBe(true);
      await expect(check(other.accessToken)).resolves.toBe(true);
      await service.restore(snapshot, companyId, { replace: true });
      await expect(check(first.accessToken)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(check(second.accessToken)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(auth.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(auth.refresh(second.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(check(other.accessToken)).resolves.toBe(true);
      await expect(auth.refresh(other.refreshToken)).resolves.toHaveProperty('accessToken');
    } finally {
      if (originalSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
      else process.env.JWT_ACCESS_SECRET = originalSecret;
    }
  });

  it('reads all tables from one snapshot while another transaction commits changes', async () => {
    let signalRead!: () => void;
    let resume!: () => void;
    const customerRead = new Promise<void>((resolve) => { signalRead = resolve; });
    const continueRead = new Promise<void>((resolve) => { resume = resolve; });
    type ReadTable = (client: unknown, spec: { model: string }, company: string) => Promise<Array<Record<string, unknown>>>;
    const internal = service as unknown as { readTable: ReadTable };
    const original = internal.readTable.bind(service);
    const spy = jest.spyOn(internal, 'readTable').mockImplementation(async (client, spec, company) => {
      const rows = await original(client, spec, company);
      if (spec.model === 'customer') {
        signalRead();
        await continueRead;
      }
      return rows;
    });
    const customer = randomUUID();
    const supplier = randomUUID();
    const pending = service.create(companyId);
    try {
      await customerRead;
      await prisma.$transaction(async (tx) => {
        await tx.customer.create({ data: { id: customer, companyId, code: 'CONCURRENT', nameEn: 'Concurrent', nameAr: 'متزامن' } });
        await tx.supplier.create({ data: { id: supplier, companyId, code: 'CONCURRENT', nameEn: 'Concurrent', nameAr: 'متزامن' } });
      });
    } finally {
      resume();
    }
    try {
      const archive = await pending;
      expect(archive.tables.customer.some((row) => row.id === customer)).toBe(false);
      expect(archive.tables.supplier.some((row) => row.id === supplier)).toBe(false);
      expect(await prisma.customer.findUnique({ where: { id: customer } })).not.toBeNull();
      expect(await prisma.supplier.findUnique({ where: { id: supplier } })).not.toBeNull();
    } finally {
      spy.mockRestore();
      await prisma.customer.deleteMany({ where: { id: customer } });
      await prisma.supplier.deleteMany({ where: { id: supplier } });
    }
  });

  it('restores saved values instead of later changes, isolates other companies and rolls back invalid data', async () => {
    const existingRestoreAudits = await prisma.auditLog.count({ where: { companyId, entity: 'company_json_backup', action: 'RESTORE_REPLACE' } });
    const snapshot = JSON.parse(JSON.stringify(await service.create(companyId))) as BackupFile;
    await prisma.customer.update({ where: { id: customerId }, data: { nameEn: 'Changed after backup', nameAr: 'تغير بعد النسخ' } });
    await prisma.company.update({ where: { id: companyId }, data: { nameEn: 'Changed company' } });
    const changedId = randomUUID();
    await prisma.customer.create({ data: { id: changedId, companyId, code: 'NEW', nameEn: 'Created later', nameAr: 'أضيف لاحقاً' } });

    // A non-directory backup location must fail closed before any deletes.
    const unavailable = join(backupDir, 'not-a-directory');
    await writeFile(unavailable, 'not a directory');
    process.env.KAYAN_BACKUP_DIR = unavailable;
    try {
      await expect(service.restore(snapshot, companyId, { replace: true })).rejects.toThrow(/safety backup/i);
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).nameEn).toBe('Changed after backup');
      expect(await prisma.customer.findUnique({ where: { id: changedId } })).not.toBeNull();
    } finally {
      process.env.KAYAN_BACKUP_DIR = backupDir;
    }

    const invalid = structuredClone(snapshot);
    invalid.tables.customer.push({ ...invalid.tables.customer[0] });
    invalid.counts.customer = invalid.tables.customer.length;
    await expect(service.restore(invalid, companyId, { replace: true })).rejects.toThrow();
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).nameEn).toBe('Changed after backup');
    expect(await prisma.customer.findUnique({ where: { id: changedId } })).not.toBeNull();

    const result = await service.restore(snapshot, companyId, { replace: true });
    expect(result.replaced).toBe(true);
    expect(result.written.customer).toBe(1);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).nameEn).toBe('Original customer');
    expect(await prisma.customer.findUnique({ where: { id: changedId } })).toBeNull();
    expect((await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).nameEn).toBe('Original company');
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: otherCustomerId } })).nameEn).toBe('Other customer');
    expect(await prisma.auditLog.count({ where: { companyId, entity: 'company_json_backup', action: 'RESTORE_REPLACE' } })).toBe(existingRestoreAudits + 1);

    // Recover the changed data from the automatically retained safety copy,
    // not the original input archive, and check both tenants again.
    const safety = JSON.parse(await readFile(join(backupDir, result.safetyBackup), 'utf8')) as BackupFile;
    expect(safety.tables.customer.some((row) => row.id === changedId)).toBe(true);
    await service.restore(safety, companyId, { replace: true });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).nameEn).toBe('Changed after backup');
    expect(await prisma.customer.findUnique({ where: { id: changedId } })).not.toBeNull();
    expect((await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).nameEn).toBe('Changed company');
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: otherCustomerId } })).nameEn).toBe('Other customer');
  });
});
