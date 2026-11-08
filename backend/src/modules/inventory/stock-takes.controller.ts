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
import { canReadCost } from '../../common/auth/cost-visibility';
import { assertWarehouseAccess, grantsOf } from '../../common/warehouse/warehouse-access';
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
      grantsOf(user)?.filter((grant) => grant.canView).map((grant) => grant.warehouseId),
    );
  }

  @Get(':id')
  @RequirePermissions('inventory.stocktake.read')
  async findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const take = await this.assertTakeAccess(user, id, 'view');
    return this.redactCosts(user, take.warehouseId, take);
  }

  @Post()
  @RequirePermissions('inventory.stocktake.create')
  start(@CurrentUser() user: AuthUser, @Body() dto: StartStockTakeDto) {
    assertWarehouseAccess(user, dto.warehouseId, 'count');
    return this.service.start(
      user.companyId,
      user.userId,
      { ...dto, branchId: user.branchId ?? null },
      warehouseScopeOf(user),
    ).then((result) => this.redactCosts(user, dto.warehouseId, result));
  }

  /// A count is opened for one shelf, so counting it - and approving what was
  /// counted there - needs the grant for that same shelf. Without this the
  /// access screen would decide what a person may *read* and nothing else.
  private redactCosts(user: AuthUser, warehouseId: string | undefined, result: unknown): unknown {
    const grants = grantsOf(user);
    const mayRead = canReadCost(user) && (
      grants === null ||
      grants.some((grant) => grant.warehouseId === warehouseId && grant.canSeeCost)
    );
    if (mayRead) return result;
    const hide = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(hide);
      if (value === null || typeof value !== 'object') return value;
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key]) => key !== 'unitCost' && key !== 'varianceValue')
          .map(([key, child]) => [key, hide(child)]),
      );
    };
    return hide(result);
  }

  private async assertTakeAccess(
    user: AuthUser,
    id: string,
    action: 'view' | 'count' | 'approve',
  ): Promise<{ warehouseId?: string } & Record<string, unknown>> {
    const take = await this.service.findOne(user.companyId, id, warehouseScopeOf(user));
    assertWarehouseAccess(user, (take as { warehouseId?: string } | null)?.warehouseId, action);
    return take as { warehouseId?: string } & Record<string, unknown>;
  }

  @Post(':id/count')
  @RequirePermissions('inventory.stocktake.count')
  async record(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RecordStockTakeDto,
  ) {
    const take = await this.assertTakeAccess(user, id, 'count');
    const result = await this.service.record(user.companyId, user.userId, id, dto, warehouseScopeOf(user));
    return this.redactCosts(user, take.warehouseId, result);
  }

  @Post(':id/approve')
  @RequirePermissions('inventory.stocktake.approve')
  async approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const take = await this.assertTakeAccess(user, id, 'approve');
    const result = await this.service.approve(user.companyId, user.userId, id, warehouseScopeOf(user));
    return this.redactCosts(user, take.warehouseId, result);
  }

  @Post(':id/post')
  @RequirePermissions('inventory.stocktake.post')
  async post(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const take = await this.assertTakeAccess(user, id, 'approve');
    const result = await this.service.post(user.companyId, user.userId, id, warehouseScopeOf(user));
    return this.redactCosts(user, take.warehouseId, result);
  }

  @Post(':id/cancel')
  @RequirePermissions('inventory.stocktake.create')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { reason?: string },
  ) {
    const take = await this.assertTakeAccess(user, id, 'count');
    const result = await this.service.cancel(
      user.companyId,
      user.userId,
      id,
      dto?.reason,
      warehouseScopeOf(user),
    );
    return this.redactCosts(user, take.warehouseId, result);
  }
}
