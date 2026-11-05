import { Module } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { AuditedSuperAdminGuard } from '../../common/guards/audited-super-admin.guard';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CompanyController } from './company.controller';
import { CompaniesController } from './companies.controller';
import { CompanyService } from './company.service';
import { CompanySettingsService } from '../../common/settings/company-settings.module';
import { AccountingSettingsController } from '../accounting/settings.controller';
import { BackupScheduleController } from '../backup/backup-schedule.controller';
import { BackupScheduleService } from '../backup/backup-schedule.service';

const companyService = {
  updateProfile: jest.fn().mockResolvedValue({ updated: true }),
  setLogo: jest.fn().mockResolvedValue({ updated: true }),
  deleteLogo: jest.fn().mockResolvedValue(undefined),
  getProfile: jest.fn().mockResolvedValue({ id: 'fixture-company' }),
  createBranch: jest.fn().mockResolvedValue({ id: 'fixture-branch' }),
  updateBranch: jest.fn().mockResolvedValue({ id: 'fixture-branch' }),
  deleteBranch: jest.fn().mockResolvedValue(undefined),
};

const deniedAudit = {recordRequired: jest.fn().mockResolvedValue(undefined)};
const schedule = {status:jest.fn().mockResolvedValue({retentionCount:1}), history:jest.fn().mockResolvedValue([]), runNow:jest.fn().mockResolvedValue([]), pruneRetention:jest.fn().mockResolvedValue([])};
const companySettingsService = {update:jest.fn().mockResolvedValue({updated:true})};

@Module({
  controllers: [CompanyController, CompaniesController, AccountingSettingsController, BackupScheduleController],
  providers: [AuditedSuperAdminGuard, {provide:AuditService,useValue:deniedAudit}, {provide:PrismaService,useValue:{}}, { provide: CompanyService, useValue: companyService },
    {provide:CompanySettingsService,useValue:companySettingsService}, {provide:BackupScheduleService,useValue:schedule}],
})
class FixtureModule {}

describe('company profile HTTP authorization', () => {
  it('rejects delegated permissions and allows only super admin on both API families', async () => {
    const app = await NestFactory.create(FixtureModule, { logger: false });
    // Test-only authentication fixture: production uses JwtAuthGuard instead.
    app.use((req: { headers: Record<string, string>; user?: object }, _res: unknown, next: () => void) => {
      req.user = {
        userId: 'fixture-user', companyId: 'fixture-company', username: 'fixture', branchId: null,
        isSuperAdmin: req.headers['x-fixture-super'] === 'yes',
        permissions: ['admin.company.manage', 'company.profile.manage', 'admin.backup'],
      };
      next();
    });
    app.useGlobalGuards(new PermissionsGuard(new Reflector()));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    try {
      for (const prefix of ['/company', '/companies']) {
        for (const [method, route] of [['PATCH', '/profile'], ['POST', '/logo'], ['DELETE', '/logo']]) {
          const send = async (superAdmin: boolean) => {
            const headers: Record<string, string> = { 'x-fixture-super': superAdmin ? 'yes' : 'no' };
            let body: BodyInit | undefined;
            if (method === 'PATCH') {
              headers['content-type'] = 'application/json';
              body = JSON.stringify({ nameEn: 'Fixture' });
            } else if (method === 'POST') {
              const form = new FormData();
              form.set('file', new Blob([Buffer.from('fixture')], { type: 'image/png' }), 'fixture.png');
              body = form;
            }
            return fetch(base + prefix + route, { method, headers, body });
          };
          const before = companyService.updateProfile.mock.calls.length + companyService.setLogo.mock.calls.length + companyService.deleteLogo.mock.calls.length;
          expect((await send(false)).status).toBe(403);
          expect(companyService.updateProfile.mock.calls.length + companyService.setLogo.mock.calls.length + companyService.deleteLogo.mock.calls.length).toBe(before);
          expect((await send(true)).status).toBe(method === 'POST' ? 201 : 200);
        }
      }
      const settingsUrl = base + '/accounting/settings';
      const settingsPatch = (superAdmin: boolean) => fetch(settingsUrl, {method:'PATCH',
        headers:{'content-type':'application/json','x-fixture-super':superAdmin ? 'yes' : 'no'},
        body:JSON.stringify({managerName:'Synthetic manager'})});
      expect((await settingsPatch(false)).status).toBe(403);
      expect(companySettingsService.update).not.toHaveBeenCalled();
      expect((await settingsPatch(true)).status).toBe(200);
      expect(companySettingsService.update).toHaveBeenCalledTimes(1);
      for (const [method, path] of [['GET',''],['GET','/history'],['POST','/run'],['POST','/prune']]) {
        const send = (superAdmin: boolean) => fetch(base + '/backup/schedule' + path, {
          method, headers:{'x-fixture-super':superAdmin ? 'yes' : 'no','content-type':'application/json'},
          ...(method === 'POST' ? {body:JSON.stringify({companyId:'another-company'})} : {}),
        });
        expect((await send(false)).status).toBe(403);
        expect((await send(true)).status).toBe(method === 'POST' ? 201 : 200);
      }
      expect(schedule.runNow).toHaveBeenCalledTimes(1);
      expect(schedule.pruneRetention).toHaveBeenCalledTimes(1);
      // A failed audit does not allow the company update through.
      deniedAudit.recordRequired.mockRejectedValueOnce(new Error('synthetic audit failure'));
      const beforeFailure = companyService.updateProfile.mock.calls.length;
      expect((await settingsPatch(false)).status).toBe(503);
      expect(companyService.updateProfile.mock.calls.length).toBe(beforeFailure);
      expect(companySettingsService.update).toHaveBeenCalledTimes(1);
      expect(deniedAudit.recordRequired).toHaveBeenCalledTimes(12);
      expect(deniedAudit.recordRequired).toHaveBeenCalledWith(expect.objectContaining({companyId:'fixture-company',userId:'fixture-user',action:'ACCESS_DENIED',entity:'super_admin_access'}), expect.anything());
      expect(companyService.updateProfile).toHaveBeenCalledTimes(2);
      expect(companyService.setLogo).toHaveBeenCalledTimes(2);
      expect(companyService.deleteLogo).toHaveBeenCalledTimes(2);
      expect(companyService.updateProfile).toHaveBeenCalledWith('fixture-company', 'fixture-user', { nameEn: 'Fixture' });
    } finally {
      await app.close();
    }
  });
  it('requires super admin for all branch mutations even with delegated company permission', async () => {
    jest.clearAllMocks();
    const app = await NestFactory.create(FixtureModule, {logger:false});
    app.use((req: {headers:Record<string,string>;user?:object},_res:unknown,next:()=>void)=>{
      req.user={userId:'fixture-user',companyId:'fixture-company',branchId:null,username:'fixture',
        isSuperAdmin:req.headers['x-fixture-super']==='yes',permissions:['admin.company.manage']}; next();
    });
    app.useGlobalGuards(new PermissionsGuard(new Reflector()));
    await app.listen(0,'127.0.0.1');
    const port=(app.getHttpServer().address() as {port:number}).port;
    try {
      for (const [method,path] of [['POST','/company/branches'],['PATCH','/company/branches/fixture-branch'],['DELETE','/company/branches/fixture-branch']]) {
        const request=(superAdmin:boolean)=>fetch(`http://127.0.0.1:${port}${path}`,{method,
          headers:{'x-fixture-super':superAdmin?'yes':'no','content-type':'application/json'},
          ...(method==='DELETE'?{}:{body:JSON.stringify({nameEn:'Fixture'})})});
        expect((await request(false)).status).toBe(403);
        expect((await request(true)).status).toBe(method==='POST'?201:200);
      }
      expect(deniedAudit.recordRequired).toHaveBeenCalledTimes(3);
      expect(companyService.createBranch).toHaveBeenCalledTimes(1);
      expect(companyService.updateBranch).toHaveBeenCalledTimes(1);
      expect(companyService.deleteBranch).toHaveBeenCalledTimes(1);
    } finally {await app.close();}
  });

});
