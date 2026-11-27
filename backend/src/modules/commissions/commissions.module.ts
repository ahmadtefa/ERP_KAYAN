import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CommissionsController } from './commissions.controller';
import { CommissionsService } from './commissions.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [CommissionsController],
  providers: [CommissionsService],
})
export class CommissionsModule {}
