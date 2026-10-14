import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { SalesOrdersService } from './sales-orders.service';

/**
 * Sales orders: raising one needs `sales.orders.create`, approving it
 * needs `sales.orders.approve`, and turning it into an invoice is the
 * invoice service's business - which is why the conversion asks for
 * `sales.invoices.create` as well as read access to the order.
 */
@Controller('sales/orders')
export class SalesOrdersController {
  constructor(private readonly service: SalesOrdersService) {}

  @Get()
  @RequirePermissions('sales.orders.read')
  findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: { customerId?: string; status?: string; from?: string; to?: string },
  ) {
    return this.service.findAll(user.companyId, query);
  }

  @Get(':id')
  @RequirePermissions('sales.orders.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }

  @Post()
  @RequirePermissions('sales.orders.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.service.create(user.companyId, user.branchId, user.userId, dto);
  }

  @Post(':id/approve')
  @RequirePermissions('sales.orders.approve')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.approve(user.companyId, user.userId, id);
  }

  @Post(':id/cancel')
  @RequirePermissions('sales.orders.create')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { reason?: string },
  ) {
    return this.service.cancel(user.companyId, user.userId, id, dto?.reason);
  }

  @Post(':id/invoice')
  @RequirePermissions('sales.orders.read', 'sales.invoices.create')
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
