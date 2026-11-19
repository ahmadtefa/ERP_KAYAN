import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Client } from 'pg';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { AuditService } from '../../../common/audit/audit.service';
import { MaintenanceService } from '../../../common/maintenance/maintenance';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { reconcileRestoredAccess } from '../restore-access';
import { CompleteBackupService } from './complete-backup.service';
import {
  DESTRUCTIVE_PHASES,
  RestoreJournalStore,
  describeJournal,
  isUnfinished,
  type RestoreJournal,
} from './restore-journal';
import { RestoreGateService } from './restore-gate.service';
import { ARCHIVE_PATHS, type SystemBackupManifest } from './manifest';
import {
  MAX_UPLOAD_BYTES,
  backupDirectory,
  cleanDatabaseUrl,
  createScratchDatabase,
  databaseNameFrom,
  dropDatabaseIfExists,
  ensureDirectory,
  executeSql,
  findLicenceSnapshot,
  hasCustomMagic,
  listUserFiles,
  pgRestoreInto,
  removeIfExists,
  uploadsDirectory,
  withPgClient,
} from './pg-support';
import { extractTar } from './tar';

/**
 * Restoring a complete backup — carefully, and in an order that always leaves
 * a way back.
 *
 * The rule this file is built around: at every instant, either the old data or
 * the new data is intact, and the machine knows which. That is why nothing
 * destructive happens before a safety backup exists, why the archive is
 * rehearsed on a scratch database first, why every step is written to a
 * journal before it is taken, and why a failure half way automatically puts
 * the safety copy back instead of asking the person to try again.
 *
 *   1. the gate must say this machine can do it at all
 *   2. `RESTORE` must be typed — a restore is never one click
 *   3. the archive is verified against its own manifest and SHA-256
 *   4. it is restored into a scratch database, which catches a damaged file
 *      while the real database is still untouched
 *   5. a complete safety backup is written; if that fails, nothing happens
 *   6. writes are blocked and the journal says "db-replacing"
 *   7. the schema is replaced under the live database
 *   8. the data is checked against the manifest's own counts
 *   9. the uploads folder is swapped, keeping the old one reachable
 *  10. access is repaired (role grants, a super administrator), the licence is
 *      proved untouched, and the journal is closed
 *
 * A failure at any point after step 6 rolls the safety backup back in place.
 * A power cut leaves the journal, and the next start refuses to pretend the
 * installation is healthy: it stays in maintenance mode and offers recovery.
 */

/// The advisory lock that makes "one restore at a time" true across processes,
/// not just inside this one.
const ADVISORY_LOCK_KEY = 918_273_645;

export interface RestoreInput {
  uploaded?: { buffer: Buffer; originalName: string };
  fileName?: string;
  confirm: boolean;
  /// The word the person typed. Required for a complete restore.
  confirmPhrase?: string;
}

export interface RestoreCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface RestoreResult {
  restored: true;
  source: string;
  safetyBackup: string;
  rehearsed: boolean;
  filesRestored: number;
  licencePreserved: boolean;
  checks: RestoreCheck[];
  durationMs: number;
  manifest: {
    createdAt: string;
    appVersion: string;
    companies: number;
    users: number;
    files: number;
  };
}

@Injectable()
export class SystemRestoreService implements OnModuleInit {
  private readonly logger = new Logger(SystemRestoreService.name);
  /// The in-process half of "one restore at a time". The advisory lock is the
  /// other half, for a second process.
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly maintenance: MaintenanceService,
    private readonly gate: RestoreGateService,
    private readonly backups: CompleteBackupService,
    private readonly journals: RestoreJournalStore,
  ) {}

  /**
   * The startup check. If the journal says a restore was interrupted, the
   * program must not behave as if everything is fine: it enters maintenance
   * mode and says what happened and what to do.
   */
  async onModuleInit(): Promise<void> {
    try {
      const journal = await this.journals.read();
      if (!journal || !isUnfinished(journal)) return;
      if (journal.phase === 'started' || journal.phase === 'validated' || journal.phase === 'rehearsed' || journal.phase === 'safety-taken') {
        // Nothing destructive happened; the journal is a leftover.
        this.logger.warn(
          `Discarding a restore journal that stopped before anything was replaced (phase "${journal.phase}").`,
        );
        await this.journals.clear();
        return;
      }
      this.logger.error(
        `An interrupted restore was found (phase "${journal.phase}"). The system stays in maintenance mode until it is recovered.`,
      );
      this.maintenance.begin(
        'تم إيقاف النظام لأن عملية استعادة سابقة لم تكتمل. لم تُغيَّر أي بيانات إضافية. ' +
          'افتح شاشة النسخ الاحتياطي ونفّذ «استكمال التعافي» للعودة إلى نسخة الأمان. / ' +
          'The system is stopped because an earlier restore did not finish. No further ' +
          'changes are being accepted. Open the backup screen and run "resume recovery" ' +
          'to return to the safety backup.',
      );
    } catch (error) {
      this.logger.error(`Could not read the restore journal: ${(error as Error).message}`);
    }
  }

  /// What the restore screen polls while it waits.
  async status() {
    const journal = await this.journals.read().catch(() => null);
    return {
      ...this.maintenance.status,
      running: this.running,
      journal: describeJournal(journal),
      recoveryAvailable: Boolean(journal && DESTRUCTIVE_PHASES.includes(journal.phase)),
      recoveryAction: journal
        ? 'POST /backup/complete/recovery/resume restores the safety backup taken before the interrupted restore.'
        : null,
    };
  }

  /// ───────────────────────────────────────────────────────────── restoring

  async restore(input: RestoreInput, userId: string): Promise<RestoreResult> {
    const started = Date.now();
    // 1. Can this machine do it at all?
    const gate = await this.gate.assertAllowed();

    // 2. The typed confirmation.
    if (!input.confirm) {
      throw new BadRequestException(
        'A complete restore replaces the whole database. Send confirm=true once you have read the warning.',
      );
    }
    if ((input.confirmPhrase ?? '').trim().toUpperCase() !== 'RESTORE') {
      throw new BadRequestException(
        'اكتب كلمة RESTORE لتأكيد الاستعادة. / Type RESTORE to confirm that you want to replace everything.',
      );
    }

    if (this.running || this.maintenance.isActive) {
      throw new ConflictException(
        'A restore is already running. Wait for it to finish before starting another one.',
      );
    }

    const existing = await this.journals.read();
    if (existing && isUnfinished(existing)) {
      throw new ServiceUnavailableException(
        `An earlier restore stopped at "${existing.phase}" and has not been resolved. ` +
          'Run "resume recovery" first so the safety backup is put back before anything else ' +
          'is attempted. Nothing was changed.',
      );
    }

    const dir = await ensureDirectory(backupDirectory());
    let sourcePath: string;
    let label: string;
    let uploadedTemporary: string | null = null;

    if (input.uploaded?.buffer?.length) {
      if (input.uploaded.buffer.length > MAX_UPLOAD_BYTES) {
        throw new BadRequestException('The backup file is larger than 2 GB.');
      }
      label = input.uploaded.originalName || 'uploaded backup';
      uploadedTemporary = join(dir, `.restore-upload-${Date.now()}-${process.pid}.kayanbackup`);
      await writeFile(uploadedTemporary, input.uploaded.buffer);
      sourcePath = uploadedTemporary;
    } else if (input.fileName) {
      label = input.fileName;
      sourcePath = this.backups.pathOf(input.fileName);
      if (!existsSync(sourcePath)) {
        throw new BadRequestException(`There is no backup named "${input.fileName}" on this server.`);
      }
    } else {
      throw new BadRequestException(
        'Choose a backup to restore: upload one or name one already on this server.',
      );
    }

    if (input.uploaded?.buffer?.length && input.uploaded.buffer.subarray(0, 5).toString('latin1') === 'PGDMP') {
      throw new BadRequestException(
        'هذا أرشيف قاعدة بيانات (.dump) وليس نسخة نظام كاملة. استخدم قسم أرشيف قاعدة البيانات. / ' +
          'This is a database-only .dump archive, not a complete system backup. Use the ' +
          'database-archive restore instead.',
      );
    }

    // One restore at a time, across processes as well as inside this one.
    const lock = await this.holdAdvisoryLock();
    this.running = true;
    try {
      // 3. Verify the archive before anything is believed about it.
      const report = await this.backups.verifyPath(sourcePath, label, Boolean(uploadedTemporary));
      if (!report.ok || !report.manifest) {
        throw new BadRequestException(
          report.failure ?? 'The archive did not pass verification; nothing was changed.',
        );
      }
      const manifest = await this.backups.readManifest(sourcePath);

      const preLicence = await findLicenceSnapshot();
      const databaseName = databaseNameFrom();
      const stagingId = `${Date.now()}-${process.pid}`;
      const stagingDir = this.journals.stagingFolder(stagingId);
      await mkdir(stagingDir, { recursive: true });

      let journal: RestoreJournal = await this.journals.write({
        id: stagingId,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        phase: 'started',
        source: label,
        sourceManifest: {
          createdAt: manifest.createdAt,
          appVersion: manifest.appVersion,
          companies: manifest.counts.companies,
          files: manifest.files.count,
        },
        safetyBackup: null,
        previousUploads: null,
        stagingDir,
        detail: null,
        checks: [],
      });

      // 4. Unpack, hashing every byte against the manifest as it lands.
      const extracted = await extractTar(sourcePath, stagingDir, {
        expected: this.backups.expectedFrom(manifest),
      });
      const dumpPath = join(stagingDir, ARCHIVE_PATHS.databaseDump);
      if (!(await hasCustomMagic(dumpPath))) {
        throw new BadRequestException(
          'The database dump inside this archive is not a PostgreSQL archive. Nothing was changed.',
        );
      }
      journal = await this.journals.advance(journal, 'validated', {
        checks: [
          {
            name: 'archive',
            ok: true,
            detail: `${extracted.length} files read and matched to the manifest`,
          },
        ],
      });

      // 5. Rehearse on a scratch database. This is where a truncated or
      //    foreign archive is caught while the real database is untouched.
      const scratchName = `kayan_restore_check_${Date.now()}`;
      let rehearsed = false;
      try {
        await createScratchDatabase(scratchName);
      } catch (error) {
        throw new ServiceUnavailableException(
          'A restore cannot be rehearsed on this database server because it cannot create a ' +
            `scratch database (${(error as Error).message}). The safety gate above should have ` +
            'caught this; nothing was changed.',
        );
      }
      try {
        await pgRestoreInto(scratchName, dumpPath);
        const tables = await this.scratchTables(scratchName);
        if (tables < 10) {
          throw new Error(
            `the archive restored only ${tables} tables into the scratch database, which is not a ` +
              'KAYAN database',
          );
        }
        rehearsed = true;
      } catch (error) {
        throw new BadRequestException(
          'This backup did not restore cleanly into a test database, so the current data was ' +
            `not touched. It may be damaged, or made by a different PostgreSQL version. Details: ${String(
              (error as Error).message ?? error,
            ).slice(0, 400)}`,
        );
      } finally {
        await dropDatabaseIfExists(scratchName).catch(() => {});
      }
      journal = await this.journals.advance(journal, 'rehearsed', {
        checks: [
          ...journal.checks,
          { name: 'rehearsal', ok: rehearsed, detail: 'restored cleanly into a scratch database' },
        ],
      });

      // 6. The safety copy. No safety copy, no restore.
      let safety;
      try {
        safety = await this.backups.createSafety(userId);
      } catch (error) {
        throw new ServiceUnavailableException(
          'The restore was stopped before anything was replaced because a safety backup could ' +
            `not be written (${(error as Error).message}). The current data is untouched.`,
        );
      }
      journal = await this.journals.advance(journal, 'safety-taken', { safetyBackup: safety.name });

      // 7. Replace the database, with writes blocked.
      this.maintenance.begin(
        `Restoring the system from ${label}. The program will be back shortly.`,
      );
      journal = await this.journals.advance(journal, 'db-replacing');

      try {
        await executeSql('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
      } catch (error) {
        this.logger.warn(`Could not drop the public schema: ${(error as Error).message}`);
      }
      this.injectFailure('after-schema');
      await pgRestoreInto(databaseName, dumpPath);
      await this.reconnectPrisma();
      this.injectFailure('after-db');

      // 8. Does what came back match what the archive promised?
      const dataChecks = await this.checkRestoredData(manifest);
      journal = await this.journals.advance(journal, 'db-restored', {
        checks: [...journal.checks, ...dataChecks],
      });
      const failed = dataChecks.filter((check) => !check.ok);
      if (failed.length > 0) {
        throw new Error(
          `the restored data did not pass its checks: ${failed
            .map((check) => `${check.name} — ${check.detail}`)
            .join('; ')}`,
        );
      }

      // 9. Repair access: the archive was written by some version of the
      //    program, and this one may expect more. Additive only.
      const access = await this.reconcileAccess();

      // 10. The files the database refers to.
      journal = await this.journals.advance(journal, 'files-replacing');
      const filesRestored = await this.swapUploadsFolder(stagingDir, journal, (patch) => {
        journal = { ...journal, ...patch };
        return this.journals.write(journal);
      });
      journal = await this.journals.advance(journal, 'files-swapped');
      this.injectFailure('after-files');

      // 11. The licence: never restored, and proved untouched.
      const postLicence = await findLicenceSnapshot();
      const licencePreserved =
        preLicence.present === postLicence.present &&
        preLicence.sha256 === postLicence.sha256;
      const accessChecks: RestoreCheck[] = [
        { name: 'access', ok: true, detail: access },
        {
          name: 'licence',
          ok: licencePreserved,
          detail: licencePreserved
            ? preLicence.present
              ? 'the licence file was not touched'
              : 'no licence file exists on this machine, and none was written'
            : 'the licence file changed during the restore',
        },
      ];
      const finalChecks = await this.checkRestoredData(manifest);
      const allChecks = [...journal.checks, ...accessChecks, ...finalChecks];
      const failures = allChecks.filter((check) => !check.ok);
      if (failures.length > 0) {
        throw new Error(
          `the restored system did not pass its final checks: ${failures
            .map((check) => `${check.name} — ${check.detail}`)
            .join('; ')}`,
        );
      }

      journal = await this.journals.advance(journal, 'verified', { checks: allChecks });
      this.maintenance.end();
      await this.journals.clear();
      await this.gate.forget();
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});

      await this.audit.record({
        action: 'RESTORE',
        entity: 'backup_system',
        entityId: label,
        after: {
          source: label,
          safetyBackup: safety.name,
          rehearsed,
          filesRestored,
          licencePreserved,
          companies: manifest.counts.companies,
          users: manifest.counts.users,
          checks: allChecks,
        },
        userId,
      });

      return {
        restored: true,
        source: label,
        safetyBackup: safety.name,
        rehearsed,
        filesRestored,
        licencePreserved,
        checks: allChecks,
        durationMs: Date.now() - started,
        manifest: {
          createdAt: manifest.createdAt,
          appVersion: manifest.appVersion,
          companies: manifest.counts.companies,
          users: manifest.counts.users,
          files: manifest.files.count,
        },
      };
    } catch (error) {
      // Anything that failed after the database was being replaced must be
      // rolled back here — the person is told what happened and what is now
      // on disk, never left to find out.
      const journal = await this.journals.read().catch(() => null);
      if (journal && DESTRUCTIVE_PHASES.includes(journal.phase) && journal.safetyBackup) {
        const rollback = await this.rollback(journal, userId).catch((rollbackError) => ({
          recovered: false,
          detail: `the automatic recovery itself failed: ${(rollbackError as Error).message}`,
        }));
        if (rollback.recovered) {
          throw new ServiceUnavailableException(
            'لم تكتمل الاستعادة، وتم إرجاع البيانات السابقة تلقائياً من نسخة الأمان ' +
              `(${journal.safetyBackup}). لم تُفقد أي بيانات. / The restore did not finish and ` +
              `the previous data was put back automatically from the safety backup ` +
              `(${journal.safetyBackup}). No data was lost. Details: ${this.messageOf(error).slice(0, 400)}`,
          );
        }
        this.maintenance.begin(
          'فشلت الاستعادة وفشل التعافي التلقائي أيضاً. النظام في وضع الصيانة ولا يقبل أي تعديل. ' +
            `استعد يدوياً من نسخة الأمان ${journal.safetyBackup}. / The restore failed and the ` +
            `automatic recovery also failed. The system stays in maintenance mode; restore ` +
            `manually from the safety backup ${journal.safetyBackup}.`,
        );
        await this.gate.forget();
        throw new ServiceUnavailableException({
          code: 'RESTORE_FAILED_RECOVERY_FAILED',
          message: 'The restore failed and the automatic recovery also failed.',
          detail:
            'Restore manually from the safety backup ' +
            `${journal.safetyBackup} in ${backupDirectory()}. ` +
            `Original error: ${this.messageOf(error).slice(0, 300)}`,
        });
      }

      // Nothing destructive happened: put the maintenance switch back and
      // leave the journal clean.
      this.maintenance.end();
      await this.journals.clear().catch(() => {});
      throw error;
    } finally {
      this.running = false;
      await lock?.end().catch(() => {});
      // Whatever happened, the gate must look at the machine again: a restore
      // that just finished changed the backup folder, the journal and (after
      // a failure) the maintenance switch.
      await this.gate.forget();
      await removeIfExistsLater(uploadedTemporary);
    }
  }

  /// ───────────────────────────────────────────────────────────── recovery

  /**
   * Puts the safety backup back after an interrupted or failed restore, from
   * a journal left on disk. This is the action the operator is told to take,
   * and the only one that is safe after a crash mid-replacement.
   */
  async resumeRecovery(userId: string): Promise<{
    recovered: boolean;
    phase: string | null;
    safetyBackup: string | null;
    detail: string;
  }> {
    const journal = await this.journals.read();
    if (!journal) {
      this.maintenance.end();
      return {
        recovered: false,
        phase: null,
        safetyBackup: null,
        detail: 'There is no interrupted restore to recover from.',
      };
    }
    if (!journal.safetyBackup) {
      // Nothing was replaced, so there is nothing to put back.
      await this.journals.clear();
      this.maintenance.end();
      return {
        recovered: false,
        phase: journal.phase,
        safetyBackup: null,
        detail:
          'The interrupted restore stopped before any data was replaced, so there was nothing ' +
          'to recover. The journal was cleared.',
      };
    }
    const result = await this.rollback(journal, userId);
    await this.gate.forget();
    return {
      recovered: result.recovered,
      phase: journal.phase,
      safetyBackup: journal.safetyBackup,
      detail: result.detail,
    };
  }

  /**
   * The one recovery path, used by both an automatic failure and a manual
   * resume: put the safety archive's database back, put the previous uploads
   * folder back, and prove both before saying so.
   */
  private async rollback(
    journal: RestoreJournal,
    userId: string,
  ): Promise<{ recovered: boolean; detail: string }> {
    const safetyName = journal.safetyBackup;
    if (!safetyName) return { recovered: false, detail: 'no safety backup was recorded' };
    this.logger.warn(`Rolling back to safety backup ${safetyName}`);
    this.maintenance.begin(
      `Recovering from the safety backup ${safetyName}. Do not enter data yet.`,
    );
    await this.journals.advance(journal, 'rolling-back');

    const workDir = join(backupDirectory(), '.recovery', `${Date.now()}-${process.pid}`);
    try {
      await mkdir(workDir, { recursive: true });
      const safetyPath = this.backups.pathOf(safetyName);
      if (!existsSync(safetyPath)) {
        throw new Error(`the safety backup ${safetyName} is not in the backup folder`);
      }
      const report = await this.backups.verifyPath(safetyPath, safetyName);
      if (!report.ok) {
        throw new Error(`the safety backup itself did not verify: ${report.failure}`);
      }
      const manifest = await this.backups.readManifest(safetyPath);
      await extractTar(safetyPath, workDir, {
        expected: this.backups.expectedFrom(manifest),
      });
      const dumpPath = join(workDir, ARCHIVE_PATHS.databaseDump);

      // The database first: without it nothing else matters.
      await executeSql('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
      await pgRestoreInto(databaseNameFrom(), dumpPath);
      await this.reconnectPrisma();

      const checks = await this.checkRestoredData(manifest);
      const failed = checks.filter((check) => !check.ok);
      if (failed.length > 0) {
        throw new Error(
          `the safety backup restored but did not pass its checks: ${failed
            .map((check) => `${check.name} — ${check.detail}`)
            .join('; ')}`,
        );
      }

      // Then the files that belong to the database that is now in place.
      const previous = journal.previousUploads;
      if (previous && existsSync(previous)) {
        const uploads = uploadsDirectory();
        const current = `${uploads}.failed-restore-${Date.now()}`;
        if (existsSync(uploads)) await rename(uploads, current).catch(() => {});
        await rename(previous, uploads);
      }

      if (journal.stagingDir) {
        await rm(journal.stagingDir, { recursive: true, force: true }).catch(() => {});
      }
      await this.journals.advance(journal, 'rolled-back', {
        checks,
        detail: 'the safety backup was put back',
      });
      await this.journals.clear();
      this.maintenance.end();
      await this.gate.forget();
      this.logger.log(`Rolled back to ${safetyName} and the data passed its checks`);

      await this.audit.record({
        action: 'RESTORE_ROLLBACK',
        entity: 'backup_system',
        entityId: safetyName,
        after: { safetyBackup: safetyName, checks },
        userId,
      });

      return {
        recovered: true,
        detail:
          `تم إرجاع البيانات من نسخة الأمان ${safetyName} والتحقق منها. / ` +
          `The data was put back from the safety backup ${safetyName} and passed its checks.`,
      };
    } catch (error) {
      await this.journals.advance(journal, 'failed', {
        detail: this.messageOf(error).slice(0, 1000),
      });
      this.maintenance.begin(
        'فشل التعافي التلقائي. النظام في وضع الصيانة. ' +
          `استعد يدوياً من نسخة الأمان ${safetyName}. / Automatic recovery failed. The system ` +
          `stays in maintenance mode; restore manually from ${safetyName}.`,
      );
      this.logger.error(`Rollback to ${safetyName} failed: ${this.messageOf(error)}`);
      return { recovered: false, detail: this.messageOf(error) };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /// ─────────────────────────────────────────────────────────────── helpers

  /**
   * The checks that decide whether a restored database is the database the
   * archive described: the same counts, a balanced journal, users who can sign
   * in, roles that still grant permissions, and stock that points at real
   * items.
   */
  private async checkRestoredData(manifest: SystemBackupManifest): Promise<RestoreCheck[]> {
    const checks: RestoreCheck[] = [];
    const record = (name: string, ok: boolean, detail: string): void => {
      checks.push({ name, ok, detail });
    };

    try {
      await withPgClient({}, async (client) => {
        const tables = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public'`,
        );
        const tableCount = Number(tables.rows[0]?.count ?? 0);
        record(
          'schema',
          tableCount > 10,
          `${tableCount} tables in the public schema`,
        );

        const counts = await client.query<Record<string, string>>(`
          SELECT
            (SELECT count(*) FROM companies) AS companies,
            (SELECT count(*) FROM users) AS users,
            (SELECT count(*) FROM accounts) AS accounts,
            (SELECT count(*) FROM journal_entries) AS journal_entries,
            (SELECT count(*) FROM items) AS items,
            (SELECT count(*) FROM customers) AS customers,
            (SELECT count(*) FROM suppliers) AS suppliers,
            (SELECT count(*) FROM stock_balances) AS stock_balances
        `);
        const row = counts.rows[0] ?? {};
        const actual = {
          companies: Number(row.companies ?? 0),
          users: Number(row.users ?? 0),
          accounts: Number(row.accounts ?? 0),
          journalEntries: Number(row.journal_entries ?? 0),
          items: Number(row.items ?? 0),
          customers: Number(row.customers ?? 0),
          suppliers: Number(row.suppliers ?? 0),
          stockBalances: Number(row.stock_balances ?? 0),
        };
        const mismatches = Object.entries(actual)
          .filter(([key, value]) => (manifest.counts as Record<string, number>)[key] !== value)
          .map(
            ([key, value]) =>
              `${key}: archive ${(manifest.counts as Record<string, number>)[key]}, database ${value}`,
          );
        record(
          'counts',
          mismatches.length === 0,
          mismatches.length === 0
            ? `${actual.companies} companies, ${actual.users} users, ${actual.accounts} accounts`
            : `the database does not match the archive (${mismatches.join('; ')})`,
        );

        const imbalance = await client.query<{ count: string }>(`
          SELECT count(*)::text AS count FROM (
            SELECT e.id
            FROM journal_entries e
            JOIN journal_lines l ON l."journalEntryId" = e.id
            GROUP BY e.id, e."totalDebit", e."totalCredit"
            HAVING ROUND(SUM(l.debit), 4) <> ROUND(e."totalDebit", 4)
               OR ROUND(SUM(l.credit), 4) <> ROUND(e."totalCredit", 4)
            LIMIT 50
          ) AS broken
        `);
        const broken = Number(imbalance.rows[0]?.count ?? 0);
        record(
          'journal-balance',
          broken === 0,
          broken === 0 ? 'every journal entry matches its lines' : `${broken} journal entries do not balance`,
        );

        const unpaired = await client.query<{ count: string }>(`
          SELECT count(*)::text AS count FROM journal_entries e
          WHERE NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l."journalEntryId" = e.id)
        `);
        const empty = Number(unpaired.rows[0]?.count ?? 0);
        record(
          'journal-lines',
          empty === 0,
          empty === 0 ? 'every journal entry has lines' : `${empty} journal entries have no lines`,
        );

        const orphans = await client.query<{ count: string }>(`
          SELECT count(*)::text AS count FROM stock_balances b
          LEFT JOIN items i ON i.id = b."itemId"
          LEFT JOIN branches br ON br.id = b."branchId"
          WHERE i.id IS NULL OR br.id IS NULL
        `);
        const orphanStock = Number(orphans.rows[0]?.count ?? 0);
        record(
          'stock-integrity',
          orphanStock === 0,
          orphanStock === 0
            ? 'every stock balance points at a real item and branch'
            : `${orphanStock} stock balances point at something that is not there`,
        );

        const permissions = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM permissions`,
        );
        const permissionCount = Number(permissions.rows[0]?.count ?? 0);
        record(
          'permissions',
          actual.users === 0 || permissionCount > 0,
          actual.users === 0
            ? 'the archive holds no users, so no permissions are needed'
            : `${permissionCount} permissions are in place for ${actual.users} users`,
        );

        const superAdmins = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM users WHERE "isSuperAdmin" = true AND "deletedAt" IS NULL AND "isActive" = true`,
        );
        const admins = Number(superAdmins.rows[0]?.count ?? 0);
        record(
          'super-admin',
          actual.users === 0 || admins > 0,
          actual.users === 0
            ? 'the archive holds no users'
            : admins > 0
              ? `${admins} active super administrator(s) can reach the installation screens`
              : 'no active super administrator exists, so the installation screens would be unreachable',
        );
      });
    } catch (error) {
      record('database', false, `the restored database did not answer the checks: ${(error as Error).message}`);
    }
    return checks;
  }

  private async reconcileAccess(): Promise<string> {
    try {
      const companies = await this.prisma.company.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      let grantsAdded = 0;
      const promoted: string[] = [];
      for (const company of companies) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const repaired = await this.prisma.$transaction((tx: any) =>
          reconcileRestoredAccess(tx, company.id),
        );
        grantsAdded += repaired.grantsAdded;
        if (repaired.superAdminPromoted) promoted.push(repaired.superAdminPromoted);
      }
      return (
        `${companies.length} companies repaired: ${grantsAdded} role grants added` +
        (promoted.length > 0 ? `, ${promoted.length} administrator(s) promoted` : '')
      );
    } catch (error) {
      // A repair failure must not un-report a restore whose data already
      // passed its checks; it is reported instead.
      return `access repair could not complete: ${(error as Error).message}`;
    }
  }

  /**
   * Replaces the uploads folder with the one inside the archive, moving the
   * current one aside rather than deleting it: the safety backup can put the
   * database back, and this folder is what makes that a complete recovery.
   */
  private async swapUploadsFolder(
    stagingDir: string,
    journal: RestoreJournal,
    persist: (patch: Partial<RestoreJournal>) => Promise<RestoreJournal>,
  ): Promise<number> {
    const uploads = uploadsDirectory();
    const staged = join(stagingDir, ARCHIVE_PATHS.filesRoot);
    const previous = join(stagingDir, 'previous-uploads');

    let filesRestored = 0;
    if (existsSync(staged)) {
      filesRestored = (await listUserFiles(staged)).length;
    }

    if (existsSync(uploads)) {
      await rename(uploads, previous);
    }
    await persist({ previousUploads: previous });

    if (existsSync(staged)) {
      await mkdir(join(uploads, '..'), { recursive: true });
      await rename(staged, uploads);
    } else {
      await mkdir(uploads, { recursive: true });
    }
    return filesRestored;
  }

  private async scratchTables(database: string): Promise<number> {
    return withPgClient({ database }, async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      return Number(result.rows[0]?.count ?? 0);
    });
  }

  /// The connection pool holds handles to the schema that has just been
  /// replaced. Dropping them is not optional: every check after this point
  /// would otherwise read whatever the old connections had cached.
  private async reconnectPrisma(): Promise<void> {
    const client = this.prisma as unknown as {
      $disconnect?: () => Promise<void>;
      $connect?: () => Promise<void>;
    };
    try {
      await client.$disconnect?.();
    } catch {
      /* a pool that is already gone is not a problem */
    }
    await client.$connect?.();
  }

  /// The advisory lock that stops a second process from starting a restore
  /// while this one holds it. Returns the client that holds it, so it is only
  /// released when that client is closed.
  private async holdAdvisoryLock(): Promise<Client | null> {
    const url = process.env.DATABASE_URL;
    if (!url) return null;
    const client = new Client({ connectionString: cleanDatabaseUrl(url) });
    try {
      await client.connect();
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [ADVISORY_LOCK_KEY],
      );
      if (!result.rows[0]?.locked) {
        await client.end().catch(() => {});
        throw new ConflictException('Another process is already restoring this database.');
      }
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      if (error instanceof ConflictException) throw error;
      this.logger.warn(`Could not take the restore advisory lock: ${(error as Error).message}`);
      return null;
    }
  }

  /// A deliberate failure, used only by the test harness to prove that a
  /// restore which dies half way puts the previous data back. It cannot run in
  /// production: the check is on NODE_ENV, not on a request parameter.
  private injectFailure(point: string): void {
    if (process.env.NODE_ENV === 'production') return;
    if (process.env.KAYAN_RESTORE_TEST_FAILURE !== point) return;
    this.logger.warn(`Test failure injected at "${point}"`);
    throw new Error(`injected test failure at ${point}`);
  }

  private messageOf(error: unknown): string {
    return String((error as Error)?.message ?? error);
  }
}

/// Removes a temporary upload after the response has been decided; failures
/// are irrelevant to the outcome and are swallowed.
async function removeIfExistsLater(path: string | null): Promise<void> {
  if (!path) return;
  await removeIfExists(path);
}
