import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ExpiryAlertScheduler } from './expiry-alert.scheduler';
import { NotificationsService } from './notifications.service';

export class NotificationQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() severity?: string;
  // Query parameters arrive as strings ("100"), so the transform must run
  // before validation. Without @Type the string fails @IsNumber and the
  // whole list request is refused with the pageSize errors the centre showed.
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}

class UpdateNotificationSettingDto {
  @IsOptional() @IsBoolean() isEnabled?: boolean;
  @IsOptional() @IsIn(['INFO', 'WARNING', 'CRITICAL']) severity?: string;
  @IsOptional() @IsArray() warehouseIds?: string[];
  @IsOptional() @IsArray() expiryDays?: number[];
  @IsOptional() @IsNumber() @Min(1) @Max(720) repeatAfterHours?: number;
}

/// The notification centre.
///
/// One place for everything the program wants a person to know, whatever
/// module raised it. Reading is open to anybody signed in - an empty list is
/// the right answer for somebody the alerts are not written for - while
/// changing how alerts behave is a management act.
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly service: NotificationsService,
    private readonly scheduler: ExpiryAlertScheduler,
  ) {}

  @Get()
  @RequirePermissions('notifications.read')
  list(@CurrentUser() user: AuthUser, @Query() query: NotificationQueryDto) {
    return this.service.list(user, query);
  }

  /// The badge. Deliberately cheap and deliberately separate from the list.
  @Get('unread-count')
  @RequirePermissions('notifications.read')
  unread(@CurrentUser() user: AuthUser) {
    return this.service.unreadCount(user);
  }

  @Get('settings')
  @RequirePermissions('notifications.read')
  settings(@CurrentUser() user: AuthUser) {
    return this.service.settings(user.companyId);
  }

  @Put('settings/:type')
  @RequirePermissions('notifications.manage')
  updateSetting(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @Body() dto: UpdateNotificationSettingDto,
  ) {
    return this.service.updateSetting(user.companyId, user.userId, type, dto);
  }

  @Post('read-all')
  @RequirePermissions('notifications.read')
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.service.markAllRead(user);
  }

  /// What "clear the old ones" would remove, before the person confirms.
  @Get('cleanup-preview')
  @RequirePermissions('notifications.read')
  cleanupPreview(
    @CurrentUser() user: AuthUser,
    @Query('days') days: string,
    @Query('includeUnread') includeUnread?: string,
  ) {
    return this.service.cleanupPreview(
      user,
      parseDays(days),
      includeUnread === 'true' || includeUnread === '1',
    );
  }

  /// Deleting is personal and non-destructive: the alert itself — and the
  /// document, stock or invoice behind it — is never touched. These three
  /// must be declared before `:id` or the literal paths would be swallowed.
  @Delete('read')
  @RequirePermissions('notifications.read')
  dismissRead(@CurrentUser() user: AuthUser) {
    return this.service.dismissRead(user);
  }

  @Delete('older')
  @RequirePermissions('notifications.read')
  dismissOlder(
    @CurrentUser() user: AuthUser,
    @Query('days') days: string,
    @Query('includeUnread') includeUnread?: string,
  ) {
    return this.service.dismissOlderThan(
      user,
      parseDays(days),
      includeUnread === 'true' || includeUnread === '1',
    );
  }

  @Delete('all')
  @RequirePermissions('notifications.read')
  dismissAll(@CurrentUser() user: AuthUser) {
    return this.service.dismissAll(user);
  }

  @Delete(':id')
  @RequirePermissions('notifications.read')
  dismiss(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.dismiss(user, id);
  }

  @Post(':id/read')
  @RequirePermissions('notifications.read')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.markRead(user, id);
  }

  /// "I will deal with it later": the row goes back to unread without needing
  /// a second alert to be raised.
  @Post(':id/unread')
  @RequirePermissions('notifications.read')
  unreadOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.markUnread(user, id);
  }

  @Post(':id/archive')
  @RequirePermissions('notifications.read')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.archive(user, id);
  }

  /// Runs the stock scanner now instead of waiting for its interval.
  /// Idempotent: every fact it finds is deduplicated by its own key.
  ///
  /// The answer also carries the automatic scanner's state, so a person can
  /// tell "nothing is expiring" from "the timer is switched off". A screen that
  /// showed an empty list without saying which of the two it means would be
  /// telling half the truth.
  @Post('scan')
  @RequirePermissions('notifications.manage')
  async scan(@CurrentUser() user: AuthUser) {
    const stock = await this.service.scanStock(user.companyId);
    const business = await this.service.scanBusiness(user.companyId);
    return {
      raised: stock.raised + business.raised,
      closed: stock.closed + business.closed,
      stock,
      business,
      scheduler: this.scheduler.status(),
    };
  }
}

/// Cleanup windows are written by the screen; anything outside a sane range
/// is refused here rather than silently clamped.
function parseDays(value: string | undefined): number {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new BadRequestException({ code: 'NOTIFICATION_DAYS_INVALID', message: 'days must be an integer between 1 and 3650' });
  }
  return days;
}
