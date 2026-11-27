import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { zonesOnSheet } from './quotation-background-media';
import { QuotationBackgroundsService } from './quotation-backgrounds.service';

class CreateBackgroundDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  /// The PDF, PNG or JPEG file, base64 encoded (up to about 5.4 MB of text for a 4 MB file).
  @IsString() @MinLength(8) @MaxLength(5_600_000) dataBase64!: string;
  @IsOptional() @IsInt() @Min(1) @Max(500) page?: number;
}

@Controller('sales/quotation-backgrounds')
export class QuotationBackgroundsController {
  constructor(private readonly service: QuotationBackgroundsService) {}

  @Get()
  @RequirePermissions('sales.quotations.read')
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.companyId);
  }

  /// The page as a PNG, for the in-app preview.
  @Get(':id/preview')
  @RequirePermissions('sales.quotations.read')
  async preview(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('fit') fit: string | undefined,
    @Res() response: Response,
  ) {
    const png = await this.service.preview(user.companyId, id);
    if (!png) throw new NotFoundException({ code: 'BACKGROUND_NOT_FOUND', message: 'Background not found' });
    // The artwork zones the printed text keeps clear of, so the in-app preview
    // can leave the same room.
    const meta = await this.service.meta(user.companyId, id);
    if (meta) {
      const mm = zonesOnSheet(meta, fit === 'stretch' ? 'stretch' : 'contain');
      response.setHeader('X-Background-Top-Mm', String(mm.topInsetMm));
      response.setHeader('X-Background-Bottom-Mm', String(mm.bottomInsetMm));
      response.setHeader('X-Background-Width-Pt', String(meta.widthPt));
      response.setHeader('X-Background-Height-Pt', String(meta.heightPt));
      response.setHeader('Access-Control-Expose-Headers', 'X-Background-Top-Mm, X-Background-Bottom-Mm, X-Background-Width-Pt, X-Background-Height-Pt');
    }
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.type('image/png');
    response.send(png);
  }

  @Post()
  @RequirePermissions('sales.quotations.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBackgroundDto) {
    return this.service.create(user.companyId, user.userId, dto);
  }

  @Delete(':id')
  @RequirePermissions('sales.quotations.manage')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.companyId, id);
  }
}
