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
require('ts-node/register/transpile-only');
const { Client } = require('pg');
const { FullBackupService } = require('../src/modules/backup/full-backup.service');
const { MaintenanceService } = require('../src/common/maintenance/maintenance');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
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
    await client.query("CREATE TABLE fixture_items(id integer primary key, value text); INSERT INTO fixture_items VALUES(1,'before')");
    const backup = await service.createFull('fixture');
    assert.ok((await service.verify(backup.file.name)).entries > 0);
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
    await client.query("UPDATE fixture_items SET value='changed-after-backup'");
    await assert.rejects(service.restore({ confirm: true, fileName: backup.file.name }, 'fixture'), /rehearsal database could not be removed/i);
    assert.equal(schemaDestructions, 0);
    assert.equal(maintenance.isActive, false);
    assert.equal((await client.query('SELECT value FROM fixture_items')).rows[0].value, 'changed-after-backup');
    assert.equal((await service.list()).filter(f => f.kind === 'safety').length, 0);
    console.log('PASS: real pg_restore rejects a truncated safety archive and scratch cleanup failure leaves synthetic primary unchanged; Prisma and licence checks mocked.');
  } finally {
    if (scratchClient) await scratchClient.end();
    if (scratchName) await admin.query(`DROP DATABASE "${scratchName}"`);
    await client.end();
    if (created) await admin.query(`DROP DATABASE "${targetName}"`);
    await admin.end();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
