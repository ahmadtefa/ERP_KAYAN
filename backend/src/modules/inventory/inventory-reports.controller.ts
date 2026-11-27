import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { AllowQueryToken } from '../../common/decorators/allow-query-token.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { canReadCost, canReadPurchasePrice, canReadSalePrice } from '../../common/auth/cost-visibility';
import { redactPriceFields } from '../../common/auth/price-redaction';
import { warehouseScopeOf } from '../../common/warehouse/warehouse.service';
import { resolveInventoryReportAccess } from './inventory-report-access';
import { BarcodeLabelsService } from './barcode-labels.service';
import { BarcodeLabelsQueryDto } from './dto/barcode-labels.dto';
import { InventoryReportsService } from './inventory-reports.service';

@Controller('inventory')
export class InventoryReportsController {
  constructor(
    private readonly service: InventoryReportsService,
    private readonly labels: BarcodeLabelsService,
  ) {}

  @Get('categories')
  @RequirePermissions('inventory.items.read')
  categories(
    @CurrentUser() user: AuthUser,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.service.listCategories(user.companyId, includeInactive === 'true');
  }

  @Post('categories')
  @RequirePermissions('inventory.items.create')
  createCategory(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.service.createCategory(user.companyId, user.userId, body);
  }

  @Get('items/:itemId/units')
  @RequirePermissions('inventory.items.read')
  units(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.service.listUnits(user.companyId, itemId, canReadPurchasePrice(user)).then((result) => this.redactPrices(user, result));
  }

  @Post('items/:itemId/units')
  @RequirePermissions('inventory.items.update')
  addUnit(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.assertPriceWritePermissions(user, body);
    if (body?.barcode !== undefined && !this.mayManageBarcodes(user)) {
      throw new ForbiddenException({ code: 'BARCODE_PERMISSION', message: 'ليس لديك صلاحية تعديل أكواد الباركود. / Missing permission: inventory.barcodes.manage' });
    }
    return this.service.addUnit(
      user.companyId,
      user.userId,
      itemId,
      body,
      canReadPurchasePrice(user),
    ).then((result) => this.redactPrices(user, result));
  }

  @Patch('items/:itemId/units/:unitId')
  @RequirePermissions('inventory.items.update')
  updateUnit(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Param('unitId') unitId: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.assertPriceWritePermissions(user, body);
    if (body?.barcode !== undefined && !this.mayManageBarcodes(user)) {
      throw new ForbiddenException({ code: 'BARCODE_PERMISSION', message: 'ليس لديك صلاحية تعديل أكواد الباركود. / Missing permission: inventory.barcodes.manage' });
    }
    return this.service.updateUnit(
      user.companyId,
      user.userId,
      itemId,
      unitId,
      body,
      canReadPurchasePrice(user),
    ).then((result) => this.redactPrices(user, result));
  }

  @Delete('items/:itemId/units/:unitId')
  @RequirePermissions('inventory.items.update')
  removeUnit(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Param('unitId') unitId: string,
  ) {
    return this.service.removeUnit(
      user.companyId,
      user.userId,
      itemId,
      unitId,
      canReadPurchasePrice(user),
    ).then((result) => this.redactPrices(user, result));
  }

  /// Used units are deactivated, never hard-deleted, so old documents keep a
  /// unit row that still exists while new documents reject the inactive unit.
  @Post('items/:itemId/units/:unitId/deactivate')
  @RequirePermissions('inventory.items.update')
  deactivateUnit(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Param('unitId') unitId: string,
  ) {
    return this.service.deactivateUnit(
      user.companyId,
      user.userId,
      itemId,
      unitId,
      canReadPurchasePrice(user),
    ).then((result) => this.redactPrices(user, result));
  }

  @Post('items/:itemId/units/:unitId/reactivate')
  @RequirePermissions('inventory.items.update')
  reactivateUnit(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Param('unitId') unitId: string,
  ) {
    return this.service.reactivateUnit(
      user.companyId,
      user.userId,
      itemId,
      unitId,
      canReadPurchasePrice(user),
    ).then((result) => this.redactPrices(user, result));
  }

  /// Gives a unit its own code, generated when none is supplied.
  @Post('items/:itemId/units/:unitId/barcode')
  @RequirePermissions('inventory.barcodes.manage')
  assignUnitBarcode(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Param('unitId') unitId: string,
    @Body() body: { barcode?: string | null },
  ) {
    return this.service.assignUnitBarcode(
      user.companyId,
      user.userId,
      itemId,
      unitId,
      body?.barcode,
      canReadPurchasePrice(user),
    ).then((result) => this.redactPrices(user, result));
  }

  private assertPriceWritePermissions(user: AuthUser, body: Record<string, unknown>) {
    if (body.salePrice !== undefined && !user.isSuperAdmin &&
        !user.permissions.includes('inventory.items.saleprice.manage')) {
      throw new ForbiddenException({ code: 'SALE_PRICE_PERMISSION', message: 'ليس لديك صلاحية إدخال أو تعديل سعر البيع. / Missing permission: inventory.items.saleprice.manage' });
    }
    if (body.purchasePrice !== undefined && !user.isSuperAdmin &&
        !user.permissions.includes('inventory.items.purchaseprice.manage')) {
      throw new ForbiddenException({ code: 'PURCHASE_PRICE_PERMISSION', message: 'ليس لديك صلاحية إدخال أو تعديل سعر الشراء. / Missing permission: inventory.items.purchaseprice.manage' });
    }
  }

  private redactPrices(user: AuthUser, response: unknown) {
    return redactPriceFields(response, { sale: canReadSalePrice(user), purchase: canReadPurchasePrice(user), cost: canReadCost(user) });
  }

  private reportBranch(user: AuthUser, requested?: string): string | undefined {
    const scope = warehouseScopeOf(user);
    if (scope === null) return requested;
    if (requested) {
      if (!scope.includes(requested)) {
        throw new ForbiddenException({ code: 'REPORT_OUTSIDE_BRANCHES', message: 'This report is outside your assigned branches.' });
      }
      return requested;
    }
    if (scope.length === 1) return scope[0];
    if (user.branchId && scope.includes(user.branchId)) return user.branchId;
    if (scope.length === 0) {
      throw new ForbiddenException({ code: 'REPORT_NO_BRANCH', message: 'No branch is assigned to this account.' });
    }
    throw new BadRequestException({ code: 'REPORT_SELECT_BRANCH', message: 'Select one of your assigned branches to run this report.' });
  }

  private mayManageBarcodes(user: AuthUser): boolean {
    return user.isSuperAdmin || user.permissions.includes('inventory.barcodes.manage');
  }

  @Get('reports/valuation')
  @RequirePermissions('inventory.stock.read')
  valuation(
    @CurrentUser() user: AuthUser,
    @Query() query: { branchId?: string; categoryId?: string; warehouseId?: string; warehouseIds?: string | string[] },
  ) {
    const access = resolveInventoryReportAccess(user, query);
    const scopedBranchId = this.reportBranch(user, query.branchId);
    return this.service.valuation(
      user.companyId,
      { branchId: scopedBranchId, categoryId: query.categoryId, warehouseIds: access.warehouseIds },
      access.canReadCost,
    );
  }

  @Get('reports/cost-center-movements')
  @RequirePermissions('inventory.stock.read')
  costCenterMovements(
    @CurrentUser() user: AuthUser,
    @Query() query: { costCenterId?: string; branchId?: string; warehouseId?: string; warehouseIds?: string | string[] },
  ) {
    const access = resolveInventoryReportAccess(user, query);
    const scopedBranchId = this.reportBranch(user, query.branchId);
    return this.service.costCenterMovements(
      user.companyId,
      { costCenterId: query.costCenterId, branchId: scopedBranchId, warehouseIds: access.warehouseIds },
      access.canReadCost,
    );
  }

  @Get('reports/slow-moving')
  @RequirePermissions('inventory.stock.read')
  slowMoving(
    @CurrentUser() user: AuthUser,
    @Query() query: { days?: string; branchId?: string; warehouseId?: string; warehouseIds?: string | string[] },
  ) {
    const access = resolveInventoryReportAccess(user, query);
    const scopedBranchId = this.reportBranch(user, query.branchId);
    return this.service.slowMoving(
      user.companyId,
      { days: query.days ? Number(query.days) : undefined, branchId: scopedBranchId, warehouseIds: access.warehouseIds },
      access.canReadCost,
    );
  }

  @Get('reports/reorder')
  @RequirePermissions('inventory.stock.read')
  reorder(
    @CurrentUser() user: AuthUser,
    @Query() query: { branchId?: string; warehouseId?: string; warehouseIds?: string | string[] },
  ) {
    const access = resolveInventoryReportAccess(user, query);
    const scopedBranchId = this.reportBranch(user, query.branchId);
    return this.service.reorder(
      user.companyId,
      { branchId: scopedBranchId, warehouseIds: access.warehouseIds },
      access.canReadCost,
      access.canReadPurchasePrice,
    );
  }

  /// Printable barcode label sheet (HTML) for the item's own units. Reading
  /// items is enough to print their labels; assigning barcodes stays separate.
  @Get('items/:itemId/barcode-labels/print')
  @AllowQueryToken()
  @RequirePermissions('inventory.items.read')
  async barcodeLabelPrint(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Query('specs') specsQuery: string[] | string | undefined,
    @Query() query: BarcodeLabelsQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const specs = this.labels.parseSpecs(specsQuery);
    const html = await this.labels.buildHtml(user.companyId, itemId, specs, {
      paper: this.labels.parsePaper(query.paper),
      showPrice: query.showPrice !== 'false' && canReadSalePrice(user),
      lang: query.lang === 'en' ? 'en' : 'ar',
      autoPrint: query.auto === '1' || query.auto === 'true',
    });
    response.type('text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.send(html);
  }

  /// Same sheet rendered to PDF through the server's browser pipeline. When
  /// the machine has no browser, PdfService explains the print-button fallback.
  @Get('items/:itemId/barcode-labels/pdf')
  @AllowQueryToken()
  @RequirePermissions('inventory.items.read')
  async barcodeLabelPdf(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Query('specs') specsQuery: string[] | string | undefined,
    @Query() query: BarcodeLabelsQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const specs = this.labels.parseSpecs(specsQuery);
    const pdf = await this.labels.renderPdf(user.companyId, itemId, specs, {
      paper: this.labels.parsePaper(query.paper),
      showPrice: query.showPrice !== 'false' && canReadSalePrice(user),
      lang: query.lang === 'en' ? 'en' : 'ar',
      autoPrint: false,
    });
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Disposition',
      `inline; filename="barcode-labels-${itemId}.pdf"`,
    );
    response.send(pdf);
  }
}
