import { Global, Module } from '@nestjs/common';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/// The program's one notification centre.
///
/// Registered globally for the same reason warehouses and the audit trail are:
/// any module may have something to tell a person, and none of them should
/// have to import a feature module to say it. The centre is not an inventory
/// feature - stock is simply the first module with something worth saying.
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
