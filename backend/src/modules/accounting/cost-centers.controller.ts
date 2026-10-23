import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CostCentersService } from './cost-centers.service';

@Controller('accounting/cost-centers')
export class CostCentersController {
  constructor(private readonly service: CostCentersService) {}

  @Get()
  @RequirePermissions('accounting.costcenters.read')
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('includeInactive') includeInactive?: string,
    @Query('q') q?: string,
    @Query('type') type?: string,
    @Query('parentId') parentId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.findAll(user.companyId, {
      includeInactive: includeInactive === 'true',
      q,
      type,
      // `parentId=root` is the only way a query string can say "the roots";
      // a missing value means "everything", which would otherwise be the same
      // string as "no parent".
      parentId:
        parentId === undefined ? undefined : parentId === 'root' ? null : parentId,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  /// The whole hierarchy with a depth per row, for the tree view and the parent
  /// selectors. Declared before `:id` so it is not swallowed by it.
  @Get('tree')
  @RequirePermissions('accounting.costcenters.read')
  tree(
    @CurrentUser() user: AuthUser,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.service.tree(user.companyId, {
      includeInactive: includeInactive === 'true',
    });
  }

  @Get(':id')
  @RequirePermissions('accounting.costcenters.read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }

  /// How many journal lines and allocations point at this centre. The UI uses
  /// it to explain why a delete was refused.
  @Get(':id/usage')
  @RequirePermissions('accounting.costcenters.read')
  usage(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.usage(user.companyId, id);
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
