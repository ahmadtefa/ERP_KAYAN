import * as argon2 from 'argon2';
import { UsersService } from './users.service';

describe('administrator password reset', () => {
  it('updates the password and invalidates access and refresh sessions in one transaction', async () => {
    const update = jest.fn().mockReturnValue('user-update');
    const revoke = jest.fn().mockReturnValue('refresh-revoke');
    const transaction = jest.fn().mockResolvedValue([]);
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'employee', companyId: 'company', isSuperAdmin: false }), update },
      refreshToken: { updateMany: revoke },
      $transaction: transaction,
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new UsersService(prisma as never, audit as never, {} as never);
    await expect(service.changePassword('company', 'manager', 'employee', 'new-password-123', false))
      .resolves.toEqual({ id: 'employee', sessionsRevoked: true });
    const args = update.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'employee' });
    expect(args.data).toMatchObject({ tokenVersion: { increment: 1 }, failedLoginCount: 0, lockedUntil: null });
    expect(await argon2.verify(args.data.passwordHash, 'new-password-123')).toBe(true);
    expect(revoke).toHaveBeenCalledWith({ where: { userId: 'employee', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    expect(transaction).toHaveBeenCalledWith(['user-update', 'refresh-revoke']);
  });
});
