import { Controller, Get, Query } from '@nestjs/common';

import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { SearchService } from './search.service';

/// The one search box: documents, partners and items answered together.
@Controller('search')
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  @RequirePermissions('reports.read')
  search(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.search(user.companyId, q ?? '', limit ? Number(limit) : 8);
  }
}
