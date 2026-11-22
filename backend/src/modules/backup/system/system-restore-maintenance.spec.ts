import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { MaintenanceService } from '../../../common/maintenance/maintenance';
import { SystemRestoreService } from './system-restore.service';
import type { RestoreJournal } from './restore-journal';

describe('complete restore recovery maintenance', () => {
  function setup(journal: Partial<RestoreJournal> | null) {
    const maintenance = new MaintenanceService();
    const journals = { read: jest.fn().mockResolvedValue(journal), clear: jest.fn() };
    const service = new SystemRestoreService(
      {} as never, {} as never, maintenance, {} as never, {} as never, journals as never,
    );
    const internals = service as unknown as {
      running: boolean;
      holdAdvisoryLock: () => Promise<null>;
    };
    jest.spyOn(internals, 'holdAdvisoryLock').mockResolvedValue(null);
    return { service, maintenance, journals, internals };
  }

  it('does not clear a journal owned by a restore in another process', async () => {
    const { service, journals, internals } = setup({ id: 'active', phase: 'started' });
    jest.mocked(internals.holdAdvisoryLock).mockRejectedValueOnce(new ConflictException());
    await service.onModuleInit();
    expect(journals.clear).not.toHaveBeenCalled();
  });

  it('rechecks an abandoned journal under the lock before clearing it', async () => {
    const { service, journals } = setup({ id: 'abandoned', phase: 'started' });
    journals.read.mockResolvedValueOnce({ id: 'abandoned', phase: 'started' })
      .mockResolvedValueOnce({ id: 'abandoned', phase: 'db-replacing', safetyBackup: 'safety.kayanbackup' });
    await service.onModuleInit();
    expect(journals.clear).not.toHaveBeenCalled();
    expect((await service.status()).maintenance).toBe(true);
  });

  it('holds maintenance at startup if the journal cannot be verified', async () => {
    const { service, maintenance, journals } = setup(null);
    journals.read.mockRejectedValue(new Error('damaged'));
    await service.onModuleInit();
    expect(maintenance.isActive).toBe(true);
    expect(journals.clear).not.toHaveBeenCalled();
    await expect(service.status()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('keeps maintenance active if journal deletion fails before reopening', async () => {
    const { service, maintenance, journals } = setup(null);
    maintenance.begin('restoring');
    journals.clear.mockRejectedValueOnce(new Error('storage error'));
    const internal = service as unknown as { clearJournalBeforeReopening(): Promise<void> };
    await expect(internal.clearJournalBeforeReopening()).rejects.toThrow('storage error');
    expect(maintenance.isActive).toBe(true);
  });

  it('does not end an unrelated maintenance operation when there is no journal', async () => {
    const { service, maintenance } = setup(null);
    maintenance.begin('another operation');
    expect((await service.resumeRecovery('user')).recovered).toBe(false);
    expect(maintenance.isActive).toBe(true);
  });

  it('does not clear a destructive journal with no safety backup', async () => {
    const { service, maintenance, journals } = setup({ phase: 'db-replacing', safetyBackup: null });
    maintenance.begin('interrupted');
    await expect(service.resumeRecovery('user')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(journals.clear).not.toHaveBeenCalled();
    expect(maintenance.isActive).toBe(true);
  });

  it('refuses recovery while a restore is running', async () => {
    const { service, internals, journals } = setup(null);
    internals.running = true;
    await expect(service.resumeRecovery('user')).rejects.toBeInstanceOf(ConflictException);
    expect(journals.read).not.toHaveBeenCalled();
  });
});
