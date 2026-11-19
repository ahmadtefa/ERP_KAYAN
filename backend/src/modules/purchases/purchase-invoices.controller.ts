import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { canReadCost } from '../../common/auth/cost-visibility';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreatePurchaseInvoiceDto,
  ListPurchaseInvoicesDto,
} from './dto/purchase-invoice.dto';
import { PurchaseInvoicesService } from './purchase-invoices.service';

@Controller('purchases/invoices')
export class PurchaseInvoicesController {
  constructor(private readonly service: PurchaseInvoicesService) {}

  @Get()
  @RequirePermissions('purchases.invoices.read')
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListPurchaseInvoicesDto) {
    return this.service.findAll(user.companyId, query);
  }

  @Get(':id')
  @RequirePermissions('purchases.invoices.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id, canReadCost(user));
  }

  @Post()
  @RequirePermissions('purchases.invoices.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePurchaseInvoiceDto) {
    return this.service.create(user.companyId, user.branchId, user.userId, dto, undefined, canReadCost(user));
  }

  @Put(':id')
  @RequirePermissions('purchases.invoices.create')
  updateDraft(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreatePurchaseInvoiceDto,
  ) {
    return this.service.updateDraft(user.companyId, user.branchId, user.userId, id, dto, canReadCost(user));
  }

  @Put(':id/order-allocation')
  @RequirePermissions('purchases.orders.read', 'purchases.invoices.create')
  updateOrderAllocation(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.updateOrderAllocation(user.companyId, user.branchId, user.userId, id, dto ?? {}, canReadCost(user));
  }

  @Delete(':id')
  @RequirePermissions('purchases.invoices.create')
  cancelDraft(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.cancelDraft(user.companyId, user.branchId, user.userId, id);
  }

  @Post(':id/post')
  @RequirePermissions('purchases.invoices.post')
  post(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.post(user.companyId, user.userId, id, canReadCost(user));
  }

  @Post(':id/reverse')
  @RequirePermissions('purchases.invoices.post')
  reverse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reverse(user.companyId, user.userId, id, canReadCost(user));
  }
}
