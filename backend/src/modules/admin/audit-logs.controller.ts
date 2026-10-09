import { Controller, Get, Query } from '@nestjs/common';

import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AuditLogsService } from './audit-logs.service';
import { ListAuditLogsDto } from './dto/audit-log.dto';

@Controller('admin/audit-logs')
@RequirePermissions('admin.audit.read')
export class AuditLogsController {
  constructor(private readonly logs: AuditLogsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListAuditLogsDto) {
    return this.logs.list(user.companyId, query);
  }
}
