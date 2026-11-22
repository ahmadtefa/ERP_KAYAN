import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARCHIVE_PATHS } from './manifest';
import type { RestoreJournal } from './restore-journal';
import { SystemRestoreService } from './system-restore.service';

describe('complete restore uploads recovery', () => {
  let root: string;
  let uploads: string;
  let originalEnv: string | undefined;
  let service: {
    swapUploadsFolder: (staging: string, journal: RestoreJournal, persist: (patch: Partial<RestoreJournal>) => Promise<RestoreJournal>) => Promise<number>;
    restoreUploadsFromSafety: (work: string, journal: RestoreJournal) => Promise<void>;
  };
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kayan-restore-files-'));
    uploads = join(root, 'uploads');
    originalEnv = process.env.KAYAN_UPLOAD_DIR;
    process.env.KAYAN_UPLOAD_DIR = uploads;
    service = new SystemRestoreService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never) as unknown as typeof service;
  });
  afterEach(async () => {
    if (originalEnv === undefined) delete process.env.KAYAN_UPLOAD_DIR;
    else process.env.KAYAN_UPLOAD_DIR = originalEnv;
    await rm(root, { recursive: true, force: true });
  });

  it('journals the original uploads location before moving any files', async () => {
    const staging = join(root, 'staging');
    await mkdir(uploads, { recursive: true });
    await writeFile(join(uploads, 'original.txt'), 'original');
    await mkdir(join(staging, ARCHIVE_PATHS.filesRoot), { recursive: true });
    await writeFile(join(staging, ARCHIVE_PATHS.filesRoot, 'restored.txt'), 'restored');
    const journal = {} as RestoreJournal;
    const persist = jest.fn(async (patch: Partial<RestoreJournal>) => {
      expect(existsSync(join(uploads, 'original.txt'))).toBe(true);
      expect(existsSync(join(staging, 'previous-uploads'))).toBe(false);
      return { ...journal, ...patch };
    });
    await service.swapUploadsFolder(staging, journal, persist);
    expect(persist).toHaveBeenCalledWith({ previousUploads: join(staging, 'previous-uploads') });
    expect(await readFile(join(uploads, 'restored.txt'), 'utf8')).toBe('restored');
    expect(await readFile(join(staging, 'previous-uploads', 'original.txt'), 'utf8')).toBe('original');
  });

  it('recovers uploads from the verified safety extraction if an older interrupted journal lacks a previous path', async () => {
    const work = join(root, 'recovery');
    await mkdir(uploads, { recursive: true });
    await writeFile(join(uploads, 'new.txt'), 'new');
    await mkdir(join(work, ARCHIVE_PATHS.filesRoot), { recursive: true });
    await writeFile(join(work, ARCHIVE_PATHS.filesRoot, 'old.txt'), 'old');
    await service.restoreUploadsFromSafety(work, { previousUploads: null } as RestoreJournal);
    expect(await readFile(join(uploads, 'old.txt'), 'utf8')).toBe('old');
    expect(existsSync(join(uploads, 'new.txt'))).toBe(false);
  });
});
