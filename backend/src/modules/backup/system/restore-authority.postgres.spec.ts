import { randomUUID } from 'node:crypto';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { AuthUser } from '../../../common/decorators/current-user.decorator';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { assertRestoreAuthority } from './restore-authority';
import { acquireRestoreLock } from './restore-lock';

const run = process.env.KAYAN_COMPANY_BACKUP_PG === '1';
(run ? describe : describe.skip)('restore authority revalidation on isolated PostgreSQL', () => {
  jest.setTimeout(60000);
  let prisma: PrismaService;
  const companyId = randomUUID();
  const userId = randomUUID();
  const tokenHash = 'a'.repeat(64);
  let permissionId: string;
  let createdPermission = false;
  const actor: AuthUser = { userId, companyId, username: 'fixture', sessionHash: tokenHash,
    branchId: null, isSuperAdmin: true, permissions: ['admin.backup'] };

  beforeAll(async () => {
    if (process.env.NODE_ENV !== 'test' || new URL(process.env.DATABASE_URL ?? '').pathname !== '/erp_kayan_acceptance') {
      throw new Error('Isolated acceptance database required');
    }
    prisma = new PrismaService();
    await prisma.company.create({ data: { id: companyId, code: `AUTH-${companyId}`, nameAr: 'اختبار', nameEn: 'Fixture', isActive: false, deletedAt: new Date() } });
    await prisma.user.create({ data: { id: userId, companyId, username: `auth-${userId}`, fullNameAr: 'اختبار', fullNameEn: 'Fixture', passwordHash: 'unused-test-hash', isSuperAdmin: true } });
    const existing = await prisma.permission.findUnique({ where: { code: 'admin.backup' } });
    createdPermission = !existing;
    const permission = existing ?? await prisma.permission.create({ data: { code: 'admin.backup', nameAr: 'نسخ', nameEn: 'Backup', module: 'admin' } });
    permissionId = permission.id;
  });
  beforeEach(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt: new Date(Date.now() + 60000) } });
    await prisma.userPermission.deleteMany({ where: { userId } });
    await prisma.user.update({ where: { id: userId }, data: { isSuperAdmin: true } });
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    if (createdPermission) await prisma.permission.delete({ where: { id: permissionId } });
    await prisma.$disconnect();
  });
  it('rejects a session removed while the restore waited, under real restore ownership', async () => {
    await assertRestoreAuthority(prisma, actor, true);
    await prisma.refreshToken.deleteMany({ where: { userId } });
    const lock = await acquireRestoreLock();
    try { await expect(assertRestoreAuthority(prisma, actor, true)).rejects.toBeInstanceOf(UnauthorizedException); }
    finally { await lock.end(); }
  });
  it('rechecks super admin rather than trusting the previously resolved principal', async () => {
    await prisma.user.update({ where: { id: userId }, data: { isSuperAdmin: false } });
    await expect(assertRestoreAuthority(prisma, actor, true)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('honours direct backup permission, deny, and company isolation for JSON', async () => {
    await prisma.user.update({ where: { id: userId }, data: { isSuperAdmin: false } });
    await prisma.userPermission.create({ data: { userId, permissionId, isDenied: false } });
    await expect(assertRestoreAuthority(prisma, actor, false)).resolves.toBeUndefined();
    await prisma.userPermission.update({ where: { userId_permissionId: { userId, permissionId } }, data: { isDenied: true } });
    await expect(assertRestoreAuthority(prisma, actor, false)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(assertRestoreAuthority(prisma, { ...actor, companyId: randomUUID() }, false)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
