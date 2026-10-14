import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
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
