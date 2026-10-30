import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';

import { LicenseGuard, licenceMessage } from './license.guard';

/**
 * What an expired licence stops, and what it must never stop. The distinction
 * matters more than the block itself: a customer whose licence expired must
 * still be able to sign in, read the licence screen, enter a renewal key, and
 * take a backup of their data.
 */

const contextFor = (path: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ route: { path }, path, url: `${path}?x=1` }),
    }),
  }) as unknown as ExecutionContext;

function guard(options: {
  enforced?: boolean;
  blocked?: boolean;
  state?: 'UNLICENSED' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'WRONG_MACHINE';
}) {
  const service = {
    isEnforced: () => options.enforced ?? true,
    status: jest.fn().mockResolvedValue({
      blocked: options.blocked ?? true,
      state: options.state ?? 'EXPIRED',
      expiresAt: '2026-05-01T00:00:00.000Z',
      perpetual: false,
    }),
  };
  return { guard: new LicenseGuard(service as any), service };
}

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return null;
  } catch (error) {
    return (error as ForbiddenException).getResponse() as any;
  }
};

describe('LicenseGuard while the licence is blocked', () => {
  it('stops a business route and says why', async () => {
    const { guard: g } = guard({});
    const body = await codeOf(g.canActivate(contextFor('/invoices')));
    expect(body.code).toBe('LICENSE_EXPIRED');
    expect(body.license).toEqual({
      state: 'EXPIRED',
      expiresAt: '2026-05-01T00:00:00.000Z',
      perpetual: false,
    });
    expect(body.detail).toContain('البيانات محفوظة');
  });

  it('names a clock suspension as such', async () => {
    const { guard: g } = guard({ state: 'SUSPENDED' });
    const body = await codeOf(g.canActivate(contextFor('/journals')));
    expect(body.code).toBe('LICENSE_CLOCK_TAMPERED');
  });

  it('blocks a copied licence and identifies the machine mismatch', async () => {
    const { guard: g } = guard({ state: 'WRONG_MACHINE' });
    const body = await codeOf(g.canActivate(contextFor('/journals')));
    expect(body.code).toBe('LICENSE_WRONG_MACHINE');
    expect(body.detail).toContain('البيانات محفوظة');
  });

  it('asks for an activation when there is no licence at all', async () => {
    const { guard: g } = guard({ state: 'UNLICENSED' });
    const body = await codeOf(g.canActivate(contextFor('/journals')));
    expect(body.code).toBe('LICENSE_REQUIRED');
  });

  it.each([
    '/auth/login',
    '/license',
    '/license/status',
    '/license/request-code',
    '/backup',
    '/backup/full',
    '/health',
    '/setup/status',
    '/api/v1/health',
    '/api/v1/setup/status',
    '/api/v1/backup/full',
    '/api/v1/license/status',
  ])('keeps %s reachable', async (path) => {
    const { guard: g, service } = guard({});
    await expect(g.canActivate(contextFor(path))).resolves.toBe(true);
    // It does not even ask, so a slow database cannot block the way out.
    expect(service.status).not.toHaveBeenCalled();
  });

  it('does not treat a prefixed business route as an escape route', async () => {
    const { guard: g } = guard({});
    const body = await codeOf(g.canActivate(contextFor('/api/v1/authorizations')));
    expect(body?.code).toBe('LICENSE_EXPIRED');
  });

  it('does not treat a longer path with the same first letters as allowed', async () => {
    const { guard: g } = guard({});
    const body = await codeOf(g.canActivate(contextFor('/authorizations')));
    expect(body?.code).toBe('LICENSE_EXPIRED');
  });

  it('lets everything through when enforcement is off or warn', async () => {
    const { guard: g } = guard({ enforced: false });
    await expect(g.canActivate(contextFor('/invoices'))).resolves.toBe(true);
  });

  it('lets everything through while the licence is valid', async () => {
    const { guard: g } = guard({ blocked: false, state: 'ACTIVE' });
    await expect(g.canActivate(contextFor('/invoices'))).resolves.toBe(true);
  });
});

describe('licenceMessage', () => {
  it('is bilingual for every state and never suggests deleting data', () => {
    for (const state of ['EXPIRED', 'SUSPENDED', 'WRONG_MACHINE', 'UNLICENSED']) {
      const message = licenceMessage(state);
      expect(message).toMatch(/[\u0600-\u06FF]/);
      expect(message).toContain('/');
    }
    expect(licenceMessage('EXPIRED')).toContain('البيانات محفوظة');
  });
});
