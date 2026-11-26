import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CashModule } from '../cash/cash.module';
import { ChequesController } from './cheques.controller';
import { ChequesService } from './cheques.service';

@Module({
  imports: [PrismaModule, AuditModule, CashModule],
  controllers: [ChequesController],
  providers: [ChequesService],
})
export class ChequesModule {}
