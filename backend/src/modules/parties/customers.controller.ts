import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateCustomerDto,
  ListPartiesDto,
  UpdateCustomerDto,
} from './dto/party.dto';
import { PartiesService } from './parties.service';

@Controller('parties/customers')
export class CustomersController {
  constructor(private readonly service: PartiesService) {}

  @Get()
  @RequirePermissions('parties.customers.read')
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListPartiesDto) {
    return this.service.findAll(user.companyId, 'customer', query);
  }

  // Declared before ':id' so 'summary' is never read as an identifier.
  @Get('summary/:id')
  @RequirePermissions('parties.customers.read')
  summary(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.summary(user.companyId, 'customer', id);
  }

  @Get('statement/:id')
  @RequirePermissions('parties.customers.read')
  statement(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.statement(user.companyId, 'customer', id, { from, to });
  }

  @Get(':id')
  @RequirePermissions('parties.customers.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, 'customer', id);
  }

  @Post()
  @RequirePermissions('parties.customers.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomerDto) {
    return this.service.create(user.companyId, user.userId, 'customer', dto);
  }

  @Patch(':id')
  @RequirePermissions('parties.customers.update')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.service.update(user.companyId, user.userId, 'customer', id, dto);
  }

  @Post(':id/deactivate')
  @RequirePermissions('parties.customers.update')
  deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.deactivate(user.companyId, user.userId, 'customer', id);
  }
}
