import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ResetCompanyDataDto } from './dto/reset.dto';
import { ResetService } from './reset.service';

/**
 * «إعادة ضبط بيانات البرنامج» — Reset ERP Data.
 *
 * The most destructive thing the program offers, so it is the most guarded:
 *
 *  * it lives under `/admin`, and every route needs the signed-in principal to
 *    be an administrator of the installation (checked again inside the
 *    service, where a token alone is not enough);
 *  * it needs the administrator's own password, verified server-side;
 *  * it needs the word RESET, checked server-side.
 *
 * Nothing here is reachable with an expired token: the authentication guard
 * runs first and rejects those before any of this code is reached.
 */
@Controller('admin/reset')
@RequirePermissions('admin.company.manage')
export class ResetController {
  constructor(private readonly service: ResetService) {}

  /// What a reset would remove, for the warning to name real numbers.
  @Get()
  preview(@CurrentUser() user: AuthUser) {
    return this.service.preview(user.companyId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  reset(
    @CurrentUser() user: AuthUser,
    @Body() dto: ResetCompanyDataDto,
    @Req() request: Request,
  ) {
    // The password and the confirmation are read from the body and handed to
    // the service. They are never logged, and `preview` above already told the
    // screen what the cost is.
    return this.service.reset(
      user,
      dto.password,
      dto.confirmation,
      request.ip ?? undefined,
      request.headers['user-agent'] ?? undefined,
    );
  }
}
