import { randomUUID } from 'node:crypto';
import { cp, lstat, open, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function syncTree(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error('Restore directories must not contain symbolic links.');
  if (info.isDirectory()) {
    for (const name of await readdir(path)) await syncTree(join(path, name));
    await syncDirectory(path);
  } else if (info.isFile()) {
    const handle = await open(path, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
  } else throw new Error('Unexpected file type in restore directory.');
}

/** Publish a complete destination before removing the source. A plain rename
 * cannot move uploads between C: and a backup folder on D: (EXDEV on POSIX).
 * The temporary copy is never the journal's previousUploads path, so a crash
 * cannot make recovery mistake an incomplete copy for the original files.
 */
export async function moveRestoreDirectory(source: string, destination: string): Promise<void> {
  try {
    await rename(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    const temporary = `${destination}.copy-${randomUUID()}`;
    let published = false;
    try {
      await cp(source, temporary, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
      await syncTree(temporary);
      await rename(temporary, destination);
      published = true;
      await syncDirectory(dirname(destination));
      await rm(source, { recursive: true });
    } finally {
      if (!published) await rm(temporary, { recursive: true, force: true }).catch(() => {});
    }
  }
  await syncDirectory(dirname(destination));
  if (dirname(source) !== dirname(destination)) await syncDirectory(dirname(source));
}
