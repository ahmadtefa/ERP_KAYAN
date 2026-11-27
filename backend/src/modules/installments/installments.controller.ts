import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { InstallmentsService } from './installments.service';

@Controller('installments')
export class InstallmentsController {
  constructor(private readonly installments: InstallmentsService) {}

  @Get('plans')
  @RequirePermissions('installments.read')
  plans(@CurrentUser() user: AuthUser, @Query() query: { status?: string }) {
    return this.installments.listPlans(user.companyId, query);
  }

  @Get('overdue')
  @RequirePermissions('installments.read')
  overdue(@CurrentUser() user: AuthUser) {
    return this.installments.overdue(user.companyId);
  }

  @Get('invoices/:invoiceId')
  @RequirePermissions('installments.read')
  forInvoice(@CurrentUser() user: AuthUser, @Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    return this.installments.forInvoice(user.companyId, invoiceId);
  }

  @Put('invoices/:invoiceId')
  @RequirePermissions('installments.manage')
  save(
    @CurrentUser() user: AuthUser,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() body: { downPayment?: unknown; count?: unknown; intervalMonths?: unknown; firstDue?: string },
  ) {
    return this.installments.save(user.companyId, user.userId, invoiceId, body ?? {});
  }

  @Delete('invoices/:invoiceId')
  @RequirePermissions('installments.manage')
  remove(@CurrentUser() user: AuthUser, @Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    return this.installments.remove(user.companyId, user.userId, invoiceId);
  }
}
