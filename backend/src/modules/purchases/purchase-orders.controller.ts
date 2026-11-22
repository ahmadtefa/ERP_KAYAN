import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';

import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { canReadCost, canReadPurchasePrice } from '../../common/auth/cost-visibility';
import { redactPriceFields } from '../../common/auth/price-redaction';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PurchaseOrdersService } from './purchase-orders.service';

/**
 * Purchase orders: raising one needs `purchases.orders.create`, approving it
 * needs `purchases.orders.approve`, and turning it into an invoice is the
 * invoice service's business - which is why the conversion asks for
 * `purchases.invoices.create` as well as read access to the order.
 */
@Controller('purchases/orders')
export class PurchaseOrdersController {
  constructor(private readonly service: PurchaseOrdersService) {}

  private redact(user: AuthUser, response: unknown) {
    return redactPriceFields(response, { sale: true, purchase: canReadPurchasePrice(user), cost: canReadCost(user) }, 'purchase');
  }

  @Get()
  @RequirePermissions('purchases.orders.read')
  findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: { supplierId?: string; status?: string; from?: string; to?: string },
  ) {
    return this.service.findAll(user.companyId, query).then((result) => this.redact(user, result));
  }

  @Get(':id')
  @RequirePermissions('purchases.orders.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id).then((result) => this.redact(user, result));
  }

  @Post()
  @RequirePermissions('purchases.orders.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.service.create(user.companyId, user.branchId, user.userId, dto).then((result) => this.redact(user, result));
  }

  @Put(':id')
  @RequirePermissions('purchases.orders.read', 'purchases.orders.manage')
  updateDraft(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.updateDraft(user.companyId, user.branchId, user.userId, id, dto ?? {}).then((result) => this.redact(user, result));
  }

  @Put(':id/amend')
  @RequirePermissions('purchases.orders.read', 'purchases.orders.manage')
  amend(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.amend(user.companyId, user.branchId, user.userId, id, dto ?? {}).then((result) => this.redact(user, result));
  }

  @Post(':id/approve')
  @RequirePermissions('purchases.orders.approve')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.approve(user.companyId, user.userId, id).then((result) => this.redact(user, result));
  }

  @Post(':id/cancel')
  @RequirePermissions('purchases.orders.create')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { reason?: string },
  ) {
    return this.service.cancel(user.companyId, user.userId, id, dto?.reason).then((result) => this.redact(user, result));
  }

  @Post(':id/invoice')
  @RequirePermissions('purchases.orders.read', 'purchases.invoices.create')
  convert(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.service.convertToInvoice(
      user.companyId,
      user.branchId,
      user.userId,
      id,
      dto ?? {},
      canReadCost(user),
    ).then((result) => this.redact(user, result));
  }
}
