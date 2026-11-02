import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AVATAR_MAX_BYTES, AVATAR_LIMITS, UserAvatarsService } from './user-avatars.service';

interface UploadedImage {
  originalname?: string;
  mimetype?: string;
  size?: number;
  buffer: Buffer;
}

/// Photos live on their own routes, outside the `admin/users` controller.
///
/// That controller is guarded as a whole by `admin.users.manage`, which is
/// right for accounts and wrong for a face: a salesperson must be able to see
/// their own photo and their colleagues', and must be able to change their own
/// without being given the right to manage accounts. Authorisation is
/// therefore per-route here - anyone signed in may *read*, and the service
/// decides who may *write* (self, or `admin.users.manage`).
///
/// The read is deliberately thin: bytes and a content type, nothing else. No
/// account field travels with it, so exposing it to every colleague cannot
/// leak an account.
@Controller('users')
export class UserAvatarsController {
  constructor(private readonly avatars: UserAvatarsService) {}

  @Get(':id/avatar')
  async read(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const avatar = await this.avatars.getAvatar(user.companyId, id);
    response.setHeader('Content-Type', avatar.mime);
    // The bytes are what the validator proved them to be; a browser must not
    // sniff them into something executable, and a cached copy must be
    // revalidated because replacing a photo happens under the same URL.
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    response.setHeader(
      'Cache-Control',
      'private, max-age=0, must-revalidate',
    );
    if (avatar.updatedAt) {
      response.setHeader('Last-Modified', avatar.updatedAt.toUTCString());
    }
    response.setHeader('Content-Length', String(avatar.data.length));
    return avatar.data;
  }

  @Put(':id/avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      // One byte over the limit is refused by the service with a readable
      // message; this limit only stops a huge upload being buffered first.
      limits: { fileSize: AVATAR_MAX_BYTES * 4, files: 1 },
    }),
  )
  set(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedImage | undefined,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException(
        'لم يتم اختيار صورة. / No image was chosen.',
      );
    }
    return this.avatars.setAvatar(user.companyId, user, id, file);
  }

  @Delete(':id/avatar')
  clear(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.avatars.clearAvatar(user.companyId, user, id);
  }

  /// What the client may tell the person before they pick a file, so a
  /// 12-megapixel phone photo is refused in the dialog instead of after an
  /// upload.
  @Get('avatar/limits')
  limits() {
    return AVATAR_LIMITS;
  }
}
