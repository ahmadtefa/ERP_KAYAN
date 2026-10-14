import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
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

  @Get()
  @RequirePermissions('purchases.orders.read')
  findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: { supplierId?: string; status?: string; from?: string; to?: string },
  ) {
    return this.service.findAll(user.companyId, query);
  }

  @Get(':id')
  @RequirePermissions('purchases.orders.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }

  @Post()
  @RequirePermissions('purchases.orders.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.service.create(user.companyId, user.branchId, user.userId, dto);
  }

  @Post(':id/approve')
  @RequirePermissions('purchases.orders.approve')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.approve(user.companyId, user.userId, id);
  }

  @Post(':id/cancel')
  @RequirePermissions('purchases.orders.create')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { reason?: string },
  ) {
    return this.service.cancel(user.companyId, user.userId, id, dto?.reason);
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
    );
  }
}
