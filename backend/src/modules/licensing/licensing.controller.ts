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
  async status() {
    return this.safeStatus(() => this.licensing.status());
  }

  @Public()
  @Get('status')
  async statusAlias() {
    return this.safeStatus(() => this.licensing.status());
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

  /**
   * A damaged protected state file must never turn the whole desktop into a
   * startup/HTTP 503 loop. Return a deliberately blocked status so the client
   * can open the licence/backup recovery screens. No entitlement is restored,
   * no key is accepted and no business operation is unblocked by this path.
   */
  private async safeStatus(load: () => Promise<unknown>) {
    try {
      return await load();
    } catch (error) {
      const response = (error as { response?: unknown }).response;
      if (
        response &&
        typeof response === 'object' &&
        'code' in response &&
        response.code === 'LICENSE_STATE_DAMAGED'
      ) {
        return {
          state: 'UNLICENSED',
          stateError: 'LICENSE_STATE_DAMAGED',
          blocked: true,
          enforcement: 'enforce',
          configured: false,
          licenseId: null,
          machineId: '',
          installId: 'unavailable',
          issuedAt: null,
          startsAt: null,
          expiresAt: null,
          perpetual: false,
          daysRemaining: null,
          expiringSoon: false,
          seats: { limit: 0, used: 0, available: null },
          clock: {
            state: 'WARNING',
            lastSeenAt: null,
            note: 'The protected licence state is damaged. Business operations remain blocked until the original trusted state is restored.',
          },
          publicKeyFingerprint: null,
          requestCode: '',
          serverTime: new Date().toISOString(),
        };
      }
      throw error;
    }
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
