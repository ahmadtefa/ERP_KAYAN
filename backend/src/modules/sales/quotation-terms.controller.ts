import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateQuotationTermDto,
  UpdateQuotationTermDto,
} from './dto/quotation-term.dto';
import { QuotationTermsService } from './quotation-terms.service';

/// The reusable terms library that the quotation editor offers.
///
/// Reading it follows the same permission as reading quotations; changing it
/// follows the permission for editing them. Nothing here can affect an issued
/// quotation: the editor copies the chosen text onto the document.
@Controller('sales/quotation-terms')
export class QuotationTermsController {
  constructor(private readonly service: QuotationTermsService) {}

  @Get()
  @RequirePermissions('sales.quotations.read')
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.companyId);
  }

  @Post()
  @RequirePermissions('sales.quotations.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateQuotationTermDto) {
    return this.service.create(user.companyId, user.userId, dto);
  }

  @Put(':id')
  @RequirePermissions('sales.quotations.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateQuotationTermDto,
  ) {
    return this.service.update(user.companyId, user.userId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('sales.quotations.manage')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.companyId, user.userId, id);
  }
}
