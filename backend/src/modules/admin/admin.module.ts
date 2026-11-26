import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { BackupModule } from '../backup/backup.module';
import { AuthModule } from '../auth/auth.module';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';
import { RoleCatalogueBootstrap } from './role-catalogue.bootstrap';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/// Users, roles and permissions — the answer to "who may do what" —
/// plus a read-only window onto the audit trail.
@Module({
  imports: [AuditModule, BackupModule, AuthModule],
  controllers: [
    UsersController,
    RolesController,
    AuditLogsController,
  ],
  providers: [
    UsersService,
    RolesService,
    AuditLogsService,
    RoleCatalogueBootstrap,
  ],
  exports: [UsersService, RolesService, RoleCatalogueBootstrap],
})
export class AdminModule {}
