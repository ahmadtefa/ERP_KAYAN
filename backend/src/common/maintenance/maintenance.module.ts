import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import {
  MaintenanceInterceptor,
  MaintenanceService,
} from './maintenance';

/// The maintenance switch, available everywhere.
///
/// The interceptor is global because the rule it enforces is global: while a
/// full restore is replacing the database, no write anywhere is allowed
/// through — not invoices, not accounts, not users.
@Global()
@Module({
  providers: [
    MaintenanceService,
    { provide: APP_INTERCEPTOR, useClass: MaintenanceInterceptor },
  ],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
