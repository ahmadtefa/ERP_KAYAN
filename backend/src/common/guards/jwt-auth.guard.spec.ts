import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';

const payload = {
  sub: 'user-1',
  username: 'employee',
  companyId: 'company-1',
  branchId: null,
  isSuperAdmin: false,
  permissions: ['inventory.items.read'],
};

function makeContext(authorization = 'Bearer access-token') {
  const request: { headers: Record<string, string>; query: Record<string, unknown>; user?: unknown } = {
    headers: { authorization },
    query: {},
  };
  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

function makeGuard(options?: {
  principal?: { id: string; companyId: string; isActive: boolean; deletedAt: Date | null } | null;
  verifyError?: Error;
}) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
  } as unknown as Reflector;
  const jwt = {
    verifyAsync: jest.fn().mockImplementation(() =>
      options?.verifyError ? Promise.reject(options.verifyError) : Promise.resolve(payload),
    ),
  } as unknown as JwtService;
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(
        options && 'principal' in options
          ? options.principal
          : {
              id: payload.sub,
              companyId: payload.companyId,
              isActive: true,
              deletedAt: null,
            },
      ),
    },
  } as unknown as PrismaService;
  return { guard: new JwtAuthGuard(reflector, jwt, prisma), jwt, prisma };
}

describe('JwtAuthGuard account status', () => {
  it('accepts a valid token for an active account in the same company', async () => {
    const { guard, prisma } = makeGuard();
    const { context, request } = makeContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: payload.sub },
      select: { id: true, companyId: true, isActive: true, deletedAt: true },
    });
    expect(request.user).toMatchObject({
      userId: payload.sub,
      companyId: payload.companyId,
      permissions: payload.permissions,
    });
  });

  it.each([
    ['inactive', { id: payload.sub, companyId: payload.companyId, isActive: false, deletedAt: null }],
    ['deleted', { id: payload.sub, companyId: payload.companyId, isActive: true, deletedAt: new Date() }],
    ['missing', null],
    ['company mismatch', { id: payload.sub, companyId: 'other-company', isActive: true, deletedAt: null }],
  ])('rejects a %s account before allowing protected requests', async (_label, principal) => {
    const { guard } = makeGuard({ principal });
    const { context } = makeContext();

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not query the account when the access token is invalid', async () => {
    const { guard, prisma } = makeGuard({ verifyError: new Error('bad token') });
    const { context } = makeContext();

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
