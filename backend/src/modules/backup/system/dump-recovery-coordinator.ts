import { ConflictException, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { FullBackupService } from '../full-backup.service';
import { RestoreJournalStore, isDestructive } from './restore-journal';
import { acquireRestoreLock } from './restore-lock';
import { MaintenanceService } from '../../../common/maintenance/maintenance';

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
    private readonly maintenance: MaintenanceService) {}

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
      this.logger.error('Automatic DUMP recovery did not complete. Preserve the safety copy and journal for investigation.');
    }).finally(() => { this.running = null; });
    return this.running;
  }

  private async recover(): Promise<void> {
    const candidate = await this.journals.read();
    if (!candidate || candidate.kind !== 'dump' || this.attempted.has(candidate.id)) return;
    let lock;
    try { lock = await acquireRestoreLock(); }
    catch (error) { if (error instanceof ConflictException) return; throw error; }
    try {
      const journal = await this.journals.read();
      if (!journal || journal.id !== candidate.id || journal.kind !== 'dump') return;
      this.attempted.add(journal.id);
      if (!isDestructive(journal)) {
        // Includes a durably completed rollback: never replay an old safety
        // copy over subsequently accepted work.
        await this.journals.clear();
        this.maintenance.end();
        return;
      }
      await this.dumps.recoverDumpJournal(journal);
      this.logger.log('Interrupted DUMP restore recovered from its verified safety copy.');
    } finally { await lock.end().catch(() => {}); }
  }
}
