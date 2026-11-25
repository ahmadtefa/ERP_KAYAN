import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { canReadCost, canReadPurchasePrice, canReadSalePrice } from '../../common/auth/cost-visibility';
import { redactPriceFields } from '../../common/auth/price-redaction';
import { CreateItemDto, ListItemsDto, UpdateItemDto } from './dto/item.dto';
import { ItemsService } from './items.service';

@Controller('inventory/items')
export class ItemsController {
  constructor(private readonly service: ItemsService) {}

  @Get()
  @RequirePermissions('inventory.items.read')
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListItemsDto) {
    return this.service.findAll(user.companyId, query, this.mayReadCost(user)).then((result) => this.redactPrices(user, result));
  }

  /// Resolving a scanned code. Declared before `:id` so that the literal
  /// path is not swallowed by the parameterised one.
  @Get('by-barcode/:code')
  @RequirePermissions('inventory.items.read')
  findByBarcode(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.service.findByBarcode(user.companyId, code, this.mayReadCost(user)).then((result) => this.redactPrices(user, result));
  }

  /// The warehouse a new item's opening stock would be written to for this
  /// caller (same resolver as the save). Declared before `:id`.
  @Get('opening-target')
  @RequirePermissions('inventory.items.create')
  openingTarget(@CurrentUser() user: AuthUser) {
    return this.service.openingTarget(user.companyId, user.branchId ?? null, user);
  }

  @Get(':id')
  @RequirePermissions('inventory.items.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id, this.mayReadCost(user)).then((result) => this.redactPrices(user, result));
  }

  @Post()
  @RequirePermissions('inventory.items.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateItemDto) {
    this.assertPriceWritePermissions(user, dto);
    return this.service.create(
      user.companyId,
      user.userId,
      dto,
      user.branchId,
      canReadPurchasePrice(user),
      this.mayManageBarcodes(user),
      user,
    ).then((result) => this.redactPrices(user, result));
  }

  @Patch(':id')
  @RequirePermissions('inventory.items.update')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
  ) {
    this.assertPriceWritePermissions(user, dto);
    // A barcode identifies a thing; changing it needs the barcode
    // permission on top of the ordinary item-edit one, so a role that may
    // correct a name cannot silently repoint a code that labels are printed
    // from and scanners read.
    if (dto.barcode !== undefined && !this.mayManageBarcodes(user)) {
      throw new ForbiddenException(
        'ليس لديك صلاحية تعديل أكواد الباركود. / Missing permission: inventory.barcodes.manage',
      );
    }
    return this.service.update(
      user.companyId,
      user.userId,
      id,
      dto,
      canReadPurchasePrice(user),
      this.mayManageBarcodes(user),
    ).then((result) => this.redactPrices(user, result));
  }

  /// Generates an internal EAN-13 code, or assigns the one supplied.
  @Post(':id/barcode')
  @RequirePermissions('inventory.barcodes.manage')
  assignBarcode(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { barcode?: string | null },
  ) {
    return this.service.assignBarcode(
      user.companyId,
      user.userId,
      id,
      body?.barcode,
      canReadPurchasePrice(user),
    ).then((result) => this.redactPrices(user, result));
  }

  private assertPriceWritePermissions(
    user: AuthUser,
    body: {
      salePrice?: unknown;
      purchasePrice?: unknown;
      openingUnitCost?: unknown;
      units?: unknown;
    },
  ) {
    const rows = Array.isArray(body.units) ? body.units : [];
    const hasValue = (key: string) =>
      body[key as 'salePrice' | 'purchasePrice'] !== undefined ||
      rows.some((row) => row !== null && typeof row === 'object' &&
        (row as Record<string, unknown>)[key] !== undefined);
    if (hasValue('salePrice') &&
        !user.isSuperAdmin && !user.permissions.includes('inventory.items.saleprice.manage')) {
      throw new ForbiddenException(
        'ليس لديك صلاحية إدخال أو تعديل سعر البيع. / Missing permission: inventory.items.saleprice.manage',
      );
    }
    if (hasValue('purchasePrice') &&
        !user.isSuperAdmin && !user.permissions.includes('inventory.items.purchaseprice.manage')) {
      throw new ForbiddenException(
        'ليس لديك صلاحية إدخال أو تعديل سعر الشراء. / Missing permission: inventory.items.purchaseprice.manage',
      );
    }
    if (body.openingUnitCost !== undefined &&
        !user.isSuperAdmin && !user.permissions.includes('inventory.cost.manage')) {
      throw new ForbiddenException(
        'ليس لديك صلاحية إدخال تكلفة الرصيد الافتتاحي. / Missing permission: inventory.cost.manage',
      );
    }
  }

  private redactPrices(user: AuthUser, response: unknown) {
    return redactPriceFields(response, { sale: canReadSalePrice(user), purchase: canReadPurchasePrice(user), cost: canReadCost(user) });
  }

  /// Whether this caller may see what the goods cost the company.
  private mayReadCost(user: AuthUser): boolean {
    return canReadPurchasePrice(user);
  }

  private mayManageBarcodes(user: AuthUser): boolean {
    return user.isSuperAdmin || user.permissions.includes('inventory.barcodes.manage');
  }

  @Post(':id/deactivate')
  @RequirePermissions('inventory.items.update')
  deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.deactivate(
      user.companyId,
      user.userId,
      id,
      canReadPurchasePrice(user),
    ).then((result) => this.redactPrices(user, result));
  }

  // Unit catalogue management (list/add/update/deactivate/reactivate, unit
  // barcodes) lives in InventoryReportsController under the same
  // /inventory/items/:id/units URLs, which is the surface the desktop client
  // already calls. Keeping one route owner prevents duplicate registration.
}
