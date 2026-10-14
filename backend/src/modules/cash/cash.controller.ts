import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { BankReconciliationService } from './bank-reconciliation.service';
import { CashAccountsService } from './cash-accounts.service';
import { CashTransfersService } from './cash-transfers.service';
import { CashVouchersService } from './cash-vouchers.service';

/// Cash boxes, bank accounts, receipts, payments and transfers.
///
/// Every route here needs a permission of its own: reading a cash position,
/// creating a voucher and posting one are three different jobs in an
/// accounting office, and the server is where that is enforced.
@Controller('cash')
export class CashController {
  constructor(
    private readonly accounts: CashAccountsService,
    private readonly vouchers: CashVouchersService,
    private readonly transfers: CashTransfersService,
    private readonly reconciliations: BankReconciliationService,
  ) {}

  // ---------------------------------------------------------- accounts

  @Get('accounts')
  @RequirePermissions('cash.accounts.read')
  listAccounts(
    @CurrentUser() user: AuthUser,
    @Query('kind') kind?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.accounts.findAll(user.companyId, {
      kind,
      includeInactive: includeInactive === 'true',
      branchId,
    });
  }

  @Get('accounts/balances')
  @RequirePermissions('cash.accounts.read')
  balances(@CurrentUser() user: AuthUser, @Query('asOf') asOf?: string) {
    return this.accounts.balances(user.companyId, asOf);
  }

  @Get('accounts/:id')
  @RequirePermissions('cash.accounts.read')
  getAccount(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.accounts.findOne(user.companyId, id);
  }

  @Post('accounts')
  @RequirePermissions('cash.accounts.manage')
  createAccount(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.accounts.create(user.companyId, user.userId, body);
  }

  @Patch('accounts/:id')
  @RequirePermissions('cash.accounts.manage')
  updateAccount(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.accounts.update(user.companyId, user.userId, id, body);
  }

  @Post('accounts/:id/deactivate')
  @RequirePermissions('cash.accounts.manage')
  deactivateAccount(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.accounts.deactivate(user.companyId, user.userId, id);
  }

  @Get('accounts/:id/statement')
  @RequirePermissions('cash.accounts.read')
  statement(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.accounts.statement(user.companyId, id, { from, to });
  }

  // ---------------------------------------------------------- vouchers

  @Get('vouchers')
  @RequirePermissions('cash.vouchers.read')
  listVouchers(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.vouchers.findAll(user.companyId, {
      kind: query.kind,
      status: query.status,
      cashAccountId: query.cashAccountId,
      customerId: query.customerId,
      supplierId: query.supplierId,
      from: query.from,
      to: query.to,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    });
  }

  @Get('vouchers/:id')
  @RequirePermissions('cash.vouchers.read')
  getVoucher(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.vouchers.findOne(user.companyId, id);
  }

  @Post('vouchers')
  @RequirePermissions('cash.vouchers.create')
  createVoucher(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.vouchers.create(user.companyId, user.branchId, user.userId, body as never);
  }

  @Post('vouchers/:id/post')
  @RequirePermissions('cash.vouchers.post')
  postVoucher(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.vouchers.post(user.companyId, user.userId, id);
  }

  @Post('vouchers/:id/reverse')
  @RequirePermissions('cash.vouchers.post')
  reverseVoucher(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.vouchers.reverse(user.companyId, user.userId, id, body?.reason);
  }

  @Get('open-invoices/:kind/:partyId')
  @RequirePermissions('cash.vouchers.create')
  openInvoices(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: string,
    @Param('partyId') partyId: string,
  ) {
    if (kind !== 'customer' && kind !== 'supplier') {
      return { items: [] };
    }
    return this.vouchers.openInvoices(user.companyId, kind, partyId);
  }

  // --------------------------------------------------------- transfers

  @Get('transfers')
  @RequirePermissions('cash.vouchers.read')
  listTransfers(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.transfers.findAll(user.companyId, {
      cashAccountId: query.cashAccountId,
      from: query.from,
      to: query.to,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    });
  }

  @Get('transfers/:id')
  @RequirePermissions('cash.vouchers.read')
  getTransfer(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.transfers.findOne(user.companyId, id);
  }

  @Post('transfers')
  @RequirePermissions('cash.vouchers.create')
  createTransfer(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.transfers.create(user.companyId, user.branchId, user.userId, body as never);
  }

  @Post('transfers/:id/post')
  @RequirePermissions('cash.vouchers.post')
  postTransfer(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.transfers.post(user.companyId, user.userId, id);
  }

  @Post('transfers/:id/reverse')
  @RequirePermissions('cash.vouchers.post')
  reverseTransfer(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.transfers.reverse(user.companyId, user.userId, id);
  }

  // ---------------------------------------------------- reconciliations

  @Get('reconciliations')
  @RequirePermissions('cash.reconcile')
  listReconciliations(
    @CurrentUser() user: AuthUser,
    @Query('cashAccountId') cashAccountId?: string,
  ) {
    return this.reconciliations.findAll(user.companyId, cashAccountId);
  }

  @Get('reconciliations/unmatched/:cashAccountId')
  @RequirePermissions('cash.reconcile')
  unmatched(
    @CurrentUser() user: AuthUser,
    @Param('cashAccountId') cashAccountId: string,
    @Query('to') to?: string,
  ) {
    return this.reconciliations.unmatched(user.companyId, cashAccountId, to);
  }

  @Get('reconciliations/:id')
  @RequirePermissions('cash.reconcile')
  getReconciliation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reconciliations.findOne(user.companyId, id);
  }

  @Post('reconciliations')
  @RequirePermissions('cash.reconcile')
  reconcile(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.reconciliations.create(user.companyId, user.userId, body as never);
  }
}
