import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { AccountingModule } from '../accounting/accounting.module';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';

/// Bringing master data in from a spreadsheet.
@Module({
  imports: [AuditModule, AccountingModule],
  controllers: [ImportController],
  providers: [ImportService],
  exports: [ImportService],
})
export class ImportModule {}
