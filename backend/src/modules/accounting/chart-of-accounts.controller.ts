import { Controller, Get } from '@nestjs/common';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ChartOfAccountsService } from './chart-of-accounts.service';

@Controller('accounting/chart-of-accounts')
export class ChartOfAccountsController {
  constructor(private readonly service: ChartOfAccountsService) {}

  @Get()
  @RequirePermissions('accounting.accounts.read')
  findAll(@CurrentUser() user: AuthUser) {
    // The company comes from the verified token, never from a query
    // parameter, so a caller cannot request another company's data.
    return this.service.findAll(user.companyId);
  }
}
