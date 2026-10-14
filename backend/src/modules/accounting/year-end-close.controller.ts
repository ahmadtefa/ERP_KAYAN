import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { YearEndCloseService } from './year-end-close.service';

/// Closing a year: see what it would do (preview), then do it once.
@Controller('accounting/fiscal-periods')
export class YearEndCloseController {
  constructor(private readonly service: YearEndCloseService) {}

  @Get(':id/closing-preview')
  @RequirePermissions('accounting.periods.read')
  preview(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.preview(user.companyId, id);
  }

  @Post(':id/close-year')
  @RequirePermissions('accounting.periods.close')
  close(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.service.close(user.companyId, user.userId, id, body?.reason);
  }
}
