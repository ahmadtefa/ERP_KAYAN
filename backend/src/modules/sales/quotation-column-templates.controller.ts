import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  QuotationColumnTemplateDto,
  UpdateQuotationColumnTemplateDto,
} from './dto/quotation.dto';
import { QuotationColumnTemplatesService } from './quotation-column-templates.service';

/// The saved column layouts the quotation editor offers.
///
/// Reading follows the same permission as reading quotations; changing one
/// follows the permission for editing them. A template is a starting point
/// only: the quotation keeps its own copy of the columns.
@Controller('sales/quotation-column-templates')
export class QuotationColumnTemplatesController {
  constructor(private readonly service: QuotationColumnTemplatesService) {}

  @Get()
  @RequirePermissions('sales.quotations.read')
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.companyId);
  }

  @Post()
  @RequirePermissions('sales.quotations.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: QuotationColumnTemplateDto) {
    return this.service.create(user.companyId, user.userId, dto);
  }

  @Put(':id')
  @RequirePermissions('sales.quotations.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateQuotationColumnTemplateDto,
  ) {
    return this.service.update(user.companyId, user.userId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('sales.quotations.manage')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.companyId, user.userId, id);
  }
}
