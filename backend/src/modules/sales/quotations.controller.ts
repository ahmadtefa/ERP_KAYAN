import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { QuotationsService } from './quotations.service';

@Controller('sales/quotations')
export class QuotationsController {
  constructor(private readonly service: QuotationsService) {}

  @Get()
  @RequirePermissions('sales.orders.read')
  findAll(@CurrentUser() user: AuthUser, @Query() query: { status?: string; customerId?: string; page?: number; pageSize?: number }) {
    return this.service.findAll(user.companyId, query);
  }

  @Get('terms')
  @RequirePermissions('sales.orders.read')
  terms(@CurrentUser() user: AuthUser) {
    return this.service.listTerms(user.companyId);
  }

  @Post('terms')
  @RequirePermissions('sales.orders.manage')
  createTerm(@CurrentUser() user: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.service.createTerm(user.companyId, user.userId, dto);
  }

  @Put('terms/:id')
  @RequirePermissions('sales.orders.manage')
  updateTerm(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.updateTerm(user.companyId, user.userId, id, dto);
  }

  @Delete('terms/:id')
  @RequirePermissions('sales.orders.manage')
  deleteTerm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.deleteTerm(user.companyId, user.userId, id);
  }

  @Get(':id')
  @RequirePermissions('sales.orders.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }

  @Post()
  @RequirePermissions('sales.orders.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.service.create(user.companyId, user.branchId, user.userId, dto);
  }

  @Put(':id')
  @RequirePermissions('sales.orders.manage')
  updateDraft(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.updateDraft(user.companyId, user.branchId, user.userId, id, dto);
  }

  @Post(':id/issue')
  @RequirePermissions('sales.orders.approve')
  issue(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.issue(user.companyId, user.userId, id);
  }

  @Post(':id/accept')
  @RequirePermissions('sales.orders.approve')
  accept(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.accept(user.companyId, user.userId, id);
  }

  @Post(':id/reject')
  @RequirePermissions('sales.orders.approve')
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reject(user.companyId, user.userId, id);
  }

  @Post(':id/convert-to-invoice')
  @RequirePermissions('sales.orders.read', 'sales.invoices.create')
  convert(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.convertToInvoice(user.companyId, user.branchId, user.userId, id);
  }
}
