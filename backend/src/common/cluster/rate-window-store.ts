/// The request counters of the whole server when it runs several workers. The
/// primary process owns them, so one address or user is counted once however
/// many workers its requests land on. Same fixed-window rule as the
/// single-process limiter.
interface Window { count: number; resetAt: number }

export class RateWindowStore {
  private readonly windows = new Map<string, Window>();
  private lastPrune = 0;

  /// Counts one request. Returns whether it is within [limit] and the window.
  hit(key: string, limit: number, windowMs: number, now: number = Date.now()): { allowed: boolean; count: number; resetAt: number } {
    this.prune(now);
    const w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.windows.set(key, fresh);
      return { allowed: true, count: 1, resetAt: fresh.resetAt };
    }
    w.count += 1;
    return { allowed: w.count <= limit, count: w.count, resetAt: w.resetAt };
  }

  /// Gives one request back, only while the same window is still the live one.
  refund(key: string, resetAt: number, now: number = Date.now()): void {
    const w = this.windows.get(key);
    if (w && w.resetAt === resetAt && w.resetAt > now && w.count > 0) w.count -= 1;
  }

  size(): number {
    return this.windows.size;
  }

  private prune(now: number): void {
    if (now - this.lastPrune < 60_000) return;
    this.lastPrune = now;
    for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
  }
}

export interface RateRequestMessage {
  kroot: 'kayan-rate';
  id: number;
  op: 'hit' | 'refund';
  key: string;
  limit?: number;
  windowMs?: number;
  resetAt?: number;
}
export interface RateReplyMessage {
  kroot: 'kayan-rate';
  id: number;
  allowed: boolean;
  count: number;
  resetAt: number;
}
