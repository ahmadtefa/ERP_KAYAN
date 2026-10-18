import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';

const payload = {
  sub: 'user-1',
  username: 'stale-token-name',
  companyId: 'company-1',
  branchId: 'branch-old',
  isSuperAdmin: true,
  permissions: ['admin.users.manage', 'inventory.items.read', 'reports.read'],
};

const activePrincipal = {
  id: payload.sub,
  username: 'employee',
  companyId: payload.companyId,
  isActive: true,
  isSuperAdmin: false,
  deletedAt: null,
  tokenVersion: 0,
  userRoles: [
    {
      role: {
        rolePermissions: [
          { permission: { code: 'inventory.items.read' } },
          { permission: { code: 'reports.read' } },
        ],
      },
    },
  ],
  branches: [{ branchId: 'branch-current' }],
};

function makeContext(authorization = 'Bearer access-token') {
  const request: {
    headers: Record<string, string>;
    query: Record<string, unknown>;
    user?: unknown;
  } = {
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

type TestPrincipal = Omit<typeof activePrincipal, 'deletedAt'> & {
  deletedAt: Date | null;
};

function makeGuard(options?: {
  principal?: TestPrincipal | null;
  tokenPayload?: typeof payload;
  verifyError?: Error;
}) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
  } as unknown as Reflector;
  const jwt = {
    verifyAsync: jest.fn().mockImplementation(() =>
      options?.verifyError
        ? Promise.reject(options.verifyError)
        : Promise.resolve(options?.tokenPayload ?? payload),
    ),
  } as unknown as JwtService;
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(
        options && 'principal' in options ? options.principal : activePrincipal,
      ),
    },
  } as unknown as PrismaService;
  return { guard: new JwtAuthGuard(reflector, jwt, prisma), jwt, prisma };
}

describe('JwtAuthGuard account status and live authorization', () => {
  it('ignores stale token permissions, identity, super-admin status, and branch', async () => {
    const { guard, prisma } = makeGuard();
    const { context, request } = makeContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: payload.sub },
      select: {
        id: true,
        username: true,
        companyId: true,
        isActive: true,
        isSuperAdmin: true,
        deletedAt: true,
        tokenVersion: true,
        userRoles: {
          where: {
            companyId: payload.companyId,
            role: {
              deletedAt: null,
              OR: [{ companyId: payload.companyId }, { companyId: null }],
            },
          },
          select: {
            role: {
              select: {
                rolePermissions: {
                  select: { permission: { select: { code: true } } },
                },
              },
            },
          },
        },
        branches: {
          where: {
            branch: {
              companyId: payload.companyId,
              isActive: true,
              deletedAt: null,
            },
          },
          select: { branchId: true },
          orderBy: { branchId: 'asc' },
        },
      },
    });
    expect(request.user).toEqual({
      userId: payload.sub,
      username: 'employee',
      companyId: payload.companyId,
      branchId: 'branch-current',
      isSuperAdmin: false,
      permissions: ['inventory.items.read', 'reports.read'],
    });
  });

  it('preserves a selected branch only while it remains assigned and active', async () => {
    const { guard } = makeGuard({
      tokenPayload: { ...payload, branchId: 'branch-current' },
    });
    const { context, request } = makeContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({ branchId: 'branch-current' });
  });

  it.each([
    ['inactive', { ...activePrincipal, isActive: false }],
    ['deleted', { ...activePrincipal, deletedAt: new Date() }],
    ['missing', null],
    ['company mismatch', { ...activePrincipal, companyId: 'other-company' }],
  ])('rejects a %s account before allowing protected requests', async (_label, principal) => {
    const { guard } = makeGuard({ principal });
    const { context } = makeContext();

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('honors a permission revocation before the access token expires', async () => {
    const principal = {
      ...activePrincipal,
      userRoles: [{ role: { rolePermissions: [] } }],
    };
    const { guard } = makeGuard({ principal });
    const { context, request } = makeContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({ permissions: [], isSuperAdmin: false });
  });

  it('honors super-admin demotion before the access token expires', async () => {
    const principal = { ...activePrincipal, isSuperAdmin: false };
    const { guard } = makeGuard({ principal });
    const { context, request } = makeContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({ isSuperAdmin: false });
  });

  it('does not query the account when the access token is invalid', async () => {
    const { guard, prisma } = makeGuard({ verifyError: new Error('bad token') });
    const { context } = makeContext();

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
  it('rejects access tokens revoked by reset', async () => {
    const { guard } = makeGuard({ principal: { ...activePrincipal, tokenVersion: 1 } });
    await expect(guard.canActivate(makeContext().context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

});
