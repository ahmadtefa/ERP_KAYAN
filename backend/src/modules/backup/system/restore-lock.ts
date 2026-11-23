import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Client } from 'pg';
import { cleanDatabaseUrl } from './pg-support';
import { BUSINESS_BARRIER_KEY, RESTORE_TOOL_LOCK_KEY } from '../../../common/maintenance/lock-keys';

// Shared by JSON, DUMP and complete-system restores on this database. This
// serializes cooperating restores across processes; it is NOT a business-write
// barrier, so callers still need maintenance/draining and must not advertise
// it as protection from other API processes or arbitrary SQL writers.
export const RESTORE_LOCK_KEY = 918_273_645;

export async function acquireRestoreLock(): Promise<Client> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new ServiceUnavailableException('Cannot lock the restore: DATABASE_URL is not configured.');
  const client = new Client({ connectionString: cleanDatabaseUrl(url), connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    const result = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked', [RESTORE_LOCK_KEY],
    );
    if (!result.rows[0]?.locked) {
      throw new ConflictException('Another process is already restoring this database.');
    }
    // PostgreSQL queues this exclusive lock behind business requests admitted
    // by every API process. Never take a safety snapshot until they finish.
    await client.query("SET lock_timeout = '30s'");
    await client.query('SELECT pg_advisory_lock($1)', [BUSINESS_BARRIER_KEY]);
    // An orphan supervisor keeps this locked until both the tool and its
    // PostgreSQL sessions are gone. Releasing the API lock alone is not proof.
    await client.query('SELECT pg_advisory_lock($1)', [RESTORE_TOOL_LOCK_KEY]);
    // A supervisor itself may have crashed. Its tool sessions are tagged;
    // terminate them before recovery can replace the schema again.
    const deadline = Date.now() + 30_000;
    while (true) {
      const active = await client.query<{ pid: number }>(
        "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND application_name LIKE 'kayan-restore-%'",
      );
      if (!active.rowCount) break;
      for (const row of active.rows) await client.query('SELECT pg_terminate_backend($1)', [row.pid]);
      if (Date.now() > deadline) throw new Error('Restore tool sessions did not stop');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await client.query('SELECT pg_advisory_unlock($1)', [RESTORE_TOOL_LOCK_KEY]);
    return client;
  } catch (error) {
    await client.end().catch(() => {});
    if (error instanceof ConflictException) throw error;
    throw new ServiceUnavailableException('Cannot safely lock the database for restore or recovery. No data was changed.');
  }
}
