import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { NotificationsService } from './notifications.service';

class NotificationQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() severity?: string;
  @IsOptional() @IsNumber() @Min(1) page?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(200) pageSize?: number;
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
  constructor(private readonly service: NotificationsService) {}

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

  @Post(':id/read')
  @RequirePermissions('notifications.read')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.markRead(user, id);
  }

  @Post(':id/archive')
  @RequirePermissions('notifications.read')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.archive(user, id);
  }

  /// Runs the stock scanner now instead of waiting for its interval.
  /// Idempotent: every fact it finds is deduplicated by its own key.
  @Post('scan')
  @RequirePermissions('notifications.manage')
  scan(@CurrentUser() user: AuthUser) {
    return this.service.scanStock(user.companyId);
  }
}
