import 'reflect-metadata';
import * as argon2 from 'argon2';

import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('self-service password change', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const companyId = '22222222-2222-4222-8222-222222222222';

  async function fixture() {
    const passwordHash = await argon2.hash('correct-current-password', { type: argon2.argon2id });
    const user = {
      id: userId,
      companyId,
      username: 'cashier',
      passwordHash,
      failedLoginCount: 0,
      lockedUntil: null,
    };
    const tx = {
      user: { update: jest.fn().mockResolvedValue({}) },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(user),
        update: jest.fn().mockResolvedValue({ failedLoginCount: 1 }),
      },
      $transaction: jest.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
    };
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
      recordRequired: jest.fn((input: unknown, transaction: typeof tx) =>
        transaction.auditLog.create({ data: input }),
      ),
    };
    const service = new AuthService(prisma as never, {} as never, audit as never);
    return { service, prisma, tx, audit, user };
  }

  it('requires the public pre-login route and does not require an authenticated session', () => {
    const descriptor = Object.getOwnPropertyDescriptor(AuthController.prototype, 'changePassword')!;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, descriptor.value)).toBe(true);
  });

  it('changes only the matching company account, hashes the new password, revokes sessions and invalidates access tokens', async () => {
    const { service, prisma, tx, user } = await fixture();
    const result = await service.changeOwnPassword(
      'cashier', 'KAYAN', 'correct-current-password',
      'a-brand-new-secret', 'a-brand-new-secret', '192.0.2.8', 'test-agent',
    );

    expect(result).toEqual({ success: true });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        username: 'cashier', deletedAt: null, isActive: true,
        company: { code: 'KAYAN', isActive: true },
      },
    });
    const update = tx.user.update.mock.calls[0]![0];
    expect(update.where).toEqual({ id: userId });
    expect(update.data).toMatchObject({ tokenVersion: { increment: 1 }, failedLoginCount: 0, lockedUntil: null });
    expect(await argon2.verify(update.data.passwordHash, 'a-brand-new-secret')).toBe(true);
    expect(update.data.passwordHash).not.toBe('a-brand-new-secret');
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId, revokedAt: null }, data: { revokedAt: expect.any(Date) },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId, userId, action: 'user.password_changed_self', entity: 'users', entityId: userId,
        ipAddress: '192.0.2.8', userAgent: 'test-agent',
      }),
    });
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain('a-brand-new-secret');
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain('correct-current-password');
    expect(user.passwordHash).not.toBe(update.data.passwordHash);
  });

  it('returns the same authentication error for a wrong current password and records no secret', async () => {
    const { service, prisma, audit } = await fixture();
    await expect(service.changeOwnPassword(
      'cashier', 'KAYAN', 'incorrect-current-password',
      'a-brand-new-secret', 'a-brand-new-secret',
    )).rejects.toMatchObject({ status: 401, message: 'Invalid username or current password' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: userId }, data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      companyId, userId, action: 'PASSWORD_CHANGE_FAILED', entity: 'users', entityId: userId,
    }));
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('incorrect-current-password');
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('a-brand-new-secret');
  });

  it('rejects mismatched new passwords before looking up an account', async () => {
    const { service, prisma } = await fixture();
    await expect(service.changeOwnPassword(
      'cashier', 'KAYAN', 'correct-current-password', 'first-new-password', 'other-new-password',
    )).rejects.toMatchObject({ status: 400 });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });
});
