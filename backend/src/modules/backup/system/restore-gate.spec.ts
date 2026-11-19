import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MaintenanceService } from '../../../common/maintenance/maintenance';
import { RestoreGateService } from './restore-gate.service';
import { RestoreJournalStore } from './restore-journal';

/// The gate is the last thing between a person and a restore that could lose
/// every company. Its job is to say "no" for a named reason whenever a
/// safeguard is missing, and to say "no" the moment an administrator turns it
/// off. These tests pin the refusals that do not need a database.

describe('restore gate', () => {
  let dir: string;
  let journal: RestoreJournalStore;
  let maintenance: MaintenanceService;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kayan-gate-'));
    process.env.KAYAN_BACKUP_DIR = dir;
    process.env.KAYAN_UPLOAD_DIR = join(dir, 'uploads');
    process.env.KAYAN_PG_DUMP = join(dir, 'no-such-pg_dump');
    process.env.KAYAN_PG_RESTORE = join(dir, 'no-such-pg_restore');
    delete process.env.KAYAN_FULL_RESTORE_ENABLED;
    journal = new RestoreJournalStore(dir);
    maintenance = new MaintenanceService();
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await rm(dir, { recursive: true, force: true });
  });

  it('refuses when the PostgreSQL tools are not on this machine', async () => {
    const gate = new RestoreGateService(maintenance, journal);
    const report = await gate.probe(true);
    expect(report.fullRestoreSupported).toBe(false);
    expect(report.state).toBe('blocked');
    expect(report.reasons.join(' ')).toMatch(/pg_dump|tools/);
    expect(report.checks.find((check) => check.name === 'postgresql-tools')?.ok).toBe(false);
  });

  it('refuses while a restore is running', async () => {
    maintenance.begin('restoring');
    const gate = new RestoreGateService(maintenance, journal);
    const report = await gate.probe(true);
    expect(report.fullRestoreSupported).toBe(false);
    expect(report.reasons.join(' ')).toMatch(/already running|maintenance/);
  });

  it('refuses when an interrupted restore is waiting to be resolved', async () => {
    await journal.write({
      id: 'crashed',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      phase: 'db-replacing',
      source: 'power cut',
      sourceManifest: { createdAt: null, appVersion: null, companies: null, files: null },
      safetyBackup: 'kayan-safety-1.kayanbackup',
      previousUploads: null,
      stagingDir: null,
      detail: null,
      checks: [],
    });
    const gate = new RestoreGateService(maintenance, journal);
    const report = await gate.probe(true);
    expect(report.fullRestoreSupported).toBe(false);
    expect(report.reasons.join(' ')).toMatch(/interrupted restore|must be resolved/);
  });

  it('lets an administrator switch destructive restores off, never on', async () => {
    process.env.KAYAN_FULL_RESTORE_ENABLED = '0';
    const gate = new RestoreGateService(maintenance, journal);
    const report = await gate.probe(true);
    expect(report.state).toBe('disabled');
    expect(report.fullRestoreSupported).toBe(false);

    // The switch cannot force a machine that fails its checks to pass them.
    process.env.KAYAN_FULL_RESTORE_ENABLED = '1';
    const stillBlocked = await gate.probe(true);
    expect(stillBlocked.fullRestoreSupported).toBe(false);
    expect(stillBlocked.state).toBe('blocked');
  });

  it('names the refusal in the exception a caller sees', async () => {
    const gate = new RestoreGateService(maintenance, journal);
    await expect(gate.assertAllowed()).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'FULL_RESTORE_UNAVAILABLE',
        detail: expect.stringContaining('pg_dump'),
      }),
    });
  });

  it('checks that the backup folder really accepts a file', async () => {
    // A file where the folder should be: ensureDirectory cannot make it, and
    // the gate must say so rather than assume the folder is fine.
    const blocked = join(dir, 'not-a-folder');
    await writeFile(blocked, 'x');
    process.env.KAYAN_BACKUP_DIR = blocked;
    const gate = new RestoreGateService(maintenance, new RestoreJournalStore(blocked));
    const report = await gate.probe(true);
    const folder = report.checks.find((check) => check.name === 'backup-folder');
    expect(folder?.ok).toBe(false);
  });
});
