import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, open, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Client } from 'pg';

import { sanitiseLicence, type SanitisedLicence } from './manifest';

/**
 * Everything the complete backup and restore need from PostgreSQL and from
 * the machine: finding the tools, running them, opening a scratch database,
 * holding a lock, and reading the licence file without ever exposing a key.
 *
 * Kept in one place so the backup and the restore cannot drift apart: if one
 * of them can dump, the other can restore the same file, because both come
 * from these functions.
 */

export const CUSTOM_MAGIC = Buffer.from('PGDMP', 'latin1');
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const TOOL_CACHE_TTL_MS = 60_000;

export interface PgTools {
  pgDump: string | null;
  pgRestore: string | null;
  version: string | null;
}

export interface PgCommandResult {
  stdout: string;
}

/// The child-process environment that speaks to the same PostgreSQL the
/// program uses. The password travels here, never on a command line where
/// every user of the machine could read it.
export function connectionEnv(raw = process.env.DATABASE_URL): NodeJS.ProcessEnv {
  if (!raw) return {};
  try {
    const url = new URL(raw);
    return {
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')).split('?')[0],
      PGSSLMODE: url.searchParams.get('sslmode') ?? undefined,
    } as NodeJS.ProcessEnv;
  } catch {
    return {};
  }
}

/// The URL without Prisma's `schema` parameter, which the command-line tools
/// do not understand.
export function cleanDatabaseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.searchParams.delete('schema');
    return url.toString();
  } catch {
    return raw.replace(/([?&])schema=[^&]*/, '$1').replace(/[?&]$/, '');
  }
}

export function databaseNameFrom(raw: string | undefined = process.env.DATABASE_URL): string {
  if (!raw) {
    throw new Error(
      'This server has no DATABASE_URL, so it does not know which database to back up.',
    );
  }
  const url = new URL(raw);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!name) throw new Error('The DATABASE_URL this server was started with names no database.');
  return name;
}

/// The same URL pointed at another database on the same server.
export function databaseUrlFor(name: string, raw = process.env.DATABASE_URL): string {
  if (!raw) {
    throw new Error('This server has no DATABASE_URL, so it cannot reach the database.');
  }
  const url = new URL(cleanDatabaseUrl(raw));
  url.pathname = `/${name}`;
  return url.toString();
}

export function adminDatabaseUrl(raw = process.env.DATABASE_URL): string {
  return databaseUrlFor('postgres', raw);
}

export function majorOf(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = /(\d{1,2})\.?\d*/.exec(text);
  return match ? Number(match[1]) : null;
}

export function which(name: string): string | null {
  const paths = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':');
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

/**
 * The folders this installation may keep its own PostgreSQL tools in. The
 * program ships its own copy for exactly this reason: a Windows machine with
 * no PostgreSQL installed still has to be able to back itself up.
 */
export function bundledToolDirs(): string[] {
  const dirs: string[] = [];
  dirs.push(join(process.cwd(), 'postgres', 'bin'));
  dirs.push(join(process.cwd(), 'backend', 'postgres', 'bin'));
  dirs.push(join(__dirname, '..', '..', '..', '..', 'postgres', 'bin'));
  dirs.push(join(process.cwd(), 'pg', 'bin'));
  dirs.push(join(process.cwd(), 'pg'));
  dirs.push(join(process.cwd(), 'backend', 'pg', 'bin'));
  dirs.push(join(process.cwd(), 'backend', 'pg'));
  dirs.push(join(__dirname, '..', '..', '..', '..', 'pg', 'bin'));
  dirs.push(join(__dirname, '..', '..', '..', '..', 'pg'));
  dirs.push(join(__dirname, '..', '..', '..', 'pg'));
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    dirs.push(join(localAppData, 'kayan-tools', 'pgsql', 'bin'));
    const programData = process.env.ProgramData ?? process.env.PROGRAMDATA;
    if (programData) dirs.push(join(programData, 'KAYAN-ERP', 'pgsql', 'bin'));
  }
  return dirs;
}

export function platformToolDirs(): string[] {
  const dirs: string[] = [];
  if (process.platform === 'win32') {
    for (const root of ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL']) {
      if (!existsSync(root)) continue;
      try {
        for (const entry of readdirSync(root)) dirs.push(join(root, entry, 'bin'));
      } catch {
        /* an unreadable folder is simply not a candidate */
      }
    }
  } else if (process.platform === 'darwin') {
    dirs.push(
      '/Applications/Postgres.app/Contents/Versions/latest/bin',
      '/Library/PostgreSQL/17/bin',
      '/Library/PostgreSQL/16/bin',
      '/opt/homebrew/opt/postgresql@17/bin',
      '/opt/homebrew/opt/postgresql@16/bin',
      '/usr/local/opt/postgresql@17/bin',
      '/usr/local/opt/postgresql@16/bin',
    );
  } else {
    dirs.push(
      '/usr/lib/postgresql/18/bin',
      '/usr/lib/postgresql/17/bin',
      '/usr/lib/postgresql/16/bin',
      '/usr/lib/postgresql/15/bin',
      '/usr/bin',
    );
  }
  return dirs;
}

/**
 * The PostgreSQL command-line tools, found once and remembered briefly. A
 * negative answer is re-checked after a minute: tools can be installed or
 * provisioned while the program is running.
 */
export async function findPgTools(): Promise<PgTools> {
  const cached = toolCache;
  if (cached && Date.now() - cached.at < TOOL_CACHE_TTL_MS) return cached.tools;

  const lookup = (name: string, envVar: string): string | null => {
    const chosen = process.env[envVar]?.trim();
    if (chosen && existsSync(chosen)) return chosen;
    for (const folder of bundledToolDirs()) {
      const candidate = join(folder, name + (process.platform === 'win32' ? '.exe' : ''));
      if (existsSync(candidate)) return candidate;
    }
    const onPath = which(name);
    if (onPath) return onPath;
    for (const folder of platformToolDirs()) {
      const candidate = join(folder, name + (process.platform === 'win32' ? '.exe' : ''));
      if (existsSync(candidate)) return candidate;
    }
    return null;
  };

  const pgDump = lookup('pg_dump', 'KAYAN_PG_DUMP');
  const pgRestore = lookup('pg_restore', 'KAYAN_PG_RESTORE');
  let version: string | null = null;
  if (pgDump) {
    version = await runCapture(pgDump, ['--version'], 10_000).catch(() => null);
  }
  const tools: PgTools = { pgDump, pgRestore, version: version?.trim() ?? null };
  toolCache = { tools, at: Date.now() };
  return tools;
}

let toolCache: { tools: PgTools; at: number } | null = null;

export function forgetPgTools(): void {
  toolCache = null;
}

/// Runs a command and resolves with its standard output; rejects with the
/// tool's own words when it fails.
export function runCapture(
  command: string,
  args: string[],
  timeout = 600_000,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      command,
      args,
      {
        timeout,
        maxBuffer: 32 * 1024 * 1024,
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

/// Where backups live. On Windows the installer's data root, so a backup
/// survives reinstalling the program and is not written into a folder the
/// service account may not touch.
export function backupDirectory(): string {
  const chosen = process.env.KAYAN_BACKUP_DIR?.trim();
  if (chosen) return chosen;
  if (process.platform === 'win32') {
    const programData = process.env.ProgramData ?? process.env.PROGRAMDATA;
    if (programData) return join(programData, 'KAYAN-ERP', 'backups');
  }
  return join(process.cwd(), 'backups');
}

export async function ensureDirectory(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  return path;
}

/// The folder the program keeps uploaded files in. Mirrors `uploadsDir()` in
/// company.service.ts; kept separate so the backup does not have to import a
/// module full of feature code to find the same folder.
export function uploadsDirectory(): string {
  return process.env.KAYAN_UPLOAD_DIR ?? join(process.cwd(), 'uploads');
}

/**
 * Every place a licence file may live. The restore never writes one of these
 * — a licence belongs to a machine — but a backup records whether one was
 * there and what state it was in.
 */
export function licenceFileCandidates(): string[] {
  const candidates: string[] = [];
  for (const key of ['KAYAN_LICENSE_FILE', 'KAYAN_LICENCE_FILE', 'KAYAN_LICENSE_PATH']) {
    const chosen = process.env[key]?.trim();
    if (chosen) candidates.push(chosen);
  }
  const programData = process.env.ProgramData ?? process.env.PROGRAMDATA;
  if (programData) {
    candidates.push(join(programData, 'KAYAN-ERP', 'licence.json'));
    candidates.push(join(programData, 'KAYAN-ERP', 'license.json'));
  }
  candidates.push(join(process.cwd(), 'licence.json'));
  candidates.push(join(process.cwd(), 'license.json'));
  candidates.push(join(process.cwd(), '..', 'licence.json'));
  candidates.push(join(homedir(), '.kayan', 'licence.json'));
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) candidates.push(join(localAppData, 'kayan', 'licence.json'));
  return [...new Set(candidates)];
}

export interface LicenceSnapshot {
  path: string;
  present: boolean;
  sha256: string | null;
  bytes: number;
  sanitised: SanitisedLicence;
}

/// Reads the licence file and reduces it to facts that are safe to store.
export async function readLicenceSnapshot(path: string): Promise<LicenceSnapshot> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size === 0 || info.size > 128 * 1024) {
      return { path, present: false, sha256: null, bytes: 0, sanitised: { status: null, expiresAt: null, fields: {}, withheld: [] } };
    }
    const data = await readFile(path);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(data.toString('utf8'));
    } catch {
      parsed = null;
    }
    return {
      path,
      present: true,
      sha256: createHash('sha256').update(data).digest('hex'),
      bytes: data.length,
      sanitised: parsed
        ? sanitiseLicence(parsed)
        : { status: 'unreadable', expiresAt: null, fields: {}, withheld: [] },
    };
  } catch {
    return { path, present: false, sha256: null, bytes: 0, sanitised: { status: null, expiresAt: null, fields: {}, withheld: [] } };
  }
}

export async function findLicenceSnapshot(): Promise<LicenceSnapshot> {
  for (const candidate of licenceFileCandidates()) {
    const snapshot = await readLicenceSnapshot(candidate);
    if (snapshot.present) return snapshot;
  }
  return {
    path: licenceFileCandidates()[0] ?? '',
    present: false,
    sha256: null,
    bytes: 0,
    sanitised: { status: null, expiresAt: null, fields: {}, withheld: [] },
  };
}

/// ───────────────────────────────────────────────────── PostgreSQL client

export interface WithClientOptions {
  database?: string;
  connectionString?: string;
}

export async function withPgClient<T>(
  options: WithClientOptions,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const raw = process.env.DATABASE_URL;
  if (!options.connectionString && !raw) {
    throw new Error('This server has no DATABASE_URL, so it cannot reach the database.');
  }
  const connectionString =
    options.connectionString ??
    (options.database ? databaseUrlFor(options.database) : cleanDatabaseUrl(raw as string));
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end().catch(() => {});
  }
}

export async function serverVersion(): Promise<string | null> {
  try {
    return await withPgClient({}, async (client) => {
      const result = await client.query<{ v: string }>("SELECT current_setting('server_version') AS v");
      return result.rows[0]?.v ?? null;
    });
  } catch {
    return null;
  }
}

/// Whether the database account may open a scratch database. A restore that
/// cannot be rehearsed is not offered, because the rehearsal is the step that
/// catches a damaged archive before production data is replaced.
export async function mayCreateDatabase(): Promise<{ allowed: boolean; reason: string | null }> {
  try {
    return await withPgClient({}, async (client) => {
      const result = await client.query<{ allowed: boolean }>(
        'SELECT (rolsuper OR rolcreatedb) AS allowed FROM pg_roles WHERE rolname = current_user',
      );
      const allowed = result.rows[0]?.allowed === true;
      return {
        allowed,
        reason: allowed ? null : 'the database account is not allowed to create a database',
      };
    });
  } catch (error) {
    return { allowed: false, reason: (error as Error).message };
  }
}

export async function executeSql(sql: string, database?: string): Promise<void> {
  await withPgClient({ database }, async (client) => {
    await client.query(sql);
  });
}

export async function dropDatabaseIfExists(name: string): Promise<void> {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`refusing to drop database "${name}"`);
  try {
    await withPgClient({ connectionString: adminDatabaseUrl() }, async (client) => {
      await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    });
  } catch {
    // An older PostgreSQL has no WITH (FORCE); try the plain form.
    await withPgClient({ connectionString: adminDatabaseUrl() }, async (client) => {
      await client.query(`DROP DATABASE IF EXISTS "${name}"`);
    });
  }
}

export async function createScratchDatabase(name: string): Promise<void> {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`refusing to create database "${name}"`);
  await withPgClient({ connectionString: adminDatabaseUrl() }, async (client) => {
    await client.query(`CREATE DATABASE "${name}"`);
  });
}

/// ─────────────────────────────────────────────────────── dump and restore

export async function pgDumpToFile(target: string): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('This server has no DATABASE_URL, so there is no database to dump.');
  }
  const tools = await findPgTools();
  if (!tools.pgDump) {
    throw new Error(
      'pg_dump was not found on this machine, so no backup can be written here. ' +
        'Set KAYAN_PG_DUMP to the pg_dump of the PostgreSQL this database uses.',
    );
  }
  await runCapture(
    tools.pgDump,
    [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--no-password',
      `--file=${target}`,
      `--dbname=${cleanDatabaseUrl(process.env.DATABASE_URL as string)}`,
    ],
    30 * 60_000,
  );
}

export async function pgRestoreInto(database: string, dumpPath: string): Promise<void> {
  const tools = await findPgTools();
  if (!tools.pgRestore) {
    throw new Error(
      'pg_restore was not found on this machine, so a backup cannot be restored here. ' +
        'Set KAYAN_PG_RESTORE to the pg_restore of the PostgreSQL this database uses.',
    );
  }
  await runCapture(
    tools.pgRestore,
    [
      '--exit-on-error',
      '--no-owner',
      '--no-privileges',
      '--no-password',
      `--dbname=${cleanDatabaseUrl(databaseUrlFor(database))}`,
      dumpPath,
    ],
    30 * 60_000,
  );
}

/// How many objects `pg_restore --list` finds. Zero means the archive is
/// empty; a non-zero answer also proves the tool can read the whole table of
/// contents, which catches truncation.
export async function dumpEntries(dumpPath: string): Promise<number> {
  const tools = await findPgTools();
  if (!tools.pgRestore) {
    throw new Error('pg_restore was not found on this machine, so a dump cannot be checked here.');
  }
  const listing = await runCapture(tools.pgRestore, ['--list', dumpPath], 5 * 60_000);
  return listing
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith(';')).length;
}

/// Confirms a file starts with the custom-format magic bytes.
export async function hasCustomMagic(path: string): Promise<boolean> {
  const handle = await open(path, 'r').catch(() => null);
  if (!handle) return false;
  try {
    const head = Buffer.alloc(5);
    const read = await handle.read(head, 0, 5, 0);
    return read.bytesRead === 5 && head.equals(CUSTOM_MAGIC);
  } finally {
    await handle.close();
  }
}

/// Safely lists the files under the uploads folder: regular files only, no
/// links, no hidden temporary files, bounded in number.
export async function listUserFiles(
  root: string,
  limits = { maxFiles: 20_000, maxTotalBytes: 4 * 1024 * 1024 * 1024 },
): Promise<Array<{ relative: string; absolute: string; bytes: number }>> {
  const found: Array<{ relative: string; absolute: string; bytes: number }> = [];
  let total = 0;
  const walk = async (folder: string, prefix: string): Promise<void> => {
    let entries: string[];
    try {
      entries = await readdir(folder);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      const absolute = join(folder, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      let info;
      try {
        info = await stat(absolute);
      } catch {
        continue;
      }
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        await walk(absolute, relative);
        continue;
      }
      if (!info.isFile()) continue;
      if (name.startsWith('.') || /\.(tmp|partial|lock)$/i.test(name)) continue;
      total += info.size;
      if (found.length >= limits.maxFiles || total > limits.maxTotalBytes) {
        throw new Error(
          'the uploads folder holds more data than a single backup may carry; ' +
            'move older attachments out of the uploads folder and try again',
        );
      }
      found.push({ relative, absolute, bytes: info.size });
    }
  };
  await walk(root, '');
  return found;
}

/// Copies a directory tree to a new place, used to keep the pre-restore files
/// reachable after a restore swaps the uploads folder.
export async function copyTree(source: string, destination: string): Promise<number> {
  let copied = 0;
  const walk = async (folder: string, prefix: string): Promise<void> => {
    let entries: string[];
    try {
      entries = await readdir(folder);
    } catch {
      return;
    }
    for (const name of entries) {
      const absolute = join(folder, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const info = await stat(absolute);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        await walk(absolute, relative);
        continue;
      }
      if (!info.isFile()) continue;
      const target = join(destination, relative);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, await readFile(absolute));
      copied += 1;
    }
  };
  await mkdir(destination, { recursive: true });
  await walk(source, '');
  return copied;
}

/// A file inside the backup directory, refusing anything that is not a simple
/// file name there.
export function safeBackupPath(name: string, roots: string[]): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error('that is not a backup file name');
  }
  for (const root of roots) {
    const base = resolve(root);
    const target = resolve(base, name);
    if (!target.startsWith(base + sep)) continue;
    if (existsSync(target)) return target;
  }
  return resolve(roots[0], name);
}

export async function removeIfExists(path: string): Promise<void> {
  await unlink(path).catch(() => {});
}

export function directorySize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
