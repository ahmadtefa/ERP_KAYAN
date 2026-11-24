import { Controller, Get, Module, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../decorators/public.decorator';
import { RequirePermissions } from '../decorators/require-permissions.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { RateLimitGuard, VerifiedUserRateLimitGuard } from './rate-limit.guard';

const run = process.env.KAYAN_RATE_LIMIT_PG === '1';
(run ? describe : describe.skip)('rate quotas through real JWT session guard and PostgreSQL over HTTP', () => {
  jest.setTimeout(60000);
  let app: INestApplication; let prisma: PrismaService; let jwt: JwtService; let base: string;
  const companyId = randomUUID();
  const users: Array<{id:string; hash:string; token:string}> = [];
  const oldSecret = process.env.JWT_ACCESS_SECRET;
  @Controller()
  class FixtureController {
    @Get('business') business() { return { ok: true }; }
    @Get('denied') @RequirePermissions('fixture.denied') denied() { return { ok: true }; }
    @Get('auth/login') @Public() login() { return { fixture: true }; }
    @Get('public') @Public() public() { return { fixture: true }; }
  }
  beforeAll(async () => {
    if (process.env.NODE_ENV !== 'test' || new URL(process.env.DATABASE_URL ?? '').pathname !== '/erp_kayan_acceptance') throw new Error('Isolated acceptance database required');
    process.env.JWT_ACCESS_SECRET = 'synthetic-rate-quota-http-secret-not-a-product-secret';
    @Module({ imports:[JwtModule.register({})], controllers:[FixtureController], providers:[
      PrismaService, {provide:ConfigService,useValue:{get:(key:string,fallback:unknown)=>({RATE_LIMIT_MAX:3,RATE_LIMIT_AUTH_MAX:2} as Record<string,unknown>)[key] ?? fallback}},
      RateLimitGuard, VerifiedUserRateLimitGuard,
      {provide:APP_GUARD,useExisting:RateLimitGuard}, {provide:APP_GUARD,useClass:JwtAuthGuard},
      {provide:APP_GUARD,useExisting:VerifiedUserRateLimitGuard}, {provide:APP_GUARD,useClass:PermissionsGuard},
    ]}) class FixtureModule {}
    app=await NestFactory.create(FixtureModule,{logger:false});app.setGlobalPrefix('api/v1');
    await app.listen(0,'127.0.0.1');base=await app.getUrl();prisma=app.get(PrismaService);jwt=app.get(JwtService);
    await prisma.company.create({data:{id:companyId,isActive:false,deletedAt:new Date(),code:`QUOTA-${companyId}`,nameEn:'Synthetic quota fixture',nameAr:'اختبار الصلاحيات'}});
    for(let index=0;index<5;index++) {
      const id=randomUUID(),hash=randomUUID().replace(/-/g,'').repeat(2);
      await prisma.user.create({data:{id,companyId,username:`quota-${id}`,fullNameEn:'Synthetic',fullNameAr:'تجريبي',passwordHash:'unused'}});
      await prisma.refreshToken.create({data:{userId:id,tokenHash:hash,expiresAt:new Date(Date.now()+600000)}});
      const token=await jwt.signAsync({sub:id,companyId,sessionHash:hash,tokenVersion:0},{secret:process.env.JWT_ACCESS_SECRET,expiresIn:'1h'});
      users.push({id,hash,token});
    }
  });
  beforeEach(async()=>{
    (app.get(RateLimitGuard) as any).counters.clear();
    await prisma.user.updateMany({where:{companyId},data:{isActive:true,tokenVersion:0}});
    await prisma.refreshToken.updateMany({where:{userId:{in:users.map(u=>u.id)}},data:{revokedAt:null,expiresAt:new Date(Date.now()+600000)}});
  });
  afterAll(async()=>{
    try { if(prisma){await prisma.user.deleteMany({where:{companyId}});await prisma.company.deleteMany({where:{id:companyId}});} }
    finally { await app?.close(); if(oldSecret===undefined)delete process.env.JWT_ACCESS_SECRET;else process.env.JWT_ACCESS_SECRET=oldSecret; }
  });
  const call=(path:string,token?:string,extra:Record<string,string>={})=>fetch(`${base}/api/v1/${path}`,{headers:{...(token?{authorization:`Bearer ${token}`} : {}),...extra}});
  it('refunds successful NAT users independently but keeps one user quota across tokens',async()=>{
    for(let round=0;round<3;round++)for(const user of users)expect((await call('business',user.token)).status).toBe(200);
    const nextToken=await jwt.signAsync({sub:users[0].id,companyId,sessionHash:users[0].hash,tokenVersion:0},{secret:process.env.JWT_ACCESS_SECRET});
    const refused=await call('business',nextToken);expect(refused.status).toBe(429);expect(refused.headers.get('retry-after')).toMatch(/^\d+$/);
  });
  it.each(['revoked','expired-session','disabled','token-version','forged'])(
    'retains IP reservation for %s credentials after real authentication rejects',async(kind)=>{
      let token=users[0].token;
      if(kind==='revoked')await prisma.refreshToken.updateMany({where:{userId:users[0].id},data:{revokedAt:new Date()}});
      if(kind==='expired-session')await prisma.refreshToken.updateMany({where:{userId:users[0].id},data:{expiresAt:new Date(0)}});
      if(kind==='disabled')await prisma.user.update({where:{id:users[0].id},data:{isActive:false}});
      if(kind==='token-version')await prisma.user.update({where:{id:users[0].id},data:{tokenVersion:1}});
      if(kind==='forged')token=await jwt.signAsync({sub:users[0].id,companyId},{secret:'wrong-secret'});
      for(let index=0;index<3;index++)expect((await call('business',token,{'x-forwarded-for':`192.0.2.${index}`})).status).toBe(401);
      const refusal=await call('business',token);expect(refusal.status).toBe(429);expect(refusal.headers.get('retry-after')).toMatch(/^\d+$/);
    },
  );
  it('refunds authenticated authorization failures but charges verified user quota',async()=>{
    for(let index=0;index<3;index++)expect((await call('denied',users[0].token)).status).toBe(403);
    expect((await call('denied',users[0].token)).status).toBe(429);
    expect((await call('business',users[1].token)).status).toBe(200);
  });
  it('never refunds public traffic or changes tight login quota even with valid bearer',async()=>{
    for(let index=0;index<2;index++)expect((await call('auth/login',users[index].token)).status).toBe(200);
    const login=await call('auth/login',users[2].token);expect(login.status).toBe(429);expect(login.headers.get('retry-after')).toBeTruthy();
    for(let index=0;index<3;index++)expect((await call('public',users[index].token)).status).toBe(200);
    expect((await call('public',users[3].token)).status).toBe(429);
  });
});
