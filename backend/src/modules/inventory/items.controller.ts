import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateItemDto, ListItemsDto, UpdateItemDto } from './dto/item.dto';
import { ItemsService } from './items.service';

@Controller('inventory/items')
export class ItemsController {
  constructor(private readonly service: ItemsService) {}

  @Get()
  @RequirePermissions('inventory.items.read')
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListItemsDto) {
    return this.service.findAll(user.companyId, query);
  }

  @Get(':id')
  @RequirePermissions('inventory.items.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }

  @Post()
  @RequirePermissions('inventory.items.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateItemDto) {
    return this.service.create(user.companyId, user.userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('inventory.items.update')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
  ) {
    return this.service.update(user.companyId, user.userId, id, dto);
  }

  @Post(':id/deactivate')
  @RequirePermissions('inventory.items.update')
  deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.deactivate(user.companyId, user.userId, id);
  }
}
