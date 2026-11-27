import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { SerialsService } from './serials.service';

@Controller('serials')
export class SerialsController {
  constructor(private readonly serials: SerialsService) {}

  @Get()
  @RequirePermissions('serials.read')
  list(@CurrentUser() user: AuthUser, @Query() query: { itemId?: string; status?: string; q?: string; warrantyEndingInDays?: string }) {
    return this.serials.list(user.companyId, query);
  }

  @Get('lookup')
  @RequirePermissions('serials.read')
  lookup(@CurrentUser() user: AuthUser, @Query('serial') serial: string) {
    return this.serials.lookup(user.companyId, serial);
  }

  @Get('unassigned')
  @RequirePermissions('serials.read')
  unassigned(@CurrentUser() user: AuthUser, @Query() query: { from?: string; to?: string }) {
    return this.serials.unassigned(user.companyId, query);
  }

  @Post('register')
  @RequirePermissions('serials.manage')
  register(@CurrentUser() user: AuthUser, @Body() body: { itemId?: string; warehouseId?: string; serials?: unknown; warrantyMonths?: unknown; reference?: string }) {
    return this.serials.register(user.companyId, user.userId, body ?? {});
  }

  @Post('sell')
  @RequirePermissions('serials.manage')
  sell(@CurrentUser() user: AuthUser, @Body() body: { salesInvoiceId?: string; itemId?: string; serials?: unknown; warrantyMonths?: unknown }) {
    return this.serials.sell(user.companyId, user.userId, body ?? {});
  }

  @Post(':id/return')
  @RequirePermissions('serials.manage')
  giveBack(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { note?: string }) {
    return this.serials.act(user.companyId, user.userId, id, 'return', body ?? {});
  }

  @Post(':id/scrap')
  @RequirePermissions('serials.manage')
  scrap(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { note?: string }) {
    return this.serials.act(user.companyId, user.userId, id, 'scrap', body ?? {});
  }
}
