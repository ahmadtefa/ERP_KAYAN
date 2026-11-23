import { Module } from '@nestjs/common';
import { AuditedSuperAdminGuard } from '../../common/guards/audited-super-admin.guard';

import { AuditModule } from '../../common/audit/audit.module';
import { BackupController } from './backup.controller';
import { BackupScheduleController } from './backup-schedule.controller';
import { BackupScheduleService } from './backup-schedule.service';
import { BackupService } from './backup.service';
import { FullBackupController } from './full-backup.controller';
import { FullBackupService } from './full-backup.service';
import { CompleteBackupController } from './system/complete-backup.controller';
import { CompleteBackupService } from './system/complete-backup.service';
import { RestoreGateService } from './system/restore-gate.service';
import { RestoreJournalStore } from './system/restore-journal';
import { SystemRestoreService } from './system/system-restore.service';
import { backupDirectory } from './system/pg-support';
import { DumpRecoveryCoordinator } from './system/dump-recovery-coordinator';

/// Copying the books out, and putting a copy back.
///
/// Three kinds of backup live here, and the screens keep them apart:
///
///  * the company-level JSON file — one company's books, portable between
///    installations, and the only one that never touches another company;
///  * the database archive (`.dump`) — the whole PostgreSQL database;
///  * the complete system backup (`.kayanbackup`) — database, uploaded files,
///    settings, licence state and a manifest with a SHA-256 of everything,
///    with the safe restore that puts it back.
@Module({
  imports: [AuditModule],
  controllers: [
    BackupController,
    FullBackupController,
    CompleteBackupController,
    BackupScheduleController,
  ],
  providers: [
    AuditedSuperAdminGuard,
    BackupService,
    FullBackupService,
    BackupScheduleService,
    CompleteBackupService,
    SystemRestoreService,
    DumpRecoveryCoordinator,
    RestoreGateService,
    {
      provide: RestoreJournalStore,
      useFactory: () => new RestoreJournalStore(backupDirectory()),
    },
  ],
  exports: [
    BackupService,
    FullBackupService,
    BackupScheduleService,
    CompleteBackupService,
    SystemRestoreService,
    RestoreGateService,
  ],
})
export class BackupModule {}
