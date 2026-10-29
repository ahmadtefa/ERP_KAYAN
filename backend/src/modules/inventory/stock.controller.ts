import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { canReadCost } from '../../common/auth/cost-visibility';
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
    return this.service.balances(
      user.companyId,
      {
        branchId: query.branchId,
        itemId: query.itemId,
        onlyInStock: query.onlyInStock === 'true',
      },
      canReadCost(user),
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
    return this.service.byWarehouse(user.companyId, {
      branchId: query.branchId,
      itemIds: itemIds.length ? itemIds : undefined,
    });
  }

  @Get(':itemId/ledger')
  @RequirePermissions('inventory.stock.read')
  ledger(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.service.itemLedger(user.companyId, itemId, canReadCost(user));
  }
}
