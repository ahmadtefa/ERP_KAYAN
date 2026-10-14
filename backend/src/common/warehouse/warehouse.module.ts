import { Global, Module } from '@nestjs/common';

import { WarehouseService } from './warehouse.service';

/**
 * Warehouses are asked about from every module that moves goods - sales,
 * purchases, returns, stock documents, opening balances - so the service is
 * registered once, globally, rather than imported five times.
 */
@Global()
@Module({
  providers: [WarehouseService],
  exports: [WarehouseService],
})
export class WarehouseModule {}
