import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateJournalEntryDto,
  ListJournalEntriesDto,
} from './dto/create-journal-entry.dto';
import { JournalEntriesService } from './journal-entries.service';

@Controller('accounting/journal-entries')
export class JournalEntriesController {
  constructor(private readonly service: JournalEntriesService) {}

  @Get()
  @RequirePermissions('accounting.journal.read')
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListJournalEntriesDto) {
    return this.service.findAll(user.companyId, query.page, query.pageSize);
  }

  @Get(':id')
  @RequirePermissions('accounting.journal.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }

  @Post()
  @RequirePermissions('accounting.journal.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateJournalEntryDto) {
    return this.service.create(
      user.companyId,
      user.branchId,
      user.userId,
      dto,
    );
  }

  @Post(':id/post')
  @RequirePermissions('accounting.journal.post')
  post(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.post(user.companyId, user.userId, id);
  }

  @Post(':id/submit')
  @RequirePermissions('accounting.journal.create')
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.submitForApproval(user.companyId, user.userId, id);
  }

  @Post(':id/approve')
  @RequirePermissions('accounting.journal.approve')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.approve(user.companyId, user.userId, id);
  }

  @Post(':id/cancel')
  @RequirePermissions('accounting.journal.create')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.service.cancel(user.companyId, user.userId, id, body?.reason);
  }

  @Post(':id/reverse')
  @RequirePermissions('accounting.journal.post')
  reverse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reverse(user.companyId, user.userId, id);
  }
}
