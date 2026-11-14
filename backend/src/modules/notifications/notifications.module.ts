import { Global, Module } from '@nestjs/common';

import { ExpiryAlertScheduler } from './expiry-alert.scheduler';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/// The program's one notification centre.
///
/// Registered globally for the same reason warehouses and the audit trail are:
/// any module may have something to tell a person, and none of them should
/// have to import a feature module to say it. The centre is not an inventory
/// feature - stock is simply the first module with something worth saying.
///
/// The scheduler lives here rather than in the inventory module for the same
/// reason: it drives the centre's scanner, and the scanner is what decides
/// whether a lot is worth a row. Inventory only supplies the facts.
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, ExpiryAlertScheduler],
  exports: [NotificationsService, ExpiryAlertScheduler],
})
export class NotificationsModule {}
