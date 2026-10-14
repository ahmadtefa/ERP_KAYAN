import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ReturnsService } from './returns.service';

/// Sales returns (credit notes) and purchase returns (debit notes).
///
/// They live under their own routes because a return is a document a person
/// looks for by name, not a filter they have to remember to set on an invoice
/// list.
@Controller('returns')
export class ReturnsController {
  constructor(private readonly service: ReturnsService) {}

  @Get('sales')
  @RequirePermissions('sales.invoices.read')
  listSales(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.service.findAll(user.companyId, 'sales', {
      from: query.from,
      to: query.to,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    });
  }

  @Get('sales/:id')
  @RequirePermissions('sales.invoices.read')
  getSales(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, 'sales', id);
  }

  @Post('sales')
  @RequirePermissions('sales.invoices.create')
  createSales(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.service.createSalesReturn(user.companyId, user.branchId, user.userId, body as never);
  }

  @Post('sales/:id/post')
  @RequirePermissions('sales.invoices.post')
  postSales(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.postSalesReturn(user.companyId, user.userId, id);
  }

  @Post('sales/:id/reverse')
  @RequirePermissions('sales.invoices.post')
  reverseSales(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reverse(user.companyId, user.userId, 'sales', id);
  }

  @Get('purchases')
  @RequirePermissions('purchases.invoices.read')
  listPurchases(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.service.findAll(user.companyId, 'purchases', {
      from: query.from,
      to: query.to,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    });
  }

  @Get('purchases/:id')
  @RequirePermissions('purchases.invoices.read')
  getPurchase(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, 'purchases', id);
  }

  @Post('purchases')
  @RequirePermissions('purchases.invoices.create')
  createPurchase(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.service.createPurchaseReturn(
      user.companyId,
      user.branchId,
      user.userId,
      body as never,
    );
  }

  @Post('purchases/:id/post')
  @RequirePermissions('purchases.invoices.post')
  postPurchase(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.postPurchaseReturn(user.companyId, user.userId, id);
  }

  @Post('purchases/:id/reverse')
  @RequirePermissions('purchases.invoices.post')
  reversePurchase(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reverse(user.companyId, user.userId, 'purchases', id);
  }
}
