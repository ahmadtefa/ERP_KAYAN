import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { UpdateCompanyProfileDto } from './dto/company.dto';
import { CompanyService, LOGO_MAX_BYTES } from './company.service';

interface UploadedLogo {
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/// The profile and logo endpoints the Flutter shell has always used. They
/// share the same storage and rules as `/company` (see CompanyController), so
/// the logo shown in the shell and the logo in the company settings are one
/// and the same.
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompanyService) {}

  @Public()
  @Get('branding')
  branding() {
    return this.companies.publicBranding();
  }

  @Get('my-branding')
  myBranding(@CurrentUser() user: AuthUser) {
    return this.companies.brandingFor(user.companyId);
  }

  @Public()
  @Get('logo')
  async publicLogo(@Res() response: Response) {
    return this.sendLogo(undefined, response);
  }

  @Public()
  @Get('logo/:companyId')
  async tenantLogo(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Res() response: Response,
  ) {
    return this.sendLogo(companyId, response);
  }

  @Get('profile')
  @RequirePermissions('company.profile.manage')
  profile(@CurrentUser() user: AuthUser) {
    return this.companies.getProfile(user.companyId);
  }

  @Patch('profile')
  @RequirePermissions('company.profile.manage')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateCompanyProfileDto) {
    return this.companies.updateProfile(user.companyId, user.userId, dto);
  }

  @Post('logo')
  @RequirePermissions('company.profile.manage')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES, files: 1 } }),
  )
  async uploadLogo(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedLogo | undefined,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Logo file is required');
    return this.companies.setLogo(user.companyId, user.userId, file.buffer, file.mimetype);
  }

  @Delete('logo')
  @RequirePermissions('company.profile.manage')
  async removeLogo(@CurrentUser() user: AuthUser) {
    await this.companies.deleteLogo(user.companyId, user.userId);
    return this.companies.getProfile(user.companyId);
  }

  private async sendLogo(companyId: string | undefined, response: Response) {
    const logo = await this.companies.getLogo(companyId);
    if (!logo) throw new NotFoundException('Company logo not found');
    response.setHeader('Content-Type', logo.mime);
    response.setHeader('Cache-Control', 'public, max-age=300');
    response.end(logo.data);
  }
}
