import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PeriodQueryDto } from './dto/report-query.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('trial-balance')
  @RequirePermissions('reports.read')
  trialBalance(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.service.trialBalance(user.companyId, query);
  }

  @Get('profit-and-loss')
  @RequirePermissions('reports.read')
  profitAndLoss(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.service.profitAndLoss(user.companyId, query);
  }

  @Get('customer-balances')
  @RequirePermissions('reports.read')
  customerBalances(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.service.customerBalances(user.companyId, query);
  }

  @Get('supplier-balances')
  @RequirePermissions('reports.read')
  supplierBalances(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.service.supplierBalances(user.companyId, query);
  }

  @Get('account-ledger/:accountId')
  @RequirePermissions('reports.read')
  accountLedger(
    @CurrentUser() user: AuthUser,
    @Param('accountId') accountId: string,
    @Query() query: PeriodQueryDto,
  ) {
    return this.service.accountLedger(user.companyId, accountId, query);
  }
}
