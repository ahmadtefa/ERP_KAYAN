/**
 * REAL backup -> restore cycle (classification E, recovery) on an isolated
 * PostgreSQL database.
 *
 * Source: the kayan_test database (real PG 18, one company with the
 * concurrency / year-end / reconciliation test data). A company backup is
 * produced with the PROJECT'S OWN BackupService (the JSON "kayan-backup"
 * format), written into the project's real backend/backups folder, verified
 * on disk, then restored into a brand-new, separately migrated database
 * kayan_restore_test. The two databases are then compared table-by-table,
 * relation integrity is re-proved on the restored side, and real services
 * read back from it. A separate step boots the whole Nest backend against
 * the restored database and calls the public health route.
 *
 * The pg_dump/pg_restore "full backup" path cannot run here: the embedded
 * PostgreSQL distribution ships the server only, without client binaries.
 * That is recorded as BLOCKED for the full-backup path, not worked around.
 *
 * Usage: DATABASE_URL=... node scripts/pg-backup-restore-cycle.mjs
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import pg from 'pg';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { AuditService } from '../dist/src/common/audit/audit.service.js';
import { AuditPurgeService } from '../dist/src/common/audit/audit-purge.service.js';
import { LicensingService } from '../dist/src/modules/licensing/licensing.service.js';
import { BackupService } from '../dist/src/modules/backup/backup.service.js';
import { BankReconciliationService } from '../dist/src/modules/cash/bank-reconciliation.service.js';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(here, '..');

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error('DATABASE_URL is required');
const TARGET_DB = 'kayan_restore_test';

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
const num = (v) => Number(v);

function makeClient(connectionString, applicationName) {
  const u = new URL(connectionString);
  u.searchParams.set('application_name', applicationName);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: u.toString() }) });
}
function replaceDatabase(url, db) {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

async function main() {
  const source = makeClient(DB_URL, 'guard-bk-src');
  const company = await source.company.findFirst({ where: { isActive: true } });
  if (!company) throw new Error('No active company in source database');
  const companyId = company.id;
  console.log(`Source company ${company.code} (${companyId})`);

  // ------------------------------------------------------------ 1. backup
  console.log('\n[1] backup through the production BackupService');
  const audit = new AuditService(source);
  const purge = new AuditPurgeService();
  const configStub = { get: () => undefined };
  const licensing = new LicensingService(source, configStub, {});
  const backupService = new BackupService(source, audit, purge, licensing);
  const file = await backupService.create(companyId);
  check('backup header identifies format/version and this company',
    // The number itself is the program's to decide; what this scenario needs
    // is that the header is a readable format version this program wrote.
    file.format === 'kayan-backup' && Number.isInteger(file.version) && file.version >= 1 &&
    file.companyId === companyId && typeof file.companyCode === 'string',
    `${file.format} v${file.version} ${file.companyCode}`);

  const payload = JSON.stringify(file);
  const sha = createHash('sha256').update(payload).digest('hex');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = join(backendRoot, 'backups');
  await mkdir(backupDir, { recursive: true });
  const backupPath = join(backupDir, `kayan-guard-cycle-${stamp}.json`);
  await writeFile(backupPath, payload, 'utf8');
  console.log(`    written ${backupPath} (${(payload.length / 1024).toFixed(1)} KiB, sha256 ${sha.slice(0, 16)}…)`);

  // ----------------------------------------------------- 2. verify on disk
  console.log('\n[2] verify the persisted backup content independently');
  const reread = JSON.parse(await readFile(backupPath, 'utf8'));
  const rereadSha = createHash('sha256').update(JSON.stringify(reread)).digest('hex');
  check('file on disk parses and byte-hashes identically', rereadSha === sha, sha.slice(0, 24));
  const tableKeys = Object.keys(reread.tables);
  check('backup carries the full TABLES coverage (>= 45 tables)', tableKeys.length >= 45,
    `${tableKeys.length} tables`);
  check('counts manifest matches the actual row arrays',
    Object.entries(reread.counts).every(([k, n]) => reread.tables[k]?.length === n));
  check('audit trail and ledger are inside the backup',
    Array.isArray(reread.tables.auditLog) && Array.isArray(reread.tables.journalEntry) &&
    Array.isArray(reread.tables.journalLine));
  const sourceJeSum = await source.$queryRaw`
    SELECT COALESCE(SUM("totalDebit"),0) d, COALESCE(SUM("totalCredit"),0) c
      FROM journal_entries WHERE "companyId" = ${companyId}::uuid`;
  const backupJeDebit = reread.tables.journalEntry.reduce((s, r) => s + num(r.totalDebit), 0);
  check('backup journal totals equal the live ledger',
    backupJeDebit === num(sourceJeSum[0].d) &&
    backupJeDebit === num(sourceJeSum[0].c),
    `debit=${backupJeDebit} credit=${num(sourceJeSum[0].c)}`);

  // --------------------------------------------- 3. fresh isolated database
  console.log('\n[3] create a separate target database and migrate it');
  const adminUrl = replaceDatabase(DB_URL, 'postgres');
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TARGET_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TARGET_DB}`);
  await admin.end();
  const targetUrl = replaceDatabase(DB_URL, TARGET_DB);
  const { stdout: migrateOut, stderr: migrateErr } = await execFileAsync(
    process.execPath,
    [join(backendRoot, 'scripts', 'pg-apply-migrations.mjs')],
    { cwd: backendRoot, env: { ...process.env, DATABASE_URL: targetUrl } },
  );
  const migratedTables = Number((migrateOut + migrateErr).match(/(\d+) public tables/)?.[1] ?? 0);
  check('real project migrations applied to the empty target (64 tables)', migratedTables === 64,
    `tables=${migratedTables}`);

  const target = makeClient(targetUrl, 'guard-bk-tgt');
  // The target needs the company identity row; restore refuses foreign companies.
  await target.company.create({
    data: {
      id: company.id,
      code: company.code,
      nameEn: company.nameEn,
      nameAr: company.nameAr,
      currency: company.currency,
      isActive: true,
    },
  });

  // ------------------------------------------------------------- 4. restore
  console.log('\n[4] restore the backup into the separate database');
  const targetAudit = new AuditService(target);
  const targetBackup = new BackupService(
    target,
    targetAudit,
    new AuditPurgeService(),
    new LicensingService(target, configStub, {}),
  );
  const summary = await targetBackup.restore(reread, company.id, {
    replace: true,
    actorUserId: null,
  });
  check('restore summary reports the same company and a non-zero total',
    summary.companyId === company.id && summary.total > 0, `total=${summary.total}`);

  // --------------------------------------------- 5. table-by-table comparison
  console.log('\n[5] compare every public table between source and restored databases');
  const tableNames = (await target.$queryRaw`
    SELECT table_name::text AS table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE'
     ORDER BY table_name`).map((r) => r.table_name);
  let mismatches = [];
  let compared = 0;
  for (const t of tableNames) {
    if (t === '_prisma_migrations') continue; // never created on the pg-apply path
    const [s, d] = await Promise.all([
      source.$queryRawUnsafe(`SELECT count(*)::int n FROM "${t}"`),
      target.$queryRawUnsafe(`SELECT count(*)::int n FROM "${t}"`),
    ]);
    compared += 1;
    // The restore is self-auditing by design: it appends an AUDIT_PURGED row
    // and a RESTORE/RESTORE_REPLACE row. Every other table must match exactly.
    if (t === 'audit_logs') continue;
    if (num(s[0].n) !== num(d[0].n)) mismatches.push(`${t}: src=${s[0].n} tgt=${d[0].n}`);
  }
  check(`all ${compared - 1} business tables hold identical row counts`, mismatches.length === 0,
    mismatches.length ? mismatches.slice(0, 5).join('; ') : 'identical');
  const [srcAudit, tgtAudit, extraRows] = await Promise.all([
    source.auditLog.count(),
    target.auditLog.count(),
    target.auditLog.findMany({
      where: { action: { in: ['RESTORE', 'RESTORE_REPLACE', 'AUDIT_PURGED'] } },
      select: { action: true },
    }),
  ]);
  const actions = extraRows.map((r) => r.action).sort();
  check('audit_logs differ only by the restore self-audit rows (RESTORE + AUDIT_PURGED)',
    tgtAudit === srcAudit + 2 &&
    actions.includes('RESTORE') && actions.includes('AUDIT_PURGED'),
    `src=${srcAudit} tgt=${tgtAudit} extra=[${actions.join(',')}]`);

  // --------------------------------------------- 6. relation integrity in target
  console.log('\n[6] foreign-key / business integrity re-proved on restored data');
  const orphanLines = await target.$queryRaw`
    SELECT count(*)::int n FROM journal_lines l
     LEFT JOIN journal_entries e ON e.id = l."journalEntryId" WHERE e.id IS NULL`;
  check('no orphan journal lines', num(orphanLines[0].n) === 0, `orphans=${orphanLines[0].n}`);
  const orphanDocLines = await target.$queryRaw`
    SELECT count(*)::int n FROM stock_document_lines l
     LEFT JOIN stock_documents d ON d.id = l."documentId" WHERE d.id IS NULL`;
  check('no orphan stock document lines', num(orphanDocLines[0].n) === 0, `orphans=${orphanDocLines[0].n}`);
  const brokenVoucherLinks = await target.$queryRaw`
    SELECT count(*)::int n FROM cash_vouchers v
     JOIN bank_reconciliations r ON r.id = v."reconciliationId"
     WHERE v."cashAccountId" <> r."cashAccountId"`;
  check('every voucher-reconciliation link points at the same cash account',
    num(brokenVoucherLinks[0].n) === 0);
  const jeBalance = await target.$queryRaw`
    SELECT count(*)::int n FROM journal_entries
     WHERE "totalDebit" <> "totalCredit"`;
  check('every restored journal entry still balances', num(jeBalance[0].n) === 0,
    `unbalanced=${jeBalance[0].n}`);
  const stockQty = await Promise.all([
    source.$queryRaw`SELECT COALESCE(SUM(quantity),0)::text q FROM stock_balances`,
    target.$queryRaw`SELECT COALESCE(SUM(quantity),0)::text q FROM stock_balances`,
  ]);
  check('restored stock balance quantities equal the source',
    stockQty[0][0].q === stockQty[1][0].q, `src=${stockQty[0][0].q} tgt=${stockQty[1][0].q}`);
  const recDiff = await Promise.all([
    source.$queryRaw`SELECT COALESCE(SUM(difference),0)::text d, count(*)::int n FROM bank_reconciliations`,
    target.$queryRaw`SELECT COALESCE(SUM(difference),0)::text d, count(*)::int n FROM bank_reconciliations`,
  ]);
  check('restored reconciliations keep the same count and difference totals',
    recDiff[0][0].d === recDiff[1][0].d && recDiff[0][0].n === recDiff[1][0].n,
    `src=${recDiff[0][0].n}/${recDiff[0][0].d} tgt=${recDiff[1][0].n}/${recDiff[1][0].d}`);
  const closedPeriods = await target.fiscalPeriod.count({ where: { status: 'CLOSED' } });
  check('closed fiscal periods kept their CLOSED state through restore', closedPeriods > 0,
    `closed=${closedPeriods}`);
  // The append-only audit trigger must exist in the target schema too.
  const trigger = await target.$queryRaw`
    SELECT tgname::text AS tgname FROM pg_trigger
     WHERE tgrelid = 'audit_logs'::regclass AND NOT tgisinternal LIMIT 1`;
  check('audit append-only trigger present in restored database', trigger.length > 0,
    trigger[0]?.tgname ?? 'missing');

  // --------------------------------------------- 7. functional reads on target
  console.log('\n[7] real services read back from the restored database');
  const br = new BankReconciliationService(target, new AuditService(target));
  const list = await br.findAll(companyId);
  const sourceList = await new BankReconciliationService(source, new AuditService(source))
    .findAll(companyId);
  check('BankReconciliationService reads restored rows, same total as source',
    list.total === sourceList.total && list.items.length === list.total,
    `restored=${list.total} source=${sourceList.total}`);
  const targetPeriod = await target.fiscalPeriod.findFirst({ where: { companyId, status: 'CLOSED' } });
  if (targetPeriod) {
    const row = await target.journalEntry.findFirst({
      where: { companyId, sourceType: 'YEAR_END_CLOSE', sourceId: targetPeriod.id },
    });
    check('restored year-end closing entry is traceable to its period', row !== null, row?.entryNumber);
  }

  await source.$disconnect();
  await target.$disconnect();

  console.log(`\nBACKUP/RESTORE CYCLE: ${pass} PASS / ${fail} FAIL`);
  console.log(`Target database left intact for the backend boot step: ${targetUrl}`);
  console.log(`BACKUP_PATH=${backupPath}`);
  console.log(`TARGET_URL=${targetUrl}`);
  if (fail > 0) {
    console.log('Failed checks:', failures.join('; '));
    process.exit(1);
  }
  console.log('BACKUP/RESTORE CYCLE PASSED');
}

main().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exit(2);
});
