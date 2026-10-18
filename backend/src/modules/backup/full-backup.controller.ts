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
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { AllowQueryToken } from '../../common/decorators/allow-query-token.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { MaintenanceService } from '../../common/maintenance/maintenance';
import { FullBackupService } from './full-backup.service';

interface UploadedDump {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Full-database backups: take one, list them, download one, put one back.
 *
 * Every route needs `admin.backup`. These files hold the whole database —
 * every company and every user — so they are the most sensitive artefact the
 * program produces, and taking or restoring one is never an accident.
 */
@Controller('backup/full')
@RequirePermissions('admin.backup')
@UseGuards(SuperAdminGuard)
export class FullBackupController {
  constructor(
    private readonly service: FullBackupService,
    private readonly maintenance: MaintenanceService,
  ) {}

  /// What this machine can do, and the state of the system right now.
  @Get('capabilities')
  async capabilities() {
    return {
      ...(await this.service.capabilities()),
      maintenance: this.maintenance.status,
    };
  }

  /// How a restore is going, for the screen to poll while it waits.
  @Get('status')
  status() {
    return this.maintenance.status;
  }

  /// The backups sitting in the backup folder on the server.
  @Get()
  list() {
    return this.service.list();
  }

  /// Takes a new full backup.
  @Post()
  create(@CurrentUser() user: AuthUser) {
    return this.service.createFull(user.userId);
  }

  /// Reads a backup back from disk and reports what is inside it. A backup
  /// nobody has ever read is a hope, not a backup.
  @Post(':name/verify')
  verify(@Param('name') name: string) {
    return this.service.verify(name);
  }

  /// One backup file, as a download.
  @Get(':name/download')
  @AllowQueryToken()
  async download(
    @CurrentUser() user: AuthUser,
    @Param('name') name: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.service.read(name);
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.name}"`,
    );
    response.setHeader('Content-Length', String(file.data.length));
    response.setHeader('Cache-Control', 'no-store');
    response.end(file.data);
  }

  @Delete(':name')
  remove(@CurrentUser() user: AuthUser, @Param('name') name: string) {
    return this.service.remove(name, user.userId);
  }

  /**
   * Restores the whole database, from an uploaded file or one on the server.
   *
   * `confirm=true` is required: this replaces everything. The screen makes
   * the user type the confirmation before it sends it.
   */
  @Post('restore')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 * 1024 } }),
  )
  restore(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedDump | undefined,
    @Body() body: { confirm?: boolean | string; fileName?: string },
    @Query() query: { confirm?: string; fileName?: string },
  ) {
    const confirm =
      body?.confirm === true ||
      body?.confirm === 'true' ||
      query?.confirm === 'true';

    return this.service.restore(
      {
        uploaded: file?.buffer?.length
          ? { buffer: file.buffer, originalName: file.originalname }
          : undefined,
        fileName: body?.fileName ?? query?.fileName,
        confirm,
      },
      user.userId,
    );
  }
}
