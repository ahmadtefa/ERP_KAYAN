import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';

import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateRoleDto,
  PreviewRolePermissionsDto,
  SetRolePermissionsDto,
  UpdateRoleDto,
} from './dto/role.dto';
import { RoleCatalogueBootstrap } from './role-catalogue.bootstrap';
import { RolesService } from './roles.service';

@Controller('admin')
export class RolesController {
  constructor(
    private readonly roles: RolesService,
    private readonly catalogue: RoleCatalogueBootstrap,
  ) {}

  @Get('permissions')
  @RequirePermissions('admin.roles.manage')
  permissions() {
    return this.roles.permissions();
  }

  @Get('roles')
  @RequirePermissions('admin.roles.manage')
  list(@CurrentUser() user: AuthUser) {
    return this.roles.list(user.companyId);
  }

  /// What a permission set contains, grouped by module, and what deserves a
  /// second look. Nothing is written: this is the preview before saving.
  @Post('roles/permissions-preview')
  @RequirePermissions('admin.roles.manage')
  previewPermissions(@Body() dto: PreviewRolePermissionsDto) {
    return this.roles.previewPermissions(dto.permissions);
  }

  /// Adds any role the catalogue ships with that this installation is missing.
  /// Idempotent, and the same pass the program runs at start-up.
  @Post('roles/sync-catalogue')
  @RequirePermissions('admin.roles.manage')
  async syncCatalogue(@CurrentUser() user: AuthUser) {
    const result = await this.catalogue.ensureAllCompanies();
    return { ...result, ...(await this.roles.list(user.companyId)) };
  }

  /// Manual one-company upgrade: takes the audit-trail and approvals reads off
  /// the standard Read-only and Reports roles (custom roles untouched).
  @Post('roles/upgrade-standard-read-roles')
  @RequirePermissions('admin.roles.manage')
  async upgradeStandardReadRoles(@CurrentUser() user: AuthUser) {
    return this.catalogue.retireWildcardAdminReads(user.companyId);
  }

  @Get('roles/:id')
  @RequirePermissions('admin.roles.manage')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.roles.findOne(user.companyId, id);
  }

  @Post('roles')
  @RequirePermissions('admin.roles.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRoleDto) {
    return this.roles.create(
      user.companyId,
      user.userId,
      dto,
      user.permissions,
      user.isSuperAdmin,
    );
  }

  @Patch('roles/:id')
  @RequirePermissions('admin.roles.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.roles.update(user.companyId, user.userId, id, dto);
  }

  @Post('roles/:id/permissions')
  @RequirePermissions('admin.roles.manage')
  setPermissions(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRolePermissionsDto,
  ) {
    return this.roles.setPermissions(
      user.companyId,
      user.userId,
      id,
      dto.permissions,
      user.permissions,
      user.isSuperAdmin,
      dto.expectedPermissions,
    );
  }

  @Delete('roles/:id')
  @RequirePermissions('admin.roles.manage')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.roles.remove(user.companyId, user.userId, id);
  }
}
