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
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AuditedSuperAdminGuard } from '../../common/guards/audited-super-admin.guard';
import { UpdateCompanyProfileDto } from './dto/company.dto';
import {
  CompanyService,
  LOGO_UPLOAD_MAX_BYTES,
  logoMimeForUpload,
} from './company.service';

interface UploadedLogo {
  originalname: string;
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

  /// Deprecated, kept for older clients: lists only a sole active company (see
  /// `CompanyService.publicOptions`). Never lists several companies.
  @Public()
  @Get('options')
  options() {
    return this.companies.publicOptions();
  }

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

  /// A company's mark by id: signed-in members of that company only. Knowing
  /// the id is not authorization, and another company's id answers 404 exactly
  /// like an unknown one. (The unauthenticated route above serves only the
  /// sole company's mark, the same as the pre-sign-in branding.)
  @Get('logo/:companyId')
  async tenantLogo(
    @CurrentUser() user: AuthUser,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Res() response: Response,
  ) {
    if (user.companyId !== companyId) {
      throw new NotFoundException({ code: 'COMPANY_LOGO_NOT_FOUND', message: 'Company logo not found' });
    }
    return this.sendLogo(companyId, response, true);
  }

  @Get('profile')
  @RequirePermissions('company.profile.manage')
  profile(@CurrentUser() user: AuthUser) {
    return this.companies.getProfile(user.companyId);
  }

  @Patch('profile')
  @RequirePermissions('company.profile.manage')
  @UseGuards(AuditedSuperAdminGuard)
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateCompanyProfileDto) {
    return this.companies.updateProfile(user.companyId, user.userId, dto);
  }

  @Post('logo')
  @RequirePermissions('company.profile.manage')
  @UseGuards(AuditedSuperAdminGuard)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: LOGO_UPLOAD_MAX_BYTES, files: 1 } }),
  )
  async uploadLogo(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedLogo | undefined,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('لم يتم اختيار ملف للشعار / No logo file was uploaded.');
    }
    return this.companies.setLogo(
      user.companyId,
      user.userId,
      file.buffer,
      logoMimeForUpload(file.mimetype, file.originalname),
    );
  }

  @Delete('logo')
  @RequirePermissions('company.profile.manage')
  @UseGuards(AuditedSuperAdminGuard)
  async removeLogo(@CurrentUser() user: AuthUser) {
    await this.companies.deleteLogo(user.companyId, user.userId);
    return this.companies.getProfile(user.companyId);
  }

  private async sendLogo(
    companyId: string | undefined,
    response: Response,
    privateToMember = false,
  ) {
    const logo = await this.companies.getLogo(companyId);
    if (!logo) throw new NotFoundException({ code: 'COMPANY_LOGO_NOT_FOUND', message: 'Company logo not found' });
    response.setHeader('Content-Type', logo.mime);
    // A member's copy is never kept by a shared cache.
    response.setHeader(
      'Cache-Control',
      privateToMember ? 'private, max-age=300' : 'public, max-age=300',
    );
    response.end(logo.data);
  }
}
