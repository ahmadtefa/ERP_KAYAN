import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyService } from '../company/company.service';
import { AuthService } from './auth.service';

/**
 * Two companies in one installation, on real PostgreSQL: who they are is
 * decided by the username alone, and a company that is suspended or retired
 * stops its own people at sign-in, at refresh and on every request, without
 * touching the other company.
 *
 * Synthetic companies and accounts with random ids; every row is removed
 * afterwards. Runs on the isolated scratch database (its name ends in
 * "specs" or "test") or when KAYAN_COMPANY_ISOLATION_PG=1.
 */
const databaseName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//, '');
  } catch {
    return '';
  }
})();
const run =
  process.env.KAYAN_COMPANY_ISOLATION_PG === '1' ||
  /(_specs?|_test)$/.test(databaseName);
const ACCESS_SECRET = 'company-isolation-test-access-secret-0123456789';
const password = 'initial-password-123';

(run ? describe : describe.skip)('two companies on PostgreSQL', () => {
  jest.setTimeout(120_000);

  let prisma: PrismaService;
  let auth: AuthService;
  let guard: JwtAuthGuard;
  let companies: CompanyService;
  const A = { companyId: randomUUID(), branchId: randomUUID(), userId: randomUUID(), username: '', code: '' };
  const B = { companyId: randomUUID(), branchId: randomUUID(), userId: randomUUID(), username: '', code: '' };

  function context(accessToken: string) {
    const request = { headers: { authorization: `Bearer ${accessToken}` }, query: {} } as {
      headers: Record<string, string>;
      query: Record<string, unknown>;
      user?: { companyId: string; userId: string };
    };
    const ctx = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { ctx, request };
  }

  async function seed(side: typeof A, label: string) {
    side.username = `iso-${label}-${side.userId.slice(0, 8)}`;
    side.code = `ISO${label}-${side.companyId.slice(0, 6)}`.toUpperCase();
    await prisma.company.create({
      data: { id: side.companyId, code: side.code, nameEn: `Isolation ${label}`, nameAr: `عزل ${label}` },
    });
    await prisma.branch.create({
      data: { id: side.branchId, companyId: side.companyId, code: 'B1', nameEn: 'Main', nameAr: 'الرئيسي' },
    });
    await prisma.user.create({
      data: {
        id: side.userId,
        companyId: side.companyId,
        username: side.username,
        fullNameEn: `User ${label}`,
        fullNameAr: `مستخدم ${label}`,
        passwordHash: await argon2.hash(password),
      },
    });
    await prisma.userBranch.create({ data: { userId: side.userId, branchId: side.branchId } });
  }

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
    process.env.JWT_ACCESS_TTL = '900';
    process.env.JWT_REFRESH_TTL = '604800';
    prisma = new PrismaService();
    await prisma.$connect();
    const jwt = new JwtService({});
    const audit = { record: async () => {}, recordRequired: async () => {} } as never;
    auth = new AuthService(prisma, jwt, audit);
    guard = new JwtAuthGuard({ getAllAndOverride: () => false } as unknown as Reflector, jwt, prisma);
    companies = new CompanyService(prisma, audit);
    await seed(A, 'A');
    await seed(B, 'B');
  });

  afterAll(async () => {
    if (!prisma) return;
    for (const side of [A, B]) {
      await prisma.refreshToken.deleteMany({ where: { userId: side.userId } });
      await prisma.userBranch.deleteMany({ where: { userId: side.userId } });
      await prisma.auditLog.deleteMany({ where: { userId: side.userId } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: side.userId } });
      await prisma.branch.deleteMany({ where: { companyId: side.companyId } });
      await prisma.company.deleteMany({ where: { id: side.companyId } });
    }
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.company.updateMany({
      where: { id: { in: [A.companyId, B.companyId] } },
      data: { isActive: true, deletedAt: null },
    });
  });

  it('signs each person into their own company from the username alone', async () => {
    const a = await auth.login(A.username, password);
    const b = await auth.login(B.username, password);
    expect(a.user.companyId).toBe(A.companyId);
    expect(a.user.branchId).toBe(A.branchId);
    expect(b.user.companyId).toBe(B.companyId);
    expect(b.user.branchId).toBe(B.branchId);
  });

  it('reads one company profile per company and never the other one', async () => {
    expect((await companies.getProfile(A.companyId)).nameEn).toBe('Isolation A');
    expect((await companies.getProfile(B.companyId)).nameEn).toBe('Isolation B');
  });

  it('accepts a live company on every request', async () => {
    const session = await auth.login(A.username, password);
    const { ctx, request } = context(session.accessToken);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user?.companyId).toBe(A.companyId);
  });

  it('a suspended company stops sign-in, refresh and requests, and only that company', async () => {
    const a = await auth.login(A.username, password);
    const b = await auth.login(B.username, password);
    await prisma.company.update({ where: { id: A.companyId }, data: { isActive: false } });

    await expect(auth.login(A.username, password)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.refresh(a.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(context(a.accessToken).ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    // The refusal also ended A's sessions.
    expect(await prisma.refreshToken.count({ where: { userId: A.userId, revokedAt: null } })).toBe(0);

    // The other company is not affected at all.
    await expect(guard.canActivate(context(b.accessToken).ctx)).resolves.toBe(true);
    await expect(auth.login(B.username, password)).resolves.toMatchObject({ user: { companyId: B.companyId } });

    // Reactivating lets people sign in again.
    await prisma.company.update({ where: { id: A.companyId }, data: { isActive: true } });
    await expect(auth.login(A.username, password)).resolves.toMatchObject({ user: { companyId: A.companyId } });
  });

  it('a retired company (deletedAt) is refused the same way', async () => {
    const a = await auth.login(A.username, password);
    await prisma.company.update({ where: { id: A.companyId }, data: { deletedAt: new Date() } });
    await expect(auth.login(A.username, password)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(context(a.accessToken).ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('changes a password by username alone and touches only that account', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: A.userId } });
    await auth.changeOwnPassword(B.username, undefined, password, 'second-password-4567', 'second-password-4567');
    const afterB = await prisma.user.findUniqueOrThrow({ where: { id: B.userId } });
    const afterA = await prisma.user.findUniqueOrThrow({ where: { id: A.userId } });
    expect(await argon2.verify(afterB.passwordHash, 'second-password-4567')).toBe(true);
    expect(afterA.passwordHash).toBe(before.passwordHash);
    expect(afterA.tokenVersion).toBe(before.tokenVersion);
    // Put B's password back for later tests.
    await prisma.user.update({ where: { id: B.userId }, data: { passwordHash: await argon2.hash(password), tokenVersion: 0 } });
  });

  it('refuses a password change for a suspended company without saying why', async () => {
    await prisma.company.update({ where: { id: A.companyId }, data: { isActive: false } });
    await expect(
      auth.changeOwnPassword(A.username, undefined, password, 'third-password-4567', 'third-password-4567'),
    ).rejects.toMatchObject({ status: 401, message: 'Invalid username or current password' });
  });

  it('the username is unique across companies, so a second company cannot reuse it', async () => {
    await expect(
      prisma.user.create({
        data: {
          companyId: B.companyId,
          username: A.username,
          fullNameEn: 'Clash',
          fullNameAr: 'تعارض',
          passwordHash: 'x',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
