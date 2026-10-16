import { Controller, Get, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('summary')
  @RequirePermissions('reports.read')
  summary(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.summary(user.companyId, { from, to, branchId });
  }

  /// Month-by-month comparison behind the dashboard charts.
  @Get('monthly')
  @RequirePermissions('reports.read')
  monthly(
    @CurrentUser() user: AuthUser,
    @Query('months') months?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.monthly(user.companyId, {
      months: months ? Number(months) : undefined,
      branchId,
    });
  }
}
