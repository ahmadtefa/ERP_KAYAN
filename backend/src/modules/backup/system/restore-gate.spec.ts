import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MaintenanceService } from '../../../common/maintenance/maintenance';
import { forgetPgTools } from './pg-support';
import * as pgSupport from './pg-support';
import { RestoreGateService } from './restore-gate.service';
import { RestoreJournalStore } from './restore-journal';

/// The gate is the last thing between a person and a restore that could lose
/// every company. Its job is to say "no" for a named reason whenever a
/// safeguard is missing, and to say "no" the moment an administrator turns it
/// off. These tests pin the refusals that do not need a database.
///
/// Everything here is arranged so the answer is the same on a developer
/// machine with no PostgreSQL installed and on a CI runner that has one: the
/// tools are replaced by scripts that report an ancient version, which the gate
/// must refuse whatever the real machine looks like.

describe('restore gate', () => {
  let dir: string;
  let journal: RestoreJournalStore;
  let maintenance: MaintenanceService;
  const originalEnv = { ...process.env };

  /// A pair of tools that exist but are far too old. The gate asks the tools
  /// their version, so a machine without PostgreSQL can still be made to look
  /// like a machine with a 9.6 client.
  const plantOldTools = async (): Promise<void> => {
    const bin = join(dir, 'bin');
    await mkdir(bin, { recursive: true });
    for (const name of ['pg_dump', 'pg_restore']) {
      const path = join(bin, name);
      await writeFile(
        path,
        `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${name} (PostgreSQL) 9.6.24"; exit 0; fi\nexit 1\n`,
      );
      await chmod(path, 0o755);
    }
    process.env.KAYAN_PG_DUMP = join(bin, 'pg_dump');
    process.env.KAYAN_PG_RESTORE = join(bin, 'pg_restore');
    // The tool lookup is cached for the life of the process; a test that
    // changed the tools would otherwise read the previous test's answer.
    forgetPgTools();
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kayan-gate-'));
    process.env.KAYAN_BACKUP_DIR = dir;
    process.env.KAYAN_UPLOAD_DIR = join(dir, 'uploads');
    delete process.env.KAYAN_FULL_RESTORE_ENABLED;
    await plantOldTools();
    journal = new RestoreJournalStore(dir);
    maintenance = new MaintenanceService();
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    forgetPgTools();
    await rm(dir, { recursive: true, force: true });
  });

  it('reports the actual scratch actor and the required action when blocked', async () => {
    const probe = jest.spyOn(pgSupport, 'mayCreateDatabase');
    try {
      probe.mockResolvedValueOnce({ allowed: true, path: 'restore-admin', reason: null });
      const gate = new RestoreGateService(maintenance, journal);
      let check = (await gate.probe(true)).checks.find(c => c.name === 'scratch-database');
      expect(check?.detail).toMatch(/path: restore-admin/);
      probe.mockResolvedValueOnce({ allowed: false, path: null, reason: 'configure dedicated restore-admin with CREATEDB' });
      check = (await gate.probe(true)).checks.find(c => c.name === 'scratch-database');
      expect(check?.ok).toBe(false);
      expect(check?.detail).toMatch(/configure dedicated restore-admin with CREATEDB/);
    } finally {
      probe.mockRestore();
    }
  });

  it('refuses a tool set older than the server', async () => {
    const gate = new RestoreGateService(maintenance, journal);
    const report = await gate.probe(true);
    expect(report.fullRestoreSupported).toBe(false);
    expect(report.state).toBe('blocked');
    const version = report.checks.find((check) => check.name === 'tool-version');
    expect(version?.ok).toBe(false);
    expect(report.reasons.join(' ')).toMatch(/older|unknown|tools/);
  });

  it('blocks the gate if the restore journal is corrupt', async () => {
    await writeFile(join(dir, 'restore-journal.json'), '{broken');
    const report = await new RestoreGateService(maintenance, journal).probe(true);
    expect(report.fullRestoreSupported).toBe(false);
    expect(report.checks.find((check) => check.name === 'no-interrupted-restore'))
      .toMatchObject({ ok: false, detail: expect.stringMatching(/cannot be read/i) });
  });

  it('refuses while a restore is running', async () => {
    maintenance.begin('restoring');
    const gate = new RestoreGateService(maintenance, journal);
    const report = await gate.probe(true);
    expect(report.fullRestoreSupported).toBe(false);
    expect(report.reasons.join(' ')).toMatch(/already running|maintenance/);
    const running = report.checks.find((check) => check.name === 'no-restore-running');
    expect(running?.ok).toBe(false);
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

    // The switch cannot force a machine that fails its checks to pass them:
    // these tools are too old, so the answer is still no.
    process.env.KAYAN_FULL_RESTORE_ENABLED = '1';
    const stillBlocked = await gate.probe(true);
    expect(stillBlocked.fullRestoreSupported).toBe(false);
    expect(stillBlocked.state).toBe('blocked');
  });

  it('names the refusal in the exception a caller sees', async () => {
    // The switch is the one refusal that reads the same on every machine, so
    // the exception can be pinned here without depending on what is installed.
    process.env.KAYAN_FULL_RESTORE_ENABLED = 'off';
    const gate = new RestoreGateService(maintenance, journal);
    await expect(gate.assertAllowed()).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'FULL_RESTORE_UNAVAILABLE',
        detail: expect.stringContaining('KAYAN_FULL_RESTORE_ENABLED'),
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
    expect(report.fullRestoreSupported).toBe(false);
  });
});
