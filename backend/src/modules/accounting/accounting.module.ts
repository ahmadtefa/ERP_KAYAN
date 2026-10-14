import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AccountMapService } from './account-map.service';
import { AccountingSettingsController } from './settings.controller';
import { ChartOfAccountsController } from './chart-of-accounts.controller';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { CostCentersController } from './cost-centers.controller';
import { CostCentersService } from './cost-centers.service';
import { DocumentNumberService } from './document-number.service';
import { FiscalPeriodsController } from './fiscal-periods.controller';
import { FiscalPeriodsService } from './fiscal-periods.service';
import { JournalEntriesController } from './journal-entries.controller';
import { JournalEntriesService } from './journal-entries.service';
import { OpeningBalancesController } from './opening-balances.controller';
import { OpeningBalancesService } from './opening-balances.service';
import { PostingService } from './posting.service';
import { YearEndCloseController } from './year-end-close.controller';
import { YearEndCloseService } from './year-end-close.service';

@Module({
  imports: [AuditModule, PrismaModule],
  controllers: [
    ChartOfAccountsController,
    JournalEntriesController,
    FiscalPeriodsController,
    CostCentersController,
    OpeningBalancesController,
    YearEndCloseController,
    AccountingSettingsController,
  ],
  providers: [
    ChartOfAccountsService,
    JournalEntriesService,
    DocumentNumberService,
    FiscalPeriodsService,
    AccountMapService,
    PostingService,
    CostCentersService,
    OpeningBalancesService,
    YearEndCloseService,
  ],
  // Sales, purchases, cash, stock and reports all need to write or read the
  // ledger, so the pieces that do that are exported rather than reimplemented.
  exports: [
    DocumentNumberService,
    AccountMapService,
    PostingService,
    FiscalPeriodsService,
    CostCentersService,
  ],
})
export class AccountingModule {}
