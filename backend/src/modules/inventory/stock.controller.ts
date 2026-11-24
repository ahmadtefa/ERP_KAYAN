import { Controller, ForbiddenException, Get, Param, Query } from '@nestjs/common';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { canReadCost } from '../../common/auth/cost-visibility';
import { grantsOf } from '../../common/warehouse/warehouse-access';
import { scopedBranchId, visibleWarehouseIds, warehouseScopeOf } from '../../common/warehouse/warehouse.service';
import { StockService } from './stock.service';

interface StockQuery {
  branchId?: string;
  itemId?: string;
  itemIds?: string;
  onlyInStock?: string;
}

@Controller('inventory/stock')
export class StockController {
  constructor(private readonly service: StockService) {}

  @Get()
  @RequirePermissions('inventory.stock.read')
  balances(@CurrentUser() user: AuthUser, @Query() query: StockQuery) {
    if (grantsOf(user) !== null) {
      throw new ForbiddenException(
        'Branch-wide stock totals are unavailable with restricted warehouse access. Use the warehouse balance view. / إجمالي الفرع غير متاح مع تقييد صلاحيات المستودعات.',
      );
    }
    return this.service.balances(
      user.companyId,
      {
        // A `branchId` typed by the client is checked against the caller's
        // assignment; without one, a single-branch account is pinned to it.
        branchId: scopedBranchId(user, query.branchId),
        itemId: query.itemId,
        onlyInStock: query.onlyInStock === 'true',
      },
      canReadCost(user),
      visibleWarehouseIds(user),
    );
  }

  /// The same balances split by the warehouse the movements name. The
  /// picker shows both: the branch total and where it actually sits.
  @Get('by-warehouse')
  @RequirePermissions('inventory.stock.read')
  byWarehouse(@CurrentUser() user: AuthUser, @Query() query: StockQuery) {
    const itemIds = (query.itemIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    return this.service.byWarehouse(
      user.companyId,
      {
        branchId: scopedBranchId(user, query.branchId),
        itemIds: itemIds.length ? itemIds : undefined,
      },
      visibleWarehouseIds(user),
    );
  }

  @Get(':itemId/ledger')
  @RequirePermissions('inventory.stock.read')
  ledger(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    const grants = grantsOf(user);
    const visible = grants?.filter((grant) => grant.canView) ?? [];
    const mayReadCosts =
      canReadCost(user) && (grants === null || visible.every((grant) => grant.canSeeCost));
    return this.service.itemLedger(
      user.companyId,
      itemId,
      mayReadCosts,
      visibleWarehouseIds(user),
      // An item exists once for the whole company, so the ledger is the one
      // place where "which branch" has to be decided by the caller's
      // assignment rather than by a filter the client chooses.
      warehouseScopeOf(user),
    );
  }
}
