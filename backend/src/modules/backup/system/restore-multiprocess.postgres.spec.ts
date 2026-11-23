import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { MaintenanceService } from '../../../common/maintenance/maintenance';
import { cleanDatabaseUrl } from './pg-support';
import { RestoreJournalStore } from './restore-journal';
import { RESTORE_LOCK_KEY } from './restore-lock';
import { SystemRestoreService } from './system-restore.service';

const run = process.env.KAYAN_COMPANY_BACKUP_PG === '1';
(run ? describe : describe.skip)('restore journal across PostgreSQL processes', () => {
  jest.setTimeout(60_000);

  it('does not replay an already completed rollback over newer PostgreSQL data', async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (new URL(url).pathname !== '/erp_kayan_acceptance' || process.env.NODE_ENV !== 'test') {
      throw new Error('This test requires the isolated CI acceptance database.');
    }
    const dir = await mkdtemp(join(tmpdir(), 'kayan-finished-recovery-'));
    const journals = new RestoreJournalStore(dir);
    const database = new Client({ connectionString: cleanDatabaseUrl(url) });
    // A unique test-only table in the disposable CI database models work
    // accepted after rollback. Unlike a TEMP table it would be lost by the
    // public-schema replacement performed by an erroneous second rollback.
    const table = `recovery_fixture_${randomUUID().replace(/-/g, '')}`;
    try {
      await database.connect();
      await database.query(`CREATE TABLE "${table}" (value text NOT NULL)`);
      await database.query(`INSERT INTO "${table}" VALUES ($1)`, ['after-rollback']);
      await journals.write({
        id: 'completed-fixture', phase: 'rolled-back', source: 'synthetic.kayanbackup',
        startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        sourceManifest: { createdAt: null, appVersion: null, companies: null, files: null },
        safetyBackup: 'old-safety.kayanbackup', previousUploads: null, stagingDir: null,
        detail: 'verified rollback completed', checks: [],
      });
      const maintenance = new MaintenanceService();
      const service = new SystemRestoreService({} as never, {} as never, maintenance, {} as never, {} as never, journals);
      await service.onModuleInit();
      const result = await service.resumeRecovery('synthetic-user');
      expect(result).toMatchObject({ recovered: false, phase: 'rolled-back' });
      expect((await database.query(`SELECT value FROM "${table}"`)).rows).toEqual([{ value: 'after-rollback' }]);
      expect(await journals.read()).toBeNull();
    } finally {
      await database.query(`DROP TABLE IF EXISTS "${table}"`).catch(() => {});
      await database.end().catch(() => {});
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('preserves another process journal, and clears an abandoned pre-destructive journal after its owner dies', async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (new URL(url).pathname !== '/erp_kayan_acceptance' || process.env.NODE_ENV !== 'test') {
      throw new Error('This test requires the isolated CI acceptance database.');
    }
    const dir = await mkdtemp(join(tmpdir(), 'kayan-journal-process-'));
    const journals = new RestoreJournalStore(dir);
    await journals.write({
      id: 'active-process-fixture', phase: 'started', source: 'synthetic.kayanbackup',
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      sourceManifest: { createdAt: null, appVersion: null, companies: null, files: null },
      safetyBackup: null, previousUploads: null, stagingDir: null, detail: null, checks: [],
    });
    const child = spawn(process.execPath, ['-e', `
      const {Client} = require('pg');
      (async () => {
        const client = new Client({connectionString: process.env.TEST_DATABASE_URL});
        await client.connect();
        await client.query('SELECT pg_advisory_lock($1)', [Number(process.env.TEST_RESTORE_LOCK)]);
        process.stdout.write('locked\\n');
      })().catch(() => process.exit(2));
    `], {
      env: { ...process.env, TEST_DATABASE_URL: cleanDatabaseUrl(url), TEST_RESTORE_LOCK: String(RESTORE_LOCK_KEY) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Lock holder did not start')), 15_000);
        child.stdout.on('data', (data: Buffer) => {
          if (data.toString().includes('locked')) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.once('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`Lock holder exited before readiness: ${code}`));
        });
      });
      const maintenance = new MaintenanceService();
      const service = new SystemRestoreService({} as never, {} as never, maintenance, {} as never, {} as never, journals);
      await service.onModuleInit();
      expect((await journals.read())?.id).toBe('active-process-fixture');
      child.kill('SIGKILL');
      await ended;
      // Wait until PostgreSQL, not merely the OS, observes the lost session.
      const observer = new Client({ connectionString: cleanDatabaseUrl(url), connectionTimeoutMillis: 10_000 });
      await observer.connect();
      try {
        await observer.query("SET lock_timeout = '10s'");
        await observer.query('SELECT pg_advisory_lock($1)', [RESTORE_LOCK_KEY]);
      } finally {
        await observer.end();
      }
      await service.onModuleInit();
      expect(await journals.read()).toBeNull();
      expect(maintenance.isActive).toBe(false);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await ended;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
