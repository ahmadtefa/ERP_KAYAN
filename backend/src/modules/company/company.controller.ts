import {
  BadRequestException, Body, Controller, Delete, Get, NotFoundException,
  Param, ParseUUIDPipe, Patch, Post, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { UpdateCompanyDto } from './company.dto';
import { CompanyService } from './company.service';

const uploadDir = () => process.env.KAYAN_UPLOAD_DIR ?? join(process.cwd(), 'uploads');
const accepted = new Set(['image/png', 'image/jpeg', 'image/webp']);

@Controller('companies')
export class CompanyController {
  constructor(private readonly companies: CompanyService) {}

  @Public()
  @Get('branding')
  branding() { return this.companies.publicBranding(); }

  @Get('my-branding')
  myBranding(@CurrentUser() user: AuthUser) { return this.companies.brandingFor(user.companyId); }

  @Public()
  @Get('logo')
  async publicLogo(@Res() response: Response) { return this.sendLogo(undefined, response); }

  @Public()
  @Get('logo/:companyId')
  async tenantLogo(@Param('companyId', ParseUUIDPipe) companyId: string, @Res() response: Response) {
    return this.sendLogo(companyId, response);
  }

  @Get('profile')
  @RequirePermissions('company.profile.manage')
  profile(@CurrentUser() user: AuthUser) { return this.companies.profile(user.companyId); }

  @Patch('profile')
  @RequirePermissions('company.profile.manage')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateCompanyDto) {
    return this.companies.updateProfile(user.companyId, user.userId, dto);
  }

  @Post('logo')
  @RequirePermissions('company.profile.manage')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    fileFilter: (_req: any, file: { mimetype: string }, callback: (error: Error | null, accept: boolean) => void) =>
      accepted.has(file.mimetype) ? callback(null, true) : callback(new BadRequestException('Logo must be PNG, JPEG or WebP'), false),
  }))
  async uploadLogo(@CurrentUser() user: AuthUser, @UploadedFile() file?: { buffer: Buffer; mimetype: string }) {
    if (!file) throw new BadRequestException('Logo file is required');
    const dimensions = imageDimensions(file.buffer, file.mimetype);
    if (!dimensions || dimensions.width > 2048 || dimensions.height > 2048 || dimensions.width < 32 || dimensions.height < 32) {
      throw new BadRequestException('Use a valid PNG, JPEG or WebP logo between 32px and 2048px');
    }
    const extension = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[file.mimetype];
    mkdirSync(uploadDir(), { recursive: true });
    const path = join(uploadDir(), `${randomUUID()}${extension}`);
    await writeFile(path, file.buffer, { flag: 'wx' });
    try {
      return await this.companies.setLogo(user.companyId, user.userId, basename(path));
    } catch (error) {
      await unlink(path).catch(() => {});
      throw error;
    }
  }

  @Delete('logo')
  @RequirePermissions('company.profile.manage')
  removeLogo(@CurrentUser() user: AuthUser) { return this.companies.removeLogo(user.companyId, user.userId); }

  private async sendLogo(companyId: string | undefined, response: Response) {
    const filename = await this.companies.logoPath(companyId);
    const path = filename ? join(uploadDir(), basename(filename)) : null;
    if (!path || !existsSync(path)) throw new NotFoundException('Company logo not found');
    response.setHeader('Cache-Control', 'public, max-age=300');
    return response.sendFile(path);
  }
}

function imageDimensions(data: Buffer, mime: string): { width: number; height: number } | null {
  if (mime === 'image/png' && data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (mime === 'image/webp' && data.length >= 30 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    const kind = data.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) };
    if (kind === 'VP8 ' && data.length >= 30) return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L' && data.length >= 26) return { width: 1 + (((data[22] ?? 0) | ((data[23] ?? 0) & 0x3f) << 8)), height: 1 + ((((data[23] ?? 0) >> 6) | (data[24] ?? 0) << 2 | ((data[25] ?? 0) & 0x0f) << 10)) };
  }
  if (mime === 'image/jpeg' && data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) { offset++; continue; }
      const marker = data[offset + 1] ?? 0;
      const length = data.readUInt16BE(offset + 2);
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
      if (length < 2) return null;
      offset += 2 + length;
    }
  }
  return null;
}
