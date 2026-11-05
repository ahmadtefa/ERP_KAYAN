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
const { MaintenanceService } = require('../src/common/maintenance/maintenance');
const { FullBackupController } = require('../src/modules/backup/full-backup.controller');
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
    const prisma = { $executeRawUnsafe: async sql => {
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
  } finally {
    if (scratchClient) await scratchClient.end();
    if (scratchName) await admin.query(`DROP DATABASE "${scratchName}"`);
    await client.end();
    if (created) await admin.query(`DROP DATABASE "${targetName}"`);
    await admin.end();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
