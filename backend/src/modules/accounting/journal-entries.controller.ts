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

  @Post(':id/reverse')
  @RequirePermissions('accounting.journal.post')
  reverse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reverse(user.companyId, user.userId, id);
  }
}
