import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Delete,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  ChangePasswordDto,
  CreateUserDto,
  ListUsersDto,
  UpdateUserDto,
} from './dto/user.dto';
import { UsersService } from './users.service';
import { ProfilePhotoService } from '../auth/profile-photo.service';
import { LOGO_UPLOAD_MAX_BYTES, logoMimeForUpload } from '../company/company.service';

type Upload = { buffer: Buffer; mimetype: string; originalname: string };

@Controller('admin/users')
@RequirePermissions('admin.users.manage')
export class UsersController {
  constructor(private readonly users: UsersService, private readonly photos: ProfilePhotoService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListUsersDto) {
    return this.users.list(user.companyId, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.findOne(user.companyId, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateUserDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.users.create(
      user.companyId,
      user.userId,
      dto,
      user.permissions,
      user.isSuperAdmin,
      idempotencyKey?.trim() || undefined,
    );
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(
      user.companyId,
      user.userId,
      id,
      dto,
      user.permissions,
      user.isSuperAdmin,
    );
  }

  @Post(':id/password')
  changePassword(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.users.changePassword(
      user.companyId,
      user.userId,
      id,
      dto.password,
      user.isSuperAdmin,
    );
  }

  @Post(':id/deactivate')
  deactivate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.deactivate(user.companyId, user.userId, id, user.isSuperAdmin);
  }

  @Post(':id/photo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_UPLOAD_MAX_BYTES, files: 1, fields: 0, parts: 1 } }))
  setPhoto(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: Upload) {
    if (!file?.buffer?.length) throw new BadRequestException('No photo file was uploaded');
    return this.photos.setForUser(user.companyId, user.userId, id, file.buffer, logoMimeForUpload(file.mimetype, file.originalname));
  }

  @Delete(':id/photo')
  removePhoto(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.photos.removeForUser(user.companyId, user.userId, id);
  }
}
