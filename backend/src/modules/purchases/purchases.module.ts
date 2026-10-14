import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { SalesModule } from '../sales/sales.module';
import { PurchaseInvoicesController } from './purchase-invoices.controller';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';

@Module({
  imports: [AccountingModule, SalesModule],
  controllers: [PurchaseInvoicesController, PurchaseOrdersController],
  providers: [PurchaseInvoicesService, PurchaseOrdersService],
  exports: [PurchaseInvoicesService, PurchaseOrdersService],
})
export class PurchasesModule {}
