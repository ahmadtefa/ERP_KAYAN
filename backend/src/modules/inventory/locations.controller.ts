import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { assertWarehouseAccess, grantsOf } from '../../common/warehouse/warehouse-access';
import { warehouseScopeOf } from '../../common/warehouse/warehouse.service';
import { LocationInput, StorageLocationsService } from './storage-locations.service';

class LocationDto implements LocationInput {
  @IsString() warehouseId!: string;
  @IsOptional() @IsString() parentId?: string | null;
  @IsOptional() @IsIn(['ZONE', 'AISLE', 'RACK', 'SHELF', 'BIN']) kind?: string;
  @IsString() code!: string;
  @IsString() nameEn!: string;
  @IsString() nameAr!: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class MoveStockDto {
  @IsString() fromLocationId!: string;
  @IsString() toLocationId!: string;
  @IsString() itemId!: string;
  @IsOptional() @IsString() batchId?: string | null;
  @IsOptional() quantity!: number | string;
  @IsOptional() @IsString() reason?: string | null;
}

/**
 * Where inside the warehouse the goods are.
 *
 * Zones contain aisles, aisles contain racks, racks carry shelves, shelves
 * carry bins - or any shorter chain that matches how the building is actually
 * arranged. A move between two of them changes no total: it changes the
 * answer to "where is it?".
 */
@Controller('inventory/locations')
export class StorageLocationsController {
  constructor(private readonly service: StorageLocationsService) {}

  @Get()
  @RequirePermissions('inventory.warehouses.read')
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: { warehouseId?: string; parentId?: string; rootsOnly?: string },
  ) {
    return this.service.list(
      user.companyId,
      {
        warehouseId: query.warehouseId,
        parentId: query.rootsOnly === 'true' ? null : query.parentId,
      },
      warehouseScopeOf(user),
      grantsOf(user)?.filter((grant) => grant.canView).map((grant) => grant.warehouseId),
    );
  }

  @Get('tree/:warehouseId')
  @RequirePermissions('inventory.warehouses.read')
  tree(@CurrentUser() user: AuthUser, @Param('warehouseId') warehouseId: string) {
    assertWarehouseAccess(user, warehouseId, 'view');
    return this.service.tree(
      user.companyId,
      warehouseId,
      warehouseScopeOf(user),
      grantsOf(user)?.filter((grant) => grant.canView).map((grant) => grant.warehouseId),
    );
  }

  @Post()
  @RequirePermissions('inventory.warehouses.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: LocationDto) {
    assertWarehouseAccess(user, dto.warehouseId, 'view');
    return this.service.create(
      user.companyId,
      user.userId,
      dto,
      warehouseScopeOf(user),
      grantsOf(user)?.filter((grant) => grant.canView).map((grant) => grant.warehouseId),
    );
  }

  @Post('move-stock')
  @RequirePermissions('inventory.stock.adjust')
  moveStock(@CurrentUser() user: AuthUser, @Body() dto: MoveStockDto) {
    return this.service.move(
      user.companyId,
      user.userId,
      dto,
      warehouseScopeOf(user),
      grantsOf(user)?.filter((grant) => grant.canView).map((grant) => grant.warehouseId),
      grantsOf(user)?.filter((grant) => grant.canTransfer).map((grant) => grant.warehouseId),
    );
  }

  @Patch(':id')
  @RequirePermissions('inventory.warehouses.manage')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: Partial<LocationDto>) {
    return this.service.update(
      user.companyId,
      user.userId,
      id,
      dto,
      warehouseScopeOf(user),
      grantsOf(user)?.filter((grant) => grant.canView).map((grant) => grant.warehouseId),
    );
  }

  @Delete(':id')
  @RequirePermissions('inventory.warehouses.manage')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(
      user.companyId,
      user.userId,
      id,
      warehouseScopeOf(user),
      grantsOf(user)?.filter((grant) => grant.canView).map((grant) => grant.warehouseId),
    );
  }
}
