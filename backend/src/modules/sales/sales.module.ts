import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { PriceListsController } from './price-lists.controller';
import { PriceListsService } from './price-lists.service';
import { SalesInvoicesController } from './sales-invoices.controller';
import { SalesInvoicesService } from './sales-invoices.service';
import { SalesOrdersController } from './sales-orders.controller';
import { SalesOrdersService } from './sales-orders.service';

@Module({
  imports: [AccountingModule],
  controllers: [SalesInvoicesController, SalesOrdersController, PriceListsController],
  providers: [SalesInvoicesService, SalesOrdersService, PriceListsService],
  exports: [SalesInvoicesService, SalesOrdersService, PriceListsService],
})
export class SalesModule {}
