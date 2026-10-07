import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ChartOfAccountsController } from './chart-of-accounts.controller';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { DocumentNumberService } from './document-number.service';
import { JournalEntriesController } from './journal-entries.controller';
import { JournalEntriesService } from './journal-entries.service';

@Module({
  controllers: [ChartOfAccountsController, JournalEntriesController],
  providers: [
    ChartOfAccountsService,
    JournalEntriesService,
    DocumentNumberService,
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AccountingModule {}
