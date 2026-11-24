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
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { branchReadScope } from '../auth/branch-read-scope';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { APPROVAL_OPERATIONS, ApprovalsService, PolicyInput } from './approvals.service';

/// Approval configuration and history.
///
/// Reading the policy list needs `admin.approvals.read`; changing a policy
/// needs `admin.approvals.manage`. Both are separate from the right to decide
/// a level: an operator who may approve a transfer cannot widen the rule that
/// governs it.
@Controller('admin/approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get('operations')
  @RequirePermissions('admin.approvals.read')
  operations() {
    return { items: APPROVAL_OPERATIONS };
  }

  @Get('policies')
  @RequirePermissions('admin.approvals.read')
  policies(@CurrentUser() user: AuthUser) {
    return this.approvals.listPolicies(user.companyId);
  }

  @Post('policies')
  @RequirePermissions('admin.approvals.manage')
  create(@CurrentUser() user: AuthUser, @Body() body: PolicyInput) {
    return this.approvals.createPolicy(this.actor(user), body);
  }

  @Patch('policies/:id')
  @RequirePermissions('admin.approvals.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: PolicyInput,
  ) {
    return this.approvals.updatePolicy(this.actor(user), id, body);
  }

  @Delete('policies/:id')
  @RequirePermissions('admin.approvals.manage')
  remove(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.approvals.deletePolicy(this.actor(user), id);
  }

  /// The path a document took, oldest decision first. Guarded by the read
  /// permission rather than by tenant alone, and the service scopes every
  /// query by company.
  @Get('history/:entityType/:entityId')
  @RequirePermissions('admin.approvals.read')
  history(
    @CurrentUser() user: AuthUser,
    @Param('entityType') entityType: string,
    @Param('entityId', new ParseUUIDPipe()) entityId: string,
  ) {
    return this.approvals.history(user.companyId, entityType, entityId, branchReadScope(user));
  }

  private actor(user: AuthUser) {
    return {
      userId: user.userId,
      companyId: user.companyId,
      permissions: user.permissions,
      roles: user.roles ?? [],
    };
  }
}
