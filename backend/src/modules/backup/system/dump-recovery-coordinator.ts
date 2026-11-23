import { ConflictException, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { FullBackupService } from '../full-backup.service';
import { RestoreJournalStore, isDestructive } from './restore-journal';
import { acquireRestoreLock } from './restore-lock';
import { MaintenanceService } from '../../../common/maintenance/maintenance';
import { SystemRestoreService } from './system-restore.service';
import { databaseFingerprint } from './database-identity';
import { PersistentRestoreState } from './restore-state';

/** Recover only the already-authorized safety copy, never a fresh user upload.
 * This local worker needs no surviving users/session tables and exposes no
 * unauthenticated HTTP route. Live restore ownership always wins.
 */
@Injectable()
export class DumpRecoveryCoordinator implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DumpRecoveryCoordinator.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly attempted = new Set<string>();

  constructor(private readonly dumps: FullBackupService, private readonly journals: RestoreJournalStore,
    private readonly maintenance: MaintenanceService,
    @Optional() private readonly complete?: SystemRestoreService,
    @Optional() private readonly state?: PersistentRestoreState) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => { void this.check(); }, 5000);
    this.timer.unref();
    void this.check();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  check(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.recover().catch(() => {
      // Business admission reads the still-present journal and stays closed.
      this.logger.error('Automatic restore recovery did not complete. Preserve the safety copy and journal for investigation.');
    }).finally(() => { this.running = null; });
    return this.running;
  }

  private async recover(): Promise<void> {
    const candidate = await this.journals.read();
    if (!candidate || this.attempted.has(candidate.id)) return;
    if (candidate.databaseFingerprint !== databaseFingerprint()) return;
    if (candidate.kind !== undefined && candidate.kind !== 'dump' && candidate.kind !== 'complete') return;
    let lock;
    try { lock = await acquireRestoreLock({ recovery: true }); }
    catch (error) { if (error instanceof ConflictException) return; throw error; }
    try {
      const journal = await this.journals.read();
      if (!journal || journal.id !== candidate.id || journal.kind !== candidate.kind) return;
      if (journal.databaseFingerprint !== databaseFingerprint()) throw new Error('Recovery database identity changed');
      this.attempted.add(journal.id);
      if (!isDestructive(journal)) {
        // Includes a durably completed rollback: never replay an old safety
        // copy over subsequently accepted work.
        await this.state?.finish(journal.id);
        await this.journals.clear();
        this.maintenance.end();
        return;
      }
      if (journal.kind === 'dump') {
        await this.dumps.recoverDumpJournal(journal);
      } else {
        if (!this.complete) throw new Error('Complete-system recovery is unavailable');
        // The complete engine owns its own lock and rechecks the journal under
        // it. Fresh restores cannot cross this handoff while recovery is pending.
        await lock.end();
        lock = null;
        const result = await this.complete.resumeRecovery(null);
        if (!result.recovered) throw new Error('Complete-system recovery did not finish');
      }
      this.logger.log('Interrupted restore recovered from its verified safety copy.');
    } finally { await lock?.end().catch(() => {}); }
  }
}
