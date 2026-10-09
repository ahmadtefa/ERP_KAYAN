import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/// A fixed-window request counter, kept in memory.
///
/// This exists because the server is reachable from anywhere: without a limit,
/// anyone can sit and guess passwords as fast as the network allows.
///
/// Sign-in is counted separately and far more tightly than everything else, so
/// a busy office cannot exhaust the allowance that protects the login page.
///
/// A single process keeps the counts, which is the right size for one server.
/// Running several instances behind a load balancer would need the counters in
/// a shared store (Redis) instead — flagged here rather than pretended away.
///
/// Note for deployment: behind a reverse proxy every request arrives from the
/// proxy's address, so the proxy must be configured to forward the real client
/// address (X-Forwarded-For) and this server started with TRUST_PROXY=true.
/// Without that, one abusive client would use up everyone's allowance.
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  private readonly counters = new Map<string, { count: number; resetAt: number }>();
  private lastPrune = Date.now();

  /// Routes that get the tight allowance, because guessing is cheap there.
  private static readonly sensitiveRoutes = [
    '/auth/login',
    '/auth/refresh',
  ];

  canActivate(context: ExecutionContext): boolean {
    if (!this.enabled) return true;

    const request = context.switchToHttp().getRequest<{
      ip?: string;
      socket?: { remoteAddress?: string };
      path?: string;
      url?: string;
      route?: { path?: string };
      headers: Record<string, string | string[] | undefined>;
    }>();

    const response = context.switchToHttp().getResponse<{
      setHeader(name: string, value: string): void;
      status(code: number): { json(body: unknown): void };
    }>();

    const path = request.route?.path ?? request.path ?? request.url ?? '';
    const sensitive = RateLimitGuard.sensitiveRoutes.some((route) =>
      path.includes(route),
    );
    const limit = sensitive
      ? this.config.get<number>('RATE_LIMIT_AUTH_MAX', 10)
      : this.config.get<number>('RATE_LIMIT_MAX', 300);
    const windowMs = this.config.get<number>('RATE_LIMIT_WINDOW_MS', 60_000);

    const address = this.clientAddress(request);
    const key = `${sensitive ? 'auth' : 'api'}:${address}`;
    const now = Date.now();

    this.prune(now);

    const entry = this.counters.get(key);
    if (!entry || entry.resetAt <= now) {
      this.counters.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }

    entry.count += 1;
    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return this.reject(response, retryAfter, sensitive);
    }
    return true;
  }

  /// Writes the refusal straight onto the response.
  ///
  /// Doing it here rather than throwing keeps Retry-After on the reply, which
  /// is what a well-behaved client needs in order to back off correctly.
  private reject(
    response: {
      setHeader(name: string, value: string): void;
      status(code: number): { json(body: unknown): void };
    },
    retryAfter: number,
    sensitive: boolean,
  ): boolean {
    response.setHeader('Retry-After', String(retryAfter));
    response.status(HttpStatus.TOO_MANY_REQUESTS).json({
      type: 'about:blank',
      title: 'TOO_MANY_REQUESTS',
      status: HttpStatus.TOO_MANY_REQUESTS,
      detail: sensitive
        ? `Too many attempts. Try again in ${retryAfter} second(s).`
        : `Too many requests. Try again in ${retryAfter} second(s).`,
    });
    return false;
  }

  private get enabled(): boolean {
    return this.config.get<string>('RATE_LIMIT_ENABLED', 'true') !== 'false';
  }

  /// The caller's address, honouring a proxy only when the deployment says a
  /// proxy is trusted. Trusting the header blindly would let anyone reset
  /// their own counter by inventing a value.
  private clientAddress(request: {
    ip?: string;
    socket?: { remoteAddress?: string };
    headers: Record<string, string | string[] | undefined>;
  }): string {
    if (this.config.get<string>('TRUST_PROXY', 'false') === 'true') {
      const forwarded = request.headers['x-forwarded-for'];
      const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
      const first = value?.split(',')[0]?.trim();
      if (first) return first;
    }
    return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
  }

  /// Drops expired windows so the map cannot grow without bound.
  private prune(now: number): void {
    if (now - this.lastPrune < 60_000) return;
    this.lastPrune = now;
    for (const [key, entry] of this.counters) {
      if (entry.resetAt <= now) this.counters.delete(key);
    }
  }
}
