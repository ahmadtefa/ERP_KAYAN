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
import { InventoryAnalysisController } from './inventory-analysis.controller';
import { InventoryAnalysisService } from './inventory-analysis.service';
import { InventoryReportsController } from './inventory-reports.controller';
import { InventoryReportsService } from './inventory-reports.service';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { StockController } from './stock.controller';
import { StockDocumentsController } from './stock-documents.controller';
import { StockDocumentsService } from './stock-documents.service';
import { StockService } from './stock.service';
import { StockTakesController } from './stock-takes.controller';
import { StockTakesService } from './stock-takes.service';
import { ItemImageController, ItemPictureIndexController } from './item-image.controller';
import { ItemImageService } from './item-image.service';
import { WarehouseAccessController } from './warehouse-access.controller';
import { WarehouseAccessService } from './warehouse-access.service';
import { WarehousesController } from './warehouses.controller';

@Module({
  imports: [PrismaModule, AuditModule, AccountingModule, ExportModule],
  controllers: [
    // Ahead of ItemsController on purpose: its `GET :id` would otherwise
    // swallow `items/with-picture` and try to read an item literally called
    // "with-picture". Nest matches routes in registration order.
    ItemPictureIndexController,
    ItemsController,
    StockController,
    StockDocumentsController,
    InventoryReportsController,
    InventoryAnalysisController,
    InventoryPrintController,
    WarehousesController,
    BatchesController,
    StorageLocationsController,
    ItemWarehouseSettingsController,
    StockTakesController,
    WarehouseAccessController,
    ItemImageController,
  ],
  providers: [
    ItemsService,
    StockService,
    StockDocumentsService,
    InventoryReportsService,
    InventoryAnalysisService,
    BarcodeLabelsService,
    BatchesService,
    StorageLocationsService,
    ItemWarehouseSettingsService,
    StockTakesService,
    WarehouseAccessService,
    ItemImageService,
  ],
  exports: [
    StockService,
    StockDocumentsService,
    InventoryReportsService,
    // Sales and purchases post through the lot engine, so it is exported
    // rather than duplicated.
    BatchesService,
    StockTakesService,
  ],
})
export class InventoryModule {}
