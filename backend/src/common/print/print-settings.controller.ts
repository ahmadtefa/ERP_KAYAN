import { Body, Controller, Get, Put } from '@nestjs/common';
import { IsArray, IsBoolean, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { canReadCost } from '../../common/auth/cost-visibility';
import { PrintSettingsService } from './print-settings.service';

class PrintPriceSettingDto {
  /// A catalogue key, or "default" for everything not configured.
  @IsString() @MaxLength(48) documentType!: string;
  @IsBoolean() showSalePrice!: boolean;
  @IsBoolean() showCost!: boolean;
}

class SavePrintSettingsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => PrintPriceSettingDto)
  settings!: PrintPriceSettingDto[];
}

/// The company's saved print policy, and the catalogue of prints it applies to.
///
/// Reading is open to anyone who may print - a person about to print should be
/// able to see what the company decided - while changing it is the same
/// administrative act as changing any other company policy.
@Controller('company/print-settings')
export class PrintSettingsController {
  constructor(private readonly settings: PrintSettingsService) {}

  @Get()
  @RequirePermissions('reports.read')
  async get(@CurrentUser() user: AuthUser) {
    const stored = await this.settings.get(user.companyId);
    return {
      ...stored,
      /// Whether this caller may ever see a cost, so the screen disables the
      /// checkbox with a reason instead of saving a setting that is ignored.
      costLocked: !canReadCost(user),
    };
  }

  @Put()
  @RequirePermissions('admin.company.manage')
  async save(@CurrentUser() user: AuthUser, @Body() dto: SavePrintSettingsDto) {
    const stored = await this.settings.save(user.companyId, user.userId, dto.settings);
    return { ...stored, costLocked: !canReadCost(user) };
  }
}
