import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { StockService } from './stock.service';

interface StockQuery {
  branchId?: string;
  itemId?: string;
  onlyInStock?: string;
}

@Controller('inventory/stock')
export class StockController {
  constructor(private readonly service: StockService) {}

  @Get()
  @RequirePermissions('inventory.stock.read')
  balances(@CurrentUser() user: AuthUser, @Query() query: StockQuery) {
    return this.service.balances(user.companyId, {
      branchId: query.branchId,
      itemId: query.itemId,
      onlyInStock: query.onlyInStock === 'true',
    });
  }

  @Get(':itemId/ledger')
  @RequirePermissions('inventory.stock.read')
  ledger(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.service.itemLedger(user.companyId, itemId);
  }
}
