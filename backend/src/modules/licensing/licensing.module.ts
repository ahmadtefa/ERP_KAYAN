import { Global, Module } from '@nestjs/common';

import { LicenseGuard } from './license.guard';
import { LicensingController } from './licensing.controller';
import { LicensingService } from './licensing.service';

/**
 * The offline licence.
 *
 * Global because the seat limit belongs to user creation (admin) and the
 * first-run setup (company) - not to a feature module - and because the guard
 * has to see every request.
 */
@Global()
@Module({
  controllers: [LicensingController],
  providers: [LicensingService, LicenseGuard],
  exports: [LicensingService, LicenseGuard],
})
export class LicensingModule {}
