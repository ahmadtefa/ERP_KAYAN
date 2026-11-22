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
