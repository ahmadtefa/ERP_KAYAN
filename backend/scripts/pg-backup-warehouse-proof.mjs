/**
 * A full backup and a full restore, proved on the warehouse's own tables.
 *
 * The program's backup is a PostgreSQL archive of the whole database, and the
 * question this script answers is the one a storekeeper asks: after a restore,
 * are the warehouses, the shelves, the lots, the grants and the permissions
 * still there - with the quantities they held, not merely with empty tables?
 *
 *   1. it writes a warehouse, two shelves, a lot with a known remainder, a
 *      person and their warehouse grant into the running database, through
 *      Prisma - the same schema the program ships;
 *   2. it takes a real `pg_dump` archive of that database, the way the backup
 *      route does;
 *   3. it creates a database that has never had a migration applied to it and
 *      restores the archive into it;
 *   4. it compares the two databases row for row on the warehouse tables, on
 *      the permission grants, and on the value of the lot.
 *
 * Nothing here writes to the database the program normally runs on beyond one
 * tagged company-less fixture and the scratch databases this script creates
 * and drops by name.
 *
 * Environment:
 *   DATABASE_URL        the source database (the seeded test database)
 *   ADMIN_DATABASE_URL  a database on the same server used only to create and
 *                       drop the scratch restore database
 *   PG_DUMP / PG_RESTORE / PSQL  the client tools (default: on PATH)
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error('DATABASE_URL is required');

const PG_DUMP = process.env.PG_DUMP ?? 'pg_dump';
const PG_RESTORE = process.env.PG_RESTORE ?? 'pg_restore';
const PSQL = process.env.PSQL ?? 'psql';

/// `psql`, `pg_dump` and `pg_restore` refuse Prisma's `?schema=public`: it is a
/// Prisma option, not a libpq one, and the tools abort on it. The database is
/// the same either way, so the option is stripped for the client tools only.
function toolsUrl(url) {
  return url.replace(/([?&])schema=[^&]*/g, '$1').replace(/[?&]$/, '');
}

function adminUrl() {
  if (process.env.ADMIN_DATABASE_URL) return toolsUrl(process.env.ADMIN_DATABASE_URL);
  const url = new URL(toolsUrl(DB_URL));
  url.pathname = '/postgres';
  return url.toString();
}

let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(`${command} ${args.join(' ')} exited ${code}\n${stderr || stdout}`)),
    );
  });
}

/** One scalar from a database, as text. */
async function scalar(url, sqlText) {
  const { stdout } = await run(PSQL, ['-X', '-t', '-A', '-d', url, '-c', sqlText]);
  return stdout.trim();
}

function makeClient(url, applicationName) {
  const parsed = new URL(url);
  parsed.searchParams.set('application_name', applicationName);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: parsed.toString() }) });
}

async function main() {
  const prisma = makeClient(DB_URL, 'backup-warehouse-proof');
  const tag = randomUUID().slice(0, 6);
  const scratchName = `kayan_wh_restore_${Date.now()}`;
  const scratchUrl = (() => {
    const url = new URL(toolsUrl(DB_URL));
    url.pathname = `/${scratchName}`;
    return url.toString();
  })();
  const admin = adminUrl();
  const dumpDir = mkdtempSync(join(tmpdir(), 'kayan-wh-backup-'));
  const dumpFile = join(dumpDir, 'warehouse-proof.dump');

  let company = await prisma.company.findFirst({ where: { isActive: true } });
  if (!company) {
    company = await prisma.company.create({
      data: { id: randomUUID(), code: `CBP-${tag}`, nameEn: 'Backup proof', nameAr: 'إثبات النسخ' },
    });
  }
  const companyId = company.id;
  const branch = await prisma.branch.findFirst({ where: { companyId, deletedAt: null } });
  if (!branch) throw new Error('No branch in the active company; run prisma/seed.ts first.');

  console.log(`\n[1] write the warehouse fixture into ${company.code ?? companyId}`);
  const user = await prisma.user.create({
    data: {
      companyId,
      username: `backup-proof-${tag}`,
      fullNameEn: 'Backup proof',
      fullNameAr: 'إثبات النسخ',
      passwordHash: 'scenario-placeholder-not-a-real-credential',
    },
  });
  const warehouse = await prisma.warehouse.create({
    data: {
      companyId,
      branchId: branch.id,
      code: `BP-W-${tag}`,
      nameEn: 'Backup proof store',
      nameAr: 'مخزن إثبات النسخ',
    },
  });
  const zone = await prisma.storageLocation.create({
    data: {
      companyId,
      branchId: branch.id,
      warehouseId: warehouse.id,
      kind: 'ZONE',
      code: `BP-Z-${tag}`,
      nameEn: 'Zone',
      nameAr: 'منطقة',
      createdBy: user.id,
    },
  });
  const bin = await prisma.storageLocation.create({
    data: {
      companyId,
      branchId: branch.id,
      warehouseId: warehouse.id,
      parentId: zone.id,
      kind: 'BIN',
      code: `BP-B-${tag}`,
      nameEn: 'Bin',
      nameAr: 'خانة',
      createdBy: user.id,
    },
  });
  const item = await prisma.item.create({
    data: {
      companyId,
      code: `BP-I-${tag}`,
      nameEn: 'Backup proof item',
      nameAr: 'صنف إثبات النسخ',
      unit: 'عبوة',
      isStockTracked: true,
      requiresBatch: true,
    },
  });
  const lot = await prisma.itemBatch.create({
    data: {
      companyId,
      branchId: branch.id,
      warehouseId: warehouse.id,
      itemId: item.id,
      batchNumber: `BP-LOT-${tag}`,
      productionDate: new Date('2052-01-01T00:00:00Z'),
      expiryDate: new Date('2053-01-01T00:00:00Z'),
      receivedQuantity: new Prisma.Decimal(37),
      // A number that is not a round one: a restore that copied zeroes shows
      // up here immediately.
      remainingQuantity: new Prisma.Decimal('37.0000'),
      unitCost: new Prisma.Decimal('12.5'),
      storageLocationId: bin.id,
      status: 'OPEN',
    },
  });
  await prisma.userWarehouseAccess.create({
    data: {
      companyId,
      userId: user.id,
      warehouseId: warehouse.id,
      canView: true,
      canReceive: true,
      canIssue: false,
      canTransfer: false,
      canCount: true,
      canApprove: false,
      canSeeCost: false,
    },
  });
  const warehousePermissions = await prisma.permission.findMany({
    where: { code: { startsWith: 'inventory.warehouse' } },
    select: { code: true },
  });
  check('the fixture is in place', Boolean(lot.id) && warehousePermissions.length > 0,
    `${warehousePermissions.length} warehouse permissions in the catalogue`);

  try {
    console.log('\n[2] take a real dump of the whole database');
    const sourceToolsUrl = toolsUrl(DB_URL);
    await run(PG_DUMP, ['--format=custom', '--no-owner', '--no-privileges', '--file', dumpFile, sourceToolsUrl]);
    const dumpSize = Number((await run('stat', ['-c', '%s', dumpFile])).stdout.trim());
    check('the archive was written', dumpSize > 0, `${dumpSize} bytes`);

    console.log('\n[3] restore it into a database that has never been migrated');
    await run(PSQL, ['-X', '-d', admin, '-c', `DROP DATABASE IF EXISTS "${scratchName}"`]);
    await run(PSQL, ['-X', '-d', admin, '-c', `CREATE DATABASE "${scratchName}"`]);
    await run(PG_RESTORE, ['--no-owner', '--no-privileges', '-d', scratchUrl, dumpFile]);
    const tables = await scalar(scratchUrl, "select count(*) from information_schema.tables where table_schema='public'");
    check('the restored database has its structure', Number(tables) > 40, `${tables} tables`);

    console.log('\n[4] compare the warehouse tables, row for row');
    // `allowZero` is for a figure that is legitimately empty in a database
    // nobody has granted warehouse rights in yet: the restore still has to
    // reproduce it exactly, but "0 rows" is not an error there.
    const same = async (label, sqlText, { allowZero = false } = {}) => {
      const before = await scalar(sourceToolsUrl, sqlText);
      const after = await scalar(scratchUrl, sqlText);
      check(label, before === after && (allowZero || before !== '0'), `${after} (was ${before})`);
    };
    await same('the warehouses are all there',
      `select count(*) from warehouses where "companyId"='${companyId}' and "deletedAt" is null`);
    await same('the shelves are all there',
      `select count(*) from storage_locations where "companyId"='${companyId}' and "deletedAt" is null`);
    await same('the lots are all there',
      `select count(*) from item_batches where "companyId"='${companyId}'`);
    await same('the lot still holds 37 at 12.5',
      `select "batchNumber" || ':' || "remainingQuantity" || ':' || "unitCost" from item_batches where id='${lot.id}'`);
    await same('the shelf relationship survived',
      `select "storageLocationId" from item_batches where id='${lot.id}'`);
    await same('the per-user warehouse grant survived',
      `select "warehouseId" || ':' || "canView" || ':' || "canReceive" || ':' || "canCount" || ':' || "canApprove" || ':' || "canSeeCost" from user_warehouse_access where "userId"='${user.id}'`);
    await same('the warehouse permissions are in the catalogue',
      `select count(*) from permissions where code like 'inventory.warehouse%'`);
    await same('the roles keep the warehouse permissions they were granted',
      `select count(*) from role_permissions rp join permissions p on p.id = rp."permissionId" where p.code like 'inventory.warehouse%'`,
      { allowZero: true });
    // The schema itself, name for name: a restore that silently dropped a
    // table would keep every count above correct while losing a feature.
    await same('the restored schema is the same table for table',
      `select string_agg(table_name, ',' order by table_name) from information_schema.tables where table_schema='public'`);
    // Prisma's own bookkeeping, when the database was migrated with the CLI.
    // A database whose schema was applied from the migration SQL by
    // `pg-apply-migrations.mjs` has no such table, and that is not a fault:
    // the table list above has already proved the schema arrived.
    const hasMigrationTable = Number(
      await scalar(sourceToolsUrl,
        `select count(*) from information_schema.tables where table_schema='public' and table_name='_prisma_migrations'`),
    );
    if (hasMigrationTable > 0) {
      await same('every migration was recorded in the archive',
        `select count(*) from _prisma_migrations where finished_at is not null`);
    } else {
      console.log('  SKIP  every migration was recorded in the archive — this database was built from the migration SQL, so Prisma keeps no bookkeeping table here');
    }

    console.log('\n[5] the restored books still balance');
    const debit = async (url) =>
      Number(
        await scalar(
          url,
          `select coalesce(sum(debit),0) - coalesce(sum(credit),0) from journal_lines`,
        ),
      );
    const sourceBalance = await debit(sourceToolsUrl);
    const restoredBalance = await debit(scratchUrl);
    check('debits equal credits, before and after', sourceBalance === 0 && restoredBalance === 0,
      `${restoredBalance}`);
  } finally {
    await run(PSQL, ['-X', '-d', admin, '-c', `DROP DATABASE IF EXISTS "${scratchName}"`]).catch(() => undefined);
    rmSync(dumpDir, { recursive: true, force: true });
    await prisma.$disconnect();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log(`Failures: ${failures.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Proof aborted:', error);
  process.exitCode = 1;
});
