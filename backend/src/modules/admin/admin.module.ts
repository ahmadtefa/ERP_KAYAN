import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/// Users, roles and permissions — the answer to "who may do what" —
/// plus a read-only window onto the audit trail.
@Module({
  imports: [AuditModule],
  controllers: [UsersController, RolesController, AuditLogsController],
  providers: [UsersService, RolesService, AuditLogsService],
  exports: [UsersService, RolesService],
})
export class AdminModule {}
