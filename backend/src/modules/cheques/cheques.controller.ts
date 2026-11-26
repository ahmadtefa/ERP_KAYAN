import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';

import { branchReadScope } from '../../common/auth/branch-read-scope';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ChequeAction } from './cheque-rules';
import { ChequesService, CreateChequeInput } from './cheques.service';

const mayReadCash = (user: AuthUser) => user.isSuperAdmin || (user.permissions ?? []).includes('cash.accounts.read');

@Controller('cheques')
export class ChequesController {
  constructor(private readonly cheques: ChequesService) {}

  @Get()
  @RequirePermissions('cheques.read')
  list(@CurrentUser() user: AuthUser, @Query() query: { direction?: string; status?: string; dueBefore?: string }) {
    return this.cheques.list(user.companyId, { ...query, branchScope: branchReadScope(user) });
  }

  @Get(':id')
  @RequirePermissions('cheques.read')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.cheques.findOne(user.companyId, id);
  }

  @Post()
  @RequirePermissions('cheques.create')
  create(@CurrentUser() user: AuthUser, @Body() body: CreateChequeInput) {
    return this.cheques.create(user.companyId, user.branchId, user.userId, body);
  }

  private act(user: AuthUser, id: string, action: ChequeAction, body: { note?: string; date?: string; cashAccountId?: string }) {
    return this.cheques.act(user.companyId, user.userId, user.branchId, id, action, body ?? {}, { discloseBalance: mayReadCash(user) });
  }

  @Post(':id/deposit')
  @RequirePermissions('cheques.manage')
  deposit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { note?: string; cashAccountId?: string }) {
    return this.act(user, id, 'deposit', body);
  }

  @Post(':id/collect')
  @RequirePermissions('cheques.manage')
  collect(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { note?: string; date?: string; cashAccountId?: string }) {
    return this.act(user, id, 'collect', body);
  }

  @Post(':id/bounce')
  @RequirePermissions('cheques.manage')
  bounce(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { note?: string }) {
    return this.act(user, id, 'bounce', body);
  }

  @Post(':id/represent')
  @RequirePermissions('cheques.manage')
  represent(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { note?: string }) {
    return this.act(user, id, 'represent', body);
  }

  @Post(':id/cancel')
  @RequirePermissions('cheques.manage')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { note?: string }) {
    return this.act(user, id, 'cancel', body);
  }
}
