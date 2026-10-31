import {
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
import { canReadCost } from '../../common/auth/cost-visibility';
import { BarcodeLabelsService } from './barcode-labels.service';
import { BarcodeLabelsQueryDto } from './dto/barcode-labels.dto';
import { InventoryReportsService } from './inventory-reports.service';
import { PrintSettingsService } from '../../common/print/print-settings.module';

@Controller('inventory')
export class InventoryReportsController {
  constructor(
    private readonly service: InventoryReportsService,
    private readonly labels: BarcodeLabelsService,
    private readonly printSettings: PrintSettingsService,
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
    return this.service.listUnits(user.companyId, itemId, canReadCost(user));
  }

  @Post('items/:itemId/units')
  @RequirePermissions('inventory.items.update')
  addUnit(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.addUnit(
      user.companyId,
      user.userId,
      itemId,
      body,
      canReadCost(user),
    );
  }

  @Patch('items/:itemId/units/:unitId')
  @RequirePermissions('inventory.items.update')
  updateUnit(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Param('unitId') unitId: string,
    @Body() body: Record<string, unknown>,
  ) {
    if (body?.barcode !== undefined && !this.mayManageBarcodes(user)) {
      throw new ForbiddenException(
        'ليس لديك صلاحية تعديل أكواد الباركود. / Missing permission: inventory.barcodes.manage',
      );
    }
    return this.service.updateUnit(
      user.companyId,
      user.userId,
      itemId,
      unitId,
      body,
      canReadCost(user),
    );
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
      canReadCost(user),
    );
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
      canReadCost(user),
    );
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
      canReadCost(user),
    );
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
      canReadCost(user),
    );
  }

  /// Whether a label sheet carries the selling price.
  ///
  /// The sheet's own switch still wins, because a person printing one shelf of
  /// labels is making a choice about that sheet; otherwise the company's saved
  /// setting for labels decides, and the built-in default is to show it - the
  /// behaviour this route had before settings existed.
  private async labelShowsPrice(
    user: AuthUser,
    requested: string | undefined,
  ): Promise<boolean> {
    const resolved = await this.printSettings.resolve(
      user.companyId,
      user,
      requested === undefined ? {} : { showSalePrice: requested },
      'barcode-labels',
    );
    return resolved.showSalePrice;
  }

  private mayManageBarcodes(user: AuthUser): boolean {
    return user.isSuperAdmin || user.permissions.includes('inventory.barcodes.manage');
  }

  @Get('reports/valuation')
  @RequirePermissions('inventory.stock.read')
  valuation(
    @CurrentUser() user: AuthUser,
    @Query('branchId') branchId?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.service.valuation(
      user.companyId,
      { branchId, categoryId },
      canReadCost(user),
    );
  }

  @Get('reports/slow-moving')
  @RequirePermissions('inventory.stock.read')
  slowMoving(
    @CurrentUser() user: AuthUser,
    @Query('days') days?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.slowMoving(
      user.companyId,
      {
        days: days ? Number(days) : undefined,
        branchId,
      },
      canReadCost(user),
    );
  }

  @Get('reports/reorder')
  @RequirePermissions('inventory.stock.read')
  reorder(@CurrentUser() user: AuthUser, @Query('branchId') branchId?: string) {
    return this.service.reorder(user.companyId, { branchId }, canReadCost(user));
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
    const showPrice = await this.labelShowsPrice(user, query.showPrice);
    const html = await this.labels.buildHtml(user.companyId, itemId, specs, {
      paper: this.labels.parsePaper(query.paper),
      showPrice,
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
    const showPrice = await this.labelShowsPrice(user, query.showPrice);
    const pdf = await this.labels.renderPdf(user.companyId, itemId, specs, {
      paper: this.labels.parsePaper(query.paper),
      showPrice,
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
