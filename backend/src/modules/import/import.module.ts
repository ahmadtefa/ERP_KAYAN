import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';

/// Bringing master data in from a spreadsheet.
@Module({
  imports: [AuditModule],
  controllers: [ImportController],
  providers: [ImportService],
  exports: [ImportService],
})
export class ImportModule {}
