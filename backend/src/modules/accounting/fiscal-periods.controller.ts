import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateFiscalPeriodDto,
  ListFiscalPeriodsDto,
  UpdateFiscalPeriodDto,
} from './dto/fiscal-period.dto';
import { FiscalPeriodsService } from './fiscal-periods.service';

@Controller('accounting/fiscal-periods')
export class FiscalPeriodsController {
  constructor(private readonly periods: FiscalPeriodsService) {}

  @Get()
  @RequirePermissions('accounting.periods.read')
  list(@CurrentUser() user: AuthUser, @Query() query: ListFiscalPeriodsDto) {
    return this.periods.list(user.companyId, query);
  }

  @Post()
  @RequirePermissions('accounting.periods.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFiscalPeriodDto) {
    return this.periods.create(user.companyId, user.userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('accounting.periods.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFiscalPeriodDto,
  ) {
    return this.periods.update(user.companyId, user.userId, id, dto);
  }

  @Post(':id/close')
  @RequirePermissions('accounting.periods.manage')
  close(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.periods.close(user.companyId, user.userId, id);
  }
}
