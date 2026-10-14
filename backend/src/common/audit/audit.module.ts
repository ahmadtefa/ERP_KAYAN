import { Global, Module } from '@nestjs/common';
import { AuditPurgeService } from './audit-purge.service';
import { AuditService } from './audit.service';

@Global()
@Module({
  providers: [AuditService, AuditPurgeService],
  exports: [AuditService, AuditPurgeService],
})
export class AuditModule {}
