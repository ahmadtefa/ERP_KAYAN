import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateSalesInvoiceDto,
  ListInvoicesDto,
} from './dto/sales-invoice.dto';
import { SalesInvoicesService } from './sales-invoices.service';

@Controller('sales/invoices')
export class SalesInvoicesController {
  constructor(private readonly service: SalesInvoicesService) {}

  @Get()
  @RequirePermissions('sales.invoices.read')
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListInvoicesDto) {
    return this.service.findAll(user.companyId, query);
  }

  @Get(':id')
  @RequirePermissions('sales.invoices.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }

  @Post()
  @RequirePermissions('sales.invoices.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSalesInvoiceDto) {
    return this.service.create(user.companyId, user.branchId, user.userId, dto);
  }

  @Put(':id')
  @RequirePermissions('sales.invoices.create')
  updateDraft(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateSalesInvoiceDto,
  ) {
    return this.service.updateDraft(user.companyId, user.branchId, user.userId, id, dto);
  }

  @Post(':id/post')
  @RequirePermissions('sales.invoices.post')
  post(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.post(user.companyId, user.userId, id);
  }

  @Post(':id/reverse')
  @RequirePermissions('sales.invoices.post')
  reverse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reverse(user.companyId, user.userId, id);
  }
}
