import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { AllowQueryToken } from '../../common/decorators/allow-query-token.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PdfService } from '../export/pdf.service';
import {
  CreateQuotationDto,
  ListQuotationsDto,
  QuotationNoteDto,
  UpdateQuotationDto,
} from './dto/quotation.dto';
import { quotationDocumentFileName } from './quotation-document';
import { QuotationsService } from './quotations.service';

/// Quotation endpoints.
///
/// Reading needs `sales.quotations.read`, editing `sales.quotations.manage`,
/// printing `sales.quotations.export`, and turning an accepted offer into an
/// invoice `sales.quotations.convert` plus the invoice permission the invoice
/// service checks for itself. None of these routes can post accounting: the
/// conversion only creates a draft invoice.
@Controller('sales/quotations')
export class QuotationsController {
  constructor(
    private readonly service: QuotationsService,
    private readonly pdf: PdfService,
  ) {}

  @Get()
  @RequirePermissions('sales.quotations.read')
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListQuotationsDto) {
    return this.service.findAll(user.companyId, query);
  }

  @Get(':id')
  @RequirePermissions('sales.quotations.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }

  @Post()
  @RequirePermissions('sales.quotations.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateQuotationDto) {
    return this.service.create(user.companyId, user.branchId, user.userId, dto);
  }

  @Put(':id')
  @RequirePermissions('sales.quotations.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateQuotationDto,
  ) {
    return this.service.update(user.companyId, user.userId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('sales.quotations.manage')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.companyId, user.userId, id);
  }

  @Post(':id/send')
  @RequirePermissions('sales.quotations.manage')
  send(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: QuotationNoteDto,
  ) {
    return this.service.send(user.companyId, user.userId, id, dto?.note);
  }

  @Post(':id/accept')
  @RequirePermissions('sales.quotations.manage')
  accept(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: QuotationNoteDto,
  ) {
    return this.service.accept(user.companyId, user.userId, id, dto?.note);
  }

  @Post(':id/reject')
  @RequirePermissions('sales.quotations.manage')
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: QuotationNoteDto,
  ) {
    return this.service.reject(user.companyId, user.userId, id, dto?.note);
  }

  @Post(':id/revise')
  @RequirePermissions('sales.quotations.manage')
  revise(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.revise(user.companyId, user.branchId, user.userId, id);
  }

  @Post(':id/follow-up')
  @RequirePermissions('sales.quotations.manage')
  followUp(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: QuotationNoteDto,
  ) {
    return this.service.followUp(user.companyId, user.userId, id, dto?.note);
  }

  @Post(':id/convert')
  @RequirePermissions('sales.quotations.convert', 'sales.invoices.create')
  convert(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { invoiceDate?: string; warehouseId?: string; notes?: string },
  ) {
    return this.service.convert(
      user.companyId,
      user.branchId,
      user.userId,
      id,
      dto ?? {},
    );
  }

  /// The print preview. A browser page, not a file: it prints itself from the
  /// ordinary print dialogue and looks exactly like the PDF.
  @Get(':id/print')
  @AllowQueryToken()
  @RequirePermissions('sales.quotations.export')
  async print(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: { lang?: string; auto?: string },
    @Res() response: Response,
  ): Promise<void> {
    const lang = query.lang === 'ar' ? 'ar' : 'en';
    const html = await this.service.printHtml(
      user.companyId,
      id,
      lang,
      query.auto === '1' || query.auto === 'true',
    );
    response.type('text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.send(html);
  }

  /// A finished corporate document: brand header, company legal details, the
  /// customer, every table with repeated headers, the summary, the terms and
  /// the signatories, with page numbers in the footer.
  @Get(':id/pdf')
  @AllowQueryToken()
  @RequirePermissions('sales.quotations.export')
  async downloadPdf(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: { lang?: string },
    @Res() response: Response,
  ): Promise<void> {
    const lang = query.lang === 'ar' ? 'ar' : 'en';
    const document = await this.service.printDocument(
      user.companyId,
      id,
      lang,
      false,
    );
    const file = await this.pdf.render(document.html);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${quotationDocumentFileName(
        document.quotationNumber,
        id,
      )}"`,
    );
    response.setHeader('Cache-Control', 'no-store');
    response.send(file);
  }
}
