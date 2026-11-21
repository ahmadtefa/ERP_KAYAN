import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { MasterDataBackupController } from './master-data-backup.controller';
import { MasterDataBackupService } from './master-data-backup.service';

/// Safe, independent copies of the three master-data lists. These archives do
/// not include stock ledgers or commercial documents.
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [MasterDataBackupController],
  providers: [MasterDataBackupService],
})
export class MasterDataBackupModule {}
