import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { uniqueAccountClash } from './users.service';

const p2002 = (meta: Record<string, unknown>, message = 'Unique constraint failed') =>
  new Prisma.PrismaClientKnownRequestError(message, { code: 'P2002', clientVersion: 'test', meta });

describe('account unique clash message', () => {
  it('names the email problem and what to do, without naming any company or account', () => {
    for (const error of [
      p2002({ target: ['email'] }),
      p2002({ target: 'users_email_key' }),
      p2002({ driverAdapterError: { cause: { constraint: { index: 'users_email_key' } } } }),
    ]) {
      const clash = uniqueAccountClash(error);
      expect(clash).toBeInstanceOf(ConflictException);
      expect(clash!.getStatus()).toBe(409);
      expect(clash!.message).toBe(
        'That email address is already used by another account. Enter a different email address, or leave it empty.',
      );
    }
  });

  it('asks for another username on a username clash', () => {
    const clash = uniqueAccountClash(p2002({ target: ['username'] }));
    expect(clash!.message).toBe('That username is already taken. Choose a different username.');
  });

  it('leaves other errors and other constraints to the generic handling', () => {
    expect(uniqueAccountClash(p2002({ target: ['tokenHash'] }))).toBeNull();
    expect(uniqueAccountClash(new Error('boom'))).toBeNull();
    expect(
      uniqueAccountClash(new Prisma.PrismaClientKnownRequestError('x', { code: 'P2003', clientVersion: 'test' })),
    ).toBeNull();
  });
});
