import { Controller, Get, Param, Query } from '@nestjs/common';

import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgingService } from './aging.service';
import { FinancialStatementsService } from './financial-statements.service';
import { PeriodQueryDto } from './dto/report-query.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly service: ReportsService,
    private readonly statements: FinancialStatementsService,
    private readonly aging: AgingService,
  ) {}

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

  // ------------------------------------------------- financial statements

  @Get('general-journal')
  @RequirePermissions('reports.read')
  generalJournal(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.statements.generalJournal(user.companyId, query);
  }

  @Get('general-ledger')
  @RequirePermissions('reports.read')
  generalLedger(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.statements.generalLedger(user.companyId, query);
  }

  @Get('balance-sheet')
  @RequirePermissions('reports.read')
  balanceSheet(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.statements.balanceSheet(user.companyId, query);
  }

  @Get('cash-flow')
  @RequirePermissions('reports.read')
  cashFlow(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.statements.cashFlow(user.companyId, query);
  }

  @Get('cost-centers')
  @RequirePermissions('reports.read')
  costCenters(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.statements.costCenterReport(user.companyId, query);
  }

  @Get('receivables-aging')
  @RequirePermissions('reports.read')
  receivablesAging(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.aging.receivables(user.companyId, {
      asOf: query.to,
      customerId: (query as Record<string, string>).customerId,
      branchId: query.branchId,
    });
  }

  @Get('payables-aging')
  @RequirePermissions('reports.read')
  payablesAging(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.aging.payables(user.companyId, {
      asOf: query.to,
      supplierId: (query as Record<string, string>).supplierId,
      branchId: query.branchId,
    });
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
