import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AccountMapService } from './account-map.service';
import { ChartOfAccountsController } from './chart-of-accounts.controller';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { DocumentNumberService } from './document-number.service';
import { JournalEntriesController } from './journal-entries.controller';
import { JournalEntriesService } from './journal-entries.service';
import { PostingService } from './posting.service';

@Module({
  controllers: [ChartOfAccountsController, JournalEntriesController],
  providers: [
    ChartOfAccountsService,
    JournalEntriesService,
    DocumentNumberService,
    AccountMapService,
    PostingService,
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  // Sales, purchases and reports all need to write or read the ledger.
  exports: [DocumentNumberService, AccountMapService, PostingService],
})
export class AccountingModule {}
