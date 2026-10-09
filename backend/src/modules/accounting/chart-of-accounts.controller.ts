import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { CreateExpenseAccountDto, UpdateExpenseAccountDto } from './dto/expense-account.dto';

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

  @Post()
  @RequirePermissions('accounting.accounts.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateExpenseAccountDto) {
    return this.service.createExpenseAccount(user.companyId, user.userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('accounting.accounts.update')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateExpenseAccountDto) {
    return this.service.updateExpenseAccount(user.companyId, user.userId, id, dto);
  }

  @Post(':id/deactivate')
  @RequirePermissions('accounting.accounts.update')
  deactivate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.setExpenseAccountActive(user.companyId, user.userId, id, false);
  }

  @Post(':id/activate')
  @RequirePermissions('accounting.accounts.update')
  activate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.setExpenseAccountActive(user.companyId, user.userId, id, true);
  }
}
