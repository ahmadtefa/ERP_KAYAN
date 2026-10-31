import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { QuotationDesignTemplatesService } from './quotation-design-templates.service';

class QuotationDesignTemplateDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsObject() design!: Record<string, unknown>;

  /// The attached PDF the offer prints on. Absent or null keeps the drawn
  /// design; the settings say how the artwork's pages are used.
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsUUID()
  backgroundId?: string | null;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsObject()
  background?: Record<string, unknown> | null;
}
class UpdateQuotationDesignTemplateDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsObject() design?: Record<string, unknown>;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsUUID()
  backgroundId?: string | null;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsObject()
  background?: Record<string, unknown> | null;
}

@Controller('sales/quotation-design-templates')
export class QuotationDesignTemplatesController {
  constructor(private readonly service: QuotationDesignTemplatesService) {}

  @Get()
  @RequirePermissions('sales.quotations.read')
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.companyId);
  }

  @Post()
  @RequirePermissions('sales.quotations.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: QuotationDesignTemplateDto) {
    return this.service.create(user.companyId, user.userId, dto);
  }

  @Put(':id')
  @RequirePermissions('sales.quotations.manage')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateQuotationDesignTemplateDto) {
    return this.service.update(user.companyId, user.userId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('sales.quotations.manage')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.companyId, user.userId, id);
  }
}
