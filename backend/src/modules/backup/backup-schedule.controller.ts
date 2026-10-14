import { Body, Controller, Get, Post, Query } from '@nestjs/common';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { BackupScheduleService } from './backup-schedule.service';

/**
 * The scheduled backup: what it will do, what it has done, and a button to
 * make it happen now.
 *
 * The schedule itself lives in the company settings (interval in hours and how
 * many copies to keep), so an operator can see and change it without touching
 * the server. Everything here needs `admin.backup` - the same permission as
 * taking a copy by hand, because that is what running the schedule does.
 */
@Controller('backup/schedule')
@RequirePermissions('admin.backup')
export class BackupScheduleController {
  constructor(private readonly schedule: BackupScheduleService) {}

  /// When the next backup is due, and how many copies are being kept.
  @Get()
  status() {
    return this.schedule.status();
  }

  /// The backups this installation has written, newest first.
  @Get('history')
  history(@Query('take') take?: string) {
    const parsed = Number(take ?? 50);
    return this.schedule.history(Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 500) : 50);
  }

  /// Take one now: write the dump, read it back to prove it is readable, then
  /// apply retention. The same path the timer takes.
  @Post('run')
  run(@CurrentUser() user: AuthUser, @Body() body: { companyId?: string }) {
    return this.schedule.runNow(body?.companyId ?? user.companyId);
  }

  /// Apply the retention setting without taking a new backup.
  @Post('prune')
  async prune(@CurrentUser() user: AuthUser) {
    void user;
    const status = await this.schedule.status();
    const removed = await this.schedule.pruneRetention(status.retentionCount);
    return { retentionCount: status.retentionCount, removed };
  }
}
