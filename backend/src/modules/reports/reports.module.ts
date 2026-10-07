import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
  // The exporter renders the same numbers as files, so it reads the same
  // service rather than re-deriving them.
  exports: [ReportsService],
})
export class ReportsModule {}
