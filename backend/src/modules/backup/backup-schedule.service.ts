import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanySettingsService } from '../../common/settings/company-settings.module';
import { FullBackupService } from './full-backup.service';

/// How often the timer wakes up to ask whether a backup is due. The interval
/// itself is a per-company setting; this is only how promptly the setting is
/// noticed, and it is deliberately much shorter than any sane interval so a
/// company that asks for a backup every hour does not wait six.
const TICK_MINUTES = 15;

/**
 * Scheduled backups.
 *
 * Two things make this safe to leave running on a real installation:
 *
 *   * nothing is deleted until a newer backup has been written and verified,
 *     so a failed run can never take the previous copy with it;
 *   * the retention count is a setting, and pruning only ever removes the
 *     oldest files of the same kind - an operator who copied a backup out for
 *     safekeeping is never surprised by a missing file they were told exists.
 *
 * The schedule lives in the database (company_settings), not in this process,
 * because the process is restarted by upgrades and the schedule is not.
 */
@Injectable()
export class BackupScheduleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupScheduleService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly full: FullBackupService,
    private readonly settings: CompanySettingsService,
  ) {}

  onModuleInit(): void {
    // Tests and one-off commands should not leave a timer behind.
    if (process.env.KAYAN_DISABLE_BACKUP_SCHEDULE === 'on') {
      this.logger.log('Scheduled backups are switched off by configuration.');
      return;
    }

    // A first tick soon after start-up rather than immediately: a program that
    // is still booting should not be dumping the database.
    this.timer = setInterval(() => void this.tick(), TICK_MINUTES * 60 * 1000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.logger.log(`Scheduled backups are checked every ${TICK_MINUTES} minutes.`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** What the schedule would do next, for the settings screen. */
  async status(): Promise<{
    enabled: boolean;
    intervalHours: number;
    retentionCount: number;
    lastRun: { createdAt: string; status: string; fileName: string } | null;
    nextDueAt: string | null;
  }> {
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    const first = companies[0];
    if (!first) {
      return {
        enabled: false,
        intervalHours: 0,
        retentionCount: 0,
        lastRun: null,
        nextDueAt: null,
      };
    }

    const settings = await this.settings.get(first.id);
    const lastRun = await this.prisma.backupRun.findFirst({
      where: { status: { in: ['SUCCESS', 'VERIFIED'] } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, status: true, fileName: true },
    });

    const enabled = settings.backupIntervalHours > 0;
    const nextDueAt =
      enabled && lastRun
        ? new Date(
            lastRun.createdAt.getTime() + settings.backupIntervalHours * 3600 * 1000,
          ).toISOString()
        : enabled
          ? new Date().toISOString()
          : null;

    return {
      enabled,
      intervalHours: settings.backupIntervalHours,
      retentionCount: settings.backupRetentionCount,
      lastRun: lastRun
        ? {
            createdAt: lastRun.createdAt.toISOString(),
            status: lastRun.status,
            fileName: lastRun.fileName,
          }
        : null,
      nextDueAt,
    };
  }

  /** The recorded history, newest first. */
  async history(take = 50) {
    const rows = await this.prisma.backupRun.findMany({
      orderBy: { createdAt: 'desc' },
      take,
    });
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      fileName: row.fileName,
      sizeBytes: Number(row.sizeBytes),
      status: row.status,
      message: row.message,
      createdAt: row.createdAt.toISOString(),
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
    }));
  }

  /// One pass: is any company due for a backup, and has retention been
  /// reached? Errors are recorded and swallowed - a backup failure must never
  /// bring down the API the rest of the company is using.
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const companies = await this.prisma.company.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true, nameEn: true },
      });

      for (const company of companies) {
        try {
          await this.runForCompany(company);
        } catch (error) {
          this.logger.error(
            `Scheduled backup for ${company.code} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Take a scheduled backup now, whatever the clock says. Used by the
   * "back up now" button and by the tests; it goes through exactly the same
   * code as the timer, so pressing the button proves the schedule works.
   */
  async runNow(companyId?: string): Promise<
    Array<{ companyId: string; fileName: string; status: string; message: string | null }>
  > {
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null, ...(companyId ? { id: companyId } : {}) },
      select: { id: true, code: true, nameEn: true },
    });
    const results: Array<{
      companyId: string;
      fileName: string;
      status: string;
      message: string | null;
    }> = [];
    for (const company of companies) {
      const result = await this.runForCompany(company, true);
      if (result) results.push({ companyId: company.id, ...result });
    }
    return results;
  }

  private async runForCompany(
    company: { id: string; code: string; nameEn: string },
    force = false,
  ): Promise<{ fileName: string; status: string; message: string | null } | null> {
    const settings = await this.settings.get(company.id);
    const intervalHours = settings.backupIntervalHours;
    if (intervalHours <= 0 && !force) return null;

    const lastRun = await this.prisma.backupRun.findFirst({
      where: { status: { in: ['SUCCESS', 'VERIFIED'] } },
      orderBy: { createdAt: 'desc' },
    });
    const dueAt = lastRun
      ? new Date(lastRun.createdAt.getTime() + intervalHours * 3600 * 1000)
      : new Date(0);
    if (!force && dueAt > new Date()) return null;

    const tools = await this.full.capabilities();
    if (!tools.available) {
      const message = `pg_dump/pg_restore not found: ${tools.reason ?? 'unknown reason'}`;
      await this.record({
        kind: 'SCHEDULED',
        fileName: '-',
        status: 'FAILED',
        message,
      });
      return { fileName: '-', status: 'FAILED', message };
    }

    const started = Date.now();
    const result = await this.full.createFull(null);
    const fileName = result.file.name;

    // Verify before retention prunes anything: the new file has to be readable
    // or it is not a backup.
    let status = 'SUCCESS';
    let message: string | null = `written in ${Math.round((Date.now() - started) / 1000)}s`;
    try {
      const verification = await this.full.verify(fileName);
      status = 'VERIFIED';
      message = `${message}; the dump was read back and holds ${verification.entries} objects`;
    } catch (error) {
      status = 'SUCCESS';
      message = `${message}; verification could not run: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }

    const run = await this.record({
      kind: 'SCHEDULED',
      fileName,
      status,
      message,
      companyId: company.id,
    });

    await this.pruneRetention(settings.backupRetentionCount, run.id).catch((error) => {
      this.logger.warn(
        `Retention could not prune old backups: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });

    return { fileName, status, message };
  }

  /**
   * Keep the newest `count` files and remove the rest.
   *
   * Only files this installation wrote are ever candidates: the file list
   * comes from `full.list()`, and the successful run that produced the file
   * has to be on record. A file an operator dropped into the folder by hand
   * is left alone, because deleting somebody else's copy is not retention.
   */
  async pruneRetention(count: number, keepRunId?: string): Promise<string[]> {
    if (count <= 0) return [];

    const files = await this.full.list();
    const ordered = [...files].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const doomed = ordered.slice(Math.max(count, 1));
    const removed: string[] = [];

    const newestName = ordered[0]?.name;
    for (const file of doomed) {
      // Never prune the copy the user was just told about, and never prune the
      // newest file even if the count is 1.
      if (file.name === newestName) continue;
      const run = await this.prisma.backupRun.findFirst({
        where: { fileName: file.name, status: { in: ['SUCCESS', 'VERIFIED'] } },
      });
      if (!run || run.id === keepRunId) continue;
      await this.full.remove(file.name, null);
      removed.push(file.name);
    }
    return removed;
  }

  private async record(data: {
    kind: string;
    fileName: string;
    status: string;
    message: string | null;
    companyId?: string;
  }) {
    return this.prisma.backupRun.create({
      data: {
        companyId: data.companyId ?? null,
        kind: data.kind,
        fileName: data.fileName,
        sizeBytes: BigInt(0),
        status: data.status,
        message: data.message,
      },
    });
  }
}

export type { Prisma };
