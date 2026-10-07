import { Module } from '@nestjs/common';

import { ReportsModule } from '../reports/reports.module';
import { ExportController } from './export.controller';
import { ReportTablesService } from './report-tables.service';

/// The same reports as the reports screen, wrapped as files.
@Module({
  imports: [ReportsModule],
  controllers: [ExportController],
  providers: [ReportTablesService],
  exports: [ReportTablesService],
})
export class ExportModule {}
