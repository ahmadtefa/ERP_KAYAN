import { randomUUID, createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { UsersService } from '../admin/users.service';

/**
 * Changing a password must end the sessions that were opened with the old one.
 *
 * The mechanism is `tokenVersion`: the guard compares the version inside the
 * access token with the row in `users`. Rotating the refresh rows alone is not
 * enough - a still-valid access token is anchored to a refresh row, so the new
 * guard check (revoked/expired rows are refused) and the version bump together
 * must make every older access token fail on the very next request.
 *
 * Runs against a real, freshly migrated PostgreSQL database.
 */
const run = process.env.KAYAN_AUTH_SESSION_PG === '1';
const ACCESS_SECRET = 'auth-session-test-access-secret-0123456789';

(run ? describe : describe.skip)('password change invalidates older sessions on PostgreSQL', () => {
  jest.setTimeout(120_000);

  let prisma: PrismaService;
  let jwt: JwtService;
  let auth: AuthService;
  let guard: JwtAuthGuard;
  let companyId: string;
  let branchId: string;
  let userId: string;
  let username: string;
  let companyCode: string;
  const oldPassword = 'old-password-123';
  const newPassword = 'new-password-456';

  const reflector = { getAllAndOverride: () => false } as unknown as Reflector;

  function contextFor(token: string): ExecutionContext {
    const request: { headers: Record<string, string>; query: Record<string, unknown> } = {
      headers: { authorization: `Bearer ${token}` },
      query: {},
    };
    return {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  const sha = (value: string) => createHash('sha256').update(value).digest('hex');

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
    process.env.JWT_ACCESS_TTL = '900';
    process.env.JWT_REFRESH_TTL = '604800';

    prisma = new PrismaService();
    await prisma.$connect();
    jwt = new JwtService({});
    auth = new AuthService(prisma, jwt, { record: async () => {}, recordRequired: async () => {} } as never);
    guard = new JwtAuthGuard(reflector, jwt, prisma);

    companyId = randomUUID();
    branchId = randomUUID();
    userId = randomUUID();
    username = `pwx-${userId.slice(0, 8)}`;
    companyCode = `PWX-${companyId.slice(0, 8)}`.toUpperCase();

    await prisma.company.create({
      data: { id: companyId, code: companyCode, nameEn: 'Pwd sessions', nameAr: 'جلسات كلمة المرور' },
    });
    await prisma.branch.create({
      data: { id: branchId, companyId, code: 'B1', nameEn: 'Main', nameAr: 'الرئيسي' },
    });
    await prisma.user.create({
      data: {
        id: userId,
        companyId,
        username,
        fullNameEn: 'Password sessions',
        fullNameAr: 'جلسات كلمة المرور',
        passwordHash: await argon2.hash(oldPassword),
      },
    });
    await prisma.userBranch.create({ data: { userId, branchId } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.userBranch.deleteMany({ where: { userId } });
    await prisma.auditLog.deleteMany({ where: { userId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.branch.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it('ends every session opened with the old password, and only the new password works', async () => {
    const laptop = await auth.login(username, oldPassword);
    const desk = await auth.login(username, oldPassword);
    await expect(guard.canActivate(contextFor(laptop.accessToken))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor(desk.accessToken))).resolves.toBe(true);

    await auth.changeOwnPassword(
      username,
      companyCode,
      oldPassword,
      newPassword,
      newPassword,
    );

    // Both access tokens are still cryptographically valid for their full
    // lifetime; they must still be refused now.
    await expect(guard.canActivate(contextFor(laptop.accessToken))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(guard.canActivate(contextFor(desk.accessToken))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(auth.refresh(laptop.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.refresh(desk.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);

    const rows = await prisma.refreshToken.findMany({
      where: {
        userId,
        tokenHash: { in: [sha(laptop.refreshToken), sha(desk.refreshToken)] },
        revokedAt: null,
      },
    });
    expect(rows).toHaveLength(0);

    await expect(auth.login(username, oldPassword)).rejects.toBeInstanceOf(UnauthorizedException);
    const fresh = await auth.login(username, newPassword);
    await expect(guard.canActivate(contextFor(fresh.accessToken))).resolves.toBe(true);
    await auth.logout(userId);
  });

  it('leaves an administrator reset of the same password-ending effect in place', async () => {
    const session = await auth.login(username, newPassword);
    const admin = new UsersService(
      prisma,
      { record: async () => {}, recordRequired: async () => {} } as never,
      {} as never,
    );

    await admin.changePassword(companyId, userId, userId, 'reset-by-admin-789', false);

    await expect(guard.canActivate(contextFor(session.accessToken))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(auth.refresh(session.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(prisma.refreshToken.count({ where: { userId, revokedAt: null } })).resolves.toBe(0);
    await expect(auth.login(username, 'reset-by-admin-789')).resolves.toMatchObject({
      user: { id: userId },
    });
    await auth.logout(userId);
  });
});
