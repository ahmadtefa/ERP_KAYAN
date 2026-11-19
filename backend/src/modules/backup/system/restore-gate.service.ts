import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { open, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { MaintenanceService } from '../../../common/maintenance/maintenance';
import {
  backupDirectory,
  ensureDirectory,
  findPgTools,
  majorOf,
  mayCreateDatabase,
  serverVersion,
  uploadsDirectory,
} from './pg-support';
import { RestoreJournalStore } from './restore-journal';

/**
 * The gate in front of every destructive restore.
 *
 * Restoring a database archive is the only operation in the program that can
 * destroy every company at once. It is therefore not a button that is simply
 * always there: it is available only when this particular machine can prove it
 * can do it safely — the PostgreSQL tools are present and new enough, the
 * backup folder can be written to (that is where the safety copy goes), a
 * scratch database can be opened (that is where the archive is rehearsed), and
 * no interrupted restore is waiting to be resolved.
 *
 * When any of that is not true the restore is refused with the reasons, named
 * one by one. The control is deliberately not an environment switch that a
 * hurried installer can flip: flipping the switch only makes the gate *strict*
 * (it can switch the feature off). Turning it on requires the machine itself to
 * pass every check.
 */

const CACHE_MS = 15_000;

/// Set to `0`/`false`/`off` to switch destructive restores off entirely — the
/// kill switch an administrator reaches for when a machine is under
/// investigation. It cannot force the feature on.
const DISABLE_VALUES = new Set(['0', 'false', 'off', 'no', 'disabled']);

export interface GateCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface RestoreGateReport {
  fullRestoreSupported: boolean;
  state: 'ready' | 'blocked' | 'disabled';
  reasons: string[];
  checks: GateCheck[];
  checkedAt: string;
  backupDirectory: string;
  /// Whether a scratch database may be opened; without it a restore is never
  /// offered.
  canRehearse: boolean;
}

@Injectable()
export class RestoreGateService {
  private readonly logger = new Logger(RestoreGateService.name);
  private cached: { report: RestoreGateReport; at: number } | null = null;

  constructor(
    private readonly maintenance: MaintenanceService,
    private readonly journals: RestoreJournalStore,
  ) {}

  /// Forget the last answer, e.g. after the tools were provisioned.
  forget(): void {
    this.cached = null;
  }

  async probe(force = false): Promise<RestoreGateReport> {
    // Only a "yes" is remembered. A "no" can be true for a second — a restore
    // in flight, a journal being cleared — and caching it would turn a
    // momentary state into a minute of misleading refusals.
    if (
      !force &&
      this.cached &&
      this.cached.report.fullRestoreSupported &&
      Date.now() - this.cached.at < CACHE_MS
    ) {
      return this.cached.report;
    }
    const report = await this.runChecks();
    this.cached = { report, at: Date.now() };
    return report;
  }

  /// Throws the refusal the screens show, with every reason named.
  async assertAllowed(): Promise<RestoreGateReport> {
    const report = await this.probe();
    if (report.fullRestoreSupported) return report;
    throw new ServiceUnavailableException({
      code: 'FULL_RESTORE_UNAVAILABLE',
      message: 'Full restore is not available on this machine yet.',
      detail:
        'الاستعادة الكاملة متوقفة على هذا الجهاز لحماية البيانات. / ' +
        'Full restore is refused on this machine because: ' +
        report.reasons.join('; '),
    });
  }

  private async runChecks(): Promise<RestoreGateReport> {
    const checks: GateCheck[] = [];
    const dir = backupDirectory();
    let canRehearse = false;

    const switchValue = (process.env.KAYAN_FULL_RESTORE_ENABLED ?? '').trim().toLowerCase();
    const disabledByOperator = DISABLE_VALUES.has(switchValue);
    checks.push({
      name: 'operator-switch',
      ok: !disabledByOperator,
      detail: disabledByOperator
        ? 'the administrator switched destructive restores off with KAYAN_FULL_RESTORE_ENABLED'
        : 'destructive restores are not switched off',
    });

    // No restore may begin while one is running, or while an interrupted one
    // is waiting to be resolved.
    checks.push({
      name: 'no-restore-running',
      ok: !this.maintenance.isActive,
      detail: this.maintenance.isActive
        ? 'a restore is already running (or the system is in maintenance mode)'
        : 'no restore is running',
    });

    const journal = await this.journals.read();
    checks.push({
      name: 'no-interrupted-restore',
      ok: journal === null,
      detail:
        journal === null
          ? 'no interrupted restore is waiting'
          : `an earlier restore stopped at "${journal.phase}" and must be resolved first ` +
            `(safety backup: ${journal.safetyBackup ?? 'none recorded'})`,
    });

    const tools = await findPgTools();
    const toolsPresent = Boolean(tools.pgDump && tools.pgRestore);
    checks.push({
      name: 'postgresql-tools',
      ok: toolsPresent,
      detail: toolsPresent
        ? `${tools.pgDump} / ${tools.pgRestore}`
        : 'pg_dump and pg_restore were not found on this machine',
    });

    const server = await serverVersion();
    const toolMajor = majorOf(tools.version);
    const serverMajor = majorOf(server);
    const versionOk = toolMajor !== null && serverMajor !== null && toolMajor >= serverMajor;
    checks.push({
      name: 'tool-version',
      ok: versionOk,
      detail: versionOk
        ? `tools ${toolMajor}, server ${serverMajor}`
        : `pg_dump is ${tools.version ?? 'unknown'} and the server is ${server ?? 'unknown'}; ` +
          'the tools must not be older than the server',
    });

    const folderCheck = await this.checkFolder('backup-folder', dir);
    checks.push(folderCheck);

    const uploads = uploadsDirectory();
    const uploadsFolder = await this.checkFolder('uploads-folder', uploads);
    checks.push(uploadsFolder);

    const rehearsal = await mayCreateDatabase();
    canRehearse = rehearsal.allowed;
    checks.push({
      name: 'scratch-database',
      ok: rehearsal.allowed,
      detail: rehearsal.allowed
        ? 'a scratch database can be opened to rehearse a restore'
        : `a restore cannot be rehearsed here: ${rehearsal.reason ?? 'the database refused'}`,
    });

    const database = await this.checkDatabase();
    checks.push(database);

    const reasons = checks.filter((check) => !check.ok).map((check) => check.detail);
    const fullRestoreSupported = reasons.length === 0;
    if (!fullRestoreSupported) {
      this.logger.warn(`Full restore unavailable: ${reasons.join('; ')}`);
    }
    return {
      fullRestoreSupported,
      state: disabledByOperator ? 'disabled' : fullRestoreSupported ? 'ready' : 'blocked',
      reasons,
      checks,
      checkedAt: new Date().toISOString(),
      backupDirectory: dir,
      canRehearse,
    };
  }

  /// Creates a folder and writes a file in it, then removes it. Reading the
  /// permissions bits is not the same question: a folder can look writable and
  /// still refuse a file.
  private async checkFolder(name: string, path: string): Promise<GateCheck> {
    try {
      await ensureDirectory(path);
      const probe = join(path, `.kayan-write-check-${process.pid}-${Date.now()}`);
      const handle = await open(probe, 'w');
      await handle.write('kayan', 0, 'utf8');
      await handle.close();
      await unlink(probe).catch(() => {});
      return { name, ok: true, detail: `${path} is writable` };
    } catch (error) {
      return {
        name,
        ok: false,
        detail: `${path} cannot be written to (${(error as Error).message})`,
      };
    }
  }

  private async checkDatabase(): Promise<GateCheck> {
    try {
      const { withPgClient } = await import('./pg-support');
      await withPgClient({}, async (client) => {
        await client.query('SELECT 1');
      });
      return { name: 'database', ok: true, detail: 'the database answers' };
    } catch (error) {
      return {
        name: 'database',
        ok: false,
        detail: `the database did not answer (${(error as Error).message})`,
      };
    }
  }
}
