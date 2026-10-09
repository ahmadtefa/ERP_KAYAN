import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreatePartyDto, ListPartiesDto, UpdatePartyDto } from './dto/party.dto';
import { PartiesService } from './parties.service';

@Controller('parties/suppliers')
export class SuppliersController {
  constructor(private readonly service: PartiesService) {}

  @Get()
  @RequirePermissions('parties.suppliers.read')
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListPartiesDto) {
    return this.service.findAll(user.companyId, 'supplier', query);
  }

  @Get(':id')
  @RequirePermissions('parties.suppliers.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, 'supplier', id);
  }

  @Post()
  @RequirePermissions('parties.suppliers.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePartyDto) {
    return this.service.create(user.companyId, user.userId, 'supplier', dto);
  }

  @Patch(':id')
  @RequirePermissions('parties.suppliers.update')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePartyDto,
  ) {
    return this.service.update(user.companyId, user.userId, 'supplier', id, dto);
  }

  @Post(':id/deactivate')
  @RequirePermissions('parties.suppliers.update')
  deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.deactivate(user.companyId, user.userId, 'supplier', id);
  }
}
