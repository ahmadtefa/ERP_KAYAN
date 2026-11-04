import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { LOGO_UPLOAD_MAX_BYTES, logoMimeForUpload } from '../company/company.service';
import { ProfilePhotoService } from './profile-photo.service';

type Upload = { buffer:Buffer; mimetype:string; originalname:string };

/** Uses only the authenticated user; there is deliberately no target ID. */
@Controller('profile/photo')
export class ProfilePhotoController {
  constructor(private readonly photos: ProfilePhotoService) {}
  private assertSession(user: AuthUser, expectedUserId: unknown) {
    if (typeof expectedUserId !== 'string' || expectedUserId !== user.userId) {
      throw new ForbiddenException('The signed-in user changed; reload the profile');
    }
  }
  @Get()
  async get(@CurrentUser() user: AuthUser, @Query('expectedUserId') expectedUserId: string,
    @Res({passthrough:true}) response: Response) {
    this.assertSession(user,expectedUserId);
    response.setHeader('Cache-Control','private, no-store');
    return this.photos.get(user.companyId,user.userId);
  }
  @Post()
  @UseInterceptors(FileInterceptor('file',{limits:{fileSize:LOGO_UPLOAD_MAX_BYTES,files:1}}))
  set(@CurrentUser() user: AuthUser, @Body('expectedUserId') expectedUserId: string, @UploadedFile() file?: Upload) {
    this.assertSession(user,expectedUserId);
    if (!file?.buffer?.length) throw new BadRequestException('No photo file was uploaded');
    return this.photos.set(user.companyId,user.userId,file.buffer,logoMimeForUpload(file.mimetype,file.originalname));
  }
  @Delete()
  remove(@CurrentUser() user: AuthUser, @Query('expectedUserId') expectedUserId: string) {
    this.assertSession(user,expectedUserId);
    return this.photos.remove(user.companyId,user.userId);
  }
}
