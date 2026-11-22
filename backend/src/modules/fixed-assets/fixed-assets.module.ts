import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { BranchReportScopeGuard } from '../../common/auth/branch-report-scope.guard';
import { AccountingModule } from '../accounting/accounting.module';
import { FixedAssetsController } from './fixed-assets.controller';
import { FixedAssetsService } from './fixed-assets.service';

@Module({
  imports: [PrismaModule, AuditModule, AccountingModule],
  controllers: [FixedAssetsController],
  providers: [FixedAssetsService, BranchReportScopeGuard],
  exports: [FixedAssetsService],
})
export class FixedAssetsModule {}
