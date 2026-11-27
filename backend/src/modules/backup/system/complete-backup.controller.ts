import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { SuperAdminGuard } from '../../../common/guards/super-admin.guard';
import { AllowQueryToken } from '../../../common/decorators/allow-query-token.decorator';
import { AuthUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { MaintenanceService } from '../../../common/maintenance/maintenance';
import { CompleteBackupService } from './complete-backup.service';
import { CompleteRestoreUnavailableGuard } from './complete-restore-unavailable.guard';
import { RestoreGateService } from './restore-gate.service';
import { SystemRestoreService } from './system-restore.service';

interface UploadedArchive {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Complete system backups: one archive that holds the database, the uploaded
 * files, the settings, the licence *state* and a manifest with the SHA-256 of
 * everything — plus the safe restore that puts it back.
 *
 * Two kinds of backup live in this program, and they are not interchangeable:
 *
 *   • a company backup (JSON) moves one company's books between installations;
 *   • a complete system backup (this controller) recovers the whole machine.
 *
 * The screens keep them apart. Nothing here touches a single company: a
 * complete restore replaces every company, which is why the warning is shown
 * before the confirmation and the confirmation is a typed word.
 */
@Controller('backup/complete')
@RequirePermissions('admin.backup')
@UseGuards(SuperAdminGuard)
export class CompleteBackupController {
  constructor(
    private readonly backups: CompleteBackupService,
    private readonly restoreService: SystemRestoreService,
    private readonly gate: RestoreGateService,
    private readonly maintenance: MaintenanceService,
  ) {}

  /// What this machine can do, and whether it may restore at all.
  @Get('capabilities')
  async capabilities() {
    const [backup, gate] = await Promise.all([
      this.backups.capabilities(),
      this.gate.probe(),
    ]);
    return {
      ...backup,
      restore: gate,
      // The two names the Flutter screen reads. `fullRestoreSupported` is the
      // single answer to "may the restore button be shown at all": it is true
      // only when every safeguard passed above.
      fullRestoreSupported: gate.fullRestoreSupported,
      fullRestoreReasons: gate.reasons,
      maintenance: this.maintenance.status,
    };
  }

  /// How a restore is going, and whether one was interrupted.
  @Get('status')
  status() {
    return this.restoreService.status();
  }

  /// The complete backups sitting in the backup folder.
  @Get()
  list() {
    return this.backups.list();
  }

  /// Takes a complete backup: database, files, settings, licence state,
  /// manifest and checksums.
  @Post()
  create(@CurrentUser() user: AuthUser) {
    return this.backups.createFull(user.userId);
  }

  /// Reads an archive back and reports what is inside it.
  @Post(':name/verify')
  verify(@Param('name') name: string) {
    return this.backups.verify(name);
  }

  /// Checks an uploaded archive without changing anything.
  @Post('inspect')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 * 1024 } }),
  )
  inspect(@UploadedFile() file: UploadedArchive | undefined) {
    if (!file?.buffer?.length) {
      throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'No file was uploaded.' });
    }
    return this.backups.inspectUpload(file.buffer, file.originalname || 'uploaded archive');
  }

  /// One archive, as a download. The file never leaves the server otherwise.
  @Get(':name/download')
  @AllowQueryToken()
  async download(
    @Param('name') name: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.backups.read(name);
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
    response.setHeader('Content-Length', String(file.data.length));
    response.setHeader('Cache-Control', 'no-store');
    response.end(file.data);
  }

  @Delete(':name')
  remove(@CurrentUser() user: AuthUser, @Param('name') name: string) {
    return this.backups.remove(name, user.userId);
  }

  /**
   * Restores a complete backup.
   *
   * The guard runs before the upload is read: a machine that cannot restore
   * safely must not accept a 2 GB file first. The typed `RESTORE` is checked
   * again in the service, because a guard and a request body are two different
   * opinions about intent and both should agree.
   */
  @Post('restore')
  @UseGuards(CompleteRestoreUnavailableGuard)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 * 1024 } }),
  )
  restore(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedArchive | undefined,
    @Body() body: { confirm?: boolean | string; confirmPhrase?: string; fileName?: string },
    @Query() query: { confirm?: string; confirmPhrase?: string; fileName?: string },
  ) {
    const confirm =
      body?.confirm === true || body?.confirm === 'true' || query?.confirm === 'true';
    return this.restoreService.restore(
      {
        uploaded: file?.buffer?.length
          ? { buffer: file.buffer, originalName: file.originalname }
          : undefined,
        fileName: body?.fileName ?? query?.fileName,
        confirm,
        confirmPhrase: body?.confirmPhrase ?? query?.confirmPhrase,
      },
      user.userId,
      user,
    );
  }

  /// The state left behind by an interrupted restore, if any.
  @Get('recovery')
  recovery() {
    return this.restoreService.status();
  }

  /// Puts the safety backup back after an interrupted restore.
  @Post('recovery/resume')
  resume(@CurrentUser() user: AuthUser) {
    return this.restoreService.resumeRecovery(user.userId);
  }
}
