import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { SalesInvoicesController } from './sales-invoices.controller';
import { SalesInvoicesService } from './sales-invoices.service';

@Module({
  imports: [AccountingModule],
  controllers: [SalesInvoicesController],
  providers: [SalesInvoicesService],
})
export class SalesModule {}
