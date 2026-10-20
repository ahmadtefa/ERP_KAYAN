import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { BudgetsService } from './budgets.service';

/// Budget definitions: a plan per cost centre, account and period.
///
/// Reading is separate from writing, so a manager can be shown the plan
/// without being able to rewrite it. The comparison with actuals lives under
/// `/reports/budgets`, because it reads the ledger.
@Controller('accounting/budgets')
export class BudgetsController {
  constructor(private readonly service: BudgetsService) {}

  @Get()
  @RequirePermissions('accounting.budgets.read')
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('includeInactive') includeInactive?: string,
    @Query('costCenterId') costCenterId?: string,
    @Query('accountId') accountId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.findAll(user.companyId, {
      includeInactive: includeInactive === 'true',
      costCenterId,
      accountId,
      from,
      to,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions('accounting.budgets.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }

  @Post()
  @RequirePermissions('accounting.budgets.manage')
  create(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.service.create(user.companyId, user.userId, body);
  }

  @Patch(':id')
  @RequirePermissions('accounting.budgets.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.update(user.companyId, user.userId, id, body);
  }

  /// Retires a budget. It is never deleted, so a report that once compared it
  /// can still be reproduced.
  @Delete(':id')
  @RequirePermissions('accounting.budgets.manage')
  retire(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.retire(user.companyId, user.userId, id);
  }
}
