import { Module } from '@nestjs/common';

import { ReportsModule } from '../reports/reports.module';
import { ExportController } from './export.controller';
import { ListTablesService } from './list-tables.service';
import { PdfService } from './pdf.service';
import { ReportTablesService } from './report-tables.service';

/// The same reports as the reports screen, wrapped as files.
@Module({
  imports: [ReportsModule],
  controllers: [ExportController],
  providers: [ReportTablesService, PdfService, ListTablesService],
  exports: [ReportTablesService, ListTablesService],
})
export class ExportModule {}
