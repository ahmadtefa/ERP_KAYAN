import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  RestoreJournalStore,
  describeJournal,
  isDestructive,
  isUnfinished,
  type RestoreJournal,
} from './restore-journal';

function journal(overrides: Partial<RestoreJournal> = {}): RestoreJournal {
  return {
    id: 'test',
    startedAt: '2026-11-19T10:00:00.000Z',
    updatedAt: '2026-11-19T10:00:00.000Z',
    phase: 'started',
    source: 'kayan-full-test.kayanbackup',
    sourceManifest: { createdAt: null, appVersion: null, companies: null, files: null },
    safetyBackup: null,
    previousUploads: null,
    stagingDir: null,
    detail: null,
    checks: [],
    ...overrides,
  };
}

describe('restore journal', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kayan-journal-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a journal atomically and reads it back', async () => {
    const store = new RestoreJournalStore(dir);
    await store.write(journal({ phase: 'validated' }));
    const read = await store.read();
    expect(read?.phase).toBe('validated');
    expect(read?.source).toBe('kayan-full-test.kayanbackup');
    // No half-written temporary file is left next to it.
    const entries = await import('node:fs/promises').then((fs) => fs.readdir(dir));
    expect(entries.filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('advances the phase and keeps what came before', async () => {
    const store = new RestoreJournalStore(dir);
    let current = await store.write(journal());
    current = await store.advance(current, 'safety-taken', { safetyBackup: 'kayan-safety-1.kayanbackup' });
    current = await store.advance(current, 'db-replacing', {
      checks: [{ name: 'archive', ok: true, detail: 'verified' }],
    });
    const read = await store.read();
    expect(read?.phase).toBe('db-replacing');
    expect(read?.safetyBackup).toBe('kayan-safety-1.kayanbackup');
    expect(read?.checks).toHaveLength(1);
  });

  it('clears the journal when the restore is over', async () => {
    const store = new RestoreJournalStore(dir);
    await store.write(journal());
    await store.clear();
    expect(await store.read()).toBeNull();
    expect(await store.clear()).toBeUndefined();
  });

  it('knows which phases may have changed data', () => {
    expect(isDestructive({ phase: 'safety-taken' })).toBe(false);
    expect(isDestructive({ phase: 'rehearsed' })).toBe(false);
    expect(isDestructive({ phase: 'db-replacing' })).toBe(true);
    expect(isDestructive({ phase: 'files-swapped' })).toBe(true);
    // A journal in `rolled-back` is a conclusion, not a state to recover from.
    expect(isDestructive({ phase: 'rolled-back' })).toBe(false);

    expect(isUnfinished(null)).toBe(false);
    expect(isUnfinished(journal({ phase: 'rolled-back' }))).toBe(false);
    expect(isUnfinished(journal({ phase: 'verified' }))).toBe(true);
  });

  it('describes an interrupted restore so the screen can offer recovery', () => {
    const described = describeJournal(
      journal({ phase: 'db-restored', safetyBackup: 'kayan-safety-9.kayanbackup' }),
    );
    expect(described.unfinished).toBe(true);
    expect(described.destructive).toBe(true);
    expect(described.recoveryAvailable).toBe(true);
    expect(described.phase).toBe('db-restored');
  });

  it('treats a corrupt journal as no journal instead of crashing the start', async () => {
    const store = new RestoreJournalStore(dir);
    await (await import('node:fs/promises')).writeFile(join(dir, 'restore-journal.json'), '{not json');
    expect(await store.read()).toBeNull();
  });
});
