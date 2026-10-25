import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { execFile } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import {
  mkdir,
  open,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from 'fs/promises';
import { join, resolve, sep } from 'path';

import { AuditService } from '../../common/audit/audit.service';
import { MaintenanceService } from '../../common/maintenance/maintenance';
import { PrismaService } from '../../common/prisma/prisma.service';
import { reconcileRestoredAccess } from './restore-access';

/**
 * Full-database backup and restore, on the server that hosts PostgreSQL.
 *
 * The company-level JSON backup (see backup.service.ts) moves one company's
 * books between installations. This one is different in kind: it takes the
 * whole database — every company, every user, every role, every index — the
 * way `pg_dump` does it, so a machine that dies can be brought back exactly
 * as it was.
 *
 * The tools are the ones PostgreSQL itself ships: `pg_dump` writes a Custom
 * archive (-Fc), `pg_restore` puts one back. Neither is assumed to exist —
 * the screen asks what this machine can do and only offers the buttons that
 * work. Where the tools are missing the reason is shown, not hidden.
 *
 * Restoring is deliberately paranoid:
 *
 *  1. the file is checked before anything else (magic bytes, then a real
 *     `pg_restore --list` so a truncated or foreign archive is refused before
 *     it is allowed near the database);
 *  2. it is restored into a scratch database first — a restore that cannot
 *     complete never touches production;
 *  3. the current database is dumped to a safety file; if that fails, the
 *     restore stops right there;
 *  4. only then is the real restore run, with writes blocked for its duration;
 *  5. afterwards the data is checked; a failed check triggers an automatic
 *     restore from the safety file, and failing that the program stays in
 *     maintenance mode and says so plainly.
 */

/// `PGDMP` — the first five bytes of every Custom-format archive.
const CUSTOM_MAGIC = Buffer.from('PGDMP', 'latin1');

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.dump$/;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

/// How long a "the tools are not here" answer is remembered. Tools can be
/// installed or provisioned while the program is running, so a negative
/// answer is re-checked after this long instead of sticking for the lifetime
/// of the process.
const TOOL_CACHE_TTL_MS = 60_000;

export interface FullBackupFile {
  name: string;
  sizeBytes: number;
  createdAt: string;
  kind: 'full' | 'safety';
}

export interface RestoreOptions {
  /// The uploaded file, when the user picked one from their machine.
  uploaded?: { buffer: Buffer; originalName: string };
  /// Or a file already sitting in the backup folder on the server.
  fileName?: string;
  confirm: boolean;
}

export interface BackupVerification {
  name: string;
  sizeBytes: number;
  /// How many objects `pg_restore --list` found inside the archive. Zero
  /// means the archive is empty, which is never a usable backup.
  entries: number;
  verifiedAt: string;
  tool: string;
}

@Injectable()
export class FullBackupService {
  private readonly logger = new Logger(FullBackupService.name);

  /// Tool paths are found once and remembered: the search walks the disk.
  private toolsCache:
    | { pgDump: string | null; pgRestore: string | null; at: number }
    | null = null;

  /// Whether this installation may open a scratch database to rehearse a
  /// restore in. Learned the first time a restore runs, and reported by
  /// `capabilities()` so the screen can say which protection is in place.
  private canCreateDatabase = true;
  private lastCreateDatabaseFailure: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly maintenance: MaintenanceService,
  ) {}

  /// ────────────────────────────────────────────────────────────── tools

  /**
   * What this machine can actually do, so the screen only offers buttons that
   * work and can explain the ones it hides.
   */
  async capabilities() {
    const tools = this.findTools();
    const available = Boolean(tools.pgDump && tools.pgRestore);

    let version: string | null = null;
    if (tools.pgDump) {
      version = await runCapture(tools.pgDump, ['--version'], 10_000).catch(
        () => null,
      );
    }

    // A pg_dump older than the server cannot dump it reliably. The numbers
    // are compared so the screen can say so before a backup is attempted,
    // instead of failing halfway through one.
    const serverVersion = await this.serverVersion();
    const toolMajor = majorOf(version);
    const serverMajor = majorOf(serverVersion);
    const warning =
      toolMajor !== null && serverMajor !== null && toolMajor < serverMajor
        ? `pg_dump is version ${toolMajor} but the database server is ` +
          `version ${serverMajor}. Backups need pg_dump from PostgreSQL ` +
          `${serverMajor} or newer.`
        : null;

    return {
      available,
      pgDump: tools.pgDump,
      pgRestore: tools.pgRestore,
      version: version?.trim() ?? null,
      serverVersion,
      warning,
      backupDirectory: this.backupDir(),
      // Whether this installation may open a scratch database. Without it a
      // restore can still be checked with `pg_restore --list`, but it cannot
      // be rehearsed first, and the screen says which of the two it is.
      canRehearseRestore: this.canCreateDatabase,
      rehearsalNote: this.canCreateDatabase
        ? null
        : `A restore could not be rehearsed in a scratch database (${
            this.lastCreateDatabaseFailure ?? 'the server refused'
          }). Uploads are still checked with pg_restore --list and a safety ` +
          'copy is taken first.',
      reason: available
        ? null
        : 'PostgreSQL command-line tools (pg_dump / pg_restore) were not found ' +
          'on this machine. The program folder carries its own copy under ' +
          'backend\\pg; reinstall the program, or set KAYAN_PG_DUMP and ' +
          'KAYAN_PG_RESTORE to the tools of the PostgreSQL this database uses.',
    };
  }

  private async serverVersion(): Promise<string | null> {
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ v: string }>
      >`SELECT current_setting('server_version') AS v`;
      return rows[0]?.v ?? null;
    } catch {
      return null;
    }
  }

  private findTools(): { pgDump: string | null; pgRestore: string | null } {
    const now = Date.now();
    // Remembered for a minute, not for the life of the process: on a machine
    // where the tools are installed or provisioned while the program is open,
    // the buttons start working by themselves.
    if (this.toolsCache && now - this.toolsCache.at < TOOL_CACHE_TTL_MS) {
      return this.toolsCache;
    }

    const lookup = (name: string, envVar: string): string | null => {
      // An explicit choice wins over any guess.
      const chosen = process.env[envVar]?.trim();
      if (chosen && existsSync(chosen)) return chosen;

      // The program's own copy, shipped inside the package under backend\pg
      // (the build script puts it there), then the portable PostgreSQL the
      // project's installer provisions, then anything on PATH, then a system
      // PostgreSQL install. Newest candidates come first on purpose: pg_dump
      // from a newer PostgreSQL reads older servers, the reverse is not true.
      for (const folder of this.bundledToolDirs()) {
        const candidate = join(
          folder,
          name + (process.platform === 'win32' ? '.exe' : ''),
        );
        if (existsSync(candidate)) return candidate;
      }

      const onPath = which(name);
      if (onPath) return onPath;

      // Where a Windows or macOS PostgreSQL installer puts them. The version
      // folders are read from the disk rather than guessed.
      for (const folder of this.platformToolDirs()) {
        const candidate = join(
          folder,
          name + (process.platform === 'win32' ? '.exe' : ''),
        );
        if (existsSync(candidate)) return candidate;
      }
      return null;
    };

    this.toolsCache = {
      pgDump: lookup('pg_dump', 'KAYAN_PG_DUMP'),
      pgRestore: lookup('pg_restore', 'KAYAN_PG_RESTORE'),
      at: now,
    };
    return this.toolsCache;
  }

  /// Forgets what was found, so the next question looks at the disk again.
  /// Used after the program provisions its own copy of the tools.
  forgetTools(): void {
    this.toolsCache = null;
  }

  /// Folders the program itself owns: the copy that travels inside the
  /// package, and the portable PostgreSQL that scripts/
  /// install-postgres-portable.bat provisions beside it.
  private bundledToolDirs(): string[] {
    const dirs: string[] = [];
    // Current Windows installer layout (backend/postgres/bin) must win
    // over legacy portable locations and unrelated PostgreSQL on PATH.
    dirs.push(join(process.cwd(), 'postgres', 'bin'));
    dirs.push(join(process.cwd(), 'backend', 'postgres', 'bin'));
    dirs.push(join(__dirname, '..', '..', '..', '..', 'postgres', 'bin'));
    // backend\pg — next to the running server, however it was started.
    dirs.push(join(process.cwd(), 'pg', 'bin'));
    dirs.push(join(process.cwd(), 'pg'));
    dirs.push(join(process.cwd(), 'backend', 'pg', 'bin'));
    dirs.push(join(process.cwd(), 'backend', 'pg'));
    // From dist/src/modules/backup (packaged) and src/modules/backup (source):
    // both resolve to the backend root, which is where pg\ lives.
    dirs.push(join(__dirname, '..', '..', '..', '..', 'pg', 'bin'));
    dirs.push(join(__dirname, '..', '..', '..', '..', 'pg'));
    dirs.push(join(__dirname, '..', '..', '..', 'pg'));
    if (process.platform === 'win32') {
      const localAppData =
        process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
      dirs.push(join(localAppData, 'kayan-tools', 'pgsql', 'bin'));
      // Production PostgreSQL lives under ProgramData so standard Windows
      // users can run the backup/restore screens without a separate install.
      const programData = process.env.ProgramData ?? process.env.PROGRAMDATA;
      if (programData) {
        dirs.push(join(programData, 'KAYAN-ERP', 'pgsql', 'bin'));
      }
    }
    return dirs;
  }

  private platformToolDirs(): string[] {
    const dirs: string[] = [];
    if (process.platform === 'win32') {
      for (const root of [
        'C:\\Program Files\\PostgreSQL',
        'C:\\Program Files (x86)\\PostgreSQL',
      ]) {
        if (!existsSync(root)) continue;
        try {
          for (const entry of readdirSync(root)) {
            dirs.push(join(root, entry, 'bin'));
          }
        } catch {
          /* unreadable folder: simply not a candidate */
        }
      }
    } else if (process.platform === 'darwin') {
      dirs.push(
        '/Applications/Postgres.app/Contents/Versions/latest/bin',
        '/Library/PostgreSQL/16/bin',
        '/Library/PostgreSQL/15/bin',
        '/opt/homebrew/opt/postgresql@16/bin',
        '/usr/local/opt/postgresql@16/bin',
      );
    } else {
      dirs.push(
        '/usr/lib/postgresql/16/bin',
        '/usr/lib/postgresql/15/bin',
        '/usr/lib/postgresql/14/bin',
        '/usr/bin',
      );
    }
    return dirs;
  }

  /// ──────────────────────────────────────────────────────────── backups

  /**
   * Takes a full backup. The file is written to the backup directory and
   * checked before anyone is told it worked: a truncated dump that "succeeded"
   * is worse than no dump at all.
   */
  async createFull(
    userId: string | null,
  ): Promise<{ file: FullBackupFile; durationMs: number }> {
    return this.dump('full', userId);
  }

  /// The automatic safety copy taken just before a restore replaces anything.
  async createSafety(): Promise<FullBackupFile> {
    return (await this.dump('safety', null)).file;
  }

  private async dump(
    kind: 'full' | 'safety',
    userId: string | null,
  ): Promise<{ file: FullBackupFile; durationMs: number }> {
    const tools = this.requireTools();
    const dir = await this.ensureBackupDir();
    const database = this.requireDatabase();
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const name = `kayan-${kind}-${stamp}.dump`;
    const path = join(dir, name);

    const started = Date.now();
    try {
      await run(tools.pgDump as string, [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        // Never prompt: a service has no console to answer on, and a tool
        // waiting for a password looks exactly like a backup that hangs
        // forever. Failing fast with the real reason beats both.
        '--no-password',
        `--file=${path}`,
        // The database itself comes from the environment, never from a
        // parameter a caller could point at someone else's books.
        ...this.connectionArgs(),
      ]);
    } catch (error) {
      await unlink(path).catch(() => {});
      // The command line is not logged: it carries the database name, and the
      // password travels in the child's environment. Only what pg_dump itself
      // said, and the shape of the command, reach the log.
      this.logger.error(
        `pg_dump of database "${database}" failed: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'The backup could not be created. The database tools on this machine ' +
          'reported a problem; the details are in the server log. ' +
          'Nothing was changed.',
      );
    }

    const file = await this.validateAndDescribe(path, name, kind);

    if (userId) {
      await this.audit.record({
        action: 'BACKUP',
        entity: 'backup_full',
        entityId: name,
        after: { name, sizeBytes: file.sizeBytes, kind },
        userId,
      });
    }

    return { file, durationMs: Date.now() - started };
  }

  async list(): Promise<FullBackupFile[]> {
    const files: FullBackupFile[] = [];
    const seen = new Set<string>();
    for (const dir of this.backupDirs()) {
      if (!existsSync(dir)) continue;

      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch (error) {
        // A folder the program cannot read is a machine problem with a name.
        throw new ServiceUnavailableException(
          `The backup folder "${dir}" could not be read ` +
            `(${(error as Error).message}).`,
        );
      }

      for (const name of entries) {
        if (!name.endsWith('.dump') || seen.has(name)) continue;
        seen.add(name);
        const path = join(dir, name);
        try {
          const info = await stat(path);
          if (!info.isFile()) continue;
          files.push({
            name,
            sizeBytes: info.size,
            createdAt: info.mtime.toISOString(),
            kind: name.includes('-safety-') ? 'safety' : 'full',
          });
        } catch {
          /* vanished between listing and stat: skip */
        }
      }
    }
    return files.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async read(name: string): Promise<{ data: Buffer; name: string }> {
    const path = this.safePath(name);
    if (!existsSync(path)) {
      throw new NotFoundException(`No backup file named "${name}" on this server`);
    }
    try {
      return { data: await readFile(path), name };
    } catch (error) {
      throw new ServiceUnavailableException(
        `The backup file "${name}" could not be read ` +
          `(${(error as Error).message}). The database was not changed.`,
      );
    }
  }

  /**
   * Reads a backup back and proves it is a usable archive, not merely a file
   * with the right first five bytes: `pg_restore --list` walks the whole
   * table of contents, so a truncated or foreign file is caught here rather
   * than halfway through a restore.
   *
   * Used before a destructive reset, where "the backup exists" is not good
   * enough — it has to be a backup that can be put back.
   */
  async verify(name: string): Promise<BackupVerification> {
    const tools = this.requireTools();
    const path = this.safePath(name);
    const info = await stat(path).catch(() => null);
    if (!info || !info.isFile() || info.size === 0) {
      throw new NotFoundException(
        `The backup file "${name}" is not on this server, or it is empty.`,
      );
    }

    const head = Buffer.alloc(5);
    let handle;
    try {
      handle = await open(path, 'r');
      await handle.read(head, 0, 5, 0);
    } catch (error) {
      throw new ServiceUnavailableException(
        `The backup file "${name}" could not be read back for checking ` +
          `(${(error as Error).message}). Nothing was changed.`,
      );
    } finally {
      await handle?.close();
    }
    if (!head.equals(CUSTOM_MAGIC)) {
      throw new ServiceUnavailableException(
        `The backup file "${name}" is not a PostgreSQL archive. ` +
          'Nothing was changed.',
      );
    }

    let listing: string;
    try {
      listing = await runCapture(
        tools.pgRestore as string,
        ['--list', path],
        120_000,
      );
    } catch (error) {
      throw new ServiceUnavailableException(
        `The backup file "${name}" could not be read by pg_restore ` +
          `(${(error as Error).message}). It may be damaged, or written by a ` +
          'newer PostgreSQL than this machine has. Nothing was changed.',
      );
    }

    // One line per object in the archive, plus a handful of comment lines a
    // reader can skip. Comments are counted out so an empty archive cannot
    // pass as a real one.
    const entries = listing
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith(';')).length;

    if (entries === 0) {
      throw new ServiceUnavailableException(
        `The backup file "${name}" holds no database objects. ` +
          'Nothing was changed.',
      );
    }

    return {
      name,
      sizeBytes: info.size,
      entries,
      verifiedAt: new Date().toISOString(),
      tool: tools.pgRestore as string,
    };
  }

  /// The same check, for bytes that were uploaded rather than read from disk.
  private async verifyUploaded(
    buffer: Buffer,
    label: string,
    pgRestore: string,
    stagingPath: string,
  ): Promise<number> {
    let listing: string;
    try {
      listing = await runCapture(pgRestore, ['--list', stagingPath], 120_000);
    } catch (error) {
      throw new BadRequestException(
        `The file "${label}" is not a PostgreSQL archive pg_restore can read ` +
          `(${(error as Error).message}). It may be damaged, or made by a ` +
          'different PostgreSQL version. The current data was not touched.',
      );
    }
    const entries = listing
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith(';')).length;
    if (entries === 0) {
      throw new BadRequestException(
        `The file "${label}" holds no database objects, so it cannot be ` +
          'restored. The current data was not touched.',
      );
    }
    return entries;
  }

  async remove(name: string, userId: string | null): Promise<void> {
    const path = this.safePath(name);
    if (!existsSync(path)) {
      throw new NotFoundException(`No backup file named "${name}" on this server`);
    }
    try {
      await unlink(path);
    } catch (error) {
      throw new ServiceUnavailableException(
        `The backup file "${name}" could not be deleted ` +
          `(${(error as Error).message}). Nothing else was changed.`,
      );
    }
    await this.audit.record({
      action: 'DELETE',
      entity: 'backup_full',
      entityId: name,
      before: { name },
      userId,
    });
  }

  /// ───────────────────────────────────────────────────────────── restore

  /**
   * Puts a full backup back. Read the class comment for the dance this does
   * before production data is touched — every step of it is deliberate.
   */
  async restore(options: RestoreOptions, userId: string) {
    if (!options.confirm) {
      throw new BadRequestException(
        'A full restore replaces the whole database. Send confirm=true to say ' +
          'you understand that.',
      );
    }

    // Two restores at once would each take a safety copy of the other's
    // half-written database. The switch is the same one that blocks writes
    // for the duration, so it is already the right question to ask.
    if (this.maintenance.isActive) {
      throw new ServiceUnavailableException(
        'A restore is already running. Wait for it to finish before starting ' +
          'another one.',
      );
    }

    // 1. The file itself, before anything else happens.
    let buffer: Buffer;
    let label: string;
    if (options.uploaded?.buffer?.length) {
      buffer = options.uploaded.buffer;
      label = options.uploaded.originalName || 'uploaded file';
    } else if (options.fileName) {
      const read = await this.read(options.fileName);
      buffer = read.data;
      label = read.name;
    } else {
      throw new BadRequestException(
        'Choose a backup file to restore: either upload one or name one on this server.',
      );
    }
    this.assertCustomDump(buffer, label);

    // Only now are the tools needed — a bad request is a bad request even on
    // a machine without PostgreSQL tools.
    const tools = this.requireTools();

    const dir = await this.ensureBackupDir();
    const staging = join(dir, `.restore-staging-${Date.now()}.dump`);
    try {
      await writeFile(staging, buffer);
    } catch (error) {
      throw new ServiceUnavailableException(
        `The upload could not be written to "${dir}" ` +
          `(${(error as Error).message}). Set KAYAN_BACKUP_DIR to a folder ` +
          'this program may write to, then try again.',
      );
    }

    try {
      // 1b. Read the archive's table of contents. This is what catches a
      //     truncated download or a file from a foreign database before any
      //     database is involved at all.
      const entries = await this.verifyUploaded(
        buffer,
        label,
        tools.pgRestore as string,
        staging,
      );
      this.logger.log(`Backup "${label}" lists ${entries} objects`);

      // 2. A scratch database: the file must restore cleanly somewhere before
      //    it is allowed to restore here. Where the installation is not
      //    allowed to create one (a locked-down hosted database), the
      //    `--list` check above plus the safety copy below are the protection,
      //    and the reason is recorded rather than silently swallowed.
      const scratchName = `kayan_restore_check_${Date.now()}`;
      let rehearsed = false;
      try {
        await this.execSql(`CREATE DATABASE "${scratchName}"`);
        this.canCreateDatabase = true;
      } catch (error) {
        this.canCreateDatabase = false;
        this.lastCreateDatabaseFailure = String(
          (error as Error).message ?? error,
        );
        this.logger.warn(
          'A restore could not be rehearsed in a scratch database: ' +
            `${this.lastCreateDatabaseFailure}. Continuing: the archive was ` +
            'checked with pg_restore --list and a safety copy is taken next.',
        );
      }

      if (this.canCreateDatabase) {
        this.logger.log(`Restoring into scratch database ${scratchName} first`);
        try {
          await run(tools.pgRestore as string, [
            '--exit-on-error',
            '--no-owner',
            '--no-privileges',
            '--no-password',
            `--dbname=${scratchName}`,
            staging,
          ]);
          rehearsed = true;
        } catch (error) {
          throw new BadRequestException(
            'This file did not restore cleanly into a test database, so the ' +
              'current data was not touched. It may be damaged, or made by a ' +
              'different PostgreSQL version. Details: ' +
              String((error as Error).message ?? error).slice(0, 300),
          );
        } finally {
          // The scratch database has done its job; drop it on the way out.
          await this.execSql(`DROP DATABASE IF EXISTS "${scratchName}"`).catch(
            () => {},
          );
        }
      }

      // 3. The safety net. No safety copy, no restore.
      const safety = await this.createSafety();
      this.logger.log(`Safety backup taken: ${safety.name}`);

      // 4. The real thing, with writes blocked.
      this.maintenance.begin(
        `Restoring database from ${label}. The system will be back shortly.`,
      );
      let restored = false;
      try {
        await this.cleanDatabaseSchema();
        await run(tools.pgRestore as string, [
          '--exit-on-error',
          '--no-owner',
          '--no-privileges',
          '--no-password',
          ...this.connectionArgs(),
          staging,
        ]);
        restored = true;
      } catch (error) {
        this.logger.error(`pg_restore failed: ${(error as Error).message}`);
        // The database may be half-replaced. Put the safety copy back.
        await this.recoverFrom(safety.name, tools.pgRestore as string);
        throw new ServiceUnavailableException(
          'The restore failed part way through. The safety backup taken just ' +
            `before (${safety.name}) was restored back automatically. ` +
            `Details: ${String((error as Error).message ?? error).slice(0, 300)}`,
        );
      }

      // 5. Does the database answer like a database?
      if (restored) {
        const check = await this.postRestoreCheck();
        if (!check.ok) {
          this.logger.error(`Post-restore check failed: ${check.detail}`);
          await this.recoverFrom(safety.name, tools.pgRestore as string);
          throw new ServiceUnavailableException(
            'The restore finished but the data did not pass the checks that ' +
              'follow one. The safety backup was restored back automatically. ' +
              `Details: ${check.detail}`,
          );
        }
      }

      // 6. The archive is a snapshot of the program that wrote it. Bring
      // its access rows up to this version's policy — system-role grants
      // topped up, and a super administrator guaranteed per company — or
      // the installation-level screens (program reset, this very backup
      // screen) stay locked after an otherwise perfect restore. A repair
      // failure must not un-report a restore whose data already passed
      // its checks, so it is logged and written into the audit record
      // instead of failing the request.
      let accessRepair: unknown = null;
      try {
        accessRepair = await this.reconcileRestoredCompanies();
      } catch (repairError) {
        this.logger.error(
          `Post-restore access repair failed: ${(repairError as Error).message}`,
        );
        accessRepair = { error: String((repairError as Error).message ?? repairError) };
      }

      await this.audit.record({
        action: 'RESTORE',
        entity: 'backup_full',
        entityId: label,
        after: {
          source: label,
          safetyBackup: safety.name,
          rehearsedInScratchDatabase: rehearsed,
          postRestoreCheck: 'passed',
          accessReconciled: accessRepair,
        },
        userId,
      });

      return {
        restored: true,
        source: label,
        safetyBackup: safety.name,
        checked: true,
        rehearsed,
      };
    } finally {
      await unlink(staging).catch(() => {});
      this.maintenance.end();
    }
  }

  /**
   * Runs the shared post-restore access repair for every company the
   * archive brought back (a full archive can hold more than one).
   */
  private async reconcileRestoredCompanies(): Promise<{
    companies: number;
    grantsAdded: number;
    superAdminPromoted: string[];
  }> {
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    let grantsAdded = 0;
    const superAdminPromoted: string[] = [];
    for (const company of companies) {
      const repaired = await this.prisma.$transaction((tx) =>
        reconcileRestoredAccess(tx, company.id),
      );
      grantsAdded += repaired.grantsAdded;
      if (repaired.superAdminPromoted) {
        superAdminPromoted.push(repaired.superAdminPromoted);
      }
    }
    return { companies: companies.length, grantsAdded, superAdminPromoted };
  }

  /**
   * Puts the safety copy back after a failed restore. If this also fails, the
   * program stays in maintenance mode — a database nobody can trust must not
   * pretend to be open for business.
   */
  private async recoverFrom(name: string, pgRestore: string): Promise<void> {
    this.logger.warn(`Recovering from safety backup ${name}`);
    try {
      const path = this.safePath(name);
      await this.cleanDatabaseSchema();
      await run(pgRestore, [
        '--exit-on-error',
        '--no-owner',
        '--no-privileges',
        '--no-password',
        ...this.connectionArgs(),
        path,
      ]);
      const check = await this.postRestoreCheck();
      if (!check.ok) throw new Error(check.detail);
      this.maintenance.end();
    } catch (error) {
      this.maintenance.begin(
        'ATTENTION: a database restore failed and the automatic recovery ' +
          `from ${name} also failed. Do not enter data. ` +
          'Restore manually from the backup files in the backup folder.',
      );
      this.logger.error(
        `Recovery from ${name} failed: ${(error as Error).message}`,
      );
    }
  }

  /**
   * The checks that decide whether a restored database is a working one:
   * the core tables exist, the company rows are readable, and the journal
   * still balances the way double-entry requires.
   */
  private async postRestoreCheck(): Promise<{ ok: boolean; detail: string }> {
    try {
      // The restore swapped table contents under the connection; reconnect so
      // nothing stale is carried into the checks.
      await this.prisma.$disconnect();
      await this.prisma.$connect();

      const companies = await this.prisma.company.count();
      const accounts = await this.prisma.account.count();
      const users = await this.prisma.user.count();

      const imbalance = await this.prisma.$queryRaw<
        Array<{ entry_id: string }>
      >`
        SELECT e.id AS entry_id
        FROM journal_entries e
        JOIN journal_lines l ON l."journalEntryId" = e.id
        GROUP BY e.id, e."totalDebit", e."totalCredit"
        HAVING ROUND(SUM(l.debit), 4) <> ROUND(e."totalDebit", 4)
           OR ROUND(SUM(l.credit), 4) <> ROUND(e."totalCredit", 4)
        LIMIT 5`;

      if (imbalance.length > 0) {
        return {
          ok: false,
          detail: `${imbalance.length} journal entries do not match their line totals`,
        };
      }

      return {
        ok: true,
        detail: `${companies} companies, ${accounts} accounts, ${users} users`,
      };
    } catch (error) {
      return {
        ok: false,
        detail: `the database did not answer the checks: ${
          (error as Error).message
        }`,
      };
    }
  }

  /// ───────────────────────────────────────────────────────────── helpers

  private requireTools(): { pgDump: string | null; pgRestore: string | null } {
    const tools = this.findTools();
    if (!tools.pgDump || !tools.pgRestore) {
      throw new ServiceUnavailableException(
        'This machine has no PostgreSQL backup tools (pg_dump / pg_restore), ' +
          'so full backups cannot be taken or restored here. ' +
          'Install the PostgreSQL client tools and try again.',
      );
    }
    return tools;
  }

  /**
   * The database address, read once and checked.
   *
   * A missing or unreadable `DATABASE_URL` used to surface as a `TypeError`
   * from `new URL(...)`, which the error filter could only report as
   * "Unexpected server error" — the single least helpful thing a backup
   * button can say. It is asked here, where the answer can name the problem.
   */
  private requireDatabase(): string {
    const raw = process.env.DATABASE_URL?.trim();
    if (!raw) {
      throw new ServiceUnavailableException(
        'This server has no DATABASE_URL, so it does not know which database ' +
          'to back up. Set DATABASE_URL and restart the server.',
      );
    }
    try {
      const url = new URL(raw);
      const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
      if (!name) {
        throw new Error('the address names no database');
      }
      return name;
    } catch (error) {
      throw new ServiceUnavailableException(
        `The DATABASE_URL this server was started with cannot be read ` +
          `(${(error as Error).message}). Fix it and restart the server. ` +
          'Nothing was changed.',
      );
    }
  }

  public backupDir(): string {
    const chosen = process.env.KAYAN_BACKUP_DIR?.trim();
    if (chosen) return chosen;
    // On Windows the working directory of the installed backend is either
    // the service's System32 or the program folder under Program Files —
    // neither is a place a backup can reliably be written or found again.
    // The installer's own data root under ProgramData (the same root that
    // holds the bundled PostgreSQL) is writable by the service account and
    // survives reinstalling the program.
    if (process.platform === 'win32') {
      const programData = process.env.ProgramData ?? process.env.PROGRAMDATA;
      if (programData) return join(programData, 'KAYAN-ERP', 'backups');
    }
    return join(process.cwd(), 'backups');
  }

  /// Every folder a backup may legitimately sit in: the current one first,
  /// then the legacy working-directory folder older builds wrote to, so a
  /// backup taken before this change stays listed, downloadable and
  /// restorable instead of vanishing from the screen.
  private backupDirs(): string[] {
    const dirs = [this.backupDir()];
    const legacy = join(process.cwd(), 'backups');
    if (resolve(legacy) !== resolve(dirs[0])) dirs.push(legacy);
    return dirs;
  }

  public async ensureBackupDir(): Promise<string> {
    const dir = this.backupDir();
    try {
      await mkdir(dir, { recursive: true });
    } catch (error) {
      // A folder the program cannot create (a read-only install directory,
      // a missing drive, a permission) is a machine problem with an obvious
      // fix worth naming - not a mystery "unexpected server error".
      this.logger.error(
        `Could not create the backup folder ${dir}: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        `Backups cannot be written to "${dir}" on this machine ` +
          `(${(error as Error).message}). Set KAYAN_BACKUP_DIR to a folder ` +
          'this program may write to, then try again.',
      );
    }
    return dir;
  }

  /// A backup name can only be a simple file name inside a backup folder.
  /// Anything with a path separator in it is refused before it is joined.
  /// The first folder that actually holds the file wins, so backups written
  /// by older builds into the working directory remain reachable.
  private safePath(name: string): string {
    if (!NAME_PATTERN.test(name)) {
      throw new BadRequestException(
        'That is not a backup file name. Choose one from the list.',
      );
    }
    for (const folder of this.backupDirs()) {
      const dir = resolve(folder);
      const path = resolve(dir, name);
      if (!path.startsWith(dir + sep)) {
        throw new BadRequestException('That file is outside the backup folder.');
      }
      if (existsSync(path)) return path;
    }
    // Nothing found: answer with the primary folder so callers report the
    // file as missing from the place new backups are written to.
    return resolve(this.backupDir(), name);
  }

  private async validateAndDescribe(
    path: string,
    name: string,
    kind: 'full' | 'safety',
  ): Promise<FullBackupFile> {
    const info = await stat(path).catch(() => null);
    if (!info || info.size === 0) {
      throw new ServiceUnavailableException(
        'The backup tool produced no file. The database was not changed.',
      );
    }
    const head = Buffer.alloc(5);
    let handle;
    try {
      handle = await open(path, 'r');
      await handle.read(head, 0, 5, 0);
    } catch (error) {
      throw new ServiceUnavailableException(
        `The backup file "${name}" could not be read back for checking ` +
          `(${(error as Error).message}). The database was not changed.`,
      );
    } finally {
      await handle?.close();
    }
    if (!head.equals(CUSTOM_MAGIC)) {
      await unlink(path).catch(() => {});
      throw new ServiceUnavailableException(
        'The backup tool produced a file that is not a PostgreSQL archive. ' +
          'The file was discarded; the database was not changed.',
      );
    }
    return {
      name,
      sizeBytes: info.size,
      createdAt: info.mtime.toISOString(),
      kind,
    };
  }

  private assertCustomDump(buffer: Buffer, label: string): void {
    if (buffer.length === 0) {
      throw new BadRequestException('The backup file is empty.');
    }
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('The backup file is larger than 2 GB.');
    }
    const isJson = buffer[0] === 0x7b /* '{' */ || label.toLowerCase().endsWith('.json');
    if (isJson) {
      throw new BadRequestException(
        `الملف "${label}" هو ملف نسخة احتياطية لبيانات الشركة بصيغة JSON، وليس ملف أرشيف PostgreSQL (.dump). ` +
          'لاستعادة ملف JSON، يرجى استخدام قسم "استعادة بيانات الشركة" (/api/v1/backup/restore).',
      );
    }
    if (!buffer.subarray(0, 5).equals(CUSTOM_MAGIC)) {
      throw new BadRequestException(
        `الملف "${label}" ليس ملف أرشيف PostgreSQL صالحاً بصيغة Custom Format (.dump). ` +
          'يرجى اختيار ملف .dump صالح تم إنشاؤه عبر pg_dump.',
      );
    }
  }

  /**
   * The connection for the command-line tools, as environment variables.
   * The password travels in the child's environment, never in its command
   * line where every user of the machine could read it.
   */
  private connectionArgs(databaseOverride?: string): string[] {
    if (databaseOverride) {
      return [`--dbname=${cleanDatabaseUrl(databaseOverride)}`];
    }
    return [`--dbname=${cleanDatabaseUrl(this.requireDatabase())}`];
  }

  private async execSql(sql: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(sql);
  }

  private async cleanDatabaseSchema(): Promise<void> {
    try {
      await this.execSql('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    } catch (error) {
      this.logger.warn(
        `Could not drop public schema with CASCADE: ${(error as Error).message}`,
      );
    }
  }
}

function cleanDatabaseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.searchParams.delete('schema');
    return url.toString();
  } catch {
    return raw.replace(/([?&])schema=[^&]*/, '$1').replace(/[?&]$/, '');
  }
}

/// Environment for a child process that speaks to the same PostgreSQL the
/// program uses. Kept out of the command line on purpose.
function connectionEnv(): NodeJS.ProcessEnv {
  const raw = process.env.DATABASE_URL;
  if (!raw) return {};
  try {
    const url = new URL(raw);
    return {
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')).split('?')[0],
    };
  } catch {
    return {};
  }
}

/// Runs a command and resolves when it exits cleanly; rejects with the tool's
/// own words when it does not. The password is never part of those words.
function run(command: string, args: string[], timeout = 600_000): Promise<string> {
  return runCapture(command, args, timeout);
}

function runCapture(
  command: string,
  args: string[],
  timeout: number,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      command,
      args,
      {
        timeout,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, ...connectionEnv() },
      },
      (error, stdout, stderr) => {
        if (error) {
          const killed = (error as { killed?: boolean }).killed;
          const message = killed
            ? `the command was still running after ${timeout} ms`
            : String(stderr || (error as Error).message).slice(0, 2000);
          reject(new Error(message));
          return;
        }
        resolvePromise(String(stdout ?? ''));
      },
    );
  });
}

/// The leading version number of a "pg_dump (PostgreSQL) 17.7" line or of a
/// "17.7" server version string.
function majorOf(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = /(\d{1,2})\.?\d*/.exec(text);
  return match ? Number(match[1]) : null;
}

/// The PATH lookup, without pulling in a dependency for one function.
function which(name: string): string | null {
  const paths = (process.env.PATH ?? '').split(
    process.platform === 'win32' ? ';' : ':',
  );
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const folder of paths) {
    if (!folder) continue;
    for (const extension of extensions) {
      const candidate = join(folder, name + extension);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}
