import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { QuotationBackgroundsService } from './quotation-backgrounds.service';

class CreateBackgroundDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  /// The PDF file, base64 encoded (up to about 7 MB of text for a 5 MB file).
  @IsString() @MinLength(8) @MaxLength(7_500_000) dataBase64!: string;
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
