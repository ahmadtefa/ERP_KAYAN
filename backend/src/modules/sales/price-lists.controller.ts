import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';

import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PriceListsService } from './price-lists.service';

/**
 * Agreed prices.
 *
 * Reading needs `parties.customers.read` (a price list is customer master
 * data); changing one needs `sales.pricelists.manage`, which a role that may
 * post a sales invoice already holds.
 */
@Controller('sales/price-lists')
export class PriceListsController {
  constructor(private readonly service: PriceListsService) {}

  @Get()
  @RequirePermissions('parties.customers.read')
  findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: { includeInactive?: string },
  ) {
    return this.service.findAll(user.companyId, {
      includeInactive: query.includeInactive === 'true',
    });
  }

  @Get(':id')
  @RequirePermissions('parties.customers.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }

  @Post()
  @RequirePermissions('sales.pricelists.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.service.create(user.companyId, user.userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('sales.pricelists.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.service.update(user.companyId, user.userId, id, dto);
  }

  @Post(':id/deactivate')
  @RequirePermissions('sales.pricelists.manage')
  deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.deactivate(user.companyId, user.userId, id);
  }

  @Post(':id/items')
  @RequirePermissions('sales.pricelists.manage')
  setItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.service.setItem(user.companyId, user.userId, id, dto);
  }

  @Delete(':id/items/:itemId')
  @RequirePermissions('sales.pricelists.manage')
  removeItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Query() query: { unit?: string },
  ) {
    return this.service.removeItem(user.companyId, user.userId, id, itemId, query.unit);
  }

  @Post(':id/assign')
  @RequirePermissions('sales.pricelists.manage')
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.service.assign(user.companyId, user.userId, id, dto);
  }
}
