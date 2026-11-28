import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { Client } from 'pg';
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
 * Runs on its own throwaway database, migrated with the real migration files
 * and dropped afterwards. It first checks that the shipped schema refuses a
 * second live company, then drops that index in the throwaway database only
 * to prove the application's isolation with two companies. That is not
 * production multi-company support. Runs on the isolated scratch database (its name ends in
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
  let isoDb = '';
  let adminUrl = '';
  let secondLiveCompanyRefused = false;
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
    // A dedicated, throwaway database migrated with the real migration files,
    // so nothing here can touch the shared scratch database or another spec.
    const base = new URL(process.env.DATABASE_URL as string);
    const admin = new URL(base.toString());
    admin.pathname = '/postgres';
    admin.search = '';
    isoDb = `kayan_iso_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const adminClient = new Client({ connectionString: admin.toString() });
    await adminClient.connect();
    try {
      await adminClient.query(`CREATE DATABASE ${isoDb}`);
    } finally {
      await adminClient.end();
    }
    adminUrl = admin.toString();
    const isoUrl = new URL(base.toString());
    isoUrl.pathname = `/${isoDb}`;
    execFileSync('node', ['scripts/apply-migrations.mjs'], {
      cwd: path.resolve(__dirname, '../../..'),
      env: { ...process.env, DATABASE_URL: isoUrl.toString() },
      stdio: 'pipe',
    });
    const previousUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = isoUrl.toString();
    try {
      prisma = new PrismaService();
    } finally {
      process.env.DATABASE_URL = previousUrl;
    }
    await prisma.$connect();
    const jwt = new JwtService({});
    const audit = { record: async () => {}, recordRequired: async () => {} } as never;
    auth = new AuthService(prisma, jwt, audit);
    guard = new JwtAuthGuard({ getAllAndOverride: () => false } as unknown as Reflector, jwt, prisma);
    companies = new CompanyService(prisma, audit);

    // 1) The product as shipped: the migrated schema allows ONE live company.
    await seed(A, 'A');
    try {
      await seed(B, 'B');
      secondLiveCompanyRefused = false;
    } catch (error) {
      secondLiveCompanyRefused = (error as { code?: string }).code === 'P2002';
      await prisma.company.deleteMany({ where: { id: B.companyId } });
    }
    // 2) A hypothetical schema, on this throwaway database only: the
    // one-live-company index (migration 20261014000000) is dropped so the
    // application's company isolation can be exercised with two companies.
    // This is NOT production multi-company support. That needs an approved
    // migration, which the acceptance run must execute for real.
    await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS "Company_one_active_company_idx"');
    await prisma.branch.deleteMany({ where: { companyId: B.companyId } });
    await prisma.user.deleteMany({ where: { id: B.userId } });
    await seed(B, 'B');
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect().catch(() => undefined);
    if (isoDb && adminUrl) {
      const adminClient = new Client({ connectionString: adminUrl });
      await adminClient.connect();
      try {
        await adminClient.query(`DROP DATABASE IF EXISTS ${isoDb} WITH (FORCE)`);
      } finally {
        await adminClient.end();
      }
    }
  });

  afterEach(async () => {
    await prisma.company.updateMany({
      where: { id: { in: [A.companyId, B.companyId] } },
      data: { isActive: true, deletedAt: null },
    });
  });

  it('keeps today\'s product rule: the migrated schema refuses a second live company', () => {
    expect(secondLiveCompanyRefused).toBe(true);
  });

  it('signs each person into their own company from the username alone', async () => {
    const a = await auth.login(A.username, password, A.code);
    const b = await auth.login(B.username, password, B.code);
    expect(a.user.companyId).toBe(A.companyId);
    expect(a.user.branchId).toBe(A.branchId);
    expect(b.user.companyId).toBe(B.companyId);
    expect(b.user.branchId).toBe(B.branchId);
  });

  it('the same username can exist in two companies, and the company code picks the account', async () => {
    const shared = `shared-${randomUUID().slice(0, 8)}`;
    const mk = async (side: typeof A, name: string, pw: string) => prisma.user.create({
      data: { companyId: side.companyId, username: shared, fullNameEn: name, fullNameAr: name, passwordHash: await argon2.hash(pw) },
    });
    const inA = await mk(A, 'Shared in A', 'password-for-company-a-1');
    const inB = await mk(B, 'Shared in B', 'password-for-company-b-1');
    try {
      // Inside one company a name is still unique.
      await expect(mk(A, 'Duplicate in A', 'x-password-123456')).rejects.toMatchObject({ code: 'P2002' });
      const a = await auth.login(shared, 'password-for-company-a-1', A.code);
      const b = await auth.login(shared, 'password-for-company-b-1', B.code);
      expect(a.user.companyId).toBe(A.companyId);
      expect(b.user.companyId).toBe(B.companyId);
      // A company's password does not open the other company's account.
      await expect(auth.login(shared, 'password-for-company-a-1', B.code)).rejects.toBeInstanceOf(UnauthorizedException);
      // The code is case-insensitive; an unknown code is refused like a wrong password.
      await expect(auth.login(shared, 'password-for-company-a-1', A.code.toLowerCase())).resolves.toMatchObject({ user: { companyId: A.companyId } });
      await expect(auth.login(shared, 'password-for-company-a-1', 'NOSUCHCODE')).rejects.toMatchObject({ status: 401 });
      // With two live companies the code is required.
      await expect(auth.login(shared, 'password-for-company-a-1')).rejects.toMatchObject({ response: { code: 'LOGIN_COMPANY_CODE_REQUIRED' } });
      // Failed attempts are counted per account, not across the companies.
      await expect(auth.login(shared, 'wrong-password-123', A.code)).rejects.toMatchObject({ status: 401 });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: inA.id } })).failedLoginCount).toBeGreaterThan(0);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: inB.id } })).failedLoginCount).toBe(0);
    } finally {
      await prisma.refreshToken.deleteMany({ where: { userId: { in: [inA.id, inB.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [inA.id, inB.id] } } });
    }
  });

  it('reads one company profile per company and never the other one', async () => {
    expect((await companies.getProfile(A.companyId)).nameEn).toBe('Isolation A');
    expect((await companies.getProfile(B.companyId)).nameEn).toBe('Isolation B');
  });

  it('accepts a live company on every request', async () => {
    const session = await auth.login(A.username, password, A.code);
    const { ctx, request } = context(session.accessToken);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user?.companyId).toBe(A.companyId);
  });

  it('a suspended company stops sign-in, refresh and requests, and only that company', async () => {
    const a = await auth.login(A.username, password, A.code);
    const b = await auth.login(B.username, password, B.code);
    await prisma.company.update({ where: { id: A.companyId }, data: { isActive: false } });

    await expect(auth.login(A.username, password, A.code)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.refresh(a.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(context(a.accessToken).ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    // The refusal also ended A's sessions.
    expect(await prisma.refreshToken.count({ where: { userId: A.userId, revokedAt: null } })).toBe(0);

    // The other company is not affected at all.
    await expect(guard.canActivate(context(b.accessToken).ctx)).resolves.toBe(true);
    await expect(auth.login(B.username, password, B.code)).resolves.toMatchObject({ user: { companyId: B.companyId } });

    // Reactivating lets people sign in again.
    await prisma.company.update({ where: { id: A.companyId }, data: { isActive: true } });
    await expect(auth.login(A.username, password, A.code)).resolves.toMatchObject({ user: { companyId: A.companyId } });
  });

  it('a retired company (deletedAt) is refused the same way', async () => {
    const a = await auth.login(A.username, password, A.code);
    await prisma.company.update({ where: { id: A.companyId }, data: { deletedAt: new Date() } });
    await expect(auth.login(A.username, password, A.code)).rejects.toBeInstanceOf(UnauthorizedException);
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

});
