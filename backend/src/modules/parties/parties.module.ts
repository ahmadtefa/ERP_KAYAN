import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { PartiesService } from './parties.service';
import { SuppliersController } from './suppliers.controller';

@Module({
  controllers: [CustomersController, SuppliersController],
  providers: [PartiesService],
})
export class PartiesModule {}
