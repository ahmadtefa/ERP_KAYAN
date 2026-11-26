import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isClusterWorker } from '../cluster/cluster-config';
import { RateReplyMessage, RateRequestMessage } from '../cluster/rate-window-store';

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
interface WindowEntry { count: number; resetAt: number }

/// What a request reserved in the per-address window before authentication.
/// It names the exact window entry, so a refund can never touch a later window.
export interface RateReservation { key: string; entry: WindowEntry; refunded: boolean }

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  private readonly counters = new Map<string, WindowEntry>();
  private lastPrune = Date.now();

  /// With several workers the counts live in the supervising process, so one
  /// address or user is counted once however many workers serve it.
  private readonly remote = isClusterWorker();
  private nextRemoteId = 1;
  private readonly pendingRemote = new Map<number, (r: RateReplyMessage) => void>();
  private remoteListening = false;

  private remoteHit(key: string, limit: number, windowMs: number): Promise<RateReplyMessage> {
    if (!this.remoteListening) {
      this.remoteListening = true;
      process.on('message', (m: RateReplyMessage) => {
        if (!m || m.kroot !== 'kayan-rate') return;
        const done = this.pendingRemote.get(m.id);
        if (done) {
          this.pendingRemote.delete(m.id);
          done(m);
        }
      });
    }
    return new Promise((resolve) => {
      const id = this.nextRemoteId++;
      // If the supervisor does not answer, fail open for this request rather
      // than stall every request; the single-process limits still apply.
      const timer = setTimeout(() => {
        this.pendingRemote.delete(id);
        resolve({ kroot: 'kayan-rate', id, allowed: true, count: 0, resetAt: Date.now() + windowMs });
      }, 2000);
      this.pendingRemote.set(id, (r) => { clearTimeout(timer); resolve(r); });
      const msg: RateRequestMessage = { kroot: 'kayan-rate', id, op: 'hit', key, limit, windowMs };
      process.send?.(msg);
    });
  }

  /// Routes that get the tight allowance, because guessing is cheap there.
  private static readonly sensitiveRoutes = [
    '/auth/login',
    '/auth/refresh',
    '/auth/change-password',
  ];

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    if (!this.enabled) return true;

    const request = context.switchToHttp().getRequest<{
      rateReservation?: RateReservation;
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

    if (this.remote) {
      return this.remoteHit(key, limit, windowMs).then((r) => {
        if (!r.allowed) {
          return this.reject(response, Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000)), sensitive);
        }
        if (!sensitive) request.rateReservation = { key, entry: { count: r.count, resetAt: r.resetAt }, refunded: false };
        return true;
      });
    }

    this.prune(now);

    const entry = this.counters.get(key);
    if (!entry || entry.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.counters.set(key, fresh);
      if (!sensitive) request.rateReservation = { key, entry: fresh, refunded: false };
      return true;
    }

    entry.count += 1;
    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return this.reject(response, retryAfter, sensitive);
    }
    if (!sensitive) request.rateReservation = { key, entry, refunded: false };
    return true;
  }

  /// Gives back one address reservation, once, and only while its own window
  /// is still the live one. Called after the session and principal have been
  /// validated; sign-in routes never hold a reservation, so they never refund.
  refund(reservation: RateReservation | undefined): void {
    if (!reservation || reservation.refunded) return;
    reservation.refunded = true;
    if (this.remote) {
      const msg: RateRequestMessage = { kroot: 'kayan-rate', id: 0, op: 'refund', key: reservation.key, resetAt: reservation.entry.resetAt };
      process.send?.(msg);
      return;
    }
    const live = this.counters.get(reservation.key) === reservation.entry;
    if (live && reservation.entry.resetAt > Date.now() && reservation.entry.count > 0) {
      reservation.entry.count -= 1;
    }
  }

  /// Counts one request against a verified user's own window (same limits as
  /// the address window) and refuses it past the limit.
  countUser(key: string, response: Parameters<RateLimitGuard['reject']>[0]): void | Promise<void> {
    if (!this.enabled) return;
    const limit = this.config.get<number>('RATE_LIMIT_MAX', 300);
    const windowMs = this.config.get<number>('RATE_LIMIT_WINDOW_MS', 60_000);
    if (this.remote) {
      return this.remoteHit(key, limit, windowMs).then((r) => {
        if (!r.allowed) this.reject(response, Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000)), false);
      });
    }
    const now = Date.now();
    this.prune(now);
    const entry = this.counters.get(key);
    if (!entry || entry.resetAt <= now) {
      this.counters.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    entry.count += 1;
    if (entry.count > limit) {
      this.reject(response, Math.ceil((entry.resetAt - now) / 1000), false);
    }
  }

  /// Writes the refusal straight onto the response.
  ///
  /// Doing it here rather than throwing keeps Retry-After on the reply, which
  /// is what a well-behaved client needs in order to back off correctly.
  reject(
    response: {
      setHeader(name: string, value: string): void;
      status(code: number): { json(body: unknown): void };
    },
    retryAfter: number,
    sensitive: boolean,
  ): never {
    response.setHeader('Retry-After', String(retryAfter));
    // Let Nest's exception filter send the response exactly once. Returning
    // false after writing here would make Nest attempt a second 403 response.
    throw new HttpException(
      {
        type: 'about:blank',
        title: 'TOO_MANY_REQUESTS',
        status: HttpStatus.TOO_MANY_REQUESTS,
        detail: sensitive
          ? `Too many attempts. Try again in ${retryAfter} second(s).`
          : `Too many requests. Try again in ${retryAfter} second(s).`,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
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

/// Runs right after JwtAuthGuard. A request that got this far has a validated
/// session and principal: its address reservation is refunded and it is
/// counted against its own company/user window instead. Public routes and
/// failed authentication never reach a refund, so the address budget still
/// bounds them.
@Injectable()
export class VerifiedUserRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: RateLimitGuard) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: { id?: string; sub?: string; userId?: string; companyId?: string };
      rateReservation?: RateReservation;
    }>();
    const user = request.user;
    const userId = user?.id ?? user?.userId ?? user?.sub;
    if (!user || !userId || !user.companyId) return true;
    this.limiter.refund(request.rateReservation);
    const response = context.switchToHttp().getResponse<Parameters<RateLimitGuard['reject']>[0]>();
    const counted = this.limiter.countUser(`user:${user.companyId}:${userId}`, response);
    return counted ? counted.then(() => true) : true;
  }
}
