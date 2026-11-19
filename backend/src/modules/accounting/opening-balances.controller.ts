import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post } from '@nestjs/common';
import { canReadCost } from '../../common/auth/cost-visibility';
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
    return this.service.findAll(user.companyId, canReadCost(user));
  }

  @Get(':id')
  @RequirePermissions('accounting.openingbalances.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id, canReadCost(user));
  }

  @Post()
  @RequirePermissions('accounting.openingbalances.manage')
  create(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    this.assertDraftInput(user, body);
    return this.service.create(user.companyId, user.branchId, user.userId, body as never);
  }

  @Patch(':id')
  @RequirePermissions('accounting.openingbalances.manage')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    this.assertDraftInput(user, body);
    return this.service.create(user.companyId, user.branchId, user.userId, body as never, id, canReadCost(user));
  }

  @Delete(':id')
  @RequirePermissions('accounting.openingbalances.manage')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removeDraft(user.companyId, user.userId, id, user.isSuperAdmin ? undefined : user.branchId, canReadCost(user));
  }

  private assertDraftInput(user: AuthUser, body: Record<string, unknown>) {
    if (!user.isSuperAdmin && body.branchId !== undefined && body.branchId !== user.branchId) {
      throw new ForbiddenException('You cannot change opening balances for another branch');
    }
    if (body.currency !== undefined && typeof body.currency !== 'string') {
      throw new BadRequestException('Opening balance currency must be a currency code');
    }
    if (!canReadCost(user) && Array.isArray(body.lines) && body.lines.some(line => line?.itemId)) {
      throw new ForbiddenException('Stock opening balances require inventory cost permission');
    }
  }

  @Post(':id/post')
  @RequirePermissions('accounting.openingbalances.manage')
  post(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.post(user.companyId, user.userId, id, user.isSuperAdmin ? undefined : user.branchId, canReadCost(user));
  }

  @Post(':id/reverse')
  @RequirePermissions('accounting.openingbalances.manage')
  reverse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reverse(user.companyId, user.userId, id, user.isSuperAdmin ? undefined : user.branchId, canReadCost(user));
  }
}
