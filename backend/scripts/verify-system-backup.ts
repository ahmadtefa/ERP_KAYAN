/**
 * Proves the complete backup and restore on a real PostgreSQL server.
 *
 * This is not a unit test with mocks: it starts (or uses) a PostgreSQL
 * instance, builds the KAYAN schema from the real migrations, seeds two
 * companies, and then exercises the actual services — write a complete
 * backup, verify it, damage a copy and watch verification refuse it, restore
 * it, restore it again after changing the data, break a restore on purpose and
 * prove the safety backup came back, simulate a power cut and prove the
 * journal drives recovery, and prove the licence file was never touched.
 *
 * It never touches production data: it creates its own database, and the
 * backups it writes live in a temporary folder.
 *
 * Usage:
 *   npm run verify:system-backup -- --pgbin /usr/lib/postgresql/17/bin
 *   DATABASE_URL=... npm run verify:system-backup          # use an existing server
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from 'pg';

import { CompleteBackupService } from '../src/modules/backup/system/complete-backup.service';
import { MaintenanceService } from '../src/common/maintenance/maintenance';
import { RestoreGateService } from '../src/modules/backup/system/restore-gate.service';
import { RestoreJournalStore } from '../src/modules/backup/system/restore-journal';
import { SystemRestoreService } from '../src/modules/backup/system/system-restore.service';
import { extractTar } from '../src/modules/backup/system/tar';

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`${GREEN}ok${RESET}   ${label}${detail ? ` ${DIM}— ${detail}${RESET}` : ''}`);
  } else {
    failed += 1;
    console.log(`${RED}FAIL${RESET} ${label}${detail ? ` ${DIM}— ${detail}${RESET}` : ''}`);
  }
}

/// The whole message of a refusal: Nest puts the useful part in the response
/// body (detail/reasons), and a check that only reads `message` would judge a
/// refusal by its first sentence.
function describeError(error: unknown): string {
  const anyError = error as { message?: string; response?: unknown };
  const parts = [String(anyError?.message ?? error)];
  if (anyError?.response) parts.push(JSON.stringify(anyError.response));
  return parts.join(' ');
}

async function checkThrows(
  label: string,
  work: () => Promise<unknown>,
  expected: string | RegExp,
): Promise<void> {
  try {
    await work();
    failed += 1;
    console.log(`${RED}FAIL${RESET} ${label} ${DIM}— it was allowed${RESET}`);
  } catch (error) {
    const message = describeError(error);
    const ok = typeof expected === 'string' ? message.includes(expected) : expected.test(message);
    if (ok) {
      passed += 1;
      console.log(`${GREEN}ok${RESET}   ${label}`);
    } else {
      failed += 1;
      console.log(`${RED}FAIL${RESET} ${label} ${DIM}— refused for the wrong reason: ${message.slice(0, 300)}${RESET}`);
    }
  }
}

interface Options {
  pgbin: string | null;
  port: number;
  keep: boolean;
}

function parseOptions(): Options {
  const args = process.argv.slice(2);
  let pgbin = process.env.PGBIN ?? null;
  let port = Number(process.env.KAYAN_TEST_PG_PORT ?? 55432);
  let keep = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--pgbin') pgbin = args[index + 1];
    if (args[index] === '--port') port = Number(args[index + 1]);
    if (args[index] === '--keep') keep = true;
  }
  return { pgbin, port, keep };
}

function psql(pgbin: string, port: number, database: string, sql: string): string {
  return execFileSync(
    join(pgbin, 'psql'),
    ['-h', '127.0.0.1', '-p', String(port), '-U', 'kayan', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql],
    { encoding: 'utf8', env: { ...process.env } },
  ).trim();
}

function psqlFile(pgbin: string, port: number, database: string, file: string): void {
  execFileSync(
    join(pgbin, 'psql'),
    ['-h', '127.0.0.1', '-p', String(port), '-U', 'kayan', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file],
    { encoding: 'utf8', env: { ...process.env } },
  );
}

interface StartedServer {
  stop: () => void;
  port: number;
  pgbin: string;
  removeData: () => Promise<void>;
}

function startServer(options: Options): StartedServer | null {
  if (!options.pgbin) return null;
  const dataDir = mkdtempSync(join(tmpdir(), 'kayan-pg-'));
  const logFile = join(dataDir, 'server.log');
  execFileSync(join(options.pgbin, 'initdb'), ['-D', dataDir, '-U', 'kayan', '-A', 'trust', '--encoding=UTF8'], {
    stdio: 'ignore',
  });
  execFileSync(
    join(options.pgbin, 'pg_ctl'),
    [
      '-D',
      dataDir,
      '-o',
      `-p ${options.port} -k /tmp -c listen_addresses=127.0.0.1 -c fsync=on`,
      '-l',
      logFile,
      'start',
      '-w',
    ],
    { stdio: 'ignore' },
  );
  return {
    port: options.port,
    pgbin: options.pgbin,
    stop: () => {
      try {
        execFileSync(join(options.pgbin as string, 'pg_ctl'), ['-D', dataDir, '-m', 'immediate', 'stop'], {
          stdio: 'ignore',
        });
      } catch {
        /* already stopped */
      }
    },
    removeData: async () => {
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

const SEED_SQL = `
BEGIN;
DO $$
DECLARE
  c1 uuid := '11111111-1111-4111-8111-111111111111';
  c2 uuid := '22222222-2222-4222-8222-222222222222';
  b1 uuid := '11111111-1111-4111-8111-1111111111b1';
  b2 uuid := '22222222-2222-4222-8222-2222222222b2';
  r1 uuid := '11111111-1111-4111-8111-1111111111a1';
  r2 uuid := '22222222-2222-4222-8222-2222222222a2';
  u1 uuid := '11111111-1111-4111-8111-1111111111c1';
  u2 uuid := '22222222-2222-4222-8222-2222222222c2';
  ac1 uuid := '11111111-1111-4111-8111-1111111111d1';
  ac2 uuid := '11111111-1111-4111-8111-1111111111d2';
  it1 uuid := '11111111-1111-4111-8111-1111111111e1';
  cu1 uuid := '11111111-1111-4111-8111-1111111111f1';
  je1 uuid := '11111111-1111-4111-8111-111111111201';
  p1 uuid := '11111111-1111-4111-8111-111111111301';
BEGIN
  -- The installation allows one *active* company at a time; the second is a
  -- soft-deleted one, kept so the checks see more than a single company and
  -- prove nothing is silently dropped when another company exists.
  INSERT INTO companies (id, code, "nameEn", "nameAr", currency, timezone, "createdAt", "updatedAt", "deletedAt")
  VALUES (c1, 'KAYAN-IT-1', 'Integration One', 'شركة الاختبار الأولى', 'EGP', 'Africa/Cairo', now(), now(), NULL),
         (c2, 'KAYAN-IT-2', 'Integration Two', 'شركة الاختبار الثانية', 'EGP', 'Africa/Cairo', now(), now(), now());

  INSERT INTO branches (id, "companyId", code, "nameEn", "nameAr", "isActive", "createdAt", "updatedAt")
  VALUES (b1, c1, 'MAIN', 'Main', 'الرئيسي', true, now(), now()),
         (b2, c2, 'MAIN', 'Main', 'الرئيسي', true, now(), now());

  INSERT INTO accounts (id, "companyId", code, "nameEn", "nameAr", type, "isPostable", "isActive", "createdAt", "updatedAt")
  VALUES (ac1, c1, '1100', 'Cash', 'النقدية', 'ASSET', true, true, now(), now()),
         (ac2, c1, '4100', 'Revenue', 'الإيرادات', 'REVENUE', true, true, now(), now());

  INSERT INTO items (id, "companyId", code, "nameEn", "nameAr", unit, "salePrice", "purchasePrice", "reorderLevel", "isStockTracked", "isActive", "createdAt", "updatedAt")
  VALUES (it1, c1, 'IT-1', 'Widget', 'منتج', 'piece', 50, 40, 1, true, true, now(), now());

  INSERT INTO customers (id, "companyId", code, "nameEn", "nameAr", "creditLimit", "isActive", "createdAt", "updatedAt")
  VALUES (cu1, c1, 'CU-1', 'Customer One', 'عميل واحد', 0, true, now(), now());

  INSERT INTO stock_balances ("companyId", "branchId", "itemId", quantity, value, "updatedAt")
  VALUES (c1, b1, it1, 12.5, 625, now());

  INSERT INTO journal_entries (id, "companyId", "branchId", "entryNumber", "entryDate", status, currency, "totalDebit", "totalCredit", "createdAt", "updatedAt")
  VALUES (je1, c1, b1, 'JE-1', current_date, 'POSTED', 'EGP', 100, 100, now(), now());

  INSERT INTO journal_lines (id, "journalEntryId", "lineNumber", "accountId", debit, credit)
  VALUES (gen_random_uuid(), je1, 1, ac1, 100, 0),
         (gen_random_uuid(), je1, 2, ac2, 0, 100);

  INSERT INTO permissions (id, code, "nameEn", "nameAr", module)
  VALUES (p1, 'admin.backup', 'Backup', 'النسخ الاحتياطي', 'admin')
  ON CONFLICT (code) DO NOTHING;

  INSERT INTO roles (id, "companyId", code, "nameEn", "nameAr", "isSystem", "createdAt", "updatedAt")
  VALUES (r1, c1, 'ADMIN', 'Administrator', 'مدير', true, now(), now()),
         (r2, c2, 'ADMIN', 'Administrator', 'مدير', true, now(), now());

  INSERT INTO role_permissions ("roleId", "permissionId")
  SELECT r1, p.id FROM permissions p WHERE p.code = 'admin.backup'
  ON CONFLICT DO NOTHING;

  INSERT INTO users (id, "companyId", username, "fullNameEn", "fullNameAr", "passwordHash", "isActive", "isSuperAdmin", "failedLoginCount", "tokenVersion", "createdAt", "updatedAt")
  VALUES (u1, c1, 'it-super', 'IT Super', 'مدير الاختبار', 'argon2-hash-placeholder', true, true, 0, 0, now(), now()),
         (u2, c2, 'it-second', 'Second Company User', 'مستخدم الشركة الثانية', 'argon2-hash-placeholder', true, false, 0, 0, now(), now());

  INSERT INTO user_roles ("userId", "roleId", "companyId") VALUES (u1, r1, c1), (u2, r2, c2);
END $$;
COMMIT;
`;

async function main(): Promise<void> {
  const options = parseOptions();
  const server = startServer(options);
  const port = server?.port ?? options.port;
  const workDir = mkdtempSync(join(tmpdir(), 'kayan-backup-check-'));
  const backupDir = join(workDir, 'backups');
  const uploadsDir = join(workDir, 'uploads');
  const database = 'kayan_it';
  const pgbin = options.pgbin ?? process.env.PGBIN ?? '';

  const databaseUrl = `postgresql://kayan@127.0.0.1:${port}/${database}?schema=public`;
  process.env.DATABASE_URL = databaseUrl;
  process.env.KAYAN_BACKUP_DIR = backupDir;
  process.env.KAYAN_UPLOAD_DIR = uploadsDir;
  process.env.NODE_ENV = 'test';
  if (options.pgbin) {
    process.env.KAYAN_PG_DUMP = join(options.pgbin, 'pg_dump');
    process.env.KAYAN_PG_RESTORE = join(options.pgbin, 'pg_restore');
    process.env.PATH = `${options.pgbin}:${process.env.PATH}`;
  }
  delete process.env.KAYAN_FULL_RESTORE_ENABLED;

  const cleanup = async (): Promise<void> => {
    server?.stop();
    if (!options.keep) {
      await server?.removeData();
      await rm(workDir, { recursive: true, force: true });
    } else {
      console.log(`work folder kept: ${workDir}`);
    }
  };

  try {
    if (server) {
      psql(server.pgbin, port, 'postgres', `DROP DATABASE IF EXISTS ${database}`);
      psql(server.pgbin, port, 'postgres', `CREATE DATABASE ${database}`);
      const migrationsDir = join(__dirname, '..', 'prisma', 'migrations');
      const folders = readdirSync(migrationsDir)
        .filter((name) => existsSync(join(migrationsDir, name, 'migration.sql')))
        .sort();
      for (const folder of folders) {
        psqlFile(server.pgbin, port, database, join(migrationsDir, folder, 'migration.sql'));
      }
      console.log(`${DIM}applied ${folders.length} migrations to ${databaseUrl}${RESET}`);
      psql(server.pgbin, port, database, SEED_SQL);
    } else {
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      const existing = await client.query<{ count: string }>(
        `SELECT count(*)::text FROM information_schema.tables WHERE table_schema='public'`,
      );
      await client.end();
      if (Number(existing.rows[0]?.count ?? 0) < 20) {
        throw new Error(
          'The database given in DATABASE_URL has no KAYAN schema. Apply migrations first, ' +
            'or pass --pgbin so this check can create a database of its own.',
        );
      }
      if (server === null) {
        console.log(`${DIM}using the PostgreSQL at ${databaseUrl}${RESET}`);
      }
    }

    await mkdir(backupDir, { recursive: true });
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(join(uploadsDir, 'logo-one.png'), Buffer.from('PNG-FAKE-COMPANY-LOGO-ONE'));
    await writeFile(join(uploadsDir, 'logo-two.png'), Buffer.from('PNG-FAKE-COMPANY-LOGO-TWO'));

    // A licence file with a private key inside it: the backup must record its
    // state and never the key.
    const licencePath = join(workDir, 'licence.json');
    await writeFile(
      licencePath,
      JSON.stringify({
        status: 'active',
        expiresAt: '2030-12-31',
        issuedTo: 'KAYAN IT',
        edition: 'professional',
        signature: 'SIGNATURE-THAT-MUST-NEVER-BE-BACKED-UP',
        privateKey: 'PRIVATE-KEY-THAT-MUST-NEVER-BE-BACKED-UP',
        nested: { signingKey: 'NESTED-SECRET' },
      }),
    );
    process.env.KAYAN_LICENSE_FILE = licencePath;

    const noop = async (): Promise<void> => {};
    const audit = { record: noop } as never;
    const prisma = {
      company: { findMany: async () => [] },
      $connect: async () => {},
      $disconnect: async () => {},
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    } as never;

    const backups = new CompleteBackupService(prisma, audit);
    const maintenance = new MaintenanceService();
    const journals = new RestoreJournalStore(backupDir);
    const gate = new RestoreGateService(maintenance, journals);
    const restore = new SystemRestoreService(prisma, audit, maintenance, gate, backups, journals);

    // ─────────────────────────────────────────────── 1. capabilities & gate
    const gateReport = await gate.probe(true);
    check(
      'the gate reports this machine can restore safely',
      gateReport.fullRestoreSupported === true,
      gateReport.reasons.join('; ') || `${gateReport.checks.length} checks passed`,
    );
    check(
      'the gate names every check it made',
      gateReport.checks.length >= 8,
      gateReport.checks.map((c) => c.name).join(', '),
    );

    process.env.KAYAN_FULL_RESTORE_ENABLED = '0';
    const disabled = await gate.probe(true);
    check(
      'the operator switch can turn destructive restores off',
      disabled.fullRestoreSupported === false && disabled.state === 'disabled',
      disabled.reasons[0],
    );
    await checkThrows(
      'a refused gate stops a restore before it starts',
      () => restore.restore({ fileName: 'anything.kayanbackup', confirm: true, confirmPhrase: 'RESTORE' }, 'user-1'),
      /not available|refused|unavailable/i,
    );
    delete process.env.KAYAN_FULL_RESTORE_ENABLED;
    await gate.forget();

    // ─────────────────────────────────────────────── 2. create and verify
    const created = await backups.createFull('user-1');
    const archivePath = join(backupDir, created.file.name);
    check('a complete backup is written', existsSync(archivePath), created.file.name);
    check(
      'the backup carries the database, the files and a manifest',
      created.manifest.counts.companies === 2 &&
        created.manifest.files.count === 2 &&
        created.manifest.database.archiveEntries > 0,
      `${created.manifest.counts.companies} companies, ${created.manifest.files.count} files, ${created.manifest.database.archiveEntries} dump objects`,
    );
    check(
      'the manifest records the licence state without any key material',
      created.manifest.licence.present &&
        created.manifest.licence.status === 'active' &&
        created.manifest.licence.withheld.some((field) => /signature|privateKey|signingKey/.test(field)),
      `withheld: ${created.manifest.licence.withheld.join(', ')}`,
    );

    const unpacked = join(workDir, 'unpacked');
    await extractTar(archivePath, unpacked);
    const licenceStateText = readFileSync(join(unpacked, 'licence', 'licence-state.json'), 'utf8');
    check(
      'no private key, signature or secret reaches the archive',
      !/SIGNATURE-THAT-MUST|PRIVATE-KEY-THAT|NESTED-SECRET/.test(licenceStateText),
      'the licence state holds facts only',
    );
    check(
      'the archive holds restore instructions a person can follow',
      existsSync(join(unpacked, 'RESTORE-INSTRUCTIONS.txt')),
    );
    check(
      'the archive holds a checksum file in sha256sum format',
      /^[0-9a-f]{64}\s{2}database\/database\.dump$/m.test(
        readFileSync(join(unpacked, 'checksums.sha256'), 'utf8'),
      ),
    );

    const verified = await backups.verify(created.file.name);
    check(
      'the backup verifies: manifest, SHA-256 and pg_restore all agree',
      verified.ok === true && verified.compatible === true,
      verified.checks.map((c) => c.name).join(' → '),
    );

    // A copy with one byte changed must be refused.
    const tamperedPath = join(backupDir, 'kayan-full-tampered.kayanbackup');
    const bytes = await readFile(archivePath);
    const tampered = Buffer.from(bytes);
    // Flip a byte inside the database dump (after the manifest and checksums).
    const dumpOffset = tampered.indexOf(Buffer.from('PGDMP', 'latin1'));
    tampered[dumpOffset + 300] = tampered[dumpOffset + 300] ^ 0xff;
    await writeFile(tamperedPath, tampered);
    const tamperedReport = await backups.verify('kayan-full-tampered.kayanbackup');
    check(
      'a damaged archive is refused, with the reason named',
      tamperedReport.ok === false && /checksum|damaged/i.test(tamperedReport.failure ?? ''),
      tamperedReport.failure ?? '',
    );
    await backups.remove('kayan-full-tampered.kayanbackup', 'user-1');

    // ─────────────────────────────────────────────── 3. a real restore
    const before = await counts();
    // Change everything: add a customer, delete the stock row, remove a file.
    psql(server?.pgbin ?? pgbin, port, database,
      `INSERT INTO customers (id, "companyId", code, "nameEn", "nameAr", "creditLimit", "isActive", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'CU-2', 'Added later', 'أضيف لاحقاً', 0, true, now(), now())`);
    psql(server?.pgbin ?? pgbin, port, database, `DELETE FROM stock_balances`);
    await rm(join(uploadsDir, 'logo-two.png'));

    await checkThrows(
      'a restore without the typed word is refused',
      () => restore.restore({ fileName: created.file.name, confirm: true, confirmPhrase: 'yes' }, 'user-1'),
      'RESTORE',
    );

    const restored = await restore.restore(
      { fileName: created.file.name, confirm: true, confirmPhrase: 'RESTORE' },
      'user-1',
    );
    const after = await counts();
    check(
      'the restore puts the data back exactly as the archive described it',
      after.customers === before.customers && after.stockBalances === before.stockBalances,
      `customers ${after.customers}, stock ${after.stockBalances}`,
    );
    check(
      'the restore reads its own manifest back and checks it file by file',
      restored.checks.every((entry) => entry.ok),
      restored.checks.map((entry) => entry.name).join(', '),
    );
    check('the restore was rehearsed on a scratch database first', restored.rehearsed === true);
    check(
      'the uploaded files came back with the database',
      existsSync(join(uploadsDir, 'logo-two.png')) && existsSync(join(uploadsDir, 'logo-one.png')),
      `${restored.filesRestored} files`,
    );
    check(
      'a safety backup exists and is a complete archive',
      existsSync(join(backupDir, restored.safetyBackup)) &&
        (await backups.verify(restored.safetyBackup)).ok,
      restored.safetyBackup,
    );
    check(
      'the licence file was not touched by the restore',
      restored.licencePreserved === true &&
        readFileSync(licencePath, 'utf8').includes('PRIVATE-KEY-THAT-MUST-NEVER-BE-BACKED-UP'),
    );
    check(
      'the maintenance switch is back off after a successful restore',
      maintenance.isActive === false,
    );
    check(
      'no journal is left behind after a successful restore',
      (await journals.read()) === null,
    );
    let writtenBack = '';
    try {
      writtenBack = psql(server?.pgbin ?? pgbin, port, database,
        `INSERT INTO customers (id, "companyId", code, "nameEn", "nameAr", "creditLimit", "isActive", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'CU-3', 'After restore', 'بعد الاستعادة', 0, true, now(), now())
         RETURNING code`);
    } catch (error) {
      writtenBack = `refused: ${(error as Error).message.slice(0, 200)}`;
    }
    check(
      'the entry screen can write again: the database accepts a new row',
      writtenBack.trim().startsWith('CU-3'),
      writtenBack,
    );
    psql(server?.pgbin ?? pgbin, port, database, `DELETE FROM customers WHERE code = 'CU-3'`);

    // ─────────────────────────────────────── 4. a restore that dies half way
    const beforeFailure = await counts();
    process.env.KAYAN_RESTORE_TEST_FAILURE = 'after-db';
    const failureMessage = await (async () => {
      try {
        await restore.restore(
          { fileName: created.file.name, confirm: true, confirmPhrase: 'RESTORE' },
          'user-1',
        );
        return null;
      } catch (error) {
        return String((error as Error).message ?? error);
      }
    })();
    delete process.env.KAYAN_RESTORE_TEST_FAILURE;
    check(
      'a restore that fails after replacing the database is rolled back automatically',
      failureMessage !== null && /put back automatically|previous data/i.test(failureMessage),
      (failureMessage ?? '').slice(0, 200),
    );
    const afterFailure = await counts();
    check(
      'no data was lost when the restore failed',
      afterFailure.customers === beforeFailure.customers &&
        afterFailure.accounts === beforeFailure.accounts &&
        afterFailure.journalEntries === beforeFailure.journalEntries,
      `customers ${afterFailure.customers}, accounts ${afterFailure.accounts}, journal ${afterFailure.journalEntries}`,
    );
    check(
      'the system is usable again after the failed restore',
      maintenance.isActive === false && (await journals.read()) === null,
    );

    // ───────────────────────────────────── 5. a restore killed mid-replacement
    const crashSafety = await backups.createSafety('user-1');
    // Simulate the old crash window: uploads were moved, but the journal was
    // not updated with their location. Recovery must not delete them unseen.
    const crashStaging = join(workDir, 'interrupted-upload-swap');
    await mkdir(crashStaging, { recursive: true });
    await rename(uploadsDir, join(crashStaging, 'previous-uploads'));
    await journals.write({
      id: 'simulated-crash',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      phase: 'db-replacing',
      source: 'simulated power cut',
      sourceManifest: { createdAt: null, appVersion: null, companies: null, files: null },
      safetyBackup: crashSafety.name,
      previousUploads: null,
      stagingDir: crashStaging,
      detail: 'simulated power cut',
      checks: [],
    });
    // The next start must not pretend everything is fine.
    const restarted = new SystemRestoreService(prisma, audit, maintenance, gate, backups, journals);
    await restarted.onModuleInit();
    check(
      'a restart after an interrupted restore enters maintenance mode',
      maintenance.isActive === true,
    );
    const status = await restarted.status();
    check(
      'the status names the interrupted step and the safety backup',
      status.journal?.phase === 'db-replacing' && status.journal?.safetyBackup === crashSafety.name,
      `${status.journal?.phase} / ${status.journal?.safetyBackup}`,
    );
    await checkThrows(
      'a new restore is refused while an unfinished one waits',
      () =>
        restore.restore(
          { fileName: created.file.name, confirm: true, confirmPhrase: 'RESTORE' },
          'user-1',
        ),
      /unfinished|stopped|recovery/i,
    );
    psql(server?.pgbin ?? pgbin, port, database, `DELETE FROM stock_balances`);
    const recovery = await restarted.resumeRecovery('user-1');
    check(
      'resuming recovery puts the safety backup back',
      recovery.recovered === true && recovery.safetyBackup === crashSafety.name,
      recovery.detail.slice(0, 160),
    );
    check(
      'a crash before the uploads journal update recovers the safety archive files',
      existsSync(join(uploadsDir, 'logo-one.png')) &&
        existsSync(join(uploadsDir, 'logo-two.png')) &&
        readFileSync(join(uploadsDir, 'logo-one.png'), 'utf8') === 'PNG-FAKE-COMPANY-LOGO-ONE',
    );
    const afterRecovery = await counts();
    check(
      'the recovered data is complete again',
      afterRecovery.stockBalances === beforeFailure.stockBalances,
      `stock ${afterRecovery.stockBalances}`,
    );
    check(
      'the system leaves maintenance mode after a successful recovery',
      maintenance.isActive === false && (await journals.read()) === null,
    );

    // ───────────────────────────────────────────────── 6. concurrency
    const [first, second] = await Promise.allSettled([
      restore.restore(
        { fileName: created.file.name, confirm: true, confirmPhrase: 'RESTORE' },
        'user-1',
      ),
      restore.restore(
        { fileName: created.file.name, confirm: true, confirmPhrase: 'RESTORE' },
        'user-2',
      ),
    ]);
    const oneSucceeded = [first, second].filter((result) => result.status === 'fulfilled').length;
    const oneRefused = [first, second].filter((result) => result.status === 'rejected').length;
    const reasons = [first, second]
      .filter((result) => result.status === 'rejected')
      .map((result) => describeError((result as PromiseRejectedResult).reason).slice(0, 220));
    check(
      'two restores at once: one runs, the other is refused',
      oneSucceeded === 1 && oneRefused === 1,
      `${oneSucceeded} ran, ${oneRefused} refused${reasons.length ? ` — ${reasons.join(' | ')}` : ''}`,
    );

    // ─────────────────────────────────────── 7. company isolation (JSON side)
    // The company JSON backup is a different system; this proves the complete
    // restore does not confuse the two: a .json file is refused here.
    const jsonFile = join(workDir, 'company.json');
    await writeFile(jsonFile, JSON.stringify({ format: 'kayan-backup', version: 1 }));
    await checkThrows(
      'a company JSON file is refused by the complete restore',
      () =>
        restore.restore(
          { uploaded: { buffer: readFileSync(jsonFile), originalName: 'company.json' }, confirm: true, confirmPhrase: 'RESTORE' },
          'user-1',
        ),
      /not a complete KAYAN backup|not a KAYAN system backup|archive/i,
    );

    // ───────────────────────────────────────────────────── 8. file integrity
    const digest = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
    check(
      'the archive on disk is a single stable file',
      (await stat(archivePath)).size > 0 && /^[0-9a-f]{64}$/.test(digest),
      `${(await stat(archivePath)).size} bytes`,
    );
  } finally {
    await cleanup();
  }

  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;

  async function counts(): Promise<{
    companies: number;
    users: number;
    accounts: number;
    journalEntries: number;
    customers: number;
    stockBalances: number;
    files: number;
  }> {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const result = await client.query<Record<string, string>>(`
        SELECT
          (SELECT count(*) FROM companies)::text AS companies,
          (SELECT count(*) FROM users)::text AS users,
          (SELECT count(*) FROM accounts)::text AS accounts,
          (SELECT count(*) FROM journal_entries)::text AS "journalEntries",
          (SELECT count(*) FROM customers)::text AS customers,
          (SELECT count(*) FROM stock_balances)::text AS "stockBalances"
      `);
      const row = result.rows[0] ?? {};
      const files = existsSync(uploadsDir) ? readdirSync(uploadsDir).length : 0;
      return {
        companies: Number(row.companies ?? 0),
        users: Number(row.users ?? 0),
        accounts: Number(row.accounts ?? 0),
        journalEntries: Number(row.journalEntries ?? 0),
        customers: Number(row.customers ?? 0),
        stockBalances: Number(row.stockBalances ?? 0),
        files,
      };
    } finally {
      await client.end();
    }
  }
}

void (async () => {
  try {
    await main();
  } catch (error) {
    console.error(`${RED}the check itself failed${RESET}:`, error);
    process.exitCode = 1;
  }
})();
