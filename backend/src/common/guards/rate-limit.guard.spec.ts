import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RateLimitGuard, VerifiedUserRateLimitGuard } from './rate-limit.guard';

/// Builds the smallest thing the guard actually uses.
function context(
  path: string,
  ip = '10.0.0.1',
  headers: Record<string, string | string[] | undefined> = {},
): { context: ExecutionContext; status: { code?: number; body?: unknown; headers: Record<string, string> } } {
  const status = { headers: {} as Record<string, string> } as {
    code?: number;
    body?: unknown;
    headers: Record<string, string>;
  };
  const response = {
    setHeader(name: string, value: string) {
      status.headers[name] = value;
    },
    status(code: number) {
      status.code = code;
      return {
        json(body: unknown) {
          status.body = body;
        },
      };
    },
  };
  const request = { ip, path, url: path, route: { path }, headers };
  return {
    status,
    context: {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext,
  };
}

function guardFor(values: Record<string, unknown>): RateLimitGuard {
  const config = {
    get: (key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
  } as unknown as ConfigService;
  return new RateLimitGuard(config);
}

describe('RateLimitGuard', () => {
  it('lets requests through while they are under the limit', () => {
    const guard = guardFor({ RATE_LIMIT_MAX: 3 });
    for (let i = 0; i < 3; i += 1) {
      expect(guard.canActivate(context('/inventory/items').context)).toBe(true);
    }
  });

  it('refuses the request that goes over, with 429 and Retry-After', () => {
    const guard = guardFor({ RATE_LIMIT_MAX: 2 });
    guard.canActivate(context('/inventory/items').context);
    guard.canActivate(context('/inventory/items').context);
    const { context: ctx, status } = context('/inventory/items');
    expect(() => guard.canActivate(ctx)).toThrow(
      expect.objectContaining({
        status: HttpStatus.TOO_MANY_REQUESTS,
      }),
    );
    // The guard sets Retry-After, then Nest's exception filter sends one reply.
    expect(status.code).toBeUndefined();
    expect(status.body).toBeUndefined();
    expect(status.headers['Retry-After']).toBeDefined();
  });

  it('gives sign-in its own, much tighter allowance', () => {
    // The general allowance is generous, so the login page cannot be used to
    // exhaust everyone's quota.
    const guard = guardFor({ RATE_LIMIT_MAX: 100, RATE_LIMIT_AUTH_MAX: 2 });
    for (let i = 0; i < 2; i += 1) {
      expect(guard.canActivate(context('/api/v1/auth/login').context)).toBe(true);
    }
    expect(() => guard.canActivate(context('/api/v1/auth/login').context)).toThrow(HttpException);
    // A different route on the same address is untouched.
    expect(guard.canActivate(context('/api/v1/inventory/items').context)).toBe(true);
  });

  it('counts each caller separately', () => {
    const guard = guardFor({ RATE_LIMIT_MAX: 1 });
    expect(guard.canActivate(context('/x', '10.0.0.1').context)).toBe(true);
    expect(guard.canActivate(context('/x', '10.0.0.2').context)).toBe(true);
    expect(() => guard.canActivate(context('/x', '10.0.0.1').context)).toThrow(HttpException);
  });

  it('ignores a forwarded address unless a proxy is trusted', () => {
    const guard = guardFor({ RATE_LIMIT_MAX: 1 });
    const headers = { 'x-forwarded-for': '203.0.113.9' };
    // Without TRUST_PROXY the header is not believed: a caller cannot reset
    // its own counter by inventing one.
    expect(guard.canActivate(context('/x', '10.0.0.1', headers).context)).toBe(true);
    expect(() => guard.canActivate(context('/x', '10.0.0.1', headers).context)).toThrow(HttpException);
  });

  it('believes the forwarded address when a proxy is trusted', () => {
    const guard = guardFor({ RATE_LIMIT_MAX: 1, TRUST_PROXY: 'true' });
    const headers = { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' };
    expect(guard.canActivate(context('/x', '10.0.0.1', headers).context)).toBe(true);
    // Same proxy, different real client: a fresh allowance.
    const other = { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' };
    expect(guard.canActivate(context('/x', '10.0.0.1', other).context)).toBe(true);
    // The first client is now over.
    expect(() => guard.canActivate(context('/x', '10.0.0.1', headers).context)).toThrow(HttpException);
  });

  it('can be switched off by configuration', () => {
    const guard = guardFor({ RATE_LIMIT_MAX: 1, RATE_LIMIT_ENABLED: 'false' });
    for (let i = 0; i < 20; i += 1) {
      expect(guard.canActivate(context('/x').context)).toBe(true);
    }
  });
});

describe('address reservation, refund and verified-user quota', () => {
  const config = (values: Record<string, unknown>) => ({
    get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
  }) as unknown as ConfigService;
  type Req = { ip: string; path: string; url: string; route: { path: string }; headers: Record<string, string>; user?: unknown; rateReservation?: unknown };
  const ctx = (req: Req) => ({
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ setHeader() {}, status: () => ({ json() {} }) }),
    }),
  }) as unknown as ExecutionContext;
  const mk = (limit: number) => {
    const pre = new RateLimitGuard(config({ RATE_LIMIT_MAX: limit, RATE_LIMIT_AUTH_MAX: 2 }));
    return { pre, post: new VerifiedUserRateLimitGuard(pre) };
  };
  const req = (ip: string, path = '/x', user?: { userId: string; companyId: string }): Req =>
    ({ ip, path, url: path, route: { path }, headers: {}, user });
  const attempt = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e) { return (e as HttpException).getStatus?.() === 429 ? '429' : 'err'; } };
  /// One full request through both guards, authenticated as `user` (undefined = auth fails).
  const call = (g: ReturnType<typeof mk>, ip: string, user?: { userId: string; companyId: string }, path = '/x') => {
    const r = req(ip, path);
    const c = ctx(r);
    const first = attempt(() => g.pre.canActivate(c));
    if (first !== 'ok') return first;
    if (!user) return 'ok-unauth'; // JwtAuthGuard would reject: reservation stays
    r.user = user;
    return attempt(() => g.post.canActivate(c));
  };

  it('100 users behind one address each keep their own 300-style allowance', () => {
    const g = mk(3);
    for (let round = 0; round < 3; round += 1) {
      for (let u = 0; u < 100; u += 1) expect(call(g, '10.1.1.1', { userId: `u${u}`, companyId: 'c' })).toBe('ok');
    }
    expect(call(g, '10.1.1.1', { userId: 'u0', companyId: 'c' })).toBe('429'); // own quota
    expect(call(g, '10.1.1.1', { userId: 'u99', companyId: 'c' })).toBe('429');
    expect(call(g, '10.1.1.1', { userId: 'u100', companyId: 'c' })).toBe('ok'); // a new user is unaffected
  });

  it('keeps unauthenticated or revoked requests on the address budget (no refund)', () => {
    const g = mk(3);
    expect(['ok-unauth', 'ok-unauth', 'ok-unauth']).toEqual([call(g, '10.2.2.2'), call(g, '10.2.2.2'), call(g, '10.2.2.2')]);
    expect(call(g, '10.2.2.2')).toBe('429');
    // A validated user from the same address is also held while the address is full.
    expect(call(g, '10.2.2.2', { userId: 'u1', companyId: 'c' })).toBe('429');
  });

  it('mixes failed and successful requests: refunds only the successful ones', () => {
    const g = mk(4);
    expect(call(g, '10.3.3.3')).toBe('ok-unauth');
    for (let i = 0; i < 20; i += 1) expect(call(g, '10.3.3.3', { userId: `u${i}`, companyId: 'c' })).toBe('ok');
    expect(call(g, '10.3.3.3')).toBe('ok-unauth');
    expect(call(g, '10.3.3.3')).toBe('ok-unauth');
    expect(call(g, '10.3.3.3')).toBe('ok-unauth'); // 4 failures so far, 20 successes refunded
    expect(call(g, '10.3.3.3')).toBe('429'); // the fifth failure is over the limit of 4
  });

  it('refunds at most once, and never touches a later window', () => {
    const pre = new RateLimitGuard(config({ RATE_LIMIT_MAX: 2, RATE_LIMIT_WINDOW_MS: 1000 }));
    const post = new VerifiedUserRateLimitGuard(pre);
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    const r1 = req('10.4.4.4');
    pre.canActivate(ctx(r1));
    now.mockReturnValue(1_002_000); // the window reset before auth finished
    const r2 = req('10.4.4.4');
    pre.canActivate(ctx(r2)); // opens a new window with count 1
    r1.user = { userId: 'u1', companyId: 'c' };
    post.canActivate(ctx(r1)); // refund for the old window must not lower the new one
    post.canActivate(ctx(r1)); // second refund is a no-op
    const r3 = req('10.4.4.4');
    expect(attempt(() => pre.canActivate(ctx(r3)))).toBe('ok'); // count 2
    expect(attempt(() => pre.canActivate(ctx(req('10.4.4.4'))))).toBe('429'); // count 3 > 2
    now.mockRestore();
  });

  it('bounds concurrent pending requests with the same address budget', () => {
    const g = mk(5);
    const results = Array.from({ length: 8 }, () => call(g, '10.5.5.5'));
    expect(results.filter((r) => r === '429')).toHaveLength(3);
  });

  it('leaves sign-in at its own tight address limit and never refunds it', () => {
    const g = mk(300);
    expect(call(g, '10.6.6.6', undefined, '/auth/login')).toBe('ok-unauth');
    expect(call(g, '10.6.6.6', undefined, '/auth/login')).toBe('ok-unauth');
    expect(call(g, '10.6.6.6', undefined, '/auth/login')).toBe('429');
  });

  it('counts one user once across tokens and addresses', () => {
    const g = mk(3);
    const u = { userId: 'u1', companyId: 'c' };
    expect(call(g, '10.7.0.1', u)).toBe('ok');
    expect(call(g, '10.7.0.2', u)).toBe('ok');
    expect(call(g, '10.7.0.3', u)).toBe('ok');
    expect(call(g, '10.7.0.4', u)).toBe('429');
  });
});
