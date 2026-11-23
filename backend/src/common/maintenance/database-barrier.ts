import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Client } from 'pg';
import { backupDirectory, cleanDatabaseUrl } from '../../modules/backup/system/pg-support';
import { RestoreJournalStore } from '../../modules/backup/system/restore-journal';
import { API_APPLICATION_NAME } from './process-identity';

// Distinct from restore ownership: shared for the entire business handler,
// exclusive for the entire restore, including validation and recovery.
import { BUSINESS_BARRIER_KEY } from './lock-keys';
export { BUSINESS_BARRIER_KEY } from './lock-keys';

@Injectable()
export class DatabaseMaintenanceBarrier {
  async admit(): Promise<() => Promise<void>> {
    const raw = process.env.DATABASE_URL;
    if (!raw) throw new ServiceUnavailableException('Database maintenance coordination is unavailable.');
    const client = new Client({ connectionString: cleanDatabaseUrl(raw), connectionTimeoutMillis: 10_000,
      application_name: `${API_APPLICATION_NAME}-barrier` });
    let admitted = false;
    let released = false;
    client.on('error', () => {
      // A handler cannot safely keep running after losing its lease. Fail-stop
      // this API incarnation; the restore owner also drains tagged server
      // sessions before taking its snapshot. Never log connection secrets.
      if (admitted && !released) process.exit(1);
    });
    try {
      await client.connect();
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock_shared($1) AS locked', [BUSINESS_BARRIER_KEY],
      );
      if (!result.rows[0]?.locked) throw new Error('maintenance');
      // Read AFTER locking: a restore cannot begin between this check and the
      // handler. A dead owner releases PostgreSQL locks but not this journal.
      if (await new RestoreJournalStore(backupDirectory()).read()) throw new Error('recovery required');
      admitted = true;
      return async () => {
        if (released) return;
        released = true;
        await client.end();
      };
    } catch {
      await client.end().catch(() => {});
      throw new ServiceUnavailableException('The database is under maintenance or recovery is required.');
    }
  }
}
