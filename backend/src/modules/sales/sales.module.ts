import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { PriceListsController } from './price-lists.controller';
import { PriceListsService } from './price-lists.service';
import { SalesInvoicesController } from './sales-invoices.controller';
import { SalesInvoicesService } from './sales-invoices.service';
import { SalesOrdersController } from './sales-orders.controller';
import { SalesOrdersService } from './sales-orders.service';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';

@Module({
  imports: [AccountingModule],
  controllers: [SalesInvoicesController, SalesOrdersController, PriceListsController, QuotationsController],
  providers: [SalesInvoicesService, SalesOrdersService, PriceListsService, QuotationsService],
  exports: [SalesInvoicesService, SalesOrdersService, PriceListsService],
})
export class SalesModule {}
