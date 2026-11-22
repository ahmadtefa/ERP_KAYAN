import { existsSync } from 'node:fs';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ensureDirectory } from './pg-support';

/**
 * The restore journal.
 *
 * A restore replaces the database and the uploads folder. Between those two
 * steps the machine can lose power, and what is left is a half-restored
 * installation that nobody can reason about from memory. So every step is
 * written to a small file on disk *before* it is taken, and the file is only
 * removed when the restore has finished or been rolled back.
 *
 * On the next start, an unfinished journal is proof that the program did not
 * choose to stop: it says exactly which step was reached, which safety backup
 * was taken, and where the previous uploads folder is. The program then stays
 * in maintenance mode and offers the one action that is safe — put the safety
 * backup back.
 */

export type RestorePhase =
  | 'started'
  | 'validated'
  | 'rehearsed'
  | 'safety-taken'
  | 'db-replacing'
  | 'db-restored'
  | 'files-replacing'
  | 'files-swapped'
  | 'verified'
  | 'rolling-back'
  | 'rolled-back'
  | 'failed';

/// The phases after which the live database or the uploads folder may have
/// been changed: an unfinished journal in one of these means "recover".
export const DESTRUCTIVE_PHASES: RestorePhase[] = [
  'db-replacing',
  'db-restored',
  'files-replacing',
  'files-swapped',
  'verified',
  'rolling-back',
  'failed',
];

export const FINISHED_PHASES: RestorePhase[] = ['rolled-back'];

export interface RestoreJournal {
  id: string;
  startedAt: string;
  updatedAt: string;
  phase: RestorePhase;
  /// What is being restored, as the person chose it.
  source: string;
  /// Everything inside the backup, for the record after the fact.
  sourceManifest: {
    createdAt: string | null;
    appVersion: string | null;
    companies: number | null;
    files: number | null;
  };
  /// The archive that can put the installation back.
  safetyBackup: string | null;
  /// Where the previous uploads folder was moved to, so it can be moved back.
  previousUploads: string | null;
  /// Where the archive was unpacked. Removed when the restore finishes.
  stagingDir: string | null;
  /// What went wrong, if anything, in the words of the tool that said it.
  detail: string | null;
  /// The checks that ran, in order, for the report the screen shows.
  checks: Array<{ name: string; ok: boolean; detail: string }>;
}

export function journalPath(backupDir: string): string {
  return join(backupDir, 'restore-journal.json');
}

export function isDestructive(journal: Pick<RestoreJournal, 'phase'>): boolean {
  return DESTRUCTIVE_PHASES.includes(journal.phase);
}

/// A journal still on disk means no restore reached its end. `rolled-back` is
/// the one phase that is a conclusion, and the store clears the file then; a
/// journal left in it would still be reported so the operator can read it.
export function isUnfinished(journal: Pick<RestoreJournal, 'phase'> | null): boolean {
  if (!journal) return false;
  return journal.phase !== 'rolled-back';
}

export class RestoreJournalStore {
  constructor(private readonly backupDir: string) {}

  private get path(): string {
    return journalPath(this.backupDir);
  }

  async read(): Promise<RestoreJournal | null> {
    if (!existsSync(this.path)) return null;
    try {
      const text = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(text) as RestoreJournal;
      if (!parsed || typeof parsed !== 'object' || typeof parsed.phase !== 'string') {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  /// Writes the journal atomically: a half-written journal is worse than none,
  /// because it cannot be trusted to describe the state of the machine.
  async write(journal: RestoreJournal): Promise<RestoreJournal> {
    await ensureDirectory(this.backupDir);
    const next: RestoreJournal = {
      ...journal,
      updatedAt: new Date().toISOString(),
    };
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await rename(temporary, this.path);
    return next;
  }

  async advance(
    journal: RestoreJournal,
    phase: RestorePhase,
    patch: Partial<RestoreJournal> = {},
  ): Promise<RestoreJournal> {
    return this.write({ ...journal, ...patch, phase });
  }

  async clear(): Promise<void> {
    await unlink(this.path).catch(() => {});
  }

  /// A short, safe name for a staging folder belonging to this restore.
  stagingFolder(id: string): string {
    return join(this.backupDir, '.restore-staging', id);
  }
}

/// A journal that is safe to show on a screen: no paths the caller did not
/// already know, and the state spelled out in one word.
export function describeJournal(journal: RestoreJournal | null) {
  if (!journal) {
    return { unfinished: false, phase: null, detail: null, safetyBackup: null };
  }
  const unfinished = isUnfinished(journal);
  return {
    unfinished,
    id: journal.id,
    phase: journal.phase,
    destructive: isDestructive(journal),
    startedAt: journal.startedAt,
    updatedAt: journal.updatedAt,
    source: journal.source,
    detail: journal.detail,
    safetyBackup: journal.safetyBackup,
    checks: journal.checks,
    recoveryAvailable: Boolean(journal.safetyBackup),
  };
}
