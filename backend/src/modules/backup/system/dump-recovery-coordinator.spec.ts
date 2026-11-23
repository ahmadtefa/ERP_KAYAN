import { ConflictException } from '@nestjs/common';
import { MaintenanceService } from '../../../common/maintenance/maintenance';
import { DumpRecoveryCoordinator } from './dump-recovery-coordinator';
import { acquireRestoreLock } from './restore-lock';

jest.mock('./restore-lock', () => ({ acquireRestoreLock: jest.fn() }));
jest.mock('./database-identity', () => ({ databaseFingerprint: () => 'fixture-database' }));

describe('abandoned DUMP recovery coordination', () => {
  function setup(phase = 'db-replacing') {
    const journal = { id: 'operation', kind: 'dump', phase, safetyBackup: 'safety.dump', databaseFingerprint: 'fixture-database' };
    const journals = { read: jest.fn().mockResolvedValue(journal), clear: jest.fn().mockResolvedValue(undefined) };
    const dumps = { recoverDumpJournal: jest.fn().mockResolvedValue(undefined) };
    const lock = { end: jest.fn().mockResolvedValue(undefined) };
    jest.mocked(acquireRestoreLock).mockResolvedValue(lock as never);
    const maintenance = new MaintenanceService();
    maintenance.begin('recovery pending');
    const worker = new DumpRecoveryCoordinator(dumps as never, journals as never, maintenance);
    return { worker, journals, dumps, lock, maintenance };
  }
  afterEach(() => jest.resetAllMocks());

  it('leaves a live owner alone and recovers only after ownership is available', async () => {
    const { worker, dumps, journals, lock } = setup();
    jest.mocked(acquireRestoreLock).mockRejectedValueOnce(new ConflictException());
    await worker.check();
    expect(dumps.recoverDumpJournal).not.toHaveBeenCalled();
    expect(journals.clear).not.toHaveBeenCalled();
    await worker.check();
    expect(dumps.recoverDumpJournal).toHaveBeenCalledTimes(1);
    expect(lock.end).toHaveBeenCalledTimes(1);
  });
  it('does not repeatedly replay a failed safety restore', async () => {
    const { worker, dumps, journals, maintenance, lock } = setup();
    dumps.recoverDumpJournal.mockRejectedValueOnce(new Error('recovery failed'));
    await worker.check(); await worker.check();
    expect(dumps.recoverDumpJournal).toHaveBeenCalledTimes(1);
    expect(journals.clear).not.toHaveBeenCalled();
    expect(maintenance.isActive).toBe(true);
    expect(lock.end).toHaveBeenCalledTimes(1);
  });
  it('clears a completed rollback without replaying it over newer work', async () => {
    const { worker, dumps, journals, maintenance } = setup('rolled-back');
    await worker.check();
    expect(dumps.recoverDumpJournal).not.toHaveBeenCalled();
    expect(journals.clear).toHaveBeenCalledTimes(1);
    expect(maintenance.isActive).toBe(false);
  });
  it('never replays a durably committed restore over later work', async () => {
    const { worker, dumps, journals, maintenance } = setup('committed');
    await worker.check();
    expect(dumps.recoverDumpJournal).not.toHaveBeenCalled();
    expect(journals.clear).toHaveBeenCalledTimes(1);
    expect(maintenance.isActive).toBe(false);
  });

  it('keeps an unreadable journal closed for investigation', async () => {
    const { worker, journals, dumps, maintenance } = setup();
    journals.read.mockRejectedValueOnce(new Error('damaged'));
    await worker.check();
    expect(dumps.recoverDumpJournal).not.toHaveBeenCalled();
    expect(journals.clear).not.toHaveBeenCalled();
    expect(maintenance.isActive).toBe(true);
  });
  it('does not automatically apply a journal from another database', async () => {
    const { worker, journals, dumps } = setup();
    journals.read.mockResolvedValue({ id: 'foreign', kind: 'dump', phase: 'failed', safetyBackup: 'foreign.dump', databaseFingerprint: 'another-database' });
    await worker.check();
    expect(acquireRestoreLock).not.toHaveBeenCalled();
    expect(dumps.recoverDumpJournal).not.toHaveBeenCalled();
    expect(journals.clear).not.toHaveBeenCalled();
  });
  it('delegates complete-system recovery after releasing its probe lock', async () => {
    const { journals, dumps, lock, maintenance } = setup();
    journals.read.mockResolvedValue({ id: 'complete', kind: 'complete', phase: 'failed', safetyBackup: 'safety.kayanbackup', databaseFingerprint: 'fixture-database' });
    const complete = { resumeRecovery: jest.fn(async (actor: null) => {
      expect(actor).toBeNull();
      expect(lock.end).toHaveBeenCalledTimes(1);
      return { recovered: true };
    }) };
    const worker = new DumpRecoveryCoordinator(dumps as never, journals as never, maintenance, complete as never);
    await worker.check();
    expect(complete.resumeRecovery).toHaveBeenCalledTimes(1);
    expect(dumps.recoverDumpJournal).not.toHaveBeenCalled();
  });
});
