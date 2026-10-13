import { Module } from '@nestjs/common';

import { CompanyModule } from '../company/company.module';
import { ReportsModule } from '../reports/reports.module';
import { ExportController } from './export.controller';
import { ListTablesService } from './list-tables.service';
import { PdfService } from './pdf.service';
import { ReportTablesService } from './report-tables.service';

/// The same reports as the reports screen, wrapped as files.
@Module({
  imports: [ReportsModule, CompanyModule],
  controllers: [ExportController],
  providers: [ReportTablesService, PdfService, ListTablesService],
  exports: [ReportTablesService, ListTablesService, PdfService],
})
export class ExportModule {}
