import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import type { Request, Response, NextFunction } from 'express';

import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UsersController } from '../admin/users.controller';
import { UsersService } from '../admin/users.service';
import { HealthController } from '../health/health.controller';
import { SalesInvoicesController } from '../sales/sales-invoices.controller';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { signPayload } from './license-key';
import { LicenseGuard } from './license.guard';
import { LicensingController } from './licensing.controller';
import { LicensingService } from './licensing.service';
import { FakeDb, MACHINE, PUBLIC_PEM, privateKey } from './licensing.harness';

describe('installed licence HTTP guard', () => {
  it('registers the guard globally in the real application module', () => {
    const providers = Reflect.getMetadata('providers', AppModule) as Array<{ provide?: unknown; useClass?: unknown }>;
    expect(providers.some((provider) => provider.provide === APP_GUARD && provider.useClass === LicenseGuard)).toBe(true);
  });

  it('blocks real read, write and admin routes and licence changes after key loss, but keeps health and restores access', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kayan-http-licence-'));
    const pub = join(dir, 'public-key.pem');
    const now = () => new Date('2026-05-01T09:00:00.000Z');
    const db = new FakeDb(now);
    const service = new LicensingService(
      db as unknown as ConstructorParameters<typeof LicensingService>[0],
      {} as ConstructorParameters<typeof LicensingService>[1],
      { installedDirectory: dir, machineId: MACHINE, clock: now },
    );
    writeFileSync(pub, PUBLIC_PEM);
    const calls = { read: jest.fn(() => []), write: jest.fn(() => ({ ok: true })), admin: jest.fn(() => []), adminWrite: jest.fn(() => ({ ok: true })) };
    const healthDb = {
      $queryRaw: async (parts: TemplateStringsArray) => parts.join(' ').includes('current_database') ? [{ name: 'synthetic' }] : [{ value: 1 }],
      company: { count: async () => 1 },
      user: { count: async () => 1 },
    };
    @Module({
      controllers: [SalesInvoicesController, UsersController, LicensingController, HealthController],
      providers: [
        { provide: LicensingService, useValue: service },
        { provide: PrismaService, useValue: healthDb },
        { provide: SalesInvoicesService, useValue: { findAll: calls.read, create: calls.write } },
        { provide: UsersService, useValue: { list: calls.admin, create: calls.adminWrite } },
        { provide: APP_GUARD, useClass: LicenseGuard },
      ],
    })
    class IsolatedHttpModule {}
    const app = await NestFactory.create(IsolatedHttpModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    // This test deliberately stubs authentication; it exercises real routing,
    // controllers and the global licence guard, not JWT/permission enforcement.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { user: object }).user = { userId: 'synthetic', companyId: 'synthetic', branchId: null, isSuperAdmin: true, permissions: [] };
      next();
    });
    try {
      const activation = signPayload({ v: 1, keyId: 'http-activation', type: 'ACTIVATION', licenseId: 'http-license', machineId: MACHINE, issuedAt: '2026-04-30T00:00:00.000Z', term: { kind: 'MONTHS', months: 12 }, seats: { mode: 'INCREASE', value: 5 }, state: null, note: null }, privateKey);
      await service.activate(activation);
      await app.listen(0, '127.0.0.1');
      const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
      const request = (path: string, method = 'GET', body?: object) => fetch(base + path, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      expect((await request('/sales/invoices')).status).toBe(200);
      expect((await request('/sales/invoices', 'POST', {})).status).toBe(201);
      expect((await request('/admin/users')).status).toBe(200);
      expect((await request('/admin/users', 'POST', {})).status).toBe(201);
      calls.read.mockClear(); calls.write.mockClear(); calls.admin.mockClear(); calls.adminWrite.mockClear();
      const rows = structuredClone(db.installations);
      renameSync(pub, join(dir, 'saved-public.pem'));
      for (const [path, method] of [['/sales/invoices', 'GET'], ['/sales/invoices', 'POST'], ['/admin/users', 'GET'], ['/admin/users', 'POST']] as const) {
        const response = await request(path, method, method === 'POST' ? {} : undefined);
        expect(response.status).toBe(403);
        expect((await response.json() as { code: string }).code).toBe('LICENSE_PUBLIC_KEY_MISSING');
      }
      expect(calls.read).not.toHaveBeenCalled(); expect(calls.write).not.toHaveBeenCalled(); expect(calls.admin).not.toHaveBeenCalled(); expect(calls.adminWrite).not.toHaveBeenCalled();
      const renew = await request('/license/renew', 'POST', { key: activation });
      expect(renew.status).toBe(503);
      expect((await renew.json() as { code: string }).code).toBe('LICENSE_PUBLIC_KEY_MISSING');
      const confirm = await request('/license/confirm-clock', 'POST', {});
      expect(confirm.status).toBe(503);
      expect((await confirm.json() as { code: string }).code).toBe('LICENSE_PUBLIC_KEY_MISSING');
      const health = await request('/health');
      expect(health.status).toBe(200);
      expect((await health.json() as { license: { configured: boolean } }).license.configured).toBe(false);
      expect(db.installations).toEqual(rows);
      writeFileSync(pub, PUBLIC_PEM);
      expect((await request('/sales/invoices')).status).toBe(200);
      expect((await request('/admin/users')).status).toBe(200);
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
