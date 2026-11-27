import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Client } from 'pg';
import { withPgClient } from './pg-support';
import type { RestoreJournal } from './restore-journal';

// Excluded from archives and never replaced with public. A dead restore owner
// must not reopen an API configured with a different backup directory.
export const RESTORE_CONTROL_SCHEMA = 'kayan_restore_control';

export async function isRestorePending(client: Client): Promise<boolean> {
  const relation = await client.query<{ present: boolean }>(
    "SELECT to_regclass('kayan_restore_control.state') IS NOT NULL AS present",
  );
  if (!relation.rows[0]?.present) return false;
  const state = await client.query<{ active: boolean }>('SELECT active FROM kayan_restore_control.state WHERE id = 1');
  return state.rows[0]?.active === true;
}

@Injectable()
export class PersistentRestoreState {
  async start(journal: RestoreJournal): Promise<void> {
    await withPgClient({}, async (client) => {
      await client.query('CREATE SCHEMA IF NOT EXISTS kayan_restore_control');
      await client.query(`CREATE TABLE IF NOT EXISTS kayan_restore_control.state (
        id integer PRIMARY KEY CHECK (id = 1), active boolean NOT NULL,
        operation_id text NOT NULL, safety_backup text, updated_at timestamptz NOT NULL DEFAULT now()
      )`);
      const result = await client.query(`INSERT INTO kayan_restore_control.state
        (id, active, operation_id, safety_backup) VALUES (1, true, $1, $2)
        ON CONFLICT (id) DO UPDATE SET active = true, operation_id = EXCLUDED.operation_id,
          safety_backup = EXCLUDED.safety_backup, updated_at = now()
        WHERE NOT kayan_restore_control.state.active OR kayan_restore_control.state.operation_id = $1
        RETURNING id`, [journal.id, journal.safetyBackup]);
      if (result.rowCount !== 1) throw new ServiceUnavailableException({ code: 'RESTORE_STATE_START_E097', message: 'A different restore requires recovery.' });
    });
  }

  async finish(operationId: string): Promise<void> {
    await withPgClient({}, async (client) => {
      if (!await isRestorePending(client)) return;
      const result = await client.query(`UPDATE kayan_restore_control.state SET active = false, updated_at = now()
        WHERE id = 1 AND operation_id = $1 RETURNING id`, [operationId]);
      if (result.rowCount !== 1) throw new ServiceUnavailableException({ code: 'RESTORE_STATE_FINISH_E098', message: 'The persistent restore owner does not match.' });
    });
  }
}
