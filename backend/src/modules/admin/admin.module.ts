import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { BackupModule } from '../backup/backup.module';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';
import { ResetController } from './reset.controller';
import { ResetService } from './reset.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/// Users, roles and permissions — the answer to "who may do what" —
/// plus a read-only window onto the audit trail, plus the one button that
/// puts a company back to its first day.
@Module({
  imports: [AuditModule, BackupModule],
  controllers: [
    UsersController,
    RolesController,
    AuditLogsController,
    ResetController,
  ],
  providers: [
    UsersService,
    RolesService,
    AuditLogsService,
    ResetService,
  ],
  exports: [UsersService, RolesService, ResetService],
})
export class AdminModule {}
