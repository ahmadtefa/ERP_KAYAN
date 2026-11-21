import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { canReadCost, canReadPurchasePrice } from '../../common/auth/cost-visibility';
import { redactPriceFields } from '../../common/auth/price-redaction';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreatePurchaseInvoiceDto,
  ListPurchaseInvoicesDto,
} from './dto/purchase-invoice.dto';
import { PurchaseInvoicesService } from './purchase-invoices.service';

@Controller('purchases/invoices')
export class PurchaseInvoicesController {
  constructor(private readonly service: PurchaseInvoicesService) {}

  private redact(user: AuthUser, response: unknown) {
    return redactPriceFields(response, { sale: true, purchase: canReadPurchasePrice(user), cost: canReadCost(user) }, 'purchase');
  }

  @Get()
  @RequirePermissions('purchases.invoices.read')
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListPurchaseInvoicesDto) {
    return this.service.findAll(user.companyId, query, canReadCost(user)).then((result) => this.redact(user, result));
  }

  @Get(':id')
  @RequirePermissions('purchases.invoices.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id, canReadCost(user)).then((result) => this.redact(user, result));
  }

  @Post()
  @RequirePermissions('purchases.invoices.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePurchaseInvoiceDto) {
    return this.service.create(user.companyId, user.branchId, user.userId, dto, undefined, canReadCost(user)).then((result) => this.redact(user, result));
  }

  @Put(':id')
  @RequirePermissions('purchases.invoices.create')
  updateDraft(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreatePurchaseInvoiceDto,
  ) {
    return this.service.updateDraft(user.companyId, user.branchId, user.userId, id, dto, canReadCost(user)).then((result) => this.redact(user, result));
  }

  @Put(':id/order-allocation')
  @RequirePermissions('purchases.orders.read', 'purchases.invoices.create')
  updateOrderAllocation(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.updateOrderAllocation(user.companyId, user.branchId, user.userId, id, dto ?? {}, canReadCost(user)).then((result) => this.redact(user, result));
  }

  @Delete(':id')
  @RequirePermissions('purchases.invoices.create')
  cancelDraft(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.cancelDraft(user.companyId, user.branchId, user.userId, id);
  }

  @Post(':id/post')
  @RequirePermissions('purchases.invoices.post')
  post(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.post(user.companyId, user.userId, id, canReadCost(user)).then((result) => this.redact(user, result));
  }

  @Post(':id/reverse')
  @RequirePermissions('purchases.invoices.post')
  reverse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reverse(user.companyId, user.userId, id, canReadCost(user)).then((result) => this.redact(user, result));
  }
}
