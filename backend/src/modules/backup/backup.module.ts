import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';

/// Copying the books out, and putting a copy back.
@Module({
  imports: [AuditModule],
  controllers: [BackupController],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
