import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moveRestoreDirectory } from './move-restore-directory';

describe('restore directory moves between volumes', () => {
  let root: string;
  beforeEach(async () => { root = await fs.mkdtemp(join(tmpdir(), 'kayan-move-')); });
  afterEach(async () => { jest.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); });
  it('publishes every copied file before deleting the source on EXDEV', async () => {
    const source = join(root, 'source'); const destination = join(root, 'previous');
    await fs.mkdir(join(source, 'nested'), { recursive: true });
    await fs.writeFile(join(source, 'nested/logo.png'), 'original-logo');
    const rename = fs.rename;
    jest.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (from === source) throw Object.assign(new Error('cross volume'), { code: 'EXDEV' });
      expect(await fs.readFile(join(source, 'nested/logo.png'), 'utf8')).toBe('original-logo');
      expect(await fs.readFile(join(String(from), 'nested/logo.png'), 'utf8')).toBe('original-logo');
      return rename(from, to);
    });
    await moveRestoreDirectory(source, destination);
    expect(await fs.readFile(join(destination, 'nested/logo.png'), 'utf8')).toBe('original-logo');
    await expect(fs.stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('keeps the original intact and never publishes a partial copy on failure', async () => {
    const source = join(root, 'source'); const destination = join(root, 'previous');
    await fs.mkdir(source); await fs.writeFile(join(source, 'logo.png'), 'original-logo');
    jest.spyOn(fs, 'rename').mockRejectedValueOnce(Object.assign(new Error('cross volume'), { code: 'EXDEV' }));
    jest.spyOn(fs, 'cp').mockImplementation(async (_from, to) => {
      await fs.mkdir(String(to)); await fs.writeFile(join(String(to), 'incomplete'), 'partial');
      throw Object.assign(new Error('full disk'), { code: 'ENOSPC' });
    });
    await expect(moveRestoreDirectory(source, destination)).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(await fs.readFile(join(source, 'logo.png'), 'utf8')).toBe('original-logo');
    await expect(fs.stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readdir(root)).toEqual(['source']);
  });
});
