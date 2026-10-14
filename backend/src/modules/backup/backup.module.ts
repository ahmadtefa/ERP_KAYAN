import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { BackupController } from './backup.controller';
import { BackupScheduleController } from './backup-schedule.controller';
import { BackupScheduleService } from './backup-schedule.service';
import { BackupService } from './backup.service';
import { FullBackupController } from './full-backup.controller';
import { FullBackupService } from './full-backup.service';

/// Copying the books out, and putting a copy back.
///
/// Two kinds of backup live here: the company-level JSON file (one company's
/// books, portable between installations) and the full PostgreSQL archive
/// (everything on this installation, for disaster recovery).
@Module({
  imports: [AuditModule],
  controllers: [BackupController, FullBackupController, BackupScheduleController],
  providers: [BackupService, FullBackupService, BackupScheduleService],
  exports: [BackupService, FullBackupService, BackupScheduleService],
})
export class BackupModule {}
