import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { SerialsController } from './serials.controller';
import { SerialsService } from './serials.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [SerialsController],
  providers: [SerialsService],
})
export class SerialsModule {}
