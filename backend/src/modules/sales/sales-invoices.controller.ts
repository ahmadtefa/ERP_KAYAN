import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { canReadCost } from '../../common/auth/cost-visibility';
import {
  CreateSalesInvoiceDto,
  ListInvoicesDto,
} from './dto/sales-invoice.dto';
import { SalesInvoicesService } from './sales-invoices.service';

@Controller('sales/invoices')
export class SalesInvoicesController {
  constructor(private readonly service: SalesInvoicesService) {}

  @Get()
  @RequirePermissions('sales.invoices.read')
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListInvoicesDto) {
    return this.service.findAll(user.companyId, query, canReadCost(user));
  }

  @Get('tax-pricing')
  @RequirePermissions('sales.invoices.create')
  taxPricing(@CurrentUser() user: AuthUser) {
    return this.service.taxPricing(user.companyId);
  }

  @Get(':id')
  @RequirePermissions('sales.invoices.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id, canReadCost(user));
  }

  @Post()
  @RequirePermissions('sales.invoices.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSalesInvoiceDto) {
    return this.service.create(user.companyId, user.branchId, user.userId, dto, undefined, canReadCost(user));
  }

  @Put(':id')
  @RequirePermissions('sales.invoices.create')
  updateDraft(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateSalesInvoiceDto,
  ) {
    return this.service.updateDraft(user.companyId, user.branchId, user.userId, id, dto, canReadCost(user));
  }

  @Put(':id/order-allocation')
  @RequirePermissions('sales.orders.read', 'sales.invoices.create')
  updateOrderAllocation(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.updateOrderAllocation(user.companyId, user.branchId, user.userId, id, dto ?? {});
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
    });
  }

  @Post(':id/reverse')
  @RequirePermissions('sales.invoices.post')
  reverse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reverse(user.companyId, user.userId, id, canReadCost(user));
  }
}
