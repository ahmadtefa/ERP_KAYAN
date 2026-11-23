import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { canReadCost, canReadPurchasePrice, canReadSalePrice } from '../../common/auth/cost-visibility';
import { mayReadCompanyAggregates } from '../../common/auth/company-aggregate-visibility';
import { BranchReportScopeGuard } from '../../common/auth/branch-report-scope.guard';
import { CompanyAggregateVisibilityInterceptor } from '../../common/auth/company-aggregate-visibility';
import { redactPriceFields } from '../../common/auth/price-redaction';
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

/// What PostgreSQL accepts as a uuid. Checked here so a malformed id is a
/// 400 rather than a driver error reported as a server failure.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('reports')
@UseGuards(BranchReportScopeGuard)
@UseInterceptors(CompanyAggregateVisibilityInterceptor)
export class ReportsController {
  constructor(
    private readonly service: ReportsService,
    private readonly statements: FinancialStatementsService,
    private readonly aging: AgingService,
    private readonly operations: OperationsReportsService,
    private readonly budgets: BudgetsService,
    private readonly reconciliation: PartyReconciliationService,
    private readonly reconciliationCenter: ReconciliationCenterService,
  ) {}

  @Get('reconciliation-center')
  @RequirePermissions('reports.reconciliation-center.read')
  reconciliationCenterReport(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.reconciliationCenter.center(user.companyId, {
      asOf: query.asOf ?? query.to,
      branchId: query.branchId,
    });
  }

  @Get('receivables-reconciliation')
  @RequirePermissions('reports.receivables-reconciliation.read')
  receivablesReconciliation(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.reconciliation.receivables(user.companyId, {
      asOf: query.asOf ?? query.to,
      branchId: query.branchId,
    });
  }

  @Get('payables-reconciliation')
  @RequirePermissions('reports.payables-reconciliation.read')
  payablesReconciliation(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.reconciliation.payables(user.companyId, {
      asOf: query.asOf ?? query.to,
      branchId: query.branchId,
    });
  }

  @Get('trial-balance')
  @RequirePermissions('reports.trial-balance.read')
  trialBalance(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.service.trialBalance(user.companyId, query);
  }

  @Get('profit-and-loss')
  @RequirePermissions('reports.profit-and-loss.read')
  profitAndLoss(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.service.profitAndLoss(user.companyId, query);
  }

  @Get('customer-balances')
  @RequirePermissions('reports.customer-balances.read')
  customerBalances(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.service.customerBalances(user.companyId, query);
  }

  @Get('supplier-balances')
  @RequirePermissions('reports.supplier-balances.read')
  supplierBalances(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.service.supplierBalances(user.companyId, query);
  }

  // ------------------------------------------------- financial statements

  @Get('general-journal')
  @RequirePermissions('reports.general-journal.read')
  generalJournal(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.statements.generalJournal(user.companyId, query);
  }

  @Get('general-ledger')
  @RequirePermissions('reports.general-ledger.read')
  generalLedger(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.statements.generalLedger(user.companyId, query);
  }

  @Get('balance-sheet')
  @RequirePermissions('reports.balance-sheet.read')
  balanceSheet(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.statements.balanceSheet(user.companyId, query);
  }

  @Get('equity-changes')
  @RequirePermissions('reports.equity-changes.read')
  equityChanges(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.statements.equityChanges(user.companyId, query);
  }

  @Get('cash-flow')
  @RequirePermissions('reports.cash-flow.read')
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
    // `unallocated` is a real value of this route, so a pipe cannot do this
    // check. Anything that is neither `unallocated` nor a UUID is a malformed
    // request (400); passing it to PostgreSQL as a uuid would surface as a
    // 500, which says "the server is broken" about a bad address.
    @Param('costCenterId') costCenterId: string,
    @Query() query: CostCenterTransactionsQueryDto,
  ) {
    const unallocated = costCenterId === 'unallocated';
    if (!unallocated && !UUID_PATTERN.test(costCenterId)) {
      throw new BadRequestException('costCenterId must be a UUID or "unallocated"');
    }
    return this.statements.costCenterTransactions(
      user.companyId,
      unallocated ? null : costCenterId,
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
    if (!mayReadCompanyAggregates(user)) {
      throw new ForbiddenException('Company-wide budget figures are restricted to company and finance managers.');
    }
    return this.budgets.report(user.companyId, query);
  }

  @Get('receivables-aging')
  @RequirePermissions('reports.receivables-aging.read')
  receivablesAging(@CurrentUser() user: AuthUser, @Query() query: AgingQueryDto) {
    return this.aging.receivables(user.companyId, {
      asOf: query.to,
      customerId: query.customerId,
      branchId: query.branchId,
    });
  }

  @Get('payables-aging')
  @RequirePermissions('reports.payables-aging.read')
  payablesAging(@CurrentUser() user: AuthUser, @Query() query: AgingQueryDto) {
    return this.aging.payables(user.companyId, {
      asOf: query.to,
      supplierId: query.supplierId,
      branchId: query.branchId,
    });
  }

  @Get('account-ledger/:accountId')
  @RequirePermissions('reports.account-ledger.read')
  accountLedger(
    @CurrentUser() user: AuthUser,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query() query: PeriodQueryDto,
  ) {
    return this.service.accountLedger(user.companyId, accountId, query);
  }

  // ------------------------------------------------- operational reports

  @Get('sales')
  @RequirePermissions('reports.sales.read')
  salesReport(@CurrentUser() user: AuthUser, @Query() query: OperationsQueryDto) {
    return this.operations.sales(user.companyId, query, canReadCost(user)).then((result) =>
      redactPriceFields(result, { sale: canReadSalePrice(user), purchase: canReadPurchasePrice(user), cost: canReadCost(user) }, 'sale'),
    );
  }

  @Get('purchases')
  @RequirePermissions('reports.purchases.read')
  purchasesReport(@CurrentUser() user: AuthUser, @Query() query: OperationsQueryDto) {
    return this.operations.purchases(user.companyId, query).then((result) =>
      redactPriceFields(result, { sale: true, purchase: canReadPurchasePrice(user), cost: canReadCost(user) }, 'purchase'),
    );
  }

  @Get('expenses')
  @RequirePermissions('reports.expenses.read')
  expensesReport(@CurrentUser() user: AuthUser, @Query() query: OperationsQueryDto) {
    return this.operations.accountMovement(user.companyId, 'EXPENSE', query);
  }

  @Get('income')
  @RequirePermissions('reports.income.read')
  incomeReport(@CurrentUser() user: AuthUser, @Query() query: OperationsQueryDto) {
    return this.operations.accountMovement(user.companyId, 'REVENUE', query);
  }

  @Get('payments')
  @RequirePermissions('reports.payments.read')
  paymentsReport(@CurrentUser() user: AuthUser, @Query() query: OperationsQueryDto) {
    return this.operations.payments(user.companyId, query);
  }

  @Get('cash')
  @RequirePermissions('reports.cash.read')
  cashReport(@CurrentUser() user: AuthUser, @Query() query: OperationsQueryDto) {
    return this.operations.cash(user.companyId, query);
  }

  @Get('outstanding-invoices')
  @RequirePermissions('reports.outstanding-invoices.read')
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
