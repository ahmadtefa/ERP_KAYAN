import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { AllowQueryToken } from '../../common/decorators/allow-query-token.decorator';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { BackupFile, BackupService } from './backup.service';

interface UploadedBackup {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/// Taking a copy of the books, and putting one back.
///
/// Both operations need `admin.backup`. Taking a copy is harmless but contains
/// everything; putting one back replaces everything. Neither is a thing an
/// accountant doing their day's work should be able to do by accident.
@Controller('backup')
@RequirePermissions('admin.backup')
export class BackupController {
  constructor(
    private readonly service: BackupService,
    private readonly audit: AuditService,
  ) {}

  /// What a backup would contain right now, for the screen to show.
  @Get('summary')
  async summary(@CurrentUser() user: AuthUser) {
    const file = await this.service.create(user.companyId);
    return {
      companyName: file.companyName,
      companyCode: file.companyCode,
      contains: file.counts,
      total: Object.values(file.counts).reduce((sum, count) => sum + count, 0),
    };
  }

  /// The backup itself, as a download.
  @Get('download')
  @AllowQueryToken()
  async download(
    @CurrentUser() user: AuthUser,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.service.create(user.companyId);
    const body = Buffer.from(JSON.stringify(file, null, 2), 'utf8');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="kayan-backup-${file.companyCode}-${stamp}.json"`,
    );
    response.setHeader('Content-Length', String(body.length));
    response.setHeader('Cache-Control', 'no-store');
    response.end(body);

    // Who took a copy of the whole company, and when. This is the one event in
    // the audit trail that is worth recording even though nothing changed.
    await this.audit.record({
      companyId: user.companyId,
      userId: user.userId,
      action: 'BACKUP',
      entity: 'backup',
      entityId: null,
      after: { contains: file.counts, total: Object.values(file.counts).reduce((s, c) => s + c, 0) },
    });
  }

  /// Reads a backup file without touching anything, so the screen can say what
  /// is inside it and what it would replace.
  @Post('inspect')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 64 * 1024 * 1024 } }),
  )
  async inspect(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBackup | undefined,
  ) {
    const parsed = this.parse(file);
    return this.service.inspect(parsed, user.companyId);
  }

  /// Puts a backup back.
  ///
  /// `replace=true` is required when the company already holds data: a restore
  /// never merges, because merging two sets of books produces a third set that
  /// never existed.
  @Post('restore')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 64 * 1024 * 1024 } }),
  )
  async restore(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBackup | undefined,
    @Query() query: { replace?: string },
    @Body() body: { replace?: boolean },
  ) {
    const parsed = this.parse(file);
    return this.service.restore(parsed, user.companyId, {
      replace: query.replace === 'true' || body?.replace === true,
    });
  }

  private parse(file: UploadedBackup | undefined): BackupFile {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No file was uploaded.');
    }
    if (file.size > 64 * 1024 * 1024) {
      throw new BadRequestException('The backup file is larger than 64 MB.');
    }
    try {
      return JSON.parse(file.buffer.toString('utf8')) as BackupFile;
    } catch {
      throw new BadRequestException(
        'The file is not readable as a backup. It may be incomplete - check that the download finished.',
      );
    }
  }
}
