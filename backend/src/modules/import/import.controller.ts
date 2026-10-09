import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { AllowQueryToken } from '../../common/decorators/allow-query-token.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { IMPORT_KINDS, ImportKind, ImportService } from './import.service';

/// What the upload arrives as. Declared here rather than pulled from
/// @types/multer, because that is the only thing this file needs from it.
interface UploadedSpreadsheet {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/// Which permission each import needs.
///
/// It is the permission to create that kind of record by hand. Anybody who may
/// add a customer one at a time may add a hundred from a file; nobody else may.
/// The check is written out here rather than declared with @RequirePermissions
/// because the required permission depends on the kind in the path, and that
/// decorator takes a fixed list.
const PERMISSION: Record<ImportKind, string> = {
  customers: 'parties.customers.create',
  suppliers: 'parties.suppliers.create',
  items: 'inventory.items.create',
};

export const IMPORT_PERMISSIONS = PERMISSION;

@Controller('import')
export class ImportController {
  constructor(private readonly service: ImportService) {}

  /// The spreadsheet to fill in, with the right columns and an example row.
  @Get('templates/:kind')
  @AllowQueryToken()
  async template(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: string,
    @Res() response: Response,
  ): Promise<void> {
    const slug = this.kind(kind);
    this.allowed(user, slug);

    const body = await this.service.template(slug);
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="kayan-import-${slug}.xlsx"`,
    );
    response.setHeader('Cache-Control', 'no-store');
    response.end(body);
  }

  /// Reads the uploaded file.
  ///
  /// `dryRun=true` reports what would happen and writes nothing, which is what
  /// the screen shows first. `mode=insert` leaves records that already exist
  /// alone and counts them as skipped; `mode=upsert` updates them instead.
  @Post(':kind')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  async upload(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: string,
    @UploadedFile() file: UploadedSpreadsheet | undefined,
    @Query() query: { dryRun?: string; mode?: string },
  ) {
    const slug = this.kind(kind);
    this.allowed(user, slug);

    if (!file) {
      throw new BadRequestException(
        'No file arrived. Choose a .xlsx or .csv file and try again.',
      );
    }

    return this.service.run(slug, user.companyId, user.userId, file, {
      dryRun: query.dryRun === 'true' || query.dryRun === '1',
      mode: query.mode === 'upsert' ? 'upsert' : 'insert',
    });
  }

  private kind(value: string): ImportKind {
    if (!IMPORT_KINDS.includes(value as ImportKind)) {
      throw new BadRequestException(
        `Unknown import "${value}". Known imports: ${IMPORT_KINDS.join(', ')}.`,
      );
    }
    return value as ImportKind;
  }

  private allowed(user: AuthUser, kind: ImportKind): void {
    if (user.isSuperAdmin) return;
    const needed = PERMISSION[kind];
    if (!user.permissions.includes(needed)) {
      throw new ForbiddenException(`Missing permission: ${needed}`);
    }
  }
}
