import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CompanyService,
  LOGO_UPLOAD_MAX_BYTES,
  logoMimeForUpload,
} from './company.service';
import {
  CreateBranchDto,
  UpdateBranchDto,
  UpdateCompanyProfileDto,
} from './dto/company.dto';

interface UploadedLogo {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/// Company profile, the logo, and the units (headquarters and branches).
///
/// Everything here needs `admin.company.manage`: these records define who the
/// books belong to, and a wrong edit would show on every report.
@Controller('company')
export class CompanyController {
  constructor(private readonly service: CompanyService) {}

  @Get('profile')
  profile(@CurrentUser() user: AuthUser) {
    return this.service.getProfile(user.companyId);
  }

  @Patch('profile')
  @RequirePermissions('admin.company.manage')
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateCompanyProfileDto,
  ) {
    return this.service.updateProfile(user.companyId, user.userId, dto);
  }

  @Get('logo')
  async logo(@CurrentUser() user: AuthUser, @Res() response: Response) {
    const logo = await this.service.getLogo(user.companyId);
    if (!logo) {
      response.status(404).json({ title: 'The company has no logo yet' });
      return;
    }
    response.setHeader('Content-Type', logo.mime);
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.end(logo.data);
  }

  @Post('logo')
  @RequirePermissions('admin.company.manage')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: LOGO_UPLOAD_MAX_BYTES, files: 1 } }),
  )
  setLogo(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedLogo | undefined,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('لم يتم اختيار ملف للشعار / No logo file was uploaded.');
    }
    return this.service.setLogo(
      user.companyId,
      user.userId,
      file.buffer,
      logoMimeForUpload(file.mimetype, file.originalname),
    );
  }

  @Delete('logo')
  @RequirePermissions('admin.company.manage')
  async deleteLogo(@CurrentUser() user: AuthUser) {
    await this.service.deleteLogo(user.companyId, user.userId);
    return { deleted: true };
  }

  @Get('branches')
  branches(@CurrentUser() user: AuthUser) {
    return this.service.listBranches(user.companyId);
  }

  @Post('branches')
  @RequirePermissions('admin.company.manage')
  createBranch(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateBranchDto,
  ) {
    return this.service.createBranch(user.companyId, user.userId, dto);
  }

  @Patch('branches/:id')
  @RequirePermissions('admin.company.manage')
  updateBranch(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.service.updateBranch(user.companyId, user.userId, id, dto);
  }

  @Delete('branches/:id')
  @RequirePermissions('admin.company.manage')
  async deleteBranch(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    await this.service.deleteBranch(user.companyId, user.userId, id);
    return { deleted: true };
  }
}
