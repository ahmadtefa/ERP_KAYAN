import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RateLimitGuard } from './rate-limit.guard';

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
    expect(guard.canActivate(ctx)).toBe(false);
    expect(status.code).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(status.headers['Retry-After']).toBeDefined();
    expect((status.body as { title: string }).title).toBe('TOO_MANY_REQUESTS');
  });

  it('gives sign-in its own, much tighter allowance', () => {
    // The general allowance is generous, so the login page cannot be used to
    // exhaust everyone's quota.
    const guard = guardFor({ RATE_LIMIT_MAX: 100, RATE_LIMIT_AUTH_MAX: 2 });
    for (let i = 0; i < 2; i += 1) {
      expect(guard.canActivate(context('/api/v1/auth/login').context)).toBe(true);
    }
    expect(guard.canActivate(context('/api/v1/auth/login').context)).toBe(false);
    // A different route on the same address is untouched.
    expect(guard.canActivate(context('/api/v1/inventory/items').context)).toBe(true);
  });

  it('counts each caller separately', () => {
    const guard = guardFor({ RATE_LIMIT_MAX: 1 });
    expect(guard.canActivate(context('/x', '10.0.0.1').context)).toBe(true);
    expect(guard.canActivate(context('/x', '10.0.0.2').context)).toBe(true);
    expect(guard.canActivate(context('/x', '10.0.0.1').context)).toBe(false);
  });

  it('ignores a forwarded address unless a proxy is trusted', () => {
    const guard = guardFor({ RATE_LIMIT_MAX: 1 });
    const headers = { 'x-forwarded-for': '203.0.113.9' };
    // Without TRUST_PROXY the header is not believed: a caller cannot reset
    // its own counter by inventing one.
    expect(guard.canActivate(context('/x', '10.0.0.1', headers).context)).toBe(true);
    expect(guard.canActivate(context('/x', '10.0.0.1', headers).context)).toBe(false);
  });

  it('believes the forwarded address when a proxy is trusted', () => {
    const guard = guardFor({ RATE_LIMIT_MAX: 1, TRUST_PROXY: 'true' });
    const headers = { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' };
    expect(guard.canActivate(context('/x', '10.0.0.1', headers).context)).toBe(true);
    // Same proxy, different real client: a fresh allowance.
    const other = { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' };
    expect(guard.canActivate(context('/x', '10.0.0.1', other).context)).toBe(true);
    // The first client is now over.
    expect(guard.canActivate(context('/x', '10.0.0.1', headers).context)).toBe(false);
  });

  it('can be switched off by configuration', () => {
    const guard = guardFor({ RATE_LIMIT_MAX: 1, RATE_LIMIT_ENABLED: 'false' });
    for (let i = 0; i < 20; i += 1) {
      expect(guard.canActivate(context('/x').context)).toBe(true);
    }
  });
});
