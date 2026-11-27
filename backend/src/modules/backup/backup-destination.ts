import { BadRequestException, Injectable } from '@nestjs/common';
import { copyFile, mkdir, readFile, rename, rm, stat, statfs, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';

import { PrismaService } from '../../common/prisma/prisma.service';
import { backupDirectory, uploadsDirectory } from './system/pg-support';
import { fileDigest } from './system/tar';

export interface DestinationCheck {
  path: string;
  freeBytes: number | null;
  /// True when the folder is on the same disk as the program's own backup
  /// folder: a copy there does not survive that disk failing.
  sameDiskAsProgram: boolean;
}

function inside(child: string, parent: string): boolean {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p + sep);
}

/**
 * Checks a folder an administrator chose for scheduled backup copies, before
 * it is saved: it must be an absolute path, outside the program's own folders,
 * creatable, and a test file must be written and read back. Nothing here
 * reveals the contents of any folder.
 */
export async function checkBackupDestination(rawPath: string): Promise<DestinationCheck> {
  const path = typeof rawPath === 'string' ? rawPath.trim() : '';
  if (path.length === 0 || path.length > 400 || path.includes('\0')) {
    throw new BadRequestException({ code: 'BACKUP_DEST_NOT_ABSOLUTE', message: 'Choose a full folder path.', field: 'path' });
  }
  if (!isAbsolute(path)) {
    throw new BadRequestException({ code: 'BACKUP_DEST_NOT_ABSOLUTE', message: 'Choose a full folder path.', field: 'path' });
  }
  const own = [backupDirectory(), uploadsDirectory(), process.cwd()];
  if (own.some((dir) => inside(path, dir) || inside(dir, path))) {
    throw new BadRequestException({ code: 'BACKUP_DEST_INSIDE_PROGRAM', message: 'That folder is inside, or contains, the program folders.', field: 'path' });
  }
  try {
    await mkdir(path, { recursive: true });
  } catch {
    throw new BadRequestException({ code: 'BACKUP_DEST_CANNOT_CREATE', message: 'The folder cannot be created or reached.', field: 'path' });
  }
  const probe = join(path, `.kayan-write-test-${randomBytes(6).toString('hex')}`);
  const token = randomBytes(16).toString('hex');
  try {
    await writeFile(probe, token, { flag: 'wx' });
    const back = await readFile(probe, 'utf8');
    if (back !== token) throw new Error('read-back differs');
  } catch {
    await unlink(probe).catch(() => undefined);
    throw new BadRequestException({ code: 'BACKUP_DEST_NOT_WRITABLE', message: 'The program cannot write to that folder.', field: 'path' });
  }
  await unlink(probe).catch(() => undefined);

  let freeBytes: number | null = null;
  try {
    const fs = await statfs(path);
    freeBytes = Number(fs.bavail) * Number(fs.bsize);
  } catch {
    freeBytes = null;
  }
  let sameDisk = false;
  try {
    const ours = await stat(backupDirectory()).catch(async () => stat(process.cwd()));
    const theirs = await stat(path);
    sameDisk = ours.dev === theirs.dev;
  } catch {
    sameDisk = false;
  }
  return { path, freeBytes, sameDiskAsProgram: sameDisk };
}

/// Copies a finished archive into the destination and proves the copy: written
/// under a temporary name, compared by size and SHA-256 with the source, and
/// only then given its real name. A failed copy leaves no half file behind.
export async function copyArchiveVerified(source: string, destinationDir: string, name: string): Promise<void> {
  const target = join(destinationDir, name);
  const partial = `${target}.partial`;
  try {
    await mkdir(destinationDir, { recursive: true });
    await copyFile(source, partial);
    const [a, b, sa, sb] = await Promise.all([fileDigest(source), fileDigest(partial), stat(source), stat(partial)]);
    if (sa.size !== sb.size || a.sha256 !== b.sha256 || a.bytes !== b.bytes) throw new Error('copy differs from source');
    await rename(partial, target);
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined);
    throw error;
  }
}

@Injectable()
export class BackupDestinationService {
  constructor(private readonly prisma: PrismaService) {}

  async get(companyId: string): Promise<{ path: string | null; startHour: number }> {
    const rows = await this.prisma.$queryRaw<Array<{ path: string | null; startHour: number }>>`
      SELECT "path", "startHour" FROM backup_destinations WHERE "companyId" = ${companyId}::uuid
    `;
    return { path: rows[0]?.path ?? null, startHour: rows[0]?.startHour ?? 2 };
  }

  /// Saves a checked folder (or clears it when `path` is null) and the hour of
  /// day from which a daily-or-longer schedule may run.
  async set(
    companyId: string,
    userId: string,
    input: { path?: string | null; startHour?: number },
  ): Promise<{ path: string | null; startHour: number; check: DestinationCheck | null }> {
    const current = await this.get(companyId);
    let path = current.path;
    let check: DestinationCheck | null = null;
    if (input.path !== undefined) {
      if (input.path === null || input.path.trim() === '') {
        path = null;
      } else {
        check = await checkBackupDestination(input.path);
        path = check.path;
      }
    }
    let startHour = current.startHour;
    if (input.startHour !== undefined) {
      if (!Number.isInteger(input.startHour) || input.startHour < 0 || input.startHour > 23) {
        throw new BadRequestException({ code: 'BACKUP_START_HOUR_INVALID', message: 'Choose an hour from 0 to 23.', field: 'startHour' });
      }
      startHour = input.startHour;
    }
    await this.prisma.$executeRaw`
      INSERT INTO backup_destinations ("companyId", "path", "startHour", "updatedBy")
      VALUES (${companyId}::uuid, ${path}, ${startHour}, ${userId}::uuid)
      ON CONFLICT ("companyId") DO UPDATE
        SET "path" = ${path}, "startHour" = ${startHour}, "updatedAt" = now(), "updatedBy" = ${userId}::uuid
    `;
    return { path, startHour, check };
  }
}
