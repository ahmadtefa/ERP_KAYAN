import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { PrintSettingsController } from './print-settings.controller';
import { PrintSettingsService } from './print-settings.service';

export { PrintSettingsService, type PrintSettingsResponse } from './print-settings.service';

// Print settings are consulted by every PDF and print route in the program, so
// the module is global: the screens that print should not each have to import
// the policy they all obey.
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [PrintSettingsController],
  providers: [PrintSettingsService],
  exports: [PrintSettingsService],
})
export class PrintSettingsModule {}
