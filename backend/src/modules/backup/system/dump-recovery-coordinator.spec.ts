import { ConflictException } from '@nestjs/common';
import { MaintenanceService } from '../../../common/maintenance/maintenance';
import { DumpRecoveryCoordinator } from './dump-recovery-coordinator';
import { acquireRestoreLock } from './restore-lock';

jest.mock('./restore-lock', () => ({ acquireRestoreLock: jest.fn() }));

describe('abandoned DUMP recovery coordination', () => {
  function setup(phase = 'db-replacing') {
    const journal = { id: 'operation', kind: 'dump', phase, safetyBackup: 'safety.dump' };
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
  it('keeps an unreadable journal closed for investigation', async () => {
    const { worker, journals, dumps, maintenance } = setup();
    journals.read.mockRejectedValueOnce(new Error('damaged'));
    await worker.check();
    expect(dumps.recoverDumpJournal).not.toHaveBeenCalled();
    expect(journals.clear).not.toHaveBeenCalled();
    expect(maintenance.isActive).toBe(true);
  });
});
