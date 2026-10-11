import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { BackupController } from './backup.controller';
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
  controllers: [BackupController, FullBackupController],
  providers: [BackupService, FullBackupService],
  exports: [BackupService, FullBackupService],
})
export class BackupModule {}
