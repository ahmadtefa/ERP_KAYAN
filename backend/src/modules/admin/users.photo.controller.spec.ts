import 'reflect-metadata';
import { CanActivate, ExecutionContext, Injectable, Module, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ProfilePhotoService } from '../auth/profile-photo.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const target = '11111111-1111-4111-8111-111111111111';
const photos = {
  setForUser: jest.fn().mockResolvedValue({ updated: true }),
  removeForUser: jest.fn().mockResolvedValue({ deleted: true }),
};

@Injectable()
class SessionFixture implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization;
    if (token !== 'Bearer manager' && token !== 'Bearer reader') throw new UnauthorizedException();
    request.user = { companyId: 'company', userId: 'actor', isSuperAdmin: false,
      permissions: token === 'Bearer manager' ? ['admin.users.manage'] : [] };
    return true;
  }
}

@Module({
  controllers: [UsersController],
  providers: [
    { provide: UsersService, useValue: {} },
    { provide: ProfilePhotoService, useValue: photos },
    { provide: APP_GUARD, useClass: SessionFixture },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
class PhotoFixtureModule {}

describe('administrator account photo HTTP permissions', () => {
  it('accepts only authorized company managers and binds the target to the URL', async () => {
    photos.setForUser.mockClear();
    photos.removeForUser.mockClear();
    const app = await NestFactory.create(PhotoFixtureModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}/admin/users/${target}/photo`;
    const upload = (token?: string) => {
      const form = new FormData();
      form.append('file', new Blob(['test'], { type: 'image/png' }), 'photo.png');
      return fetch(url, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: form });
    };
    try {
      expect((await upload()).status).toBe(401);
      expect((await upload('reader')).status).toBe(403);
      expect(photos.setForUser).not.toHaveBeenCalled();
      expect((await upload('manager')).status).toBe(201);
      expect(photos.setForUser).toHaveBeenCalledWith('company', 'actor', target, expect.any(Buffer), 'image/png');
      expect((await fetch(url, { method: 'DELETE', headers: { authorization: 'Bearer reader' } })).status).toBe(403);
      expect(photos.removeForUser).not.toHaveBeenCalled();
      expect((await fetch(url, { method: 'DELETE', headers: { authorization: 'Bearer manager' } })).status).toBe(200);
      expect(photos.removeForUser).toHaveBeenCalledWith('company', 'actor', target);
    } finally {
      await app.close();
    }
  });
});
