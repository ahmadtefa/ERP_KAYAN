import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { backupDirectory, cleanDatabaseUrl } from '../../modules/backup/system/pg-support';
import { RestoreJournalStore } from '../../modules/backup/system/restore-journal';
import { API_APPLICATION_NAME } from './process-identity';
import { isRestorePending } from '../../modules/backup/system/restore-state';

// Distinct from restore ownership: shared for the entire business handler,
// exclusive for the entire restore, including validation and recovery.
import { BUSINESS_BARRIER_KEY } from './lock-keys';
export { BUSINESS_BARRIER_KEY } from './lock-keys';

/// Largest number of business requests this process lets hold the shared
/// barrier lock at once. Each one keeps a PostgreSQL connection until its
/// handler finishes, so this is also the number of connections the barrier
/// may use. Requests beyond it wait for a free lease (bounded by
/// BARRIER_WAIT_MS) instead of opening one more connection each, which used to
/// exhaust the server's max_connections and answer 503 "maintenance".
export function barrierPoolSize(): number {
  const n = Number(process.env.BARRIER_POOL_MAX);
  return Number.isInteger(n) && n >= 1 && n <= 500 ? n : 32;
}

function barrierWaitMs(): number {
  const n = Number(process.env.BARRIER_WAIT_MS);
  return Number.isInteger(n) && n >= 1_000 && n <= 120_000 ? n : 30_000;
}

/// The refusal for "the server is busy": a real capacity condition, not the
/// maintenance state, and it says so.
export const BARRIER_BUSY_MESSAGE = 'The server is busy. Try again in a moment.';

@Injectable()
export class DatabaseMaintenanceBarrier implements OnModuleDestroy {
  private pool: Pool | null = null;
  private readonly leases = new Set<() => void>();
  private closing = false;
  /// Admissions between asking the pool for a connection and owning a lease.
  private pending = 0;
  private drained: (() => void) | null = null;
  private shutdown: Promise<void> | null = null;

  /// Last resort when admitted handlers do not finish before shutdown's bound:
  /// end the whole process, so the locks drop together with the handlers and
  /// no handler ever keeps running without its lock.
  protected terminate(): void {
    process.exit(1);
  }

  private leaseGone(): void {
    if (this.leases.size === 0 && this.pending === 0) this.drained?.();
  }

  private getPool(): Pool {
    if (this.pool) return this.pool;
    const raw = process.env.DATABASE_URL;
    if (!raw) throw new ServiceUnavailableException({ code: 'DATABASE_BARRIER_GET_POOL_E015', message: 'Database maintenance coordination is unavailable.' });
    const pool = new Pool({
      connectionString: cleanDatabaseUrl(raw),
      max: barrierPoolSize(),
      connectionTimeoutMillis: barrierWaitMs(),
      application_name: `${API_APPLICATION_NAME}-barrier`,
    });
    // An idle pooled connection holds no lock (the lock is released before a
    // connection goes back), so losing one while idle is harmless: the pool
    // drops it. A connection lost while a request holds the lock is handled
    // per lease in admit().
    pool.on('error', () => {});
    this.pool = pool;
    return pool;
  }

  onModuleDestroy(): Promise<void> {
    // Re-entry shares one drain and cannot replace another caller's waiter.
    if (this.shutdown) return this.shutdown;
    this.closing = true;
    this.shutdown = this.closePool();
    return this.shutdown;
  }

  private async closePool(): Promise<void> {
    const pool = this.pool;
    const waitMs = Number(process.env.BARRIER_SHUTDOWN_MS);
    const bound = Number.isInteger(waitMs) && waitMs >= 100 && waitMs <= 120_000 ? waitMs : 30_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), bound);
    });
    const drainAndEnd = async (): Promise<true> => {
      if (this.leases.size > 0 || this.pending > 0) {
        await new Promise<void>((resolve) => { this.drained = resolve; });
      }
      await pool?.end();
      this.pool = null;
      return true;
    };
    try {
      // One deadline covers pending connects, admitted handlers AND pool.end.
      // Never destroy admitted sessions to hurry a shutdown: stop the entire
      // process on timeout/failure so no handler can continue without its lock.
      if (!await Promise.race([drainAndEnd(), timeout])) this.terminate();
    } catch {
      this.terminate();
    } finally {
      if (timer) clearTimeout(timer);
      this.drained = null;
    }
  }

  async admit(): Promise<() => Promise<void>> {
    if (this.closing) throw new ServiceUnavailableException({ code: 'DATABASE_BARRIER_ADMIT_E016', message: 'The server is shutting down. Try again in a moment.' });
    const pool = this.getPool();
    let client: PoolClient;
    this.pending += 1;
    try {
      client = await pool.connect();
      this.pending -= 1;
      // Registered synchronously with the connect result so the drain sees it.
    } catch (error) {
      this.pending -= 1;
      this.leaseGone();
      const text = error instanceof Error ? error.message : '';
      // Waiting for a lease timed out: the server is busy. Anything else
      // (cannot reach the database) keeps the original refusal.
      if (/timeout exceeded when trying to connect/i.test(text)) {
        throw new ServiceUnavailableException(BARRIER_BUSY_MESSAGE);
      }
      throw new ServiceUnavailableException({ code: 'DATABASE_BARRIER_ADMIT_E018', message: 'The database is under maintenance or recovery is required.' });
    }
    let admitted = false;
    let released = false;
    const onError = () => {
      // A handler cannot safely keep running after losing its lease. Fail-stop
      // this API incarnation; the restore owner also drains tagged server
      // sessions before taking its snapshot. Never log connection secrets.
      if (admitted && !released) process.exit(1);
    };
    client.on('error', onError);
    // A connection that may still hold the lock is destroyed, never reused:
    // closing the session is what releases a session-level advisory lock.
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      this.leases.delete(destroy);
      client.removeListener('error', onError);
      client.on('error', () => {});
      client.release(true);
      this.leaseGone();
    };
    let destroyed = false;
    this.leases.add(destroy);
    try {
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock_shared($1) AS locked', [BUSINESS_BARRIER_KEY],
      );
      if (!result.rows[0]?.locked) throw new Error('maintenance');
      if (await isRestorePending(client)) throw new Error('persistent recovery required');
      // Read AFTER locking: a restore cannot begin between this check and the
      // handler. A dead owner releases PostgreSQL locks but not this journal.
      if (await new RestoreJournalStore(backupDirectory()).read()) throw new Error('recovery required');
      // Shutdown began while this admission was in flight: refuse it.
      if (this.closing) throw new Error('closing');
      admitted = true;
    } catch {
      destroy();
      throw new ServiceUnavailableException({ code: 'DATABASE_BARRIER_ADMIT_E018', message: 'The database is under maintenance or recovery is required.' });
    }
    return async () => {
      if (released) return;
      released = true;
      try {
        const unlocked = await client.query<{ ok: boolean }>(
          'SELECT pg_advisory_unlock_shared($1) AS ok', [BUSINESS_BARRIER_KEY],
        );
        if (unlocked.rows[0]?.ok !== true) throw new Error('unlock failed');
        client.removeListener('error', onError);
        this.leases.delete(destroy);
        if (!destroyed) client.release();
        this.leaseGone();
      } catch {
        destroy();
      }
    };
  }
}
