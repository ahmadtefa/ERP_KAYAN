import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CommissionsService } from './commissions.service';

@Controller('commissions')
export class CommissionsController {
  constructor(private readonly commissions: CommissionsService) {}

  @Get('reps')
  @RequirePermissions('commissions.read')
  reps(@CurrentUser() user: AuthUser) {
    return this.commissions.listReps(user.companyId);
  }

  @Post('reps')
  @RequirePermissions('commissions.manage')
  createRep(@CurrentUser() user: AuthUser, @Body() body: { nameEn?: string; nameAr?: string; ratePercent?: unknown }) {
    return this.commissions.createRep(user.companyId, user.userId, body ?? {});
  }

  @Put('reps/:id')
  @RequirePermissions('commissions.manage')
  updateRep(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { nameEn?: string; nameAr?: string; ratePercent?: unknown; active?: boolean }) {
    return this.commissions.updateRep(user.companyId, user.userId, id, body ?? {});
  }

  @Get('entries')
  @RequirePermissions('commissions.read')
  entries(@CurrentUser() user: AuthUser, @Query() query: { repId?: string; status?: string; from?: string; to?: string }) {
    return this.commissions.listEntries(user.companyId, query);
  }

  @Get('unassigned')
  @RequirePermissions('commissions.read')
  unassigned(@CurrentUser() user: AuthUser, @Query() query: { from?: string; to?: string }) {
    return this.commissions.unassigned(user.companyId, query);
  }

  @Post('assign')
  @RequirePermissions('commissions.manage')
  assign(@CurrentUser() user: AuthUser, @Body() body: { salesInvoiceId?: string; repId?: string }) {
    return this.commissions.assign(user.companyId, user.userId, body ?? {});
  }

  @Delete('entries/:id')
  @RequirePermissions('commissions.manage')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.commissions.removeEntry(user.companyId, user.userId, id);
  }

  @Get('payouts')
  @RequirePermissions('commissions.read')
  payouts(@CurrentUser() user: AuthUser, @Query('repId') repId?: string) {
    return this.commissions.listPayouts(user.companyId, repId);
  }

  @Post('payouts')
  @RequirePermissions('commissions.manage')
  pay(@CurrentUser() user: AuthUser, @Body() body: { repId?: string; from?: string; to?: string; note?: string; expenseAccountId?: string; fundingAccountId?: string }) {
    return this.commissions.payout(user.companyId, user.userId, user.branchId, body ?? {});
  }
}
