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
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { InventoryReportsService } from './inventory-reports.service';

@Controller('inventory')
export class InventoryReportsController {
  constructor(private readonly service: InventoryReportsService) {}

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
    return this.service.listUnits(user.companyId, itemId);
  }

  @Post('items/:itemId/units')
  @RequirePermissions('inventory.items.update')
  addUnit(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.addUnit(user.companyId, user.userId, itemId, body);
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
    return this.service.updateUnit(user.companyId, user.userId, itemId, unitId, body);
  }

  @Delete('items/:itemId/units/:unitId')
  @RequirePermissions('inventory.items.update')
  removeUnit(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Param('unitId') unitId: string,
  ) {
    return this.service.removeUnit(user.companyId, user.userId, itemId, unitId);
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
    );
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
    return this.service.valuation(user.companyId, { branchId, categoryId });
  }

  @Get('reports/slow-moving')
  @RequirePermissions('inventory.stock.read')
  slowMoving(
    @CurrentUser() user: AuthUser,
    @Query('days') days?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.slowMoving(user.companyId, {
      days: days ? Number(days) : undefined,
      branchId,
    });
  }

  @Get('reports/reorder')
  @RequirePermissions('inventory.stock.read')
  reorder(@CurrentUser() user: AuthUser, @Query('branchId') branchId?: string) {
    return this.service.reorder(user.companyId, { branchId });
  }
}
