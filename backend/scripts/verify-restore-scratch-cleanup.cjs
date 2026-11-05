'use strict';
// GitHub-hosted disposable PostgreSQL service ONLY. Real pg_dump/pg_restore
// and PostgreSQL; Prisma's raw-execution interface and licensing are mocked.
// This proves one failure path, not cross-process or crash-safe restore.
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const load = Module._load;
Module._load = function (request, parent, main) {
  if (request === '@prisma/client') return load.call(this, require.resolve('../jest-prisma-shim.cjs'), parent, main);
  return load.call(this, request, parent, main);
};
require('reflect-metadata');
require('ts-node/register/transpile-only');
const { Client } = require('pg');
const { FullBackupService } = require('../src/modules/backup/full-backup.service');
const { BackupScheduleService } = require('../src/modules/backup/backup-schedule.service');
const { pgBackupConnectionEnv } = require('../src/modules/backup/pg-backup-connection');
const { MaintenanceService } = require('../src/common/maintenance/maintenance');
const { FullBackupController } = require('../src/modules/backup/full-backup.controller');
const { AuditService } = require('../src/common/audit/audit.service');
const { PermissionsGuard } = require('../src/common/guards/permissions.guard');
const { ProblemDetailsFilter } = require('../src/common/filters/problem-details.filter');
const { Module: NestModule } = require('@nestjs/common');
const { NestFactory, Reflector } = require('@nestjs/core');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

(async () => {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
    throw new Error('A disposable GitHub-hosted runner is required');
  }
  const adminUrl = new URL(process.env.KAYAN_TEST_ADMIN_URL ?? '');
  if (adminUrl.hostname !== '127.0.0.1' || adminUrl.port !== '5432' || adminUrl.pathname !== '/postgres') {
    throw new Error('Expected the isolated CI PostgreSQL service');
  }
  const targetName = `kayan_scratch_guard_${randomUUID().replace(/-/g, '')}`;
  const targetUrl = new URL(adminUrl);
  targetUrl.pathname = `/${targetName}`;
  process.env.DATABASE_URL = targetUrl.toString();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kayan-restore-guard-'));
  process.env.KAYAN_BACKUP_DIR = dir;
  const admin = new Client({ connectionString: adminUrl.toString() });
  const client = new Client({ connectionString: targetUrl.toString() });
  let scratchClient, scratchName, created = false;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${targetName}"`);
    created = true;
    await client.connect();
    let schemaDestructions = 0;
    const prisma = { backupRun: {create: async ({data}) => {
      const result=await client.query('INSERT INTO fixture_backup_runs(filename,status,message,kind) VALUES($1,$2,$3,$4) RETURNING *',
        [data.fileName,data.status,data.message,data.kind]);
      return result.rows[0];
    }}, $executeRawUnsafe: async sql => {
      if (sql.startsWith('DROP SCHEMA')) schemaDestructions++;
      const drop = sql.match(/^DROP DATABASE IF EXISTS "(kayan_restore_check_[0-9a-f]+)"$/);
      if (drop) {
        scratchName = drop[1];
        const scratchUrl = new URL(adminUrl);
        scratchUrl.pathname = `/${scratchName}`;
        scratchClient = new Client({ connectionString: scratchUrl.toString() });
        await scratchClient.connect();
      }
      return client.query(sql);
    } };
    const maintenance = new MaintenanceService();
    const service = new FullBackupService(prisma, { record: async () => {} }, maintenance, { reconcile: async () => {} });
    await client.query("CREATE TABLE fixture_items(id integer primary key, value text); INSERT INTO fixture_items VALUES(1,'before'); INSERT INTO fixture_items SELECT i, md5(i::text) || md5((i+1)::text) FROM generate_series(2,1002) AS i");
    const before = await client.query(`SELECT count(*)::int AS n, md5(string_agg(value, '' ORDER BY id)) AS digest FROM fixture_items`);
    const backup = await service.createFull('fixture');
    // Two real concurrent pg_dump operations can complete under distinct
    // names. A same-instance restore must be refused before its first write.
    const pendingA = service.createFull('fixture');
    const pendingB = service.createFull('fixture');
    await assert.rejects(service.restore({ confirm: true, fileName: backup.file.name }, 'fixture'), /backup is running/i);
    const [copyA, copyB] = await Promise.all([pendingA, pendingB]);
    assert.notEqual(copyA.file.name, copyB.file.name);
    assert.ok((await service.verify(copyA.file.name)).archiveContentReadable);
    assert.ok((await service.verify(copyB.file.name)).archiveContentReadable);
    assert.deepEqual((await client.query(`SELECT count(*)::int AS n, md5(string_agg(value, '' ORDER BY id)) AS digest FROM fixture_items`)).rows, before.rows);
    const verified = await service.verify(backup.file.name);
    assert.ok(verified.entries > 0);
    assert.equal(verified.archiveContentReadable, true);
    assert.equal(verified.fullRestoreRehearsed, false);
    assert.equal(verified.includesExternalFiles, false);

    // Scheduler uses real archive tools and PG; its company/settings/Prisma
    // interfaces are deliberately synthetic. A readable DB-only archive is
    // retained but must never be reported as a verified full backup.
    await client.query('CREATE TABLE fixture_backup_runs (id serial primary key, filename text, status text, message text, kind text)');
    const schedulerDb={company:{findMany:async()=>[{id:'synthetic',code:'SYN',nameEn:'Synthetic'}]},
      backupRun:{findFirst:async()=>null,create:async({data})=>{
        const inserted=await client.query('INSERT INTO fixture_backup_runs(filename,status,message) VALUES($1,$2,$3) RETURNING *',
          [data.fileName,data.status,data.message]);return inserted.rows[0];
      }}};
    const scheduler=new BackupScheduleService(schedulerDb,service,{get:async()=>({backupIntervalHours:1,backupRetentionCount:1})});
    const originalBytes=await fs.readFile(path.join(dir,backup.file.name));
    const [scheduled]=await scheduler.runNow('synthetic');
    assert.equal(scheduled.status,'FAILED');
    assert.match(scheduled.message,/الملفات والترخيص/);
    assert.ok((await service.verify(scheduled.fileName)).archiveContentReadable);
    assert.deepEqual(await fs.readFile(path.join(dir,backup.file.name)),originalBytes);
    const scheduleRows=await client.query('SELECT filename,status FROM fixture_backup_runs');
    assert.deepEqual(scheduleRows.rows,[{filename:scheduled.fileName,status:'FAILED'}]);
    assert.deepEqual((await client.query(`SELECT count(*)::int AS n, md5(string_agg(value, '' ORDER BY id)) AS digest FROM fixture_items`)).rows,before.rows);
    console.log('PASS: real database archive read remains FAILED as a full scheduled backup and preserves prior bytes; synthetic scheduler interface, no licence or full-restore proof.');

    // A readable TOC is insufficient: truncate the synthetic data section,
    // retain the original, and prove the real pg_restore can still list it.
    const corruptPath = path.join(dir, 'synthetic-corrupt.dump');
    await fs.copyFile(path.join(dir, backup.file.name), corruptPath);
    const size = (await fs.stat(corruptPath)).size;
    assert.ok(size > 1000);
    await fs.truncate(corruptPath, size - 128);
    assert.match(execFileSync('pg_restore', ['--list', corruptPath], { encoding: 'utf8' }), /fixture_items/);
    await assert.rejects(service.verify('synthetic-corrupt.dump'), /could not read/);
    assert.deepEqual((await client.query(`SELECT count(*)::int AS n, md5(string_agg(value, '' ORDER BY id)) AS digest FROM fixture_items`)).rows, before.rows);
    assert.ok((await service.verify(backup.file.name)).archiveContentReadable);
    await assert.rejects(service.remove(backup.file.name, 'fixture'), error => error.getStatus?.() === 409);
    assert.ok((await service.verify(backup.file.name)).archiveContentReadable);

    // Exercise the real controller and service over HTTP with real archive
    // tools and PostgreSQL. Identity is injected, not a JWT or licence test.
    class BackupHttpFixtureModule {}
    NestModule({ controllers: [FullBackupController], providers: [
      { provide: FullBackupService, useValue: service },
      { provide: MaintenanceService, useValue: maintenance },
    ] })(BackupHttpFixtureModule);
    const http = await NestFactory.create(BackupHttpFixtureModule, { logger: false });
    try {
      http.use((req, _res, next) => {
        req.user = { userId:'synthetic-user', companyId:'synthetic-company', branchId:null,
          username:'synthetic', isSuperAdmin:req.headers['x-fixture-super'] === 'yes', permissions:['admin.backup'] };
        next();
      });
      http.useGlobalGuards(new PermissionsGuard(new Reflector()));
      http.useGlobalFilters(new ProblemDetailsFilter());
      await http.listen(0, '127.0.0.1');
      const base = `http://127.0.0.1:${http.getHttpServer().address().port}/backup/full`;
      const headers = {'x-fixture-super':'yes'};
      // Complete manual backup refuses honestly and records FAILED; an explicit
      // DB-only archive remains available separately and is never a full copy.
      const fullAttempt=await fetch(base,{method:'POST',headers});
      assert.equal(fullAttempt.status,503);
      assert.equal((await fullAttempt.json()).code,'FULL_BACKUP_INCOMPLETE');
      const rejectedRuns=await client.query("SELECT filename,status,kind FROM fixture_backup_runs WHERE kind='FULL'");
      assert.deepEqual(rejectedRuns.rows,[{filename:'-',status:'FAILED',kind:'FULL'}]);
      const dbOnly=await fetch(`${base}/database-archive`,{method:'POST',headers});
      assert.equal(dbOnly.status,201);
      const dbOnlyResult=await dbOnly.json();
      assert.equal(dbOnlyResult.fullBackup,false);
      assert.equal(dbOnlyResult.includesExternalFiles,false);
      assert.equal(dbOnlyResult.includesLicence,false);
      assert.ok((await service.verify(dbOnlyResult.file.name)).archiveContentReadable);
      assert.deepEqual(await fs.readFile(path.join(dir,backup.file.name)),originalBytes);
      const content = await fetch(`${base}/${backup.file.name}/verify`, {method:'POST',headers});
      assert.equal(content.status, 201);
      assert.deepEqual(Object.fromEntries(Object.entries(await content.json()).filter(([key]) =>
        ['archiveContentReadable','fullRestoreRehearsed','includesExternalFiles'].includes(key))),
        {archiveContentReadable:true,fullRestoreRehearsed:false,includesExternalFiles:false});
      assert.equal((await fetch(`${base}/synthetic-corrupt.dump/verify`, {method:'POST',headers})).status, 503);
      assert.equal((await fetch(`${base}/${backup.file.name}`, {method:'DELETE',headers:{'x-fixture-super':'no'}})).status, 403);
      const denied = await fetch(`${base}/${backup.file.name}`, {method:'DELETE',headers});
      assert.equal(denied.status, 409);
      assert.equal((await denied.json()).code, 'BACKUP_DELETE_PROTECTED');
      assert.ok((await service.verify(backup.file.name)).archiveContentReadable);
      assert.deepEqual((await client.query(`SELECT count(*)::int AS n, md5(string_agg(value, '' ORDER BY id)) AS digest FROM fixture_items`)).rows, before.rows);
    } finally { await http.close(); }

    // Real pg_dump/pg_restore with an injected fsync failure: do not publish
    // a new file or disturb the previous backup/primary when flushing fails.
    const flushFail = new FullBackupService(prisma, { record: async () => {} }, maintenance, { reconcile: async () => {} });
    flushFail.syncArchive = async () => { throw new Error('synthetic fsync failure'); };
    const filesBeforeFlush = (await fs.readdir(dir)).filter(name => name.endsWith('.dump')).sort();
    await assert.rejects(flushFail.createFull('fixture'));
    assert.deepEqual((await fs.readdir(dir)).filter(name => name.endsWith('.dump')).sort(), filesBeforeFlush);
    assert.equal((await fs.readdir(dir)).some(name => name.endsWith('.partial')), false);
    assert.ok((await service.verify(backup.file.name)).archiveContentReadable);
    assert.deepEqual((await client.query(`SELECT count(*)::int AS n, md5(string_agg(value, '' ORDER BY id)) AS digest FROM fixture_items`)).rows, before.rows);
    console.log('PASS: injected archive fsync failure prevents publication and preserves the prior archive and primary; no power-loss guarantee.');

    // A tool may exit zero while leaving a data-corrupt archive; it must not
    // be published even if its TOC can be listed successfully.
    const corruptDumpTool = path.join(dir, 'corrupt-pg-dump');
    await fs.writeFile(corruptDumpTool, '#!/bin/sh\nfor x in "$@"; do case "$x" in --file=*) out=${x#--file=};; esac; done\ncp "$KAYAN_CORRUPT_FIXTURE" "$out"\n', { mode: 0o700 });
    const previousDump = process.env.KAYAN_PG_DUMP;
    process.env.KAYAN_PG_DUMP = corruptDumpTool;
    process.env.KAYAN_CORRUPT_FIXTURE = corruptPath;
    try {
      const invalid = new FullBackupService(prisma, { record: async () => {} }, maintenance, { reconcile: async () => {} });
      const files = (await fs.readdir(dir)).filter(name => name.endsWith('.dump')).sort();
      await assert.rejects(invalid.createFull('fixture'));
      assert.deepEqual((await fs.readdir(dir)).filter(name => name.endsWith('.dump')).sort(), files);
      assert.equal((await fs.readdir(dir)).some(name => name.endsWith('.partial')), false);
      assert.deepEqual((await client.query(`SELECT count(*)::int AS n, md5(string_agg(value, '' ORDER BY id)) AS digest FROM fixture_items`)).rows, before.rows);
    } finally {
      if (previousDump === undefined) delete process.env.KAYAN_PG_DUMP;
      else process.env.KAYAN_PG_DUMP = previousDump;
      delete process.env.KAYAN_CORRUPT_FIXTURE;
    }
    // pg_dump exits successfully but writes a truncated PGDMP header. The
    // real pg_restore must refuse it before a safety file is published.
    const fakeDump = path.join(dir, 'fake-pg-dump');
    await fs.writeFile(fakeDump, '#!/bin/sh\nfor x in "$@"; do case "$x" in --file=*) out=${x#--file=};; esac; done\nprintf PGDMP-broken > "$out"\n', { mode: 0o700 });
    const savedDump = process.env.KAYAN_PG_DUMP;
    process.env.KAYAN_PG_DUMP = fakeDump;
    try {
      const invalid = new FullBackupService(prisma, { record: async () => {} }, maintenance, { reconcile: async () => {} });
      const before = (await fs.readdir(dir)).filter(name => name.endsWith('.dump'));
      await assert.rejects(invalid.createSafety());
      assert.deepEqual((await fs.readdir(dir)).filter(name => name.endsWith('.dump')), before);
      assert.equal((await fs.readdir(dir)).some(name => name.endsWith('.partial')), false);
    } finally {
      if (savedDump === undefined) delete process.env.KAYAN_PG_DUMP;
      else process.env.KAYAN_PG_DUMP = savedDump;
    }
    await client.query("UPDATE fixture_items SET value='changed-after-backup' WHERE id=1");
    const pendingRestore = service.restore({ confirm: true, fileName: backup.file.name }, 'fixture');
    await assert.rejects(service.createFull('fixture'), /restore is running/i);
    await assert.rejects(pendingRestore, /rehearsal database could not be removed/i);
    assert.equal(schemaDestructions, 0);
    assert.equal(maintenance.isActive, false);
    assert.equal((await client.query('SELECT value FROM fixture_items WHERE id = 1')).rows[0].value, 'changed-after-backup');
    assert.equal((await service.list()).filter(f => f.kind === 'safety').length, 0);
    console.log('PASS: real HTTP and pg_restore read a valid archive, reject TOC-readable truncated data and protect deletion without primary changes; scratch cleanup failure leaves synthetic primary unchanged. Prisma and licence checks mocked; external files and full restore not verified.');

    // Now allow a real restore ONLY on this newly created disposable target.
    // Application postchecks and access/licence repair remain test stubs; this
    // is not an application, multi-process, crash or licensing proof.
    await scratchClient.end();
    scratchClient = null;
    await admin.query(`DROP DATABASE "${scratchName}"`);
    scratchName = null;
    const repairMaintenance = new MaintenanceService();
    const recorded = [];
    let licenseCalls = 0;
    const actual = new FullBackupService({$executeRawUnsafe: sql => client.query(sql)},
      {record: async row => {recorded.push(row);}}, repairMaintenance,
      {reconcile: async () => {licenseCalls++;}});
    actual.postRestoreCheck = async () => ({ok:true,detail:'synthetic-only'});
    actual.reconcileRestoredCompanies = async () => {throw new Error('synthetic access repair failure');};
    await assert.rejects(actual.restore({confirm:true,fileName:backup.file.name},'fixture'),/maintenance remains active/i);
    assert.equal(repairMaintenance.isActive,true);
    assert.match(repairMaintenance.status.detail,/access repair failed/i);
    assert.equal(licenseCalls,0);
    assert.deepEqual(recorded.map(row=>row.action),['RESTORE_ACCESS_REPAIR_FAILED']);
    assert.equal((await client.query('SELECT value FROM fixture_items WHERE id=1')).rows[0].value,'before');
    const safety = (await actual.list()).filter(file=>file.kind==='safety');
    assert.equal(safety.length,1);
    assert.ok((await actual.verify(safety[0].name)).archiveContentReadable);
    // Check the pre-restore value by restoring the safety file into a second
    // disposable database, rather than merely trusting its TOC or a mock.
    const safetyName=`kayan_safety_check_${randomUUID().replace(/-/g,'')}`;
    let safetyClient;
    try {
      await admin.query(`CREATE DATABASE "${safetyName}"`);
      execFileSync('pg_restore',['--exit-on-error','--no-owner','--no-privileges','--no-password',
        `--dbname=${safetyName}`,path.join(dir,safety[0].name)],
        {env:{...process.env,...pgBackupConnectionEnv(process.env.DATABASE_URL)}});
      const safetyUrl = new URL(adminUrl); safetyUrl.pathname=`/${safetyName}`;
      safetyClient = new Client({connectionString:safetyUrl.toString()});
      await safetyClient.connect();
      assert.equal((await safetyClient.query('SELECT value FROM fixture_items WHERE id=1')).rows[0].value,'changed-after-backup');
    } finally {
      if (safetyClient) await safetyClient.end();
      await admin.query(`DROP DATABASE IF EXISTS "${safetyName}"`);
    }
    console.log('PASS: synthetic PG older backup restored; injected access repair failure holds local maintenance; separate scratch restore confirms safety snapshot contains pre-restore value. Application checks and licensing stubbed; no crash or concurrency proof.');

    // Verify the production HTTP controller fails closed, then exercise the
    // legacy restore engine ONLY on this strictly disposable target. The
    // access repair, postcheck, audit and licensing are stubs, NOT end-to-end.
    const cleanMaintenance = new MaintenanceService();
    let repairCount=0, reconcileCount=0;
    const events=[];
    // Keep this synthetic audit fixture outside the public schema being
    // replaced. The real AuditService writes through an injected SQL adapter;
    // this is not proof of the installed product's audit DB durability.
    await client.query('CREATE SCHEMA fixture_audit; CREATE TABLE fixture_audit.events (action text, entity text, after_json jsonb); CREATE TABLE fixture_audit.users (id text PRIMARY KEY)');
    const cleanPrisma={$executeRawUnsafe: sql => client.query(sql),
      user:{count:async ({where}) => (await client.query('SELECT count(*)::int AS n FROM fixture_audit.users WHERE id=$1',[where.id])).rows[0].n},
      auditLog:{create:async ({data})=>{
      events.push(data);
      await client.query('INSERT INTO fixture_audit.events(action,entity,after_json) VALUES($1,$2,$3)',
        [data.action,data.entity,JSON.stringify(data.afterJson)]);
    }}};
    const clean = new FullBackupService(cleanPrisma,new AuditService(cleanPrisma),
      cleanMaintenance,{reconcile:async()=>{reconcileCount++;}});
    clean.postRestoreCheck=async()=>({ok:true,detail:'synthetic-only'});
    clean.reconcileRestoredCompanies=async()=>{repairCount++;return {companies:0,grantsAdded:0,superAdminPromoted:[]};};
    const digest=async()=> (await client.query(`SELECT count(*)::int AS n, md5(string_agg(value, '' ORDER BY id)) AS digest FROM fixture_items`)).rows;
    assert.deepEqual(await digest(),before.rows);
    await client.query("UPDATE fixture_items SET value='newer-backup' WHERE id=1; INSERT INTO fixture_items VALUES(1003,'after-old-backup')");
    const newerSnapshot=await digest();
    const newer=await clean.createFull('fixture');
    assert.notEqual(newer.file.name,backup.file.name);
    await client.query("UPDATE fixture_items SET value='before-restore' WHERE id=1; DELETE FROM fixture_items WHERE id=2");
    const beforeRestore=await digest();
    assert.notDeepEqual(beforeRestore,newerSnapshot);
    const oldBytes=await fs.readFile(path.join(dir,backup.file.name));
    const newBytes=await fs.readFile(path.join(dir,newer.file.name));
    class RestoreHttpFixtureModule {}
    NestModule({controllers:[FullBackupController],providers:[
      {provide:FullBackupService,useValue:clean},{provide:MaintenanceService,useValue:cleanMaintenance},
    ]})(RestoreHttpFixtureModule);
    const restoreHttp=await NestFactory.create(RestoreHttpFixtureModule,{logger:false});
    try {
      restoreHttp.use((req,_res,next)=>{req.user={userId:'fixture',companyId:'fixture',branchId:null,
        username:'fixture',isSuperAdmin:req.headers['x-fixture-super']==='yes',permissions:['admin.backup']};next();});
      restoreHttp.useGlobalGuards(new PermissionsGuard(new Reflector()));
      restoreHttp.useGlobalFilters(new ProblemDetailsFilter());
      await restoreHttp.listen(0,'127.0.0.1');
      const endpoint=`http://127.0.0.1:${restoreHttp.getHttpServer().address().port}/backup/full/restore`;
      const post=(body,superAdmin=true)=>fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',
        'x-fixture-super':superAdmin?'yes':'no'},body:JSON.stringify(body)});
      assert.equal((await post({confirm:true,fileName:backup.file.name},false)).status,403);
      for (const body of [{confirm:false,fileName:backup.file.name},
        {confirm:true,fileName:'synthetic-missing.dump'},
        {confirm:true,fileName:'synthetic-corrupt.dump'},
        {confirm:true,fileName:backup.file.name}]) {
        const blocked=await post(body);
        assert.equal(blocked.status,503);
        assert.equal((await blocked.json()).code,'FULL_RESTORE_UNAVAILABLE');
      }
      const form=new FormData();
      form.set('file',new Blob([Buffer.from('PGDMP synthetic')]),'test.dump');
      form.set('confirm','true');
      const upload=await fetch(endpoint,{method:'POST',headers:{'x-fixture-super':'yes'},body:form});
      assert.equal(upload.status,503);
      assert.equal((await upload.json()).code,'FULL_RESTORE_UNAVAILABLE');
      const concurrent=await Promise.all([post({confirm:true,fileName:backup.file.name}),post({confirm:true,fileName:backup.file.name})]);
      assert.ok(concurrent.every(response=>response.status===503));
      assert.deepEqual(await digest(),beforeRestore);
      assert.deepEqual(await fs.readFile(path.join(dir,backup.file.name)),oldBytes);
      assert.deepEqual(await fs.readFile(path.join(dir,newer.file.name)),newBytes);
      assert.equal(cleanMaintenance.isActive,false);
      assert.equal(repairCount,0); assert.equal(reconcileCount,0);
      // Preserve regression coverage of the isolated legacy engine; it is no
      // longer exposed by the production controller as a complete restore.
      await assert.rejects(clean.restore({confirm:false,fileName:backup.file.name},'fixture'),e=>e.getStatus?.()===400);
      await assert.rejects(clean.restore({confirm:true,fileName:'synthetic-missing.dump'},'fixture'),e=>e.getStatus?.()===404);
      await assert.rejects(clean.restore({confirm:true,fileName:'synthetic-corrupt.dump'},'fixture'),e=>e.getStatus?.()===400);
      const result=await clean.restore({confirm:true,fileName:backup.file.name},'fixture');
      assert.equal(result.restored,true); assert.equal(result.rehearsed,true); assert.equal(result.checked,true);
      assert.equal(result.source,backup.file.name);
      assert.equal(cleanMaintenance.isActive,false);
      assert.equal(repairCount,1); assert.equal(reconcileCount,1);
      assert.deepEqual(await digest(),before.rows);
      assert.deepEqual(await fs.readFile(path.join(dir,backup.file.name)),oldBytes);
      assert.deepEqual(await fs.readFile(path.join(dir,newer.file.name)),newBytes);
      assert.equal(events.filter(event=>event.action==='RESTORE_DATABASE_ARCHIVE' && event.afterJson.fullRestore===false && event.afterJson.actorId==='fixture' && event.userId===null).length,1);
      assert.deepEqual((await client.query("SELECT action,entity,after_json->>'fullRestore' AS full FROM fixture_audit.events WHERE action='RESTORE_DATABASE_ARCHIVE'")).rows,
        [{action:'RESTORE_DATABASE_ARCHIVE',entity:'backup_database_archive',full:'false'}]);
      // Independently restore the safety copy and verify all synthetic rows,
      // including the changes immediately before the destructive restore.
      const checkName=`kayan_safety_check_${randomUUID().replace(/-/g,'')}`;
      let check;
      try {
        await admin.query(`CREATE DATABASE "${checkName}"`);
        execFileSync('pg_restore',['--exit-on-error','--no-owner','--no-privileges','--no-password',
          `--dbname=${checkName}`,path.join(dir,result.safetyBackup)],
          {env:{...process.env,...pgBackupConnectionEnv(process.env.DATABASE_URL)}});
        const checkUrl=new URL(adminUrl);checkUrl.pathname=`/${checkName}`;
        check=new Client({connectionString:checkUrl.toString()});await check.connect();
        assert.deepEqual((await check.query(`SELECT count(*)::int AS n, md5(string_agg(value, '' ORDER BY id)) AS digest FROM fixture_items`)).rows,beforeRestore);
      } finally {
        if (check) await check.end();
        await admin.query(`DROP DATABASE IF EXISTS "${checkName}"`);
      }
    } finally { await restoreHttp.close(); }
    console.log('PASS: production HTTP refuses incomplete restore without database or archive changes; isolated legacy engine restores synthetic PG and its safety copy; application/access/licence checks stubbed, no files/crash/JWT proof.');

  } finally {
    if (scratchClient) await scratchClient.end();
    if (scratchName) await admin.query(`DROP DATABASE "${scratchName}"`);
    await client.end();
    if (created) await admin.query(`DROP DATABASE "${targetName}"`);
    await admin.end();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
