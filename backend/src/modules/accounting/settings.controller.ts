import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AuditedSuperAdminGuard } from '../../common/guards/audited-super-admin.guard';
import { CompanySettingsService } from '../../common/settings/company-settings.module';

/// The company's policies: tax, discount cap, stock rules, approval, backup
/// retention. Reading them is open to anyone who may read reports; changing
/// them requires the installation super administrator because these are
/// company-wide financial and document policies.
@Controller('accounting/settings')
export class AccountingSettingsController {
  constructor(private readonly settings: CompanySettingsService) {}

  @Get()
  @RequirePermissions('reports.read')
  get(@CurrentUser() user: AuthUser) {
    return this.settings.get(user.companyId);
  }

  @Patch()
  @RequirePermissions('admin.company.manage')
  @UseGuards(AuditedSuperAdminGuard)
  update(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.settings.update(user.companyId, user.userId, body);
  }
}
