import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkBackupDestination, copyArchiveVerified } from './backup-destination';

describe('backup destination folder', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'kayan-dest-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('accepts a writable absolute folder and leaves no test file behind', async () => {
    const out = join(dir, 'sub', 'backups');
    const check = await checkBackupDestination(out);
    expect(check.path).toBe(out);
    expect(await readdir(out)).toEqual([]);
  });

  it.each(['', '   ', 'relative/folder', './x'])('refuses %p', async (value) => {
    await expect(checkBackupDestination(value)).rejects.toMatchObject({ response: { code: 'BACKUP_DEST_NOT_ABSOLUTE' } });
  });

  it('refuses a folder inside the program folder', async () => {
    await expect(checkBackupDestination(join(process.cwd(), 'inner'))).rejects.toMatchObject({ response: { code: 'BACKUP_DEST_INSIDE_PROGRAM' } });
  });

  it('copies an archive and proves the copy; no partial file remains on failure', async () => {
    const src = join(dir, 'a.kayanbackup');
    await writeFile(src, 'synthetic archive bytes');
    const out = join(dir, 'out');
    await copyArchiveVerified(src, out, 'a.kayanbackup');
    expect(await readFile(join(out, 'a.kayanbackup'), 'utf8')).toBe('synthetic archive bytes');
    await expect(copyArchiveVerified(join(dir, 'missing'), out, 'b.kayanbackup')).rejects.toBeDefined();
    expect((await readdir(out)).sort()).toEqual(['a.kayanbackup']);
  });
});
