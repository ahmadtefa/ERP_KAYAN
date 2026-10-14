import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryReportsController } from './inventory-reports.controller';
import { InventoryReportsService } from './inventory-reports.service';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { StockController } from './stock.controller';
import { StockDocumentsController } from './stock-documents.controller';
import { StockDocumentsService } from './stock-documents.service';
import { StockService } from './stock.service';
import { WarehousesController } from './warehouses.controller';

@Module({
  imports: [PrismaModule, AuditModule, AccountingModule],
  controllers: [
    ItemsController,
    StockController,
    StockDocumentsController,
    InventoryReportsController,
    WarehousesController,
  ],
  providers: [ItemsService, StockService, StockDocumentsService, InventoryReportsService],
  exports: [StockService, StockDocumentsService, InventoryReportsService],
})
export class InventoryModule {}
