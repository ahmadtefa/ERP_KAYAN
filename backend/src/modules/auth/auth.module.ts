import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ProfilePhotoController } from './profile-photo.controller';
import { ProfilePhotoService } from './profile-photo.service';

@Module({
  controllers: [AuthController, ProfilePhotoController],
  providers: [AuthService, ProfilePhotoService],
  exports: [AuthService, ProfilePhotoService],
})
export class AuthModule {}
