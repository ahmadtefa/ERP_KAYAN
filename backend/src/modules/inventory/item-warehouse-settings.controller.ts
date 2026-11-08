import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { IsNumber, IsOptional } from 'class-validator';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { assertWarehouseAccess, grantsOf } from '../../common/warehouse/warehouse-access';
import { warehouseScopeOf } from '../../common/warehouse/warehouse.service';
import { ItemWarehouseSettingsService } from './item-warehouse-settings.service';

class ThresholdDto {
  @IsOptional() @IsNumber() minQuantity?: number;
  @IsOptional() @IsNumber() reorderQuantity?: number;
  @IsOptional() @IsNumber() maxQuantity?: number;
}

/**
 * The minimum, reorder point and maximum of one item in one warehouse.
 *
 * These are the numbers the reorder report prints and the notification centre
 * reads at night, so they are managed where the shelf is defined - next to the
 * warehouse - rather than on the item card, which is shared by every store.
 */
@Controller('inventory/item-thresholds')
export class ItemWarehouseSettingsController {
  constructor(private readonly service: ItemWarehouseSettingsService) {}

  @Get()
  @RequirePermissions('inventory.warehouses.read')
  list(
    @CurrentUser() user: AuthUser,
    @Query()
    query: { warehouseId?: string; itemId?: string; belowMinimum?: string },
  ) {
    return this.service.list(
      user.companyId,
      query,
      warehouseScopeOf(user),
      grantsOf(user)?.filter((grant) => grant.canView).map((grant) => grant.warehouseId),
    );
  }

  @Put(':warehouseId/:itemId')
  @RequirePermissions('inventory.warehouses.manage')
  upsert(
    @CurrentUser() user: AuthUser,
    @Param('warehouseId') warehouseId: string,
    @Param('itemId') itemId: string,
    @Body() dto: ThresholdDto,
  ) {
    assertWarehouseAccess(user, warehouseId, 'view');
    return this.service.upsert(
      user.companyId,
      user.userId,
      warehouseId,
      itemId,
      dto,
      warehouseScopeOf(user),
    );
  }
}
