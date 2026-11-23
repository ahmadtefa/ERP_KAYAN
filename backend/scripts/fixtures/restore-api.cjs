'use strict';
// Disposable API fixture: real Nest admission/interception, DUMP engine and PG;
// licence/access policy are deliberately outside this infrastructure test.
require('reflect-metadata');
const { Controller, Get, Post, Body, Module } = require('@nestjs/common');
const { NestFactory, APP_GUARD, APP_INTERCEPTOR } = require('@nestjs/core');
const { Client } = require('pg');
const { MaintenanceService, MaintenanceAdmissionGuard, MaintenanceInterceptor } = require('../../dist/src/common/maintenance/maintenance');
const { DatabaseMaintenanceBarrier } = require('../../dist/src/common/maintenance/database-barrier');
const { FullBackupService } = require('../../dist/src/modules/backup/full-backup.service');
const { RestoreJournalStore } = require('../../dist/src/modules/backup/system/restore-journal');
const { acquireRestoreLock } = require('../../dist/src/modules/backup/system/restore-lock');
const { DumpRecoveryCoordinator } = require('../../dist/src/modules/backup/system/dump-recovery-coordinator');
const { API_APPLICATION_NAME } = require('../../dist/src/common/maintenance/process-identity');

if (process.env.NODE_ENV !== 'test' || !new URL(process.env.DATABASE_URL).pathname.startsWith('/kayan_work_')) {
  throw new Error('Disposable test database required');
}
async function sql(text, values = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL, application_name: API_APPLICATION_NAME });
  await client.connect();
  try { return await client.query(text, values); } finally { await client.end(); }
}
const maintenance = new MaintenanceService(new DatabaseMaintenanceBarrier());
const prisma = {
  $executeRawUnsafe: async (text) => { await sql(text); return 0; },
  user: { count: async () => 0 },
};
const service = new FullBackupService(prisma, { record: async () => {}, recordRequired: async () => {} }, maintenance, { reconcile: async () => {}, status: async () => ({}) });
service.postRestoreCheck = async () => {
  const result = await sql('SELECT value FROM fixture WHERE id = 1');
  return { ok: result.rowCount === 1, detail: 'real fixture row checked' };
};
service.reconcileRestoredCompanies = async () => ({ companies: 0 });
class FixtureController {
  async read() { return (await sql('SELECT value FROM fixture WHERE id = 1')).rows[0]; }
  async write(body) {
    if (body.delay) {
      process.send?.({ type: 'writing' });
      await new Promise((resolve) => setTimeout(resolve, body.delay));
    }
    await sql('UPDATE fixture SET value = $1 WHERE id = 1', [body.value]);
    return { saved: true };
  }
  async restore(body) { return service.restore({ confirm: true, fileName: body.name }, 'fixture'); }
  async recover() {
    const lock = await acquireRestoreLock();
    try {
      const journal = await new RestoreJournalStore(process.env.KAYAN_BACKUP_DIR).read();
      if (!journal) throw new Error('Recovery journal missing');
      await service.recoverDumpJournal(journal);
      return { recovered: true };
    } finally { await lock.end(); }
  }
}
Controller()(FixtureController);
for (const [method, decorator, path] of [
  ['read', Get, 'fixture'], ['write', Post, 'fixture'],
  ['restore', Post, 'backup/full/restore'], ['recover', Post, 'backup/complete/recovery/resume'],
]) decorator(path)(FixtureController.prototype, method, Object.getOwnPropertyDescriptor(FixtureController.prototype, method));
Body()(FixtureController.prototype, 'write', 0);
Body()(FixtureController.prototype, 'restore', 0);
class FixtureModule {}
Module({ controllers: [FixtureController], providers: [
  { provide: MaintenanceService, useValue: maintenance },
  { provide: DumpRecoveryCoordinator, useValue: new DumpRecoveryCoordinator(service, new RestoreJournalStore(process.env.KAYAN_BACKUP_DIR), maintenance) },
  { provide: APP_GUARD, useClass: MaintenanceAdmissionGuard },
  { provide: APP_INTERCEPTOR, useClass: MaintenanceInterceptor },
] })(FixtureModule);
void (async () => {
  const app = await NestFactory.create(FixtureModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  process.send?.({ type: 'ready', port: app.getHttpServer().address().port });
  process.on('message', async (message) => {
    if (message === 'close') { await app.close(); process.exit(0); }
  });
})().catch(() => process.exit(1));
