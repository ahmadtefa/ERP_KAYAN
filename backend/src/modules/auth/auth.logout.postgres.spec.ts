import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';

/**
 * Sign-out must end the session on PostgreSQL, not merely forget the token in
 * the client.
 *
 * A refresh token row is what anchors an access token: `JwtAuthGuard` looks up
 * `sessionHash` in `refresh_tokens` on every request. Sign-out marks the row
 * `revokedAt`, so the guard must refuse a row that is revoked. These tests run
 * against a real, freshly migrated PostgreSQL database - a mocked Prisma
 * cannot prove the SQL that the guard and sign-out actually issue.
 */
const run = process.env.KAYAN_AUTH_SESSION_PG === '1';
const ACCESS_SECRET = 'auth-session-test-access-secret-0123456789';

(run ? describe : describe.skip)('sign-out and session invalidation on PostgreSQL', () => {
  jest.setTimeout(120_000);

  let prisma: PrismaService;
  let jwt: JwtService;
  let auth: AuthService;
  let guard: JwtAuthGuard;
  let companyId: string;
  let branchId: string;
  let userId: string;
  let username: string;

  const reflector = {
    getAllAndOverride: () => false,
  } as unknown as Reflector;

  function contextFor(token: string): ExecutionContext {
    const request: { headers: Record<string, string>; query: Record<string, unknown>; user?: unknown } = {
      headers: { authorization: `Bearer ${token}` },
      query: {},
    };
    return {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToActiveContext: undefined,
      switchToHttp: () => ({ getRequest: () => request }),
      getArgs: () => [],
      getArgByIndex: () => undefined,
      getType: () => 'http',
      switchToRpc: () => ({ getContext: () => ({}), getData: () => ({}) }),
      switchToWs: () => ({ getClient: () => ({}), getData: () => ({}), getPattern: () => '' }),
    } as unknown as ExecutionContext;
  }

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
    process.env.JWT_ACCESS_TTL = '900';
    process.env.JWT_REFRESH_TTL = '604800';

    prisma = new PrismaService();
    await prisma.$connect();
    jwt = new JwtService({});
    auth = new AuthService(
      prisma,
      jwt,
      { record: async () => {}, recordRequired: async () => {} } as never,
    );
    guard = new JwtAuthGuard(reflector, jwt, prisma);

    companyId = randomUUID();
    branchId = randomUUID();
    userId = randomUUID();
    username = `sess-${userId.slice(0, 8)}`;
    const suffix = companyId.slice(0, 8);

    await prisma.company.create({
      data: { id: companyId, code: `SESS-${suffix}`.toUpperCase(), nameEn: 'Session test', nameAr: 'اختبار الجلسة' },
    });
    await prisma.branch.create({
      data: { id: branchId, companyId, code: 'B1', nameEn: 'Main', nameAr: 'الرئيسي' },
    });
    await prisma.user.create({
      data: {
        id: userId,
        companyId,
        username,
        fullNameEn: 'Session test',
        fullNameAr: 'اختبار جلسة',
        passwordHash: await argon2.hash('initial-password-123'),
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

  it('refuses the access token of a session after that session signed out', async () => {
    const session = await auth.login(username, 'initial-password-123', '127.0.0.1', 'jest');

    // The fresh token is accepted while the session is alive.
    await expect(guard.canActivate(contextFor(session.accessToken))).resolves.toBe(true);

    await auth.logout(userId, session.refreshToken);

    // Sign-out must not only stop the refresh token; the access token that is
    // still cryptographically valid for ~15 minutes must be refused too.
    await expect(guard.canActivate(contextFor(session.accessToken))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(auth.refresh(session.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('keeps other sessions of the same user working when one signs out', async () => {
    const laptop = await auth.login(username, 'initial-password-123');
    const desk = await auth.login(username, 'initial-password-123');

    await auth.logout(userId, laptop.refreshToken);

    await expect(guard.canActivate(contextFor(laptop.accessToken))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(guard.canActivate(contextFor(desk.accessToken))).resolves.toBe(true);
    await expect(auth.refresh(desk.refreshToken)).resolves.toMatchObject({ accessToken: expect.any(String) });

    await auth.logout(userId);
  });

  it('signs out every session when the client presents no refresh token', async () => {
    const first = await auth.login(username, 'initial-password-123');
    const second = await auth.login(username, 'initial-password-123');

    await auth.logout(userId);

    await expect(guard.canActivate(contextFor(first.accessToken))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(guard.canActivate(contextFor(second.accessToken))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(prisma.refreshToken.count({ where: { userId, revokedAt: null } })).resolves.toBe(0);
  });

  it('does not let a sign-out of one account revoke another account', async () => {
    const session = await auth.login(username, 'initial-password-123');
    const otherUser = randomUUID();
    await prisma.user.create({
      data: {
        id: otherUser,
        companyId,
        username: `sess2-${otherUser.slice(0, 8)}`,
        fullNameEn: 'Other',
        fullNameAr: 'آخر',
        passwordHash: await argon2.hash('initial-password-123'),
      },
    });
    try {
      await auth.logout(otherUser);
      await expect(guard.canActivate(contextFor(session.accessToken))).resolves.toBe(true);
      // A crafted hash for a different user must be ignored as well.
      await auth.logout(otherUser, session.refreshToken);
      await expect(guard.canActivate(contextFor(session.accessToken))).resolves.toBe(true);
    } finally {
      await auth.logout(userId);
      await prisma.refreshToken.deleteMany({ where: { userId: otherUser } });
      await prisma.user.deleteMany({ where: { id: otherUser } });
    }
  });

  it('records the revoked row so a replayed sign-out is harmless', async () => {
    const session = await auth.login(username, 'initial-password-123');
    const hash = createHash('sha256').update(session.refreshToken).digest('hex');

    await auth.logout(userId, session.refreshToken);
    const row = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hash } });
    expect(row.revokedAt).toBeInstanceOf(Date);

    await expect(auth.logout(userId, session.refreshToken)).resolves.toBeUndefined();
    const again = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hash } });
    expect(again.revokedAt?.toISOString()).toBe(row.revokedAt?.toISOString());
  });
});
