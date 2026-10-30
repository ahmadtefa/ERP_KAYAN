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
 * Reading the state and the activation code is open to any signed-in user, so
 * the person at the machine can read the code out over the phone. Changing
 * anything needs a super administrator: a licence is an installation-level
 * fact, not a company setting an accountant may edit.
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

  @Public()
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
