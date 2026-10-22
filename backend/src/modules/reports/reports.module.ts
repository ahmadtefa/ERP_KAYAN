import { Module } from '@nestjs/common';

import { AccountingModule } from '../accounting/accounting.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AgingService } from './aging.service';
import { FinancialStatementsService } from './financial-statements.service';
import { OperationsReportsService } from './operations-reports.service';
import { PartyReconciliationService } from './party-reconciliation.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [PrismaModule, AccountingModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    FinancialStatementsService,
    AgingService,
    OperationsReportsService,
    PartyReconciliationService,
  ],
  // The exporter renders the same numbers as files, so it reads the same
  // service rather than re-deriving them.
  exports: [
    ReportsService,
    FinancialStatementsService,
    AgingService,
    OperationsReportsService,
    PartyReconciliationService,
  ],
})
export class ReportsModule {}
