import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { LicenseKeyDto } from './dto/license-key.dto';
import { LicensingService } from './licensing.service';

/**
 * The licence screen's whole conversation with the server.
 *
 * Reading the licence status itself is safe before sign-in because the desktop
 * shell must be able to decide whether to show setup/licensing UI before an
 * authenticated session exists. Activation, renewal and administrative event
 * history remain authenticated and super-admin-only.
 */
@Controller('license')
export class LicensingController {
  constructor(private readonly licensing: LicensingService) {}

  @Public()
  @Get()
  status() {
    return this.licensing.status();
  }

  @Public()
  @Get('status')
  statusAlias() {
    return this.licensing.status();
  }

  @Get('request-code')
  requestCode() {
    return this.licensing.requestCode();
  }

  @Get('events')
  async events(@CurrentUser() user: AuthUser) {
    this.superAdmin(user);
    return { items: await this.licensing.events(100) };
  }

  @Post('activate')
  async activate(
    @CurrentUser() user: AuthUser,
    @Body() dto: LicenseKeyDto,
    @Req() request: Request,
  ) {
    this.superAdmin(user);
    return this.licensing.activate(dto.key, this.actor(user, request));
  }

  @Post('renew')
  async renew(
    @CurrentUser() user: AuthUser,
    @Body() dto: LicenseKeyDto,
    @Req() request: Request,
  ) {
    this.superAdmin(user);
    return this.licensing.renew(dto.key, this.actor(user, request));
  }

  @Post('seats')
  async seats(
    @CurrentUser() user: AuthUser,
    @Body() dto: LicenseKeyDto,
    @Req() request: Request,
  ) {
    this.superAdmin(user);
    return this.licensing.addSeats(dto.key, this.actor(user, request));
  }

  @Post('transfer')
  async transfer(
    @CurrentUser() user: AuthUser,
    @Body() dto: LicenseKeyDto,
    @Req() request: Request,
  ) {
    this.superAdmin(user);
    return this.licensing.transfer(dto.key, this.actor(user, request));
  }

  @Post('confirm-clock')
  async confirmClock(@CurrentUser() user: AuthUser, @Req() request: Request) {
    this.superAdmin(user);
    return this.licensing.confirmClock(this.actor(user, request));
  }

  private superAdmin(user: AuthUser): void {
    if (!user?.isSuperAdmin) {
      throw new ForbiddenException(
        'Applying a licence key changes the whole installation, so only a super administrator may do it.',
      );
    }
  }

  private actor(user: AuthUser, request: Request) {
    return {
      userId: user?.userId ?? null,
      ipAddress: request?.ip ?? null,
    };
  }
}
