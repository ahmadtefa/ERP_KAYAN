import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Client } from 'pg';
import { cleanDatabaseUrl } from './pg-support';

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
    return client;
  } catch (error) {
    await client.end().catch(() => {});
    if (error instanceof ConflictException) throw error;
    throw new ServiceUnavailableException('Cannot safely lock the database for restore or recovery. No data was changed.');
  }
}
