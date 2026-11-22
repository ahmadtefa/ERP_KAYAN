import { BadRequestException, Controller, ForbiddenException, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import { AllowQueryToken } from '../../common/decorators/allow-query-token.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { filterReportAggregates } from '../export/aggregate-visibility';
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
import { resolveInventoryReportAccess, type InventoryReportAccess } from './inventory-report-access';
import { warehouseScopeOf } from '../../common/warehouse/warehouse.service';
import { StockDocumentsService } from './stock-documents.service';

interface PriceQuery {
  lang?: string;
  auto?: string;
  showSalePrice?: string;
  showPurchasePrice?: string;
  showCost?: string;
  branchId?: string;
  categoryId?: string;
  days?: string;
  from?: string;
  to?: string;
  warehouseId?: string;
  warehouseIds?: string | string[];
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
    const access = this.reportAccess(user, query, 'valuation-by-warehouse');
    const document = await this.documents.findOne(
      user.companyId, id, access.canReadCost, undefined, access.warehouseIds, warehouseScopeOf(user),
    );
    if (access.restricted) {
      const allowed = new Set(access.warehouseIds ?? []);
      const documentWarehouses = [document.fromWarehouseId, document.toWarehouseId].filter((value): value is string => Boolean(value));
      if (documentWarehouses.length === 0 || documentWarehouses.some((warehouseId) => !allowed.has(warehouseId))) {
        throw new ForbiddenException('This stock document is outside your assigned warehouses.');
      }
    }
    const table = stockDocumentTable(document as never);
    return this.redact(user, table, this.costSafeQuery(query, access), 'stock-document');
  }

  private async valuationFor(user: AuthUser, query: PriceQuery): Promise<ReportTable> {
    const access = this.reportAccess(user, query, 'slow-moving');
    const report = await this.reports.valuation(
      user.companyId,
      { branchId: this.reportBranch(user, query.branchId), categoryId: query.categoryId, warehouseIds: access.warehouseIds },
      access.canReadCost,
    );
    return this.redact(user, inventoryValuationTable(report as never), this.costSafeQuery(query, access), 'inventory-valuation');
  }

  private async slowMovingFor(user: AuthUser, query: PriceQuery): Promise<ReportTable> {
    const access = this.reportAccess(user, query, 'slow-moving');
    const report = await this.reports.slowMoving(
      user.companyId,
      { days: query.days ? Number(query.days) : undefined, branchId: this.reportBranch(user, query.branchId), warehouseIds: access.warehouseIds },
      access.canReadCost,
    );
    return this.redact(user, slowMovingTable(report as never), this.costSafeQuery(query, access), 'slow-moving');
  }

  private async reorderFor(user: AuthUser, query: PriceQuery): Promise<ReportTable> {
    const access = this.reportAccess(user, query, 'below-minimum');
    const report = await this.reports.reorder(
      user.companyId,
      { branchId: this.reportBranch(user, query.branchId), warehouseIds: access.warehouseIds },
      access.canReadCost,
      access.canReadPurchasePrice,
    );
    return this.redact(user, reorderTable(report as never), this.costSafeQuery(query, access), 'reorder');
  }

  private async stockTakeVarianceFor(
    user: AuthUser,
    query: PriceQuery,
  ): Promise<ReportTable> {
    const access = this.reportAccess(user, query, 'count-variances');
    const report = await this.reports.stockTakeVariance(
      user.companyId,
      {
        from: query.from,
        to: query.to,
        branchId: this.reportBranch(user, query.branchId),
        warehouseId: access.warehouseIds?.length === 1 ? access.warehouseIds[0] : undefined,
        warehouseIds: access.warehouseIds,
      },
      access.canReadCost,
    );
    return this.redact(
      user,
      stockTakeVarianceTable(report as never),
      this.costSafeQuery(query, access),
      'stock-take-variance',
    );
  }

  private reportAccess(user: AuthUser, query: PriceQuery, slug: string): InventoryReportAccess {
    if (!user.isSuperAdmin && !user.permissions.includes(`inventory.reports.${slug}.read`)) {
      throw new ForbiddenException(`Missing permission: inventory.reports.${slug}.read`);
    }
    if (!user.isSuperAdmin && !user.permissions.includes('inventory.reports.print')) {
      throw new ForbiddenException('Missing permission: inventory.reports.print');
    }
    return resolveInventoryReportAccess(user, query);
  }

  private costSafeQuery(query: PriceQuery, access: InventoryReportAccess): PriceQuery {
    return access.canReadCost ? query : { ...query, showCost: 'false' };
  }

  private reportBranch(user: AuthUser, requested?: string): string | undefined {
    const scope = warehouseScopeOf(user);
    if (requested && scope !== null && !scope.includes(requested)) {
      throw new ForbiddenException('This report is outside your assigned branches.');
    }
    if (requested) return requested;
    if (scope === null) return undefined;
    if (scope.length === 1) return scope[0];
    if (scope.length === 0) throw new ForbiddenException('No branch is assigned to this account.');
    if (user.branchId && scope.includes(user.branchId)) return user.branchId;
    throw new BadRequestException('Select one of your assigned branches to run this report.');
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
      { showSalePrice: query.showSalePrice, showPurchasePrice: query.showPurchasePrice, showCost: query.showCost },
      typeKey,
    );
    const priceSafe = applyPriceVisibility(table, {
      showSalePrice: visibility.showSalePrice ? 'true' : 'false',
      showPurchasePrice: visibility.showPurchasePrice ? 'true' : 'false',
      showCost: visibility.showCost ? 'true' : 'false',
    });
    return typeKey === 'stock-document'
      ? priceSafe
      : filterReportAggregates(priceSafe, user);
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
