/**
 * Local REAL PostgreSQL server for integration/concurrency tests.
 *
 * Uses embedded-postgres (native PostgreSQL 18 binaries shipped through npm,
 * NOT PGlite/WASM and NOT SQLite): a genuine `postgres` process with the
 * server lock manager, MVCC and multiple independent TCP connections, so
 * SELECT ... FOR UPDATE contention can be exercised truthfully.
 *
 * The cluster data directory lives OUTSIDE the repository and contains only
 * throwaway test data — never production data. The script keeps the event
 * loop alive so the spawned postgres process stays up for the test scripts;
 * SIGTERM/SIGINT triggers a graceful stop.
 *
 * Usage: node scripts/pg-embedded-server.mjs
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import EmbeddedPostgres from 'embedded-postgres';

const PORT = Number(process.env.PG_EMBEDDED_PORT ?? 55432);
const DATA_DIR = process.env.PG_EMBEDDED_DIR ?? join(tmpdir(), 'erp-kayan-pg-cluster');
const TEST_DB = process.env.PG_EMBEDDED_DB ?? 'kayan_test';

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  port: PORT,
  user: 'kayan',
  password: 'kayan',
  authMethod: 'scram-sha-256',
  persistent: true,
  initdbFlags: ['--locale=C', '--encoding=UTF8'],
  onLog: (m) => console.log(`[pg] ${m}`),
  onError: (m) => console.error(`[pg-error]`, m),
});

async function main() {
  if (!existsSync(DATA_DIR)) {
    console.log(`[pg] initialising new cluster at ${DATA_DIR}`);
    await pg.initialise();
  }
  await pg.start();
  console.log(`[pg] server started on 127.0.0.1:${PORT}`);

  try {
    await pg.createDatabase(TEST_DB);
    console.log(`[pg] database ${TEST_DB} created`);
  } catch (e) {
    // 42P04 = duplicate_database: a re-used persistent cluster already has it.
    if (e?.code !== '42P04') throw e;
    console.log(`[pg] database ${TEST_DB} already exists`);
  }

  const shutdown = async (signal) => {
    console.log(`[pg] received ${signal}, stopping`);
    try {
      await pg.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Keep the manager process (and its child postgres) alive between test runs.
  setInterval(() => undefined, 1 << 30);
  console.log('[pg] ready');
}

main().catch((e) => {
  console.error('[pg] fatal', e);
  process.exit(1);
});
