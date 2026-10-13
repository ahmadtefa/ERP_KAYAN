import { BadRequestException } from '@nestjs/common';
import { BackupService, BACKUP_FORMAT, BACKUP_VERSION, BackupFile } from './backup.service';

describe('BackupService restore reference validation', () => {
  const companyId = 'company-1';

  function makeService() {
    const prisma = {
      company: { findUnique: jest.fn().mockResolvedValue({ id: companyId }) },
      role: { findMany: jest.fn().mockResolvedValue([]) },
      permission: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    };
    return {
      service: new BackupService(prisma as any, { record: jest.fn() } as any),
      prisma,
    };
  }

  function backup(tables: Record<string, unknown[]>): BackupFile {
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      companyId,
      companyCode: 'TEST',
      companyName: 'Test Company',
      counts: {},
      tables: tables as BackupFile['tables'],
    };
  }

  it('rejects child rows that reference a parent outside the backup before writing anything', async () => {
    const { service: backupService, prisma } = makeService();
    const file = backup({
      journalEntry: [],
      journalLine: [
        { id: 'line-1', journalEntryId: 'another-company-entry', accountId: 'account-1' },
      ],
    });

    await expect(backupService.restore(file, companyId, { replace: true })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects stock balances that reference a branch outside the backup', async () => {
    const { service, prisma } = service();
    const file = backup({
      branch: [],
      item: [{ id: 'item-1' }],
      stockBalance: [
        { companyId, branchId: 'another-company-branch', itemId: 'item-1' },
      ],
    });

    await expect(service.restore(file, companyId, { replace: true })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
