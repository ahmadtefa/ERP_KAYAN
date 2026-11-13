import { Logger, ServiceUnavailableException } from '@nestjs/common';
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
      { user: { count: jest.fn().mockResolvedValue(0) } } as unknown as ConstructorParameters<typeof FullBackupService>[0],
      { record: jest.fn().mockResolvedValue(undefined), recordRequired: jest.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof FullBackupService>[1],
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

  it('does not touch the primary when the scratch database cannot be removed', async () => {
    internals.execSql.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('scratch still in use'));
    await expect(service.restore({ confirm: true, uploaded }, 'u')).rejects.toThrow(/rehearsal database could not be removed/i);
    expect(internals.execSql).toHaveBeenCalledTimes(2);
    expect(internals.createSafety).not.toHaveBeenCalled();
    expect(internals.cleanDatabaseSchema).not.toHaveBeenCalled();
    expect(maintenance.isActive).toBe(false);
  });

  it('reports scratch cleanup failure without touching primary even when rehearsal also fails', async () => {
    internals.execSql.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('scratch still in use'));
    jest.mocked(childProcess.execFile).mockImplementation(((_, __, ___, callback) => {
      (callback as (e: Error | null, stdout: string, stderr: string) => void)(new Error('rehearsal failed'), '', 'rehearsal failed');
      return {} as childProcess.ChildProcess;
    }) as typeof childProcess.execFile);
    await expect(service.restore({ confirm: true, uploaded }, 'u')).rejects.toThrow(/rehearsal database could not be removed/i);
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

  it('requires audit after licence reconciliation and keeps maintenance if audit fails', async () => {
    const audit = (service as unknown as { audit: {recordRequired: jest.Mock} }).audit;
    const marker = 'synthetic-private-marker';
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    audit.recordRequired.mockRejectedValue(new Error(marker));
    const failure = await service.restore({confirm:true,uploaded},'u').catch((error) => error);
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect(failure.message).toMatch(/audit failed.*maintenance remains active/i);
    expect(failure.message).not.toContain(marker);
    expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
    expect(licensing.reconcile).toHaveBeenCalledTimes(1);
    expect(maintenance.isActive).toBe(true);
    expect(audit.recordRequired).toHaveBeenCalledWith(expect.objectContaining({
      action:'RESTORE_DATABASE_ARCHIVE',entity:'backup_database_archive',userId:null,
      after:expect.objectContaining({fullRestore:false,actorId:'u'}),
    }),expect.anything());
  });

  it('records no successful restore before licence reconciliation succeeds', async () => {
    const audit = (service as unknown as { audit: {recordRequired: jest.Mock} }).audit;
    licensing.reconcile.mockRejectedValue(new Error('synthetic failure'));
    await expect(service.restore({confirm:true,uploaded},'u')).rejects.toThrow(/maintenance remains active/i);
    expect(audit.recordRequired).not.toHaveBeenCalled();
    expect(maintenance.isActive).toBe(true);
  });

  it('does not retain database errors in scratch rehearsal status', async () => {
    const marker = 'synthetic-private-marker';
    internals.execSql.mockRejectedValueOnce(new Error(marker));
    await expect(service.restore({ confirm: true, uploaded }, 'u')).rejects.toThrow(/rehearsal/);
    const reason = (service as unknown as { lastCreateDatabaseFailure: string }).lastCreateDatabaseFailure;
    expect(reason).toBe('unclassified failure');
    expect(reason).not.toContain(marker);
    expect(internals.cleanDatabaseSchema).not.toHaveBeenCalled();
  });

  it('does not include raw database errors in post-restore validation', async () => {
    const marker = 'synthetic-private-marker';
    const instance = new FullBackupService(
      { $disconnect: jest.fn().mockRejectedValue(new Error(marker)) } as unknown as ConstructorParameters<typeof FullBackupService>[0],
      {} as ConstructorParameters<typeof FullBackupService>[1],
      maintenance,
      licensing as unknown as ConstructorParameters<typeof FullBackupService>[3],
    );
    const check = await (instance as unknown as { postRestoreCheck(): Promise<{ ok: boolean; detail: string }> }).postRestoreCheck();
    expect(check.ok).toBe(false);
    expect(check.detail).toContain('unclassified failure');
    expect(check.detail).not.toContain(marker);
  });

  it('does not expose tool stderr or exception text when rehearsal fails', async () => {
    const marker = 'synthetic-private-marker';
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.mocked(childProcess.execFile).mockImplementation(((_, __, ___, callback) => {
      const error = Object.assign(new Error(marker), { code: 7 });
      (callback as (e: Error | null, stdout: string, stderr: string) => void)(error, '', marker);
      return {} as childProcess.ChildProcess;
    }) as typeof childProcess.execFile);
    const failure = await service.restore({ confirm: true, uploaded }, 'u').catch((error) => error);
    expect(failure.message).toContain('tool exit 7');
    expect(failure.message).not.toContain(marker);
    expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
    expect(internals.cleanDatabaseSchema).not.toHaveBeenCalled();
    expect(maintenance.isActive).toBe(false);
  });

  it('hides primary restore error details after a successful recovery', async () => {
    const marker = 'synthetic-private-marker';
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    let calls = 0;
    jest.mocked(childProcess.execFile).mockImplementation(((_, __, ___, callback) => {
      calls++;
      const error = calls === 2 ? Object.assign(new Error(marker), { code: 4 }) : null;
      (callback as (e: Error | null, stdout: string, stderr: string) => void)(error, '', marker);
      return {} as childProcess.ChildProcess;
    }) as typeof childProcess.execFile);
    const failure = await service.restore({ confirm: true, uploaded }, 'u').catch((error) => error);
    expect(failure.message).toMatch(/safety backup.*restored/i);
    expect(failure.message).toContain('tool exit 4');
    expect(failure.message).not.toContain(marker);
    expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
    expect(maintenance.isActive).toBe(false);
  });

  it('holds maintenance and does not expose access-repair errors when repair fails', async () => {
    const marker = 'synthetic-private-marker';
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    internals.reconcileRestoredCompanies.mockRejectedValue(new Error(marker));
    const failure = await service.restore({ confirm: true, uploaded }, 'u').catch((error) => error);
    const audit = (service as unknown as { audit: { record: jest.Mock } }).audit;
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect(failure.message).toMatch(/maintenance remains active/i);
    expect(failure.message).not.toContain(marker);
    expect(maintenance.isActive).toBe(true);
    expect(maintenance.status.detail).toMatch(/access repair failed/i);
    expect(licensing.reconcile).not.toHaveBeenCalled();
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(marker);
    expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RESTORE_ACCESS_REPAIR_FAILED',
      after: { safetyBackup: 'kayan-safety-test.dump' },
    }));
    expect(audit.record).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'RESTORE' }));
  });

  it('holds maintenance when recording an access-repair failure also fails', async () => {
    internals.reconcileRestoredCompanies.mockRejectedValue(new Error('synthetic repair failure'));
    const audit = (service as unknown as { audit: { record: jest.Mock } }).audit;
    audit.record.mockRejectedValue(new Error('synthetic audit failure'));
    await expect(service.restore({ confirm: true, uploaded }, 'u')).rejects.toThrow(/maintenance remains active/i);
    expect(maintenance.isActive).toBe(true);
    expect(licensing.reconcile).not.toHaveBeenCalled();
  });

  it('does not start restore while a backup is in progress in this service instance', async () => {
    let release!: () => void;
    internals.dump = jest.fn().mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ file: { name: 'fixture.dump' }, durationMs: 1 });
    }));
    const backup = service.createFull('u');
    await expect(service.restore({ confirm: true, uploaded }, 'u')).rejects.toThrow(/backup is running/i);
    expect(internals.execSql).not.toHaveBeenCalled();
    release();
    await backup;
    await expect(service.restore({ confirm: true, uploaded }, 'u')).resolves.toMatchObject({ restored: true });
  });

  it('does not start backup while a restore is in progress in this service instance', async () => {
    let release!: () => void;
    internals.verifyUploaded.mockImplementationOnce(() => new Promise<number>((resolve) => { release = () => resolve(1); }));
    const restore = service.restore({ confirm: true, uploaded }, 'u');
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    await expect(service.createFull('u')).rejects.toThrow(/restore is running/i);
    release();
    await expect(restore).resolves.toMatchObject({ restored: true });
  });

  it('releases the local backup claim after a dump failure', async () => {
    internals.dump = jest.fn().mockRejectedValue(new Error('synthetic dump failure'));
    await expect(service.createFull('u')).rejects.toThrow('synthetic dump failure');
    await expect(service.restore({ confirm: true, uploaded }, 'u')).resolves.toMatchObject({ restored: true });
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
