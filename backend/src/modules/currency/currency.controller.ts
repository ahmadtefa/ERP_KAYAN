import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrencyInput, CurrencyService, RateInput } from './currency.service';

@Controller('currencies')
export class CurrencyController {
  constructor(private readonly service: CurrencyService) {}

  @Get()
  @RequirePermissions('currency.read')
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.companyId);
  }

  @Post()
  @RequirePermissions('currency.manage')
  create(@CurrentUser() user: AuthUser, @Body() body: CurrencyInput) {
    return this.service.create(user.companyId, user.userId, body);
  }

  @Patch(':code')
  @RequirePermissions('currency.manage')
  update(@CurrentUser() user: AuthUser, @Param('code') code: string, @Body() body: CurrencyInput) {
    return this.service.update(user.companyId, user.userId, code, body);
  }

  @Get(':code/rates')
  @RequirePermissions('currency.read')
  rates(@CurrentUser() user: AuthUser, @Param('code') code: string, @Query() query: { limit?: string }) {
    return this.service.listRates(user.companyId, code, query?.limit);
  }

  @Get(':code/rate')
  @RequirePermissions('currency.read')
  rateOn(@CurrentUser() user: AuthUser, @Param('code') code: string, @Query() query: { date?: string }) {
    return this.service.rateOn(user.companyId, code, query?.date);
  }

  @Post(':code/rates')
  @RequirePermissions('currency.rates.manage')
  setRate(@CurrentUser() user: AuthUser, @Param('code') code: string, @Body() body: RateInput) {
    return this.service.setRate(user.companyId, user.userId, code, body);
  }
}
