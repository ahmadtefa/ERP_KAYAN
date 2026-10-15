import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { AgingService } from './aging.service';
import { FinancialStatementsService } from './financial-statements.service';
import { OperationsReportsService } from './operations-reports.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [PrismaModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    FinancialStatementsService,
    AgingService,
    OperationsReportsService,
  ],
  // The exporter renders the same numbers as files, so it reads the same
  // service rather than re-deriving them.
  exports: [
    ReportsService,
    FinancialStatementsService,
    AgingService,
    OperationsReportsService,
  ],
})
export class ReportsModule {}
