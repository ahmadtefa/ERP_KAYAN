import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { FixedAssetsController } from './fixed-assets.controller';
import { FixedAssetsService } from './fixed-assets.service';

@Module({
  imports: [PrismaModule, AuditModule, AccountingModule],
  controllers: [FixedAssetsController],
  providers: [FixedAssetsService],
  exports: [FixedAssetsService],
})
export class FixedAssetsModule {}
