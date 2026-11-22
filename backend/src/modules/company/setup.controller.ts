import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import { InitialSetupDto } from './dto/company.dto';
import { SetupService } from './setup.service';

/// The first-run status and initialization flow.
///
/// Both routes are public because a pristine installation has no account to
/// authenticate with. The service enforces a stricter invariant for the
/// mutation: any company row (including soft-deleted rows) or any user row
/// permanently closes public initial setup. Recovery is a separate,
/// authenticated/verified workflow and must never reuse this endpoint.
@Controller('setup')
export class SetupController {
  constructor(private readonly service: SetupService) {}

  @Public()
  @Get('status')
  status() {
    return this.service.status();
  }

  @Public()
  @Post('initial')
  initial(@Body() dto: InitialSetupDto, @Req() req: Request) {
    return this.service.initialSetup(
      dto,
      req.ip ?? undefined,
      req.headers['user-agent'] ?? undefined,
    );
  }
}
