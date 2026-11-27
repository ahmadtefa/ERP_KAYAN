import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';

import { AuditedSuperAdminGuard } from '../../common/guards/audited-super-admin.guard';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { BackupScheduleService } from './backup-schedule.service';
import { BackupDestinationService, checkBackupDestination } from './backup-destination';
import { CompanySettingsService } from '../../common/settings/company-settings.module';
import { AuditService } from '../../common/audit/audit.service';

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
@UseGuards(AuditedSuperAdminGuard)
export class BackupScheduleController {
  constructor(
    private readonly schedule: BackupScheduleService,
    private readonly destinations: BackupDestinationService,
    private readonly settings: CompanySettingsService,
    private readonly audit: AuditService,
  ) {}

  /// The administrator's choices: folder, hour of day, interval, copies kept.
  @Get('settings')
  async getSettings(@CurrentUser() user: AuthUser) {
    const [dest, s] = await Promise.all([
      this.destinations.get(user.companyId),
      this.settings.get(user.companyId),
    ]);
    return {
      intervalHours: s.backupIntervalHours,
      retentionCount: s.backupRetentionCount,
      destinationPath: dest.path,
      startHour: dest.startHour,
    };
  }

  /// Checks a folder without saving it: writes and reads back a test file.
  @Post('check-folder')
  checkFolder(@Body() body: { path?: string }) {
    return checkBackupDestination(body?.path ?? '');
  }

  @Post('settings')
  async saveSettings(
    @CurrentUser() user: AuthUser,
    @Body() body: { intervalHours?: number; retentionCount?: number; destinationPath?: string | null; startHour?: number },
  ) {
    const before = await this.getSettings(user);
    const dest = await this.destinations.set(user.companyId, user.userId, {
      path: body?.destinationPath,
      startHour: body?.startHour,
    });
    const patch: Record<string, unknown> = {};
    if (body?.intervalHours !== undefined) patch.backupIntervalHours = body.intervalHours;
    if (body?.retentionCount !== undefined) patch.backupRetentionCount = body.retentionCount;
    if (Object.keys(patch).length > 0) await this.settings.update(user.companyId, user.userId, patch);
    const after = await this.getSettings(user);
    await this.audit.record({
      action: 'UPDATE',
      entity: 'backup_schedule',
      entityId: user.companyId,
      before,
      after,
      userId: user.userId,
      companyId: user.companyId,
    });
    return { ...after, check: dest.check };
  }

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
