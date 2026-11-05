import { INestApplication, Module } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';

import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ProblemDetailsFilter } from '../../common/filters/problem-details.filter';
import { MaintenanceService } from '../../common/maintenance/maintenance';
import { FullBackupController } from './full-backup.controller';
import { FullBackupService } from './full-backup.service';

// HTTP routing/guards are real; identity and persistence are test doubles.
// PostgreSQL and archive tools are covered separately in the isolated CI job.
describe('complete backup and restore HTTP safety', () => {
  const records: any[] = [];
  const prisma = { backupRun: { create: jest.fn(async ({data}) => { records.push(data); }) } };
  const maintenance = new MaintenanceService();
  const service = new FullBackupService(prisma as any, {} as any, maintenance, {} as any);
  const archive = jest.spyOn(service, 'createFull').mockResolvedValue({
    file: {name: 'synthetic.dump', sizeBytes: 10, kind: 'full', createdAt: '2026-11-05T00:00:00Z'}, durationMs: 1,
  });
  const restore = jest.spyOn(service, 'restore');
  @Module({controllers: [FullBackupController], providers: [
    {provide: FullBackupService, useValue: service},
    {provide: MaintenanceService, useValue: maintenance},
  ]})
  class FixtureModule {}
  let app: INestApplication;
  let base: string;
  beforeAll(async () => {
    app = await NestFactory.create(FixtureModule, {logger: false});
    app.use((req: any, _res: any, next: () => void) => {
      req.user = {userId:'operator',companyId:'company',branchId:null,username:'fixture',
        isSuperAdmin:req.headers['x-fixture-super'] === 'yes',permissions:['admin.backup']};
      next();
    });
    app.useGlobalGuards(new PermissionsGuard(new Reflector()));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    base = `http://127.0.0.1:${address.port}/backup/full`;
  });
  afterAll(async () => { await app.close(); });
  afterEach(() => { records.length = 0; archive.mockClear(); restore.mockClear(); });

  it('records FAILED rather than creating a misleading complete archive', async () => {
    const result = await fetch(base, {method:'POST', headers:{'x-fixture-super':'yes'}});
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({code:'FULL_BACKUP_INCOMPLETE'});
    expect(records).toEqual([expect.objectContaining({kind:'FULL',status:'FAILED',fileName:'-'})]);
    expect(archive).not.toHaveBeenCalled();
  });

  it('offers the database archive only through the explicitly partial operation', async () => {
    const result = await fetch(`${base}/database-archive`, {method:'POST', headers:{'x-fixture-super':'yes'}});
    expect(result.status).toBe(201);
    expect(await result.json()).toMatchObject({fullBackup:false, includesExternalFiles:false, includesLicence:false});
    expect(archive).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(0);
  });

  it('labels legacy and safety dump listings as incomplete machine backups', async () => {
    const listing = jest.spyOn(service, 'list').mockResolvedValueOnce([
      {name:'legacy.dump',sizeBytes:10,kind:'full',createdAt:'2026-11-05T00:00:00Z'},
      {name:'safety.dump',sizeBytes:10,kind:'safety',createdAt:'2026-11-05T00:00:00Z'},
    ]);
    const result = await fetch(base, {headers:{'x-fixture-super':'yes'}});
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual([
      expect.objectContaining({kind:'full',fullBackup:false,includesExternalFiles:false,includesLicence:false}),
      expect.objectContaining({kind:'safety',fullBackup:false,includesExternalFiles:false,includesLicence:false}),
    ]);
    listing.mockRestore();
  });

  it('rejects restore before parsing uploads and never invokes the legacy engine', async () => {
    const result = await fetch(`${base}/restore`, {method:'POST', headers:{'x-fixture-super':'yes',
      'content-type':'multipart/form-data; boundary=invalid'}, body:'not a multipart body'});
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({code:'FULL_RESTORE_UNAVAILABLE'});
    expect(restore).not.toHaveBeenCalled();
    expect(maintenance.isActive).toBe(false);
  });

  it('still denies a non-super administrator before any operation', async () => {
    for (const path of ['', '/database-archive', '/restore']) {
      const result = await fetch(`${base}${path}`, {method:'POST', headers:{'x-fixture-super':'no'}});
      expect(result.status).toBe(403);
    }
    expect(records).toHaveLength(0);
    expect(archive).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });
});
