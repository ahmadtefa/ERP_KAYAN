import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ContractInput, ContractsService } from './contracts.service';

@Controller('contracts')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get()
  @RequirePermissions('contracts.read')
  list(@CurrentUser() user: AuthUser) {
    return this.contracts.list(user.companyId);
  }

  @Post()
  @RequirePermissions('contracts.manage')
  create(@CurrentUser() user: AuthUser, @Body() body: ContractInput) {
    return this.contracts.create(user.companyId, user.userId, body);
  }

  @Post('claims/:claimId/approve')
  @RequirePermissions('contracts.claim.approve')
  approve(@CurrentUser() user: AuthUser, @Param('claimId', ParseUUIDPipe) claimId: string) {
    return this.contracts.approveClaim(user.companyId, user.branchId, user.userId, claimId);
  }

  @Post('claims/:claimId/cancel')
  @RequirePermissions('contracts.claim.create')
  cancel(@CurrentUser() user: AuthUser, @Param('claimId', ParseUUIDPipe) claimId: string) {
    return this.contracts.cancelClaim(user.companyId, user.userId, claimId);
  }

  @Get(':id')
  @RequirePermissions('contracts.read')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.contracts.get(user.companyId, id);
  }

  @Get(':id/preview')
  @RequirePermissions('contracts.claim.create')
  preview(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('cumulativeWork') cumulativeWork: string) {
    return this.contracts.preview(user.companyId, id, cumulativeWork);
  }

  @Post(':id/variations')
  @RequirePermissions('contracts.manage')
  variation(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { variationDate?: string; amount?: unknown; note?: string }) {
    return this.contracts.addVariation(user.companyId, user.userId, id, body);
  }

  @Post(':id/claims')
  @RequirePermissions('contracts.claim.create')
  claim(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { claimDate?: string; cumulativeWork?: unknown; note?: string }) {
    return this.contracts.createClaim(user.companyId, user.userId, id, body);
  }

  @Post(':id/retention-releases')
  @RequirePermissions('contracts.manage')
  release(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { releaseDate?: string; amount?: unknown; note?: string }) {
    return this.contracts.releaseRetention(user.companyId, user.userId, id, body);
  }

  @Post(':id/status')
  @RequirePermissions('contracts.manage')
  status(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { status?: string }) {
    return this.contracts.setStatus(user.companyId, user.userId, id, body.status === 'CLOSED' ? 'CLOSED' : 'OPEN');
  }
}
