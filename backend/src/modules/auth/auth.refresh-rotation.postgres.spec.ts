import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from './auth.service';

/**
 * Refresh-token rotation on real PostgreSQL.
 *
 * The refresh token rotates: the presented token dies and a replacement is
 * issued. Two rules keep that honest:
 *
 *  1. of any set of simultaneous presentations of the same token, exactly one
 *     may succeed - the rest are treated as replay;
 *  2. a token that has already been rotated cannot be used a second time, and
 *     replaying it must not leave a live token behind for the attacker.
 *
 * The compare-and-set in `AuthService.refresh` is a single `UPDATE ... WHERE
 * revokedAt IS NULL`, so PostgreSQL row locking is what makes rule 1 true.
 * A mocked Prisma would assert the SQL text and prove nothing about it.
 */
const run = process.env.KAYAN_AUTH_SESSION_PG === '1';
const ACCESS_SECRET = 'auth-session-test-access-secret-0123456789';

(run ? describe : describe.skip)('refresh rotation on PostgreSQL', () => {
  jest.setTimeout(120_000);

  let prisma: PrismaService;
  let auth: AuthService;
  let companyId: string;
  let branchId: string;
  let userId: string;
  let username: string;
  const password = 'initial-password-123';

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
    process.env.JWT_ACCESS_TTL = '900';
    process.env.JWT_REFRESH_TTL = '604800';

    prisma = new PrismaService();
    await prisma.$connect();
    auth = new AuthService(
      prisma,
      new JwtService({}),
      { record: async () => {}, recordRequired: async () => {} } as never,
    );

    companyId = randomUUID();
    branchId = randomUUID();
    userId = randomUUID();
    username = `rot-${userId.slice(0, 8)}`;

    await prisma.company.create({
      data: { id: companyId, code: `ROT-${companyId.slice(0, 8)}`.toUpperCase(), nameEn: 'Rotation', nameAr: 'التدوير' },
    });
    await prisma.branch.create({
      data: { id: branchId, companyId, code: 'B1', nameEn: 'Main', nameAr: 'الرئيسي' },
    });
    await prisma.user.create({
      data: {
        id: userId,
        companyId,
        username,
        fullNameEn: 'Rotation test',
        fullNameAr: 'اختبار التدوير',
        passwordHash: await argon2.hash(password),
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

  async function freshSession() {
    const session = await auth.login(username, password);
    return session;
  }

  it('lets exactly one of several simultaneous refreshes win', async () => {
    const session = await freshSession();

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => auth.refresh(session.refreshToken)),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(5);
    for (const result of rejected) {
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(UnauthorizedException);
    }

    // Only one replacement may be alive after the race.
    const live = await prisma.refreshToken.count({ where: { userId, revokedAt: null } });
    expect(live).toBe(1);
    const surviving = await prisma.refreshToken.findMany({
      where: { userId, revokedAt: null },
      select: { tokenHash: true },
    });
    const rotated = (fulfilled[0] as PromiseFulfilledResult<{ refreshToken: string }>).value;
    const { createHash } = await import('node:crypto');
    expect(surviving[0]!.tokenHash).toBe(
      createHash('sha256').update(rotated.refreshToken).digest('hex'),
    );

    await auth.logout(userId);
  });

  it('refuses a rotated token on a later attempt', async () => {
    const session = await freshSession();
    const rotated = await auth.refresh(session.refreshToken);

    await expect(auth.refresh(session.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);

    // The valid replacement still works: the refusal above did not cascade.
    const next = await auth.refresh(rotated.refreshToken);
    expect(next.accessToken).toEqual(expect.any(String));
    await auth.logout(userId);
  });

  it('refuses a replayed token after its replacement has already been used', async () => {
    const session = await freshSession();
    const second = await auth.refresh(session.refreshToken);
    const third = await auth.refresh(second.refreshToken);

    await expect(auth.refresh(session.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.refresh(second.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.refresh(third.refreshToken)).resolves.toMatchObject({
      accessToken: expect.any(String),
    });
    await auth.logout(userId);
  });

  it('refuses an expired refresh token even when it was never used', async () => {
    const session = await freshSession();
    const { createHash } = await import('node:crypto');
    await prisma.refreshToken.updateMany({
      where: { tokenHash: createHash('sha256').update(session.refreshToken).digest('hex') },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(auth.refresh(session.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await auth.logout(userId);
  });

  it('refuses every session of a deactivated account and revokes the rows', async () => {
    const session = await freshSession();
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
    try {
      await expect(auth.refresh(session.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { isActive: true } });
    }
  });

  it('lets only one simultaneous password change win and kills the other session', async () => {
    const session = await freshSession();
    const { createHash } = await import('node:crypto');
    const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const attempts = await Promise.allSettled([
      auth.changeOwnPassword(username, (await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).code, password, 'rotated-password-one', 'rotated-password-one'),
      auth.changeOwnPassword(username, (await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).code, password, 'rotated-password-two', 'rotated-password-two'),
    ]);

    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    // Every session minted under the old password is gone, access anchored
    // ones included, because the token version moved.
    expect(await prisma.refreshToken.count({
      where: { userId, revokedAt: null, tokenHash: createHash('sha256').update(session.refreshToken).digest('hex') },
    })).toBe(0);
    await expect(auth.refresh(session.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);

    const winner = attempts.findIndex((r) => r.status === 'fulfilled');
    const chosen = winner === 0 ? 'rotated-password-one' : 'rotated-password-two';
    await expect(auth.login(username, password)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.login(username, chosen)).resolves.toMatchObject({ user: { id: userId } });
    await auth.logout(userId);
  });
});
