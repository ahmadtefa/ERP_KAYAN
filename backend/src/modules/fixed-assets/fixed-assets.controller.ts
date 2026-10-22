import {
  Body,
  Controller,
  Delete,
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
  ActivateFixedAssetDto,
  CreateFixedAssetDto,
  DisposeFixedAssetDto,
  ListDepreciationRunsDto,
  ListFixedAssetsDto,
  RunDepreciationDto,
  UpdateFixedAssetDto,
} from './dto/fixed-asset.dto';
import { FixedAssetsService } from './fixed-assets.service';

@Controller('fixed-assets')
export class FixedAssetsController {
  constructor(private readonly service: FixedAssetsService) {}

  // Named routes first: ':id' below must never swallow them.

  @Post('depreciation-runs')
  @RequirePermissions('accounting.fixedassets.depreciate')
  runDepreciation(@CurrentUser() user: AuthUser, @Body() dto: RunDepreciationDto) {
    return this.service.runDepreciation(user.companyId, user.branchId, user.userId, dto);
  }

  @Get('depreciation-runs')
  @RequirePermissions('accounting.fixedassets.read')
  listRuns(@CurrentUser() user: AuthUser, @Query() query: ListDepreciationRunsDto) {
    return this.service.listRuns(user.companyId, query);
  }

  @Get('reports/summary')
  @RequirePermissions('accounting.fixedassets.read')
  summary(@CurrentUser() user: AuthUser) {
    return this.service.summary(user.companyId);
  }

  @Get('purchase-lines')
  @RequirePermissions('accounting.fixedassets.read')
  purchaseLines(@CurrentUser() user: AuthUser) {
    return this.service.purchaseLines(user.companyId);
  }

  @Get()
  @RequirePermissions('accounting.fixedassets.read')
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListFixedAssetsDto) {
    return this.service.findAll(user.companyId, query);
  }

  @Post()
  @RequirePermissions('accounting.fixedassets.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFixedAssetDto) {
    return this.service.create(user.companyId, user.branchId, user.userId, dto);
  }

  @Get(':id')
  @RequirePermissions('accounting.fixedassets.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(user.companyId, id);
  }

  @Patch(':id')
  @RequirePermissions('accounting.fixedassets.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFixedAssetDto,
  ) {
    return this.service.update(user.companyId, user.userId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('accounting.fixedassets.manage')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(user.companyId, user.userId, id);
  }

  @Post(':id/activate')
  @RequirePermissions('accounting.fixedassets.manage')
  activate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActivateFixedAssetDto,
  ) {
    return this.service.activate(user.companyId, user.userId, id, dto);
  }

  @Post(':id/dispose')
  @RequirePermissions('accounting.fixedassets.manage')
  dispose(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DisposeFixedAssetDto,
  ) {
    return this.service.dispose(user.companyId, user.userId, id, dto);
  }
}
