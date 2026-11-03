import { ServiceUnavailableException } from '@nestjs/common';
import * as childProcess from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MaintenanceService } from '../../common/maintenance/maintenance';
import { FullBackupService } from './full-backup.service';

jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), execFile: jest.fn() }));

describe('full restore failure safety', () => {
  let dir: string;
  let maintenance: MaintenanceService;
  let service: FullBackupService;
  let internals: { [key: string]: jest.Mock };
  let licensing: { reconcile: jest.Mock };
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const uploaded = { buffer: Buffer.from('PGDMP synthetic archive'), originalName: 'test.dump' };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kayan-restore-test-'));
    maintenance = new MaintenanceService();
    licensing = { reconcile: jest.fn().mockResolvedValue(undefined) };
    service = new FullBackupService(
      {} as ConstructorParameters<typeof FullBackupService>[0],
      { record: jest.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof FullBackupService>[1],
      maintenance,
      licensing as unknown as ConstructorParameters<typeof FullBackupService>[3],
    );
    internals = service as unknown as { [key: string]: jest.Mock };
    jest.spyOn(internals, 'requireTools').mockReturnValue({ pgDump: 'fake-dump', pgRestore: 'fake-restore' });
    jest.spyOn(internals, 'ensureBackupDir').mockResolvedValue(dir);
    jest.spyOn(internals, 'verifyUploaded').mockResolvedValue(1);
    jest.spyOn(internals, 'execSql').mockResolvedValue(undefined);
    jest.spyOn(internals, 'cleanDatabaseSchema').mockResolvedValue(undefined);
    jest.spyOn(internals, 'createSafety').mockResolvedValue({ name: 'kayan-safety-test.dump' });
    jest.spyOn(internals, 'postRestoreCheck').mockResolvedValue({ ok: true, detail: '' });
    jest.spyOn(internals, 'reconcileRestoredCompanies').mockResolvedValue({ companies: 0 });
    jest.spyOn(internals, 'connectionArgs').mockReturnValue(['--dbname=fixture']);
    jest.spyOn(internals, 'requireDatabase').mockReturnValue('fixture');
    process.env.DATABASE_URL = 'postgresql://fixture@localhost/fixture';
    jest.mocked(childProcess.execFile).mockImplementation(((_, __, ___, callback) => {
      (callback as (e: Error | null, stdout: string, stderr: string) => void)(null, '', '');
      return {} as childProcess.ChildProcess;
    }) as typeof childProcess.execFile);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.mocked(childProcess.execFile).mockReset();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not touch the primary when the scratch database cannot be created', async () => {
    internals.execSql.mockRejectedValueOnce(new Error('create denied'));
    await expect(service.restore({ confirm: true, uploaded }, 'u')).rejects.toThrow(/rehearsal/);
    expect(internals.createSafety).not.toHaveBeenCalled();
    expect(internals.cleanDatabaseSchema).not.toHaveBeenCalled();
    expect(maintenance.isActive).toBe(false);
  });

  it('rejects an inherited libpq host override before creating or changing databases', async () => {
    const previous = process.env.PGHOSTADDR;
    process.env.PGHOSTADDR = '127.0.0.2';
    try {
      await expect(service.restore({ confirm: true, uploaded }, 'u')).rejects.toThrow(/connection settings/);
      expect(internals.execSql).not.toHaveBeenCalled();
      expect(internals.cleanDatabaseSchema).not.toHaveBeenCalled();
      expect(maintenance.isActive).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.PGHOSTADDR;
      else process.env.PGHOSTADDR = previous;
    }
  });

  it('releases maintenance if the safety backup fails before the primary is touched', async () => {
    internals.createSafety.mockRejectedValue(new Error('synthetic failure'));
    await expect(service.restore({ confirm: true, uploaded }, 'u')).rejects.toThrow('synthetic failure');
    expect(internals.cleanDatabaseSchema).not.toHaveBeenCalled();
    expect(maintenance.isActive).toBe(false);
  });

  it('holds maintenance and reports failure when restoration and recovery both fail', async () => {
    jest.mocked(childProcess.execFile).mockImplementation(((_, args, ___, callback) => {
      const scratch = (args as string[]).some((arg) => arg.startsWith('--dbname=kayan_restore_check_'));
      (callback as (e: Error | null, stdout: string, stderr: string) => void)(scratch ? null : new Error('failed'), '', 'synthetic failure');
      return {} as childProcess.ChildProcess;
    }) as typeof childProcess.execFile);
    await expect(service.restore({ confirm: true, uploaded }, 'u')).rejects.toThrow(/both failed/i);
    expect(maintenance.isActive).toBe(true);
    expect(maintenance.status.detail).toMatch(/automatic recovery/);
  });

  it('releases maintenance after verified safety recovery, but reports original failure', async () => {
    let calls = 0;
    jest.mocked(childProcess.execFile).mockImplementation(((_, __, ___, callback) => {
      calls++;
      (callback as (e: Error | null, stdout: string, stderr: string) => void)(calls === 2 ? new Error('failed') : null, '', 'synthetic failure');
      return {} as childProcess.ChildProcess;
    }) as typeof childProcess.execFile);
    await expect(service.restore({ confirm: true, uploaded }, 'u')).rejects.toThrow(/safety backup.*restored/i);
    expect(maintenance.isActive).toBe(false);
    expect(internals.postRestoreCheck).toHaveBeenCalledTimes(1);
  });

  it('holds maintenance when licence reconciliation after safety recovery fails', async () => {
    let calls = 0;
    jest.mocked(childProcess.execFile).mockImplementation(((_, __, ___, callback) => {
      calls++;
      (callback as (e: Error | null, stdout: string, stderr: string) => void)(calls === 2 ? new Error('failed') : null, '', 'synthetic failure');
      return {} as childProcess.ChildProcess;
    }) as typeof childProcess.execFile);
    licensing.reconcile.mockRejectedValue(new Error('synthetic failure'));
    await expect(service.restore({ confirm: true, uploaded }, 'u')).rejects.toThrow(/both failed/i);
    expect(maintenance.isActive).toBe(true);
  });

  it('holds maintenance when licence reconciliation fails after restore', async () => {
    licensing.reconcile.mockRejectedValue(new Error('synthetic failure'));
    await expect(service.restore({ confirm: true, uploaded }, 'u')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(maintenance.isActive).toBe(true);
  });

  it('rejects another request even before the first reaches maintenance', async () => {
    let release!: () => void;
    internals.verifyUploaded.mockImplementationOnce(() => new Promise<number>((resolve) => { release = () => resolve(1); }));
    const first = service.restore({ confirm: true, uploaded }, 'u');
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    await expect(service.restore({ confirm: true, uploaded }, 'u')).rejects.toThrow(/already running/);
    release();
    await expect(first).resolves.toMatchObject({ restored: true });
    expect(maintenance.isActive).toBe(false);
  });
});
