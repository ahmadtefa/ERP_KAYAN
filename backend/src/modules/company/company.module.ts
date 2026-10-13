import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CompaniesController } from './companies.controller';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';

/// Company profile, units (headquarters and branches), and the first-run
/// setup that fills them in on a new installation.
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [CompanyController, CompaniesController, SetupController],
  providers: [CompanyService, SetupService],
  exports: [CompanyService],
})
export class CompanyModule {}
