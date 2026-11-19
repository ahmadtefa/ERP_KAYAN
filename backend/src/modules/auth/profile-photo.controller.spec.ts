import { CanActivate, ExecutionContext, Injectable, Module, UnauthorizedException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ProfilePhotoController } from './profile-photo.controller';
import { ProfilePhotoService } from './profile-photo.service';

const photos = {get:jest.fn().mockResolvedValue({mime:null,data:null}),set:jest.fn().mockResolvedValue({updated:true}),remove:jest.fn().mockResolvedValue({deleted:true})};
@Module({controllers:[ProfilePhotoController],providers:[{provide:ProfilePhotoService,useValue:photos}]}) class FixtureModule {}
@Injectable() class FixtureGuard implements CanActivate {
  canActivate(ctx:ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    if (req.headers.authorization !== 'Bearer fixture') throw new UnauthorizedException();
    req.user = {userId:'self',companyId:'company',permissions:[],isSuperAdmin:false};
    return true;
  }
}

describe('profile photo HTTP contract', () => {
  it('requires authentication and uses only the session identity; rejects switched sessions', async () => {
    const app = await NestFactory.create(FixtureModule,{logger:false});
    app.useGlobalGuards(new FixtureGuard());
    await app.listen(0,'127.0.0.1');
    const port = (app.getHttpServer().address() as {port:number}).port;
    const base = `http://127.0.0.1:${port}/profile/photo`;
    const headers = {authorization:'Bearer fixture'};
    try {
      expect((await fetch(`${base}?expectedUserId=self`)).status).toBe(401);
      expect((await fetch(`${base}?expectedUserId=other`,{headers})).status).toBe(403);
      expect(photos.get).not.toHaveBeenCalled();
      const get = await fetch(`${base}?expectedUserId=self`,{headers});
      expect(get.status).toBe(200); expect(get.headers.get('cache-control')).toContain('no-store');
      expect(photos.get).toHaveBeenCalledWith('company','self');
      const form = new FormData(); form.append('expectedUserId','other');
      form.append('file',new Blob(['fixture'],{type:'image/png'}),'photo.png');
      expect((await fetch(base,{method:'POST',headers,body:form})).status).toBe(403);
      expect(photos.set).not.toHaveBeenCalled();
      const oversizedField = new FormData(); oversizedField.append('expectedUserId','x'.repeat(256));
      oversizedField.append('file',new Blob(['fixture'],{type:'image/png'}),'photo.png');
      expect((await fetch(base,{method:'POST',headers,body:oversizedField})).status).toBeGreaterThanOrEqual(400);
      expect(photos.set).not.toHaveBeenCalled();
      const valid = new FormData(); valid.append('expectedUserId','self');
      valid.append('file',new Blob(['fixture'],{type:'image/png'}),'photo.png');
      expect((await fetch(base,{method:'POST',headers,body:valid})).status).toBe(201);
      expect(photos.set).toHaveBeenCalledWith('company','self',expect.any(Buffer),'image/png');
      expect((await fetch(`${base}?expectedUserId=other`,{method:'DELETE',headers})).status).toBe(403);
      expect(photos.remove).not.toHaveBeenCalled();
      expect((await fetch(`${base}?expectedUserId=self`,{method:'DELETE',headers})).status).toBe(200);
      expect(photos.remove).toHaveBeenCalledWith('company','self');
    } finally { await app.close(); }
  });
});
