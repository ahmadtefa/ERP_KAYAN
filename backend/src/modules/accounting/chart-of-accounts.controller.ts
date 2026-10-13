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
import {
  CreateAccountDto,
  ListAccountsQueryDto,
  UpdateAccountDto,
} from './dto/account.dto';
import { ChartOfAccountsService } from './chart-of-accounts.service';

/// The chart of accounts: every depth, every rule enforced on the server.
@Controller('accounting/chart-of-accounts')
export class ChartOfAccountsController {
  constructor(private readonly service: ChartOfAccountsService) {}

  @Get()
  @RequirePermissions('accounting.accounts.read')
  findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: ListAccountsQueryDto,
  ) {
    // The company comes from the verified token, never from a query
    // parameter, so a caller cannot request another company's data.
    return this.service.findAll(user.companyId, query);
  }

  /// The next free code under a parent. Declared before `:id` so the path
  /// segment is not read as an account id.
  @Get('suggest-code')
  @RequirePermissions('accounting.accounts.read')
  suggestCode(@CurrentUser() user: AuthUser, @Query('parentId') parentId?: string) {
    return this.service.suggestCode(user.companyId, parentId || null);
  }

  @Get(':id')
  @RequirePermissions('accounting.accounts.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }

  @Post()
  @RequirePermissions('accounting.accounts.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAccountDto) {
    return this.service.create(user.companyId, user.userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('accounting.accounts.update')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.service.update(user.companyId, user.userId, id, dto);
  }

  /// Desktop activation endpoints (same permission as editing an account).
  @Post(':id/deactivate')
  @RequirePermissions('accounting.accounts.update')
  deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.update(user.companyId, user.userId, id, { isActive: false });
  }

  @Post(':id/activate')
  @RequirePermissions('accounting.accounts.update')
  activate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.update(user.companyId, user.userId, id, { isActive: true });
  }

  @Delete(':id')
  @RequirePermissions('accounting.accounts.delete')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.service.remove(user.companyId, user.userId, id);
    return { deleted: true };
  }
}
