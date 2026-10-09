import { Module } from '@nestjs/common';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';

@Module({
  controllers: [ItemsController, StockController],
  providers: [ItemsService, StockService],
  exports: [StockService],
})
export class InventoryModule {}
