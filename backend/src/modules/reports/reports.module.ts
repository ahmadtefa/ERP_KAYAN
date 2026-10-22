import { Module } from '@nestjs/common';

import { AccountingModule } from '../accounting/accounting.module';
import { FixedAssetsModule } from '../fixed-assets/fixed-assets.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AgingService } from './aging.service';
import { FinancialStatementsService } from './financial-statements.service';
import { OperationsReportsService } from './operations-reports.service';
import { PartyReconciliationService } from './party-reconciliation.service';
import { ReconciliationCenterService } from './reconciliation-center.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [PrismaModule, AccountingModule, FixedAssetsModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    FinancialStatementsService,
    AgingService,
    OperationsReportsService,
    PartyReconciliationService,
    ReconciliationCenterService,
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
