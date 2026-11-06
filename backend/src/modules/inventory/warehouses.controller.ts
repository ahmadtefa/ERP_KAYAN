import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';

import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { WarehouseService } from '../../common/warehouse/warehouse.service';

/**
 * The warehouses of a company, and what each one holds.
 *
 * Reading needs `inventory.warehouses.read`; changing needs
 * `inventory.warehouses.manage`, which a role that may edit items already
 * holds - naming where goods are kept is part of keeping them.
 */
@Controller('inventory/warehouses')
export class WarehousesController {
  constructor(private readonly service: WarehouseService) {}

  @Get()
  @RequirePermissions('inventory.warehouses.read')
  findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: { branchId?: string; includeInactive?: string },
  ) {
    return this.service.findAll(user.companyId, {
      branchId: query.branchId,
      includeInactive: query.includeInactive === 'true',
    });
  }

  @Get(':id')
  @RequirePermissions('inventory.warehouses.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }

  /** What this warehouse holds today, or on a given date. */
  @Get(':id/stock')
  @RequirePermissions('inventory.warehouses.read')
  stock(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: { asOf?: string; itemId?: string },
  ) {
    return this.service.stock(user.companyId, id, query);
  }

  @Post()
  @RequirePermissions('inventory.warehouses.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.service.create(user.companyId, user.userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('inventory.warehouses.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.service.update(user.companyId, user.userId, id, dto);
  }

  @Post(':id/deactivate')
  @RequirePermissions('inventory.warehouses.manage')
  deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.deactivate(user.companyId, user.userId, id);
  }

  // --- Locations / Bins / Racks ---

  @Get(':id/locations')
  @RequirePermissions('inventory.warehouses.read')
  findLocations(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findLocations(user.companyId, id);
  }

  @Post(':id/locations')
  @RequirePermissions('inventory.warehouses.manage')
  createLocation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.service.createLocation(user.companyId, user.userId, id, dto);
  }

  @Patch(':id/locations/:locId')
  @RequirePermissions('inventory.warehouses.manage')
  updateLocation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('locId') locId: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.service.updateLocation(user.companyId, user.userId, id, locId, dto);
  }

  @Delete(':id/locations/:locId')
  @RequirePermissions('inventory.warehouses.manage')
  deleteLocation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('locId') locId: string,
  ) {
    return this.service.deleteLocation(user.companyId, user.userId, id, locId);
  }

  // --- Item Warehouse Settings (Min / Max / Reorder) ---

  @Get(':id/items/settings')
  @RequirePermissions('inventory.warehouses.read')
  getItemSettings(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('itemId') itemId?: string,
  ) {
    return this.service.getItemSettings(user.companyId, id, itemId);
  }

  @Put(':id/items/:itemId/settings')
  @RequirePermissions('inventory.warehouses.manage')
  upsertItemSetting(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.service.upsertItemSetting(user.companyId, user.userId, id, itemId, dto);
  }

  // --- User Warehouse Access ---

  @Get(':id/access')
  @RequirePermissions('inventory.warehouses.read')
  getUserAccess(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getUserAccess(user.companyId, id);
  }

  @Put(':id/access/:userId')
  @RequirePermissions('inventory.warehouses.manage')
  setUserAccess(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.service.setUserAccess(
      user.companyId,
      user.userId,
      id,
      targetUserId,
      dto,
    );
  }
}
