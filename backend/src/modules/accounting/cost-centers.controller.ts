import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CostCentersService } from './cost-centers.service';

@Controller('accounting/cost-centers')
export class CostCentersController {
  constructor(private readonly service: CostCentersService) {}

  @Get()
  @RequirePermissions('reports.read')
  findAll(@CurrentUser() user: AuthUser, @Query('includeInactive') includeInactive?: string) {
    return this.service.findAll(user.companyId, { includeInactive: includeInactive === 'true' });
  }

  @Get(':id')
  @RequirePermissions('reports.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }

  @Post()
  @RequirePermissions('accounting.costcenters.manage')
  create(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.service.create(user.companyId, user.userId, body);
  }

  @Patch(':id')
  @RequirePermissions('accounting.costcenters.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.update(user.companyId, user.userId, id, body);
  }

  @Delete(':id')
  @RequirePermissions('accounting.costcenters.manage')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.companyId, user.userId, id);
  }
}
