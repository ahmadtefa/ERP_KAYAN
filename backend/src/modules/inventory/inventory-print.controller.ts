import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import { AllowQueryToken } from '../../common/decorators/allow-query-token.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { canReadCost } from '../../common/auth/cost-visibility';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PrintSettingsService } from '../../common/print/print-settings.module';
import { applyPriceVisibility } from '../export/price-visibility';
import type { ReportTable } from '../export/report-table';
import { PdfService } from '../export/pdf.service';
import { toPrintHtml, type Lang } from '../export/writers';
import {
  inventoryValuationTable,
  reorderTable,
  slowMovingTable,
  stockDocumentTable,
  stockTakeVarianceTable,
} from './inventory-print';
import { InventoryReportsService } from './inventory-reports.service';
import { StockDocumentsService } from './stock-documents.service';

interface PriceQuery {
  lang?: string;
  auto?: string;
  showSalePrice?: string;
  showCost?: string;
  branchId?: string;
  categoryId?: string;
  days?: string;
  from?: string;
  to?: string;
  warehouseId?: string;
}

/// The warehouse's own paper: a stock document, and the three inventory
/// reports, as a print page and as a PDF file.
///
/// These routes did not exist - the reports could only be read on screen - so
/// "hide prices in the warehouse print" had nothing to apply to. They now go
/// through exactly the same three steps as every other print in the program:
/// the table is built, `applyPriceVisibility` removes what this copy may not
/// show (with the permission floor decided in `PrintSettingsService`), and the
/// writers turn what is left into a page or a file.
@Controller('inventory')
export class InventoryPrintController {
  constructor(
    private readonly reports: InventoryReportsService,
    private readonly documents: StockDocumentsService,
    private readonly pdf: PdfService,
    private readonly printSettings: PrintSettingsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('stock-documents/:id/print')
  @AllowQueryToken()
  @RequirePermissions('inventory.stock.read')
  async stockDocumentPrint(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: PriceQuery,
    @Res() response: Response,
  ): Promise<void> {
    const table = await this.stockDocumentTableFor(user, id, query);
    await this.sendPage(response, table, user.companyId, query);
  }

  @Get('stock-documents/:id/pdf')
  @AllowQueryToken()
  @RequirePermissions('inventory.stock.read')
  async stockDocumentPdf(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: PriceQuery,
    @Res() response: Response,
  ): Promise<void> {
    const table = await this.stockDocumentTableFor(user, id, query);
    await this.sendPdf(response, table, user.companyId, query, 'stock-document');
  }

  @Get('reports/valuation/print')
  @AllowQueryToken()
  @RequirePermissions('inventory.stock.read')
  async valuationPrint(
    @CurrentUser() user: AuthUser,
    @Query() query: PriceQuery,
    @Res() response: Response,
  ): Promise<void> {
    const table = await this.valuationFor(user, query);
    await this.sendPage(response, table, user.companyId, query);
  }

  @Get('reports/valuation/pdf')
  @AllowQueryToken()
  @RequirePermissions('inventory.stock.read')
  async valuationPdf(
    @CurrentUser() user: AuthUser,
    @Query() query: PriceQuery,
    @Res() response: Response,
  ): Promise<void> {
    const table = await this.valuationFor(user, query);
    await this.sendPdf(response, table, user.companyId, query, 'valuation');
  }

  @Get('reports/slow-moving/print')
  @AllowQueryToken()
  @RequirePermissions('inventory.stock.read')
  async slowMovingPrint(
    @CurrentUser() user: AuthUser,
    @Query() query: PriceQuery,
    @Res() response: Response,
  ): Promise<void> {
    const table = await this.slowMovingFor(user, query);
    await this.sendPage(response, table, user.companyId, query);
  }

  @Get('reports/slow-moving/pdf')
  @AllowQueryToken()
  @RequirePermissions('inventory.stock.read')
  async slowMovingPdf(
    @CurrentUser() user: AuthUser,
    @Query() query: PriceQuery,
    @Res() response: Response,
  ): Promise<void> {
    const table = await this.slowMovingFor(user, query);
    await this.sendPdf(response, table, user.companyId, query, 'slow-moving');
  }

  @Get('reports/reorder/print')
  @AllowQueryToken()
  @RequirePermissions('inventory.stock.read')
  async reorderPrint(
    @CurrentUser() user: AuthUser,
    @Query() query: PriceQuery,
    @Res() response: Response,
  ): Promise<void> {
    const table = await this.reorderFor(user, query);
    await this.sendPage(response, table, user.companyId, query);
  }

  @Get('reports/reorder/pdf')
  @AllowQueryToken()
  @RequirePermissions('inventory.stock.read')
  async reorderPdf(
    @CurrentUser() user: AuthUser,
    @Query() query: PriceQuery,
    @Res() response: Response,
  ): Promise<void> {
    const table = await this.reorderFor(user, query);
    await this.sendPdf(response, table, user.companyId, query, 'reorder');
  }

  @Get('reports/stock-take-variance/print')
  @AllowQueryToken()
  @RequirePermissions('inventory.stock.read')
  async stockTakeVariancePrint(
    @CurrentUser() user: AuthUser,
    @Query() query: PriceQuery,
    @Res() response: Response,
  ): Promise<void> {
    const table = await this.stockTakeVarianceFor(user, query);
    await this.sendPage(response, table, user.companyId, query);
  }

  @Get('reports/stock-take-variance/pdf')
  @AllowQueryToken()
  @RequirePermissions('inventory.stock.read')
  async stockTakeVariancePdf(
    @CurrentUser() user: AuthUser,
    @Query() query: PriceQuery,
    @Res() response: Response,
  ): Promise<void> {
    const table = await this.stockTakeVarianceFor(user, query);
    await this.sendPdf(response, table, user.companyId, query, 'stock-take-variance');
  }

  // -------------------------------------------------------------- builders

  private async stockDocumentTableFor(
    user: AuthUser,
    id: string,
    query: PriceQuery,
  ): Promise<ReportTable> {
    const document = await this.documents.findOne(user.companyId, id, canReadCost(user));
    const table = stockDocumentTable(document as never);
    return this.redact(user, table, query, 'stock-document');
  }

  private async valuationFor(user: AuthUser, query: PriceQuery): Promise<ReportTable> {
    const report = await this.reports.valuation(
      user.companyId,
      { branchId: query.branchId, categoryId: query.categoryId },
      canReadCost(user),
    );
    return this.redact(user, inventoryValuationTable(report as never), query, 'inventory-valuation');
  }

  private async slowMovingFor(user: AuthUser, query: PriceQuery): Promise<ReportTable> {
    const report = await this.reports.slowMoving(
      user.companyId,
      { days: query.days ? Number(query.days) : undefined, branchId: query.branchId },
      canReadCost(user),
    );
    return this.redact(user, slowMovingTable(report as never), query, 'slow-moving');
  }

  private async reorderFor(user: AuthUser, query: PriceQuery): Promise<ReportTable> {
    const report = await this.reports.reorder(
      user.companyId,
      { branchId: query.branchId },
      canReadCost(user),
    );
    return this.redact(user, reorderTable(report as never), query, 'reorder');
  }

  private async stockTakeVarianceFor(
    user: AuthUser,
    query: PriceQuery,
  ): Promise<ReportTable> {
    const report = await this.reports.stockTakeVariance(
      user.companyId,
      {
        from: query.from,
        to: query.to,
        branchId: query.branchId,
        warehouseId: query.warehouseId,
      },
      canReadCost(user),
    );
    return this.redact(
      user,
      stockTakeVarianceTable(report as never),
      query,
      'stock-take-variance',
    );
  }

  private async redact(
    user: AuthUser,
    table: ReportTable,
    query: PriceQuery,
    typeKey: string,
  ): Promise<ReportTable> {
    const visibility = await this.printSettings.resolve(
      user.companyId,
      user,
      { showSalePrice: query.showSalePrice, showCost: query.showCost },
      typeKey,
    );
    return applyPriceVisibility(table, {
      showSalePrice: visibility.showSalePrice ? 'true' : 'false',
      showCost: visibility.showCost ? 'true' : 'false',
    });
  }

  // -------------------------------------------------------------- rendering

  private async header(companyId: string, lang: Lang) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { nameEn: true, nameAr: true, logoData: true, logoMime: true },
    });
    return {
      name: (lang === 'ar' ? company?.nameAr : company?.nameEn) ?? company?.nameEn ?? 'KAYAN',
      logo: company?.logoData
        ? { data: Buffer.from(company.logoData), mime: company.logoMime ?? 'image/png' }
        : null,
    };
  }

  /// The print page: the same HTML the browser turns into paper, with the
  /// print dialogue optionally opening by itself.
  private async sendPage(
    response: Response,
    table: ReportTable,
    companyId: string,
    query: PriceQuery,
  ): Promise<void> {
    const lang: Lang = query.lang === 'ar' ? 'ar' : 'en';
    const header = await this.header(companyId, lang);
    const html = toPrintHtml(table, lang, header.name, {
      autoPrint: query.auto === '1' || query.auto === 'true',
      logo: header.logo,
    });
    response.type('text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.send(html);
  }

  /// The file: the very same page, handed to the local browser and saved.
  private async sendPdf(
    response: Response,
    table: ReportTable,
    companyId: string,
    query: PriceQuery,
    name: string,
  ): Promise<void> {
    const lang: Lang = query.lang === 'ar' ? 'ar' : 'en';
    const header = await this.header(companyId, lang);
    const html = toPrintHtml(table, lang, header.name, {
      autoPrint: false,
      logo: header.logo,
    });
    const body = await this.pdf.render(html);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.pdf"`,
    );
    response.send(body);
  }
}
