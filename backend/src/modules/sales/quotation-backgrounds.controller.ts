import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { BACKGROUND_UPLOAD_MAX_BYTES } from './quotation-background';
import { QuotationBackgroundsService } from './quotation-backgrounds.service';

interface UploadedPdf {
  originalname?: string;
  mimetype?: string;
  size?: number;
  buffer: Buffer;
}

class RenameBackgroundDto {
  @IsString() @MaxLength(160) name!: string;
}

class UploadBackgroundDto {
  /// Optional: the file name is used when it is not given.
  @IsOptional() @IsString() @MaxLength(160) name?: string;
}

/// The artwork library the quotation design screen attaches files from.
///
/// Uploading is the same permission as editing a template, and reading a file
/// is the same permission as reading a quotation: an operator who may design an
/// offer may attach the company's letterhead; somebody who may only read offers
/// may still preview the sheet they print on.
@Controller('sales/quotation-backgrounds')
export class QuotationBackgroundsController {
  constructor(private readonly service: QuotationBackgroundsService) {}

  @Get()
  @RequirePermissions('sales.quotations.read')
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.companyId);
  }

  @Post()
  @RequirePermissions('sales.quotations.manage')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: BACKGROUND_UPLOAD_MAX_BYTES, files: 1 },
    }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedPdf | undefined,
    @Body() body: UploadBackgroundDto,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException(
        'لم يتم اختيار ملف PDF للخلفية. / No background PDF was chosen.',
      );
    }
    return this.service.upload(user.companyId, user.userId, file, body?.name);
  }

  @Put(':id')
  @RequirePermissions('sales.quotations.manage')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameBackgroundDto,
  ) {
    return this.service.rename(user.companyId, user.userId, id, dto.name);
  }

  /// The preview, and the sheet a person checks before saving the template.
  /// Sent inline so the browser's PDF viewer shows it instead of saving it.
  @Get(':id/file')
  @RequirePermissions('sales.quotations.read')
  async file(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.service.file(user.companyId, id);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Disposition',
      `inline; filename="quotation-background-${id}.pdf"`,
    );
    response.end(file.data);
  }

  @Delete(':id')
  @RequirePermissions('sales.quotations.manage')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(user.companyId, user.userId, id);
  }
}
