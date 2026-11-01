import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { canReadCost } from '../../common/auth/cost-visibility';
import { assertWarehouseAccess } from '../../common/warehouse/warehouse-access';
import { StockDocumentsService } from './stock-documents.service';

/// Adjustments, transfers and physical counts. Separate permissions for
/// reading, creating and posting, because writing stock off is not the same
/// job as recording that it was counted.
@Controller('inventory/stock-documents')
export class StockDocumentsController {
  constructor(private readonly service: StockDocumentsService) {}

  @Get()
  @RequirePermissions('inventory.stock.read')
  findAll(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.service.findAll(user.companyId, {
      kind: query.kind,
      branchId: query.branchId,
      from: query.from,
      to: query.to,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions('inventory.stock.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id, canReadCost(user));
  }

  @Post()
  @RequirePermissions('inventory.stock.adjust')
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: Record<string, unknown>,
    // A retry after a dropped connection carries the same key and gets the
    // same document back, instead of booking a second loss.
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const kind = String(body.kind ?? '').toUpperCase();
    if (kind === 'WRITE_OFF') {
      assertWarehouseAccess(user, body.toWarehouseId as string, 'transfer');
    }
    return this.service.create(user.companyId, user.branchId, user.userId, body as never, {
      idempotencyKey: idempotencyKey?.trim() || undefined,
    });
  }

  /// Approves a write-off. Its own permission: recording a loss and accepting
  /// it are two different people's jobs.
  @Post(':id/approve')
  @RequirePermissions('inventory.writeoff.approve')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.approve(user.companyId, user.userId, id);
  }

  @Post(':id/post')
  @RequirePermissions('inventory.stock.adjust')
  post(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.post(user.companyId, user.userId, id);
  }

  @Post(':id/write-off/post')
  @RequirePermissions('inventory.writeoff.post')
  postWriteOff(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.post(user.companyId, user.userId, id);
  }

  @Post(':id/reverse')
  @RequirePermissions('inventory.stock.adjust')
  reverse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reverse(user.companyId, user.userId, id);
  }
}
