import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RateInput, WithholdingService } from './withholding.service';

@Controller('withholding')
export class WithholdingController {
  constructor(private readonly service: WithholdingService) {}

  @Get('rates')
  @RequirePermissions('withholding.read')
  rates(@CurrentUser() user: AuthUser) {
    return this.service.listRates(user.companyId);
  }

  @Post('rates')
  @RequirePermissions('withholding.manage')
  createRate(@CurrentUser() user: AuthUser, @Body() body: RateInput) {
    return this.service.createRate(user.companyId, user.userId, body);
  }

  @Patch('rates/:id')
  @RequirePermissions('withholding.manage')
  updateRate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: RateInput) {
    return this.service.updateRate(user.companyId, user.userId, id, body);
  }

  @Get('report')
  @RequirePermissions('withholding.read')
  report(@CurrentUser() user: AuthUser, @Query() query: { from?: string; to?: string; direction?: string }) {
    return this.service.report(user.companyId, query);
  }

  @Get('vouchers/:voucherId')
  @RequirePermissions('cash.vouchers.read')
  forVoucher(@CurrentUser() user: AuthUser, @Param('voucherId', ParseUUIDPipe) voucherId: string) {
    return this.service.forVoucher(user.companyId, voucherId);
  }

  @Put('vouchers/:voucherId')
  @RequirePermissions('cash.vouchers.create')
  attach(@CurrentUser() user: AuthUser, @Param('voucherId', ParseUUIDPipe) voucherId: string, @Body() body: { rateId: string }) {
    return this.service.attach(user.companyId, user.userId, voucherId, body?.rateId);
  }

  @Delete('vouchers/:voucherId')
  @RequirePermissions('cash.vouchers.create')
  detach(@CurrentUser() user: AuthUser, @Param('voucherId', ParseUUIDPipe) voucherId: string) {
    return this.service.detach(user.companyId, user.userId, voucherId);
  }
}
