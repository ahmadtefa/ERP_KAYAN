import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { SalesModule } from '../sales/sales.module';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';

@Module({
  imports: [PrismaModule, AuditModule, SalesModule],
  controllers: [ContractsController],
  providers: [ContractsService],
})
export class ContractsModule {}
