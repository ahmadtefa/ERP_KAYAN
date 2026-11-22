import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from './auth.service';
import { UsersService } from '../admin/users.service';

// Runs only on the isolated, freshly migrated CI database, before seeding.
const run = process.env.KAYAN_AUTH_PASSWORD_PG === '1';
(run ? describe : describe.skip)('password changes on PostgreSQL', () => {
  jest.setTimeout(90_000);
  let prisma: PrismaService;
  let companyId: string;
  let userId: string;
  let companyCode: string;
  let username: string;
  let service: AuthService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    companyId = randomUUID();
    userId = randomUUID();
    companyCode = `PWD-${companyId.slice(0, 8)}`.toUpperCase();
    username = `pwd-${userId.slice(0, 8)}`;
    await prisma.company.create({ data: { id: companyId, code: companyCode, nameEn: 'Password test', nameAr: 'اختبار كلمة المرور' } });
    await prisma.user.create({ data: {
      id: userId, companyId, username, fullNameEn: 'Password test', fullNameAr: 'اختبار كلمة المرور',
      passwordHash: await argon2.hash('original-password-123'),
    } });
    await prisma.refreshToken.create({ data: {
      userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000),
    } });
    service = new AuthService(prisma, { signAsync: async () => 'test-access-token' } as never, { record: async () => {}, recordRequired: async () => {} } as never);
  });

  afterAll(async () => {
    if (!prisma) return;
    if (userId) {
      await prisma.refreshToken.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    if (companyId) await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it('allows only one concurrent use of the old password, revokes sessions, and accepts only the winning password', async () => {
    const candidates = ['new-password-one-123', 'new-password-two-123'];
    const results = await Promise.allSettled(candidates.map((password) =>
      service.changeOwnPassword(username, companyCode, 'original-password-123', password, password),
    ));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const winner = candidates[results.findIndex((result) => result.status === 'fulfilled')];
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await argon2.verify(updated.passwordHash, winner)).toBe(true);
    expect(await argon2.verify(updated.passwordHash, 'original-password-123')).toBe(false);
    expect(updated.tokenVersion).toBe(1);
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
    await expect(service.login(username, 'original-password-123')).rejects.toMatchObject({ status: 401 });
    await expect(service.login(username, winner)).resolves.toMatchObject({ user: { id: userId } });
  });

  it('revokes access and refresh sessions when an administrator resets the password', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const admin = new UsersService(prisma, { record: async () => {} } as never, {} as never);
    await admin.changePassword(companyId, userId, userId, 'admin-reset-password-123', false);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
    expect(await argon2.verify(after.passwordHash, 'admin-reset-password-123')).toBe(true);
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
  });
});
