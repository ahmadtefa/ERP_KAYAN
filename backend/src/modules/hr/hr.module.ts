import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { EosService } from './eos.service';
import { PayrollService } from './payroll.service';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';

@Module({
  imports: [PrismaModule, AuditModule, AccountingModule],
  controllers: [HrController],
  providers: [HrService, PayrollService, EosService],
  exports: [HrService, PayrollService, EosService],
})
export class HrModule {}
