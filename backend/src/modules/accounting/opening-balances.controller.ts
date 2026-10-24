import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { OpeningBalancesService } from './opening-balances.service';

/// Opening balances: the figures the books start with, as a document that has
/// to balance and that posts both the accounting and the stock.
@Controller('accounting/opening-balances')
export class OpeningBalancesController {
  constructor(private readonly service: OpeningBalancesService) {}

  @Get()
  @RequirePermissions('accounting.openingbalances.read')
  findAll(@CurrentUser() user: AuthUser) {
    return this.service.findAll(user.companyId);
  }

  @Get(':id')
  @RequirePermissions('accounting.openingbalances.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }

  @Post()
  @RequirePermissions('accounting.openingbalances.manage')
  create(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.service.create(user.companyId, user.branchId, user.userId, body as never);
  }

  @Post(':id/post')
  @RequirePermissions('accounting.openingbalances.manage')
  post(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.post(user.companyId, user.userId, id);
  }

  @Post(':id/reverse')
  @RequirePermissions('accounting.openingbalances.manage')
  reverse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reverse(user.companyId, user.userId, id);
  }
}
