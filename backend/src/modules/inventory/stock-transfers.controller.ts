import { BadRequestException, Body, Controller, Get, Headers, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { canReadCost } from '../../common/auth/cost-visibility';
import { assertTransferAccess, assertWarehouseAccess, grantsOf } from '../../common/warehouse/warehouse-access';
import { warehouseScopeOf } from '../../common/warehouse/warehouse.service';
import { StockTransfersService } from './stock-transfers.service';

@Controller('inventory/stock-transfers')
export class StockTransfersController {
  constructor(private readonly service: StockTransfersService) {}

  @Get()
  @RequirePermissions('inventory.transfer.read')
  async list(@CurrentUser() user: AuthUser, @Query() query: Record<string,string>) {
    const rows = await this.service.list(user.companyId, query);
    const branches = warehouseScopeOf(user);
    return this.present(user, rows.filter(row => {
      if (branches && (!branches.includes(row.sourceBranchId) || !branches.includes(row.destinationBranchId))) return false;
      try {
        assertWarehouseAccess(user, row.sourceWarehouseId, 'view');
        assertWarehouseAccess(user, row.destinationWarehouseId, 'view');
        return true;
      } catch { return false; }
    }));
  }

  @Get('report')
  @RequirePermissions('inventory.transfer.report')
  async report(@CurrentUser() user: AuthUser, @Query() query: Record<string,string>) {
    const result = await this.service.report(user.companyId, query);
    const branches = warehouseScopeOf(user);
    const rows = result.rows.filter(row => {
      if (branches && (!branches.includes(row.sourceBranchId) || !branches.includes(row.destinationBranchId))) return false;
      try { assertWarehouseAccess(user, row.sourceWarehouseId, 'view'); assertWarehouseAccess(user, row.destinationWarehouseId, 'view'); return true; } catch { return false; }
    });
    return { rows };
  }

  @Get(':id')
  @RequirePermissions('inventory.transfer.read')
  async one(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const row = await this.service.findOne(user.companyId, id);
    const branches = warehouseScopeOf(user);
    if (branches && (!branches.includes(row.sourceBranchId) || !branches.includes(row.destinationBranchId))) throw new NotFoundException('Stock transfer not found');
    assertWarehouseAccess(user, row.sourceWarehouseId, 'view');
    assertWarehouseAccess(user, row.destinationWarehouseId, 'view');
    return this.present(user, row);
  }

  @Post()
  @RequirePermissions('inventory.transfer.create')
  create(@CurrentUser() user: AuthUser, @Body() body: Parameters<StockTransfersService['create']>[2], @Headers('idempotency-key') key?: string) {
    const idempotencyKey = key?.trim() || body.idempotencyKey;
    assertTransferAccess(user, body.sourceWarehouseId, body.destinationWarehouseId);
    if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header is required');
    return this.present(user, this.service.create(user.companyId, user.userId, { ...body, idempotencyKey }, warehouseScopeOf(user)));
  }

  @Post(':id/review')
  @RequirePermissions('inventory.transfer.review')
  async review(@CurrentUser() user: AuthUser, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    await this.assertPair(user, id, 'approve'); return this.present(user, this.service.review(user.companyId, user.userId, id, key));
  }

  @Post(':id/approve')
  @RequirePermissions('inventory.transfer.approve')
  async approve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    await this.assertPair(user, id, 'approve'); return this.present(user, this.service.approve(user.companyId, user.userId, id, key));
  }

  @Post(':id/reject')
  @RequirePermissions('inventory.transfer.review')
  async reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { reason: string }, @Headers('idempotency-key') key: string) {
    await this.assertPair(user, id, 'approve'); return this.present(user, this.service.reject(user.companyId, user.userId, id, key, body.reason));
  }

  @Post(':id/dispatch')
  @RequirePermissions('inventory.transfer.dispatch')
  async dispatch(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { lines?: Array<{lineId:string;quantity:string|number}> }, @Headers('idempotency-key') key: string) {
    await this.assertPair(user, id, 'transfer'); return this.present(user, this.service.dispatch(user.companyId, user.userId, id, key, body.lines));
  }

  @Post(':id/receive')
  @RequirePermissions('inventory.transfer.receive')
  async receive(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { lines: Array<{lineId:string;quantity:string|number}> }, @Headers('idempotency-key') key: string) {
    await this.assertPair(user, id, 'receive'); return this.present(user, this.service.receive(user.companyId, user.userId, id, key, body.lines));
  }

  @Post(':id/settle')
  @RequirePermissions('inventory.transfer.settle')
  async settle(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { lines: Array<{lineId:string;quantity?:string|number;shortage?:string|number;damage?:string|number;reason:string}> }, @Headers('idempotency-key') key: string) {
    await this.assertPair(user, id, 'approve'); return this.present(user, this.service.settle(user.companyId, user.userId, id, key, body.lines));
  }

  @Post(':id/settle/approve')
  @RequirePermissions('inventory.transfer.settle.approve')
  async approveSettlement(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.assertPair(user, id, 'approve');
    return this.present(user, this.service.approveSettlement(user.companyId, user.userId, id));
  }

  @Post(':id/close')
  @RequirePermissions('inventory.transfer.close')
  async close(@CurrentUser() user: AuthUser, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    await this.assertPair(user, id, 'approve'); return this.present(user, this.service.close(user.companyId, user.userId, id, key));
  }

  @Post(':id/cancel')
  @RequirePermissions('inventory.transfer.cancel')
  async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    const row = await this.assertPair(user, id, 'transfer');
    assertWarehouseAccess(user, row.destinationWarehouseId, 'transfer');
    return this.present(user, this.service.cancel(user.companyId, user.userId, id, key));
  }

  private async present(user: AuthUser, value: unknown): Promise<unknown> {
    const result: unknown = await value;
    const redact = (candidate: unknown): unknown => {
      if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
      const row = candidate as Record<string, unknown>;
      if (!Array.isArray(row.lines)) return row;
      const grants = grantsOf(user);
      const warehouseIds = [row.sourceWarehouseId, row.destinationWarehouseId].filter((id): id is string => typeof id === 'string');
      const mayRead = canReadCost(user) && (grants === null || warehouseIds.every(id => grants.some(g => g.warehouseId === id && g.canSeeCost)));
      if (mayRead) return row;
      const safeLines = (row.lines as Array<Record<string, unknown>>).map(line => {
        const safe = { ...line };
        delete safe.unitCost;
        return safe;
      });
      return { ...row, lines: safeLines };
    };
    return Array.isArray(result) ? result.map(redact) : redact(result);
  }

  private async assertPair(user: AuthUser, id: string, action: 'view'|'receive'|'transfer'|'approve') {
    const row = await this.service.findOne(user.companyId, id);
    const branches = warehouseScopeOf(user);
    if (branches && (!branches.includes(row.sourceBranchId) || !branches.includes(row.destinationBranchId))) throw new NotFoundException('Stock transfer not found');
    assertWarehouseAccess(user, row.sourceWarehouseId, action === 'receive' ? 'view' : action);
    assertWarehouseAccess(user, row.destinationWarehouseId, action === 'transfer' ? 'view' : action);
    return row;
  }
}
