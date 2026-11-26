import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ALLOW_QUERY_TOKEN_KEY } from '../decorators/allow-query-token.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';

const payload = {
  sub: 'user-1',
  username: 'stale-token-name',
  companyId: 'company-1',
  branchId: 'branch-old',
  isSuperAdmin: true,
  permissions: ['admin.users.manage', 'inventory.items.read', 'reports.read'],
  sessionHash: 'a'.repeat(64),
};

const activePrincipal = {
  id: payload.sub,
  username: 'employee',
  companyId: payload.companyId,
  isActive: true,
  isSuperAdmin: false,
  deletedAt: null,
  tokenVersion: 0,
  company: { isActive: true, deletedAt: null as Date | null },
  userRoles: [
    {
      role: {
        code: 'storekeeper',
        isActive: true,
        rolePermissions: [
          { permission: { code: 'inventory.items.read' } },
          { permission: { code: 'reports.read' } },
        ],
      },
    },
  ],
  branches: [{ branchId: 'branch-current' }],
  userPermissions: [] as Array<{ permission: { code: string } }>,
};

function makeContext(
  authorization = 'Bearer access-token',
  query: Record<string, unknown> = {},
) {
  const request: {
    headers: Record<string, string>;
    query: Record<string, unknown>;
    user?: unknown;
  } = {
    headers: { authorization },
    query,
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
  tokenPayload?: typeof payload & { typ?: string };
  verifyError?: Error;
  allowQueryToken?: boolean;
}) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) =>
      key === ALLOW_QUERY_TOKEN_KEY ? (options?.allowQueryToken ?? false) : false,
    ),
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
    refreshToken: { findFirst: jest.fn().mockResolvedValue({ id: 'session' }) },
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
        company: { select: { isActive: true, deletedAt: true } },
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
                // The code as well as the permissions: the notification centre
                // addresses an alert to a role, not to a permission.
                code: true,
                isActive: true,
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
        // Loaded with the session so a shelf the person may not enter is
        // refused by the API, not only hidden by a screen.
        warehouseAccess: {
          where: { warehouse: { companyId: payload.companyId, deletedAt: null } },
          select: {
            warehouseId: true,
            canView: true,
            canReceive: true,
            canIssue: true,
            canTransfer: true,
            canCount: true,
            canApprove: true,
            canSeeCost: true,
          },
        },
        userPermissions: {
          select: { isDenied: true, permission: { select: { code: true } } },
        },
      },
    });
    expect(request.user).toEqual({
      userId: payload.sub,
      username: 'employee',
      companyId: payload.companyId,
      branchId: 'branch-current',
      sessionHash: payload.sessionHash,
      // The whole assignment, so warehouse screens can narrow to it.
      branchIds: ['branch-current'],
      roles: ['storekeeper'],
      warehouseAccess: [],
      isSuperAdmin: false,
      permissions: ['inventory.items.read', 'reports.read'],
    });
  });

  it('does not expose inactive role codes in the authenticated principal', async () => {
    const principal = {
      ...activePrincipal,
      userRoles: [
        ...activePrincipal.userRoles,
        { role: { code: 'GENERAL_MANAGER', isActive: false, rolePermissions: [] } },
      ],
    } as never;
    const { guard } = makeGuard({ principal });
    const { context, request } = makeContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({ roles: ['storekeeper'] });
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

  it('adds a personal grant to the permissions the roles give', async () => {
    const principal = {
      ...activePrincipal,
      userPermissions: [{ permission: { code: 'cash.vouchers.create' } }],
    };
    const { guard } = makeGuard({ principal });
    const { context, request } = makeContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({
      permissions: [
        'cash.vouchers.create',
        'inventory.items.read',
        'reports.read',
      ],
    });
  });

  it('honors a permission revocation before the access token expires', async () => {
    const principal = {
      ...activePrincipal,
      userRoles: [{ role: { code: 'viewer', isActive: true, rolePermissions: [] } }],
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
  it('accepts a download ticket on a route that opted in to query credentials', async () => {
    const ticketPayload = { ...payload, typ: 'download' };
    const { guard } = makeGuard({ tokenPayload: ticketPayload, allowQueryToken: true });
    const { context, request } = makeContext('', { ticket: 'ticket-token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({
      userId: payload.sub,
      permissions: ['inventory.items.read', 'reports.read'],
    });
  });

  it('does not accept a sign-in token where a download ticket is required', async () => {
    const { guard } = makeGuard({ allowQueryToken: true });
    const { context } = makeContext('', { token: 'access-token' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not accept a download ticket as a bearer token', async () => {
    const ticketPayload = { ...payload, typ: 'download' };
    const { guard } = makeGuard({ tokenPayload: ticketPayload });
    const { context } = makeContext('Bearer ticket-token');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token after its persisted session was removed by restore', async () => {
    const { guard, prisma } = makeGuard();
    jest.mocked(prisma.refreshToken.findFirst).mockResolvedValueOnce(null);
    await expect(guard.canActivate(makeContext().context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshToken.findFirst).toHaveBeenCalledWith({
      where: {
        tokenHash: payload.sessionHash,
        userId: payload.sub,
        // A revoked or expired row is not a session: sign-out and refresh
        // rotation stamp `revokedAt`, and the access token that outlives them
        // must stop working with them.
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      select: { id: true },
    });
  });

  it('rejects every person of a suspended or retired company', async () => {
    for (const company of [
      { isActive: false, deletedAt: null },
      { isActive: true, deletedAt: new Date('2026-11-01T00:00:00Z') },
    ]) {
      const { guard } = makeGuard({ principal: { ...activePrincipal, company } });
      await expect(guard.canActivate(makeContext().context)).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it('rejects access tokens revoked by reset', async () => {
    const { guard } = makeGuard({ principal: { ...activePrincipal, tokenVersion: 1 } });
    await expect(guard.canActivate(makeContext().context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

});
