import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { ExportModule } from '../export/export.module';
import { PriceListsController } from './price-lists.controller';
import { PriceListsService } from './price-lists.service';
import { SalesInvoicesController } from './sales-invoices.controller';
import { SalesInvoicesService } from './sales-invoices.service';
import { SalesOrdersController } from './sales-orders.controller';
import { SalesOrdersService } from './sales-orders.service';
import { QuotationColumnTemplatesController } from './quotation-column-templates.controller';
import { QuotationColumnTemplatesService } from './quotation-column-templates.service';
import { QuotationDesignTemplatesController } from './quotation-design-templates.controller';
import { QuotationDesignTemplatesService } from './quotation-design-templates.service';
import { QuotationTermsController } from './quotation-terms.controller';
import { QuotationTermsService } from './quotation-terms.service';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';

@Module({
  imports: [AccountingModule, ExportModule],
  controllers: [
    SalesInvoicesController,
    SalesOrdersController,
    PriceListsController,
    QuotationsController,
    QuotationTermsController,
    QuotationColumnTemplatesController,
    QuotationDesignTemplatesController,
  ],
  providers: [
    SalesInvoicesService,
    SalesOrdersService,
    PriceListsService,
    QuotationsService,
    QuotationTermsService,
    QuotationColumnTemplatesService,
    QuotationDesignTemplatesService,
  ],
  exports: [SalesInvoicesService, SalesOrdersService, PriceListsService, QuotationsService],
})
export class SalesModule {}
