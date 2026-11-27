import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Client } from 'pg';
import { cleanDatabaseUrl } from './pg-support';
import { isRestorePending } from './restore-state';
import { BUSINESS_BARRIER_KEY, RESTORE_TOOL_LOCK_KEY } from '../../../common/maintenance/lock-keys';

// Shared by JSON, DUMP and complete-system restores on this database. This
// serializes cooperating restores across processes and takes the exclusive
// side of the shared business barrier. Arbitrary SQL clients and older APIs
// that do not acquire the shared business lease are outside this contract.
export const RESTORE_LOCK_KEY = 918_273_645;

export async function acquireRestoreLock(options: { recovery?: boolean } = {}): Promise<Client> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new ServiceUnavailableException({ code: 'RESTORE_LOCK_X_E094', message: 'Cannot lock the restore: DATABASE_URL is not configured.' });
  const client = new Client({ connectionString: cleanDatabaseUrl(url), connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    const result = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked', [RESTORE_LOCK_KEY],
    );
    if (!result.rows[0]?.locked) {
      throw new ConflictException({ code: 'SYSTEM_RESTORE_RUNNING', message: 'Another process is already restoring this database.' });
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
        `SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()
         AND (application_name LIKE 'kayan-restore-%'
           OR (application_name LIKE 'kayan-api-%' AND state <> 'idle'))`,
      );
      if (!active.rowCount) break;
      for (const row of active.rows) await client.query('SELECT pg_terminate_backend($1)', [row.pid]);
      if (Date.now() > deadline) throw new Error('Restore tool sessions did not stop');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await client.query('SELECT pg_advisory_unlock($1)', [RESTORE_TOOL_LOCK_KEY]);
    if (!options.recovery && await isRestorePending(client)) {
      throw new ServiceUnavailableException({ code: 'RESTORE_LOCK_X_E095', message: 'An interrupted restore requires recovery before another restore can begin.' });
    }
    return client;
  } catch (error) {
    await client.end().catch(() => {});
    if (error instanceof ConflictException) throw error;
    throw new ServiceUnavailableException({ code: 'RESTORE_LOCK_X_E096', message: 'Cannot safely lock the database for restore or recovery. No data was changed.' });
  }
}
