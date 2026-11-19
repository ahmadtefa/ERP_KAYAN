import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { warehouseScopeOf } from '../../common/warehouse/warehouse.service';
import { WarehouseAccessService, WarehouseGrantInput } from './warehouse-access.service';

class WarehouseGrantDto implements WarehouseGrantInput {
  @IsString() warehouseId!: string;
  @IsOptional() @IsBoolean() canView?: boolean;
  @IsOptional() @IsBoolean() canReceive?: boolean;
  @IsOptional() @IsBoolean() canIssue?: boolean;
  @IsOptional() @IsBoolean() canTransfer?: boolean;
  @IsOptional() @IsBoolean() canCount?: boolean;
  @IsOptional() @IsBoolean() canApprove?: boolean;
  @IsOptional() @IsBoolean() canSeeCost?: boolean;
}

class SetAccessDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WarehouseGrantDto)
  grants!: WarehouseGrantDto[];
}

/**
 * Per-user warehouse rights.
 *
 * Reading who may enter which shelf is its own permission; changing it is a
 * narrower one still, because this is the control that decides who can post
 * stock into which room.
 */
@Controller('inventory/warehouse-access')
export class WarehouseAccessController {
  constructor(private readonly service: WarehouseAccessService) {}

  @Get(':userId')
  @RequirePermissions('inventory.warehouse.access.read')
  forUser(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.service.forUser(user.companyId, userId, warehouseScopeOf(user));
  }

  @Put(':userId')
  @RequirePermissions('inventory.warehouse.access.manage')
  setForUser(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Body() dto: SetAccessDto,
  ) {
    return this.service.setForUser(
      user.companyId,
      user.userId,
      userId,
      dto.grants ?? [],
      warehouseScopeOf(user),
    );
  }
}
