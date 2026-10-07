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
  SetRolePermissionsDto,
  UpdateRoleDto,
} from './dto/role.dto';
import { RolesService } from './roles.service';

@Controller('admin')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

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

  @Get('roles/:id')
  @RequirePermissions('admin.roles.manage')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.roles.findOne(user.companyId, id);
  }

  @Post('roles')
  @RequirePermissions('admin.roles.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRoleDto) {
    return this.roles.create(user.companyId, user.userId, dto);
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
    return this.roles.setPermissions(user.companyId, user.userId, id, dto.permissions);
  }

  @Delete('roles/:id')
  @RequirePermissions('admin.roles.manage')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.roles.remove(user.companyId, user.userId, id);
  }
}
