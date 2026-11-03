import { Module } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CompanyController } from './company.controller';
import { CompaniesController } from './companies.controller';
import { CompanyService } from './company.service';

const companyService = {
  updateProfile: jest.fn().mockResolvedValue({ updated: true }),
  setLogo: jest.fn().mockResolvedValue({ updated: true }),
  deleteLogo: jest.fn().mockResolvedValue(undefined),
  getProfile: jest.fn().mockResolvedValue({ id: 'fixture-company' }),
};

@Module({
  controllers: [CompanyController, CompaniesController],
  providers: [{ provide: CompanyService, useValue: companyService }],
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
        permissions: ['admin.company.manage', 'company.profile.manage'],
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
      expect(companyService.updateProfile).toHaveBeenCalledTimes(2);
      expect(companyService.setLogo).toHaveBeenCalledTimes(2);
      expect(companyService.deleteLogo).toHaveBeenCalledTimes(2);
      expect(companyService.updateProfile).toHaveBeenCalledWith('fixture-company', 'fixture-user', { nameEn: 'Fixture' });
    } finally {
      await app.close();
    }
  });
});
