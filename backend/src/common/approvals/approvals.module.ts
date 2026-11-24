import { Global, Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

/// Global because more than one module will ask "does this document need
/// approval, and who may give it?" — inventory today, and the same engine is
/// meant to govern issue, write-off and discount later without a second copy
/// of this logic.
@Global()
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
