import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { WithholdingController } from './withholding.controller';
import { WithholdingService } from './withholding.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [WithholdingController],
  providers: [WithholdingService],
})
export class WithholdingModule {}
