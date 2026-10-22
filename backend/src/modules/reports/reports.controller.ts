import { Controller, Get, Param, Query } from '@nestjs/common';

import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { BudgetsService } from '../accounting/budgets.service';
import { AgingService } from './aging.service';
import { FinancialStatementsService } from './financial-statements.service';
import {
  AgingQueryDto,
  BudgetReportQueryDto,
  CostCenterReportQueryDto,
  CostCenterTransactionsQueryDto,
  OperationsQueryDto,
  PeriodQueryDto,
} from './dto/report-query.dto';
import { OperationsReportsService } from './operations-reports.service';
import { PartyReconciliationService } from './party-reconciliation.service';
import { ReconciliationCenterService } from './reconciliation-center.service';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly service: ReportsService,
    private readonly statements: FinancialStatementsService,
    private readonly aging: AgingService,
    private readonly operations: OperationsReportsService,
    private readonly budgets: BudgetsService,
    private readonly reconciliation: PartyReconciliationService,
  ) {}

  @Get('receivables-reconciliation')
  @RequirePermissions('reports.read')
  receivablesReconciliation(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.reconciliation.receivables(user.companyId, { asOf: query.asOf ?? query.to });
  }

  @Get('payables-reconciliation')
  @RequirePermissions('reports.read')
  payablesReconciliation(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.reconciliation.payables(user.companyId, { asOf: query.asOf ?? query.to });
  }

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

  @Get('equity-changes')
  @RequirePermissions('reports.read')
  equityChanges(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.statements.equityChanges(user.companyId, query);
  }

  @Get('cash-flow')
  @RequirePermissions('reports.read')
  cashFlow(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.statements.cashFlow(user.companyId, query);
  }

  @Get('cost-centers')
  @RequirePermissions('accounting.costcenters.read')
  costCenters(@CurrentUser() user: AuthUser, @Query() query: CostCenterReportQueryDto) {
    return this.statements.costCenterReport(user.companyId, query);
  }

  /// The lines behind one centre's figure. `costCenterId=unallocated` lists the
  /// lines that carry no centre at all, which is the other half of the report.
  @Get('cost-centers/:costCenterId/transactions')
  @RequirePermissions('accounting.costcenters.read')
  costCenterTransactions(
    @CurrentUser() user: AuthUser,
    @Param('costCenterId') costCenterId: string,
    @Query() query: CostCenterTransactionsQueryDto,
  ) {
    return this.statements.costCenterTransactions(
      user.companyId,
      costCenterId === 'unallocated' ? null : costCenterId,
      query,
    );
  }

  /// Budget against actual. The actual is read from posted ledger lines only;
  /// nothing is estimated, prorated or converted.
  @Get('budgets')
  @RequirePermissions('accounting.budgets.read')
  budgetReport(
    @CurrentUser() user: AuthUser,
    @Query() query: BudgetReportQueryDto,
  ) {
    return this.budgets.report(user.companyId, query);
  }

  @Get('receivables-aging')
  @RequirePermissions('reports.read')
  receivablesAging(@CurrentUser() user: AuthUser, @Query() query: AgingQueryDto) {
    return this.aging.receivables(user.companyId, {
      asOf: query.to,
      customerId: query.customerId,
      branchId: query.branchId,
    });
  }

  @Get('payables-aging')
  @RequirePermissions('reports.read')
  payablesAging(@CurrentUser() user: AuthUser, @Query() query: AgingQueryDto) {
    return this.aging.payables(user.companyId, {
      asOf: query.to,
      supplierId: query.supplierId,
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

  // ------------------------------------------------- operational reports

  @Get('sales')
  @RequirePermissions('reports.read')
  salesReport(@CurrentUser() user: AuthUser, @Query() query: OperationsQueryDto) {
    return this.operations.sales(user.companyId, query);
  }

  @Get('purchases')
  @RequirePermissions('reports.read')
  purchasesReport(@CurrentUser() user: AuthUser, @Query() query: OperationsQueryDto) {
    return this.operations.purchases(user.companyId, query);
  }

  @Get('expenses')
  @RequirePermissions('reports.read')
  expensesReport(@CurrentUser() user: AuthUser, @Query() query: OperationsQueryDto) {
    return this.operations.accountMovement(user.companyId, 'EXPENSE', query);
  }

  @Get('income')
  @RequirePermissions('reports.read')
  incomeReport(@CurrentUser() user: AuthUser, @Query() query: OperationsQueryDto) {
    return this.operations.accountMovement(user.companyId, 'REVENUE', query);
  }

  @Get('payments')
  @RequirePermissions('reports.read')
  paymentsReport(@CurrentUser() user: AuthUser, @Query() query: OperationsQueryDto) {
    return this.operations.payments(user.companyId, query);
  }

  @Get('cash')
  @RequirePermissions('reports.read')
  cashReport(@CurrentUser() user: AuthUser, @Query() query: OperationsQueryDto) {
    return this.operations.cash(user.companyId, query);
  }

  @Get('outstanding-invoices')
  @RequirePermissions('reports.read')
  outstandingInvoices(
    @CurrentUser() user: AuthUser,
    @Query() query: OperationsQueryDto,
  ) {
    return this.operations.outstandingInvoices(user.companyId, {
      asOf: query.asOf ?? query.to,
      kind: query.kind,
      customerId: query.customerId,
      supplierId: query.supplierId,
      branchId: query.branchId,
    });
  }
}
