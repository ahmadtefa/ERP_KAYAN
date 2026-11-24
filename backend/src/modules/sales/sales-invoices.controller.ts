import { branchReadScope } from '../../common/auth/branch-read-scope';
import { Body, Controller, Delete, Get, NotFoundException, Optional, Param, Post, Put, Query } from '@nestjs/common';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { canReadCost, canReadPurchasePrice, canReadSalePrice } from '../../common/auth/cost-visibility';
import { redactPriceFields } from '../../common/auth/price-redaction';
import {
  CreateSalesInvoiceDto,
  ListInvoicesDto,
} from './dto/sales-invoice.dto';
import { SalesInvoicesService } from './sales-invoices.service';
import { CustomerCreditService } from './customer-credit.service';

@Controller('sales/invoices')
export class SalesInvoicesController {
  constructor(
    private readonly service: SalesInvoicesService,
    @Optional() private readonly credit?: CustomerCreditService,
  ) {}

  private redact(user: AuthUser, response: unknown) {
    return redactPriceFields(response, { sale: canReadSalePrice(user), purchase: canReadPurchasePrice(user), cost: canReadCost(user) }, 'sale');
  }

  @Get()
  @RequirePermissions('sales.invoices.read')
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListInvoicesDto) {
    return this.service.findAll(user.companyId, query, canReadCost(user), branchReadScope(user)).then((result) => this.redact(user, result));
  }

  @Get('tax-pricing')
  @RequirePermissions('sales.invoices.create')
  taxPricing(@CurrentUser() user: AuthUser) {
    return this.service.taxPricing(user.companyId);
  }

  @Get(':id')
  @RequirePermissions('sales.invoices.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id, canReadCost(user), branchReadScope(user)).then((result) => this.redact(user, result));
  }

  @Post()
  @RequirePermissions('sales.invoices.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSalesInvoiceDto) {
    return this.service.create(user.companyId, user.branchId, user.userId, dto, undefined, canReadCost(user)).then((result) => this.redact(user, result));
  }

  @Put(':id')
  @RequirePermissions('sales.invoices.create')
  updateDraft(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateSalesInvoiceDto,
  ) {
    return this.service.updateDraft(user.companyId, user.branchId, user.userId, id, dto, canReadCost(user)).then((result) => this.redact(user, result));
  }

  @Put(':id/order-allocation')
  @RequirePermissions('sales.orders.read', 'sales.invoices.create')
  updateOrderAllocation(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.updateOrderAllocation(user.companyId, user.branchId, user.userId, id, dto ?? {}).then((result) => this.redact(user, result));
  }

  @Delete(':id')
  @RequirePermissions('sales.invoices.create')
  cancelDraft(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.cancelDraft(user.companyId, user.branchId, user.userId, id);
  }

  /// Posting issues the goods from real lots in FEFO order.
  ///
  /// `reason` is the justification recorded when - and only when - the caller
  /// may sign for expired stock. The permission is read from the authenticated
  /// user here and never from the body: sending `allowExpired: true` to this
  /// route does nothing on its own.
  @Post(':id/post')
  @RequirePermissions('sales.invoices.post')
  post(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body?: { expiredIssueReason?: string } | undefined,
  ) {
    const mayIssueExpired =
      user.isSuperAdmin ||
      (user.permissions ?? []).includes('inventory.batches.expired.issue');
    return this.service.post(user.companyId, user.userId, id, canReadCost(user), {
      mayIssueExpired,
      reason: body?.expiredIssueReason ?? null,
    }, {
      // The credit figures are the customer card's company-wide figures.
      mayDiscloseBalance: user.isSuperAdmin === true || (user.permissions ?? []).includes('parties.customers.read'),
    }).then((result) => this.redact(user, result));
  }

  /// Signs for one over-limit draft invoice. The permission is separate from
  /// posting, so who may approve is an assignment, not a side effect.
  @Post(':id/credit-approval')
  @RequirePermissions('sales.credit.approve')
  approveCredit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { reason?: string }) {
    if (!this.credit) throw new NotFoundException('Credit approval is not available');
    return this.credit.approve(user.companyId, user.userId, id, body?.reason ?? '', branchReadScope(user));
  }

  @Post(':id/reverse')
  @RequirePermissions('sales.invoices.post')
  reverse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reverse(user.companyId, user.userId, id, canReadCost(user)).then((result) => this.redact(user, result));
  }
}
