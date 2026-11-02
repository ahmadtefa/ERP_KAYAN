import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { ExportModule } from '../export/export.module';
import { BarcodeLabelsService } from './barcode-labels.service';
import { BatchesController } from './batches.controller';
import { BatchesService } from './batches.service';
import { ItemWarehouseSettingsController } from './item-warehouse-settings.controller';
import { ItemWarehouseSettingsService } from './item-warehouse-settings.service';
import { StorageLocationsController } from './locations.controller';
import { StorageLocationsService } from './storage-locations.service';
import { InventoryPrintController } from './inventory-print.controller';
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
  imports: [PrismaModule, AuditModule, AccountingModule, ExportModule],
  controllers: [
    ItemsController,
    StockController,
    StockDocumentsController,
    InventoryReportsController,
    InventoryPrintController,
    WarehousesController,
    BatchesController,
    StorageLocationsController,
    ItemWarehouseSettingsController,
  ],
  providers: [
    ItemsService,
    StockService,
    StockDocumentsService,
    InventoryReportsService,
    BarcodeLabelsService,
    BatchesService,
    StorageLocationsService,
    ItemWarehouseSettingsService,
  ],
  exports: [
    StockService,
    StockDocumentsService,
    InventoryReportsService,
    // Sales and purchases post through the lot engine, so it is exported
    // rather than duplicated.
    BatchesService,
  ],
})
export class InventoryModule {}
