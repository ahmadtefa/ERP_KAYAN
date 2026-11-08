import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';

import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { assertWarehouseAccess, grantsOf } from '../../common/warehouse/warehouse-access';
import { canReadCost } from '../../common/auth/cost-visibility';
import {
  warehouseScopeOf,
  WarehouseService,
} from '../../common/warehouse/warehouse.service';

/**
 * The warehouses of a company, and what each one holds.
 *
 * Reading needs `inventory.warehouses.read`; changing needs
 * `inventory.warehouses.manage`, which a role that may edit items already
 * holds - naming where goods are kept is part of keeping them.
 *
 * Every route is narrowed to the branches the caller is assigned to before it
 * reads or writes anything. That is enforced here *and* in the service, so a
 * missing scope argument can never widen what a screen shows.
 */
@Controller('inventory/warehouses')
export class WarehousesController {
  constructor(private readonly service: WarehouseService) {}

  @Get()
  @RequirePermissions('inventory.warehouses.read')
  findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: { branchId?: string; includeInactive?: string },
  ) {
    return this.service.findAll(
      user.companyId,
      {
        branchId: query.branchId,
        includeInactive: query.includeInactive === 'true',
      },
      warehouseScopeOf(user),
      grantsOf(user)?.filter((grant) => grant.canView).map((grant) => grant.warehouseId),
    );
  }

  /**
   * The balance of every warehouse, item by item.
   *
   * Declared before `:id` so the literal path is not swallowed by the
   * parameterised one.
   */
  @Get('balance')
  @RequirePermissions('inventory.warehouses.read')
  balance(
    @CurrentUser() user: AuthUser,
    @Query()
    query: {
      branchId?: string;
      warehouseId?: string;
      itemId?: string;
      q?: string;
      includeZero?: string;
      asOf?: string;
    },
  ) {
    const grants = grantsOf(user);
    if (query.warehouseId) assertWarehouseAccess(user, query.warehouseId, 'view');
    const visibleGrants = grants?.filter((grant) =>
      query.warehouseId
        ? grant.warehouseId === query.warehouseId && grant.canView
        : grant.canView,
    );
    const mayReadCosts =
      canReadCost(user) && (grants === null || (visibleGrants ?? []).every((grant) => grant.canSeeCost));
    return this.service.balanceReport(
      user.companyId,
      {
        branchId: query.branchId,
        warehouseId: query.warehouseId,
        itemId: query.itemId,
        q: query.q,
        includeZero: query.includeZero === 'true',
        asOf: query.asOf,
      },
      warehouseScopeOf(user),
      grants?.filter((grant) => grant.canView).map((grant) => grant.warehouseId),
      mayReadCosts,
    );
  }

  @Get(':id')
  @RequirePermissions('inventory.warehouses.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    assertWarehouseAccess(user, id, 'view');
    return this.service.findOne(user.companyId, id, warehouseScopeOf(user));
  }

  /** What this warehouse holds today, or on a given date. */
  @Get(':id/stock')
  @RequirePermissions('inventory.warehouses.read')
  async stock(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: { asOf?: string; itemId?: string },
  ) {
    assertWarehouseAccess(user, id, 'view');
    const result = await this.service.stock(user.companyId, id, query, warehouseScopeOf(user));
    const grants = grantsOf(user);
    const mayReadCosts =
      canReadCost(user) &&
      (grants === null || grants.some((grant) => grant.warehouseId === id && grant.canSeeCost));
    if (mayReadCosts) return result;
    const hideValues = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(hideValues);
      if (value === null || typeof value !== 'object') return value;
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key]) => key !== 'value')
          .map(([key, child]) => [key, hideValues(child)]),
      );
    };
    return hideValues(result);
  }

  @Post()
  @RequirePermissions('inventory.warehouses.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.service.create(
      user.companyId,
      user.userId,
      dto,
      warehouseScopeOf(user),
    );
  }

  @Patch(':id')
  @RequirePermissions('inventory.warehouses.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.service.update(
      user.companyId,
      user.userId,
      id,
      dto,
      warehouseScopeOf(user),
    );
  }

  /// A warehouse is never deleted: documents name it forever. It is switched
  /// off, and can be switched back on.
  @Post(':id/deactivate')
  @RequirePermissions('inventory.warehouses.manage')
  deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.deactivate(
      user.companyId,
      user.userId,
      id,
      warehouseScopeOf(user),
    );
  }

  @Post(':id/reactivate')
  @RequirePermissions('inventory.warehouses.manage')
  reactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reactivate(
      user.companyId,
      user.userId,
      id,
      warehouseScopeOf(user),
    );
  }
}
