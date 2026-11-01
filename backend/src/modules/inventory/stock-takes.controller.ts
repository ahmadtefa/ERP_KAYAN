import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { warehouseScopeOf } from '../../common/warehouse/warehouse.service';
import { StockTakesService } from './stock-takes.service';

class StartStockTakeDto {
  @IsString() warehouseId!: string;
  @IsOptional() @IsIn(['FULL', 'PARTIAL']) scope?: 'FULL' | 'PARTIAL';
  @IsOptional() @IsArray() @IsString({ each: true }) itemIds?: string[];
  @IsOptional() @IsString() notes?: string;
}

class CountedLineDto {
  @IsString() lineId!: string;
  @IsNumber() countedQuantity!: number;
  @IsOptional() @IsString() notes?: string;
}

class RecordStockTakeDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CountedLineDto)
  lines!: CountedLineDto[];
  @IsOptional() @IsBoolean() finish?: boolean;
}

/**
 * Counting, and the approval that makes a difference real.
 *
 * Reading a count, counting it and approving its difference are three
 * different permissions: the clerk who walks the shelves is not the person who
 * signs off the loss.
 */
@Controller('inventory/stock-takes')
export class StockTakesController {
  constructor(private readonly service: StockTakesService) {}

  @Get()
  @RequirePermissions('inventory.stocktake.read')
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: { status?: string; warehouseId?: string; page?: string; pageSize?: string },
  ) {
    return this.service.list(
      user.companyId,
      {
        status: query.status,
        warehouseId: query.warehouseId,
        page: query.page ? Number(query.page) : undefined,
        pageSize: query.pageSize ? Number(query.pageSize) : undefined,
      },
      warehouseScopeOf(user),
    );
  }

  @Get(':id')
  @RequirePermissions('inventory.stocktake.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id, warehouseScopeOf(user));
  }

  @Post()
  @RequirePermissions('inventory.stocktake.create')
  start(@CurrentUser() user: AuthUser, @Body() dto: StartStockTakeDto) {
    return this.service.start(
      user.companyId,
      user.userId,
      { ...dto, branchId: user.branchId ?? null },
      warehouseScopeOf(user),
    );
  }

  @Post(':id/count')
  @RequirePermissions('inventory.stocktake.count')
  record(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RecordStockTakeDto,
  ) {
    return this.service.record(user.companyId, user.userId, id, dto, warehouseScopeOf(user));
  }

  @Post(':id/approve')
  @RequirePermissions('inventory.stocktake.approve')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.approve(user.companyId, user.userId, id, warehouseScopeOf(user));
  }

  @Post(':id/post')
  @RequirePermissions('inventory.stocktake.post')
  post(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.post(user.companyId, user.userId, id, warehouseScopeOf(user));
  }

  @Post(':id/cancel')
  @RequirePermissions('inventory.stocktake.create')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { reason?: string },
  ) {
    return this.service.cancel(
      user.companyId,
      user.userId,
      id,
      dto?.reason,
      warehouseScopeOf(user),
    );
  }
}
