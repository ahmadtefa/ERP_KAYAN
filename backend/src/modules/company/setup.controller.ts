import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import { InitialSetupDto } from './dto/company.dto';
import { SetupService } from './setup.service';

/// The first-run flow, open until the installation has a company.
///
/// Both routes are public because nobody can sign in before this has run —
/// but `initialSetup` closes itself the moment a company exists, and the
/// rate-limit guard applies to it like every other route, so it cannot be
/// used to guess passwords at speed.
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
