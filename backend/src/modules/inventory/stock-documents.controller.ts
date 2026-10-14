import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
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
    return this.service.findOne(user.companyId, id);
  }

  @Post()
  @RequirePermissions('inventory.stock.adjust')
  create(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.service.create(user.companyId, user.branchId, user.userId, body as never);
  }

  @Post(':id/post')
  @RequirePermissions('inventory.stock.adjust')
  post(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.post(user.companyId, user.userId, id);
  }

  @Post(':id/reverse')
  @RequirePermissions('inventory.stock.adjust')
  reverse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reverse(user.companyId, user.userId, id);
  }
}
