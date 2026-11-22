import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

/**
 * The description of a complete system backup: what is inside the archive,
 * which version of the program wrote it, and the SHA-256 of every file it
 * carries.
 *
 * A backup is only worth the promise that it can be put back. The manifest is
 * that promise written down: a restore compares the archive against it before
 * it touches the database, and a person who has to recover by hand can read
 * it without the program.
 */

export const SYSTEM_BACKUP_FORMAT = 'kayan-system-backup';
/// Bumped only when the layout changes in a way an older reader cannot take.
export const SYSTEM_BACKUP_VERSION = 1;

/// Where things sit inside the archive. Fixed names, so a person with any
/// archiver finds them without the program.
export const ARCHIVE_PATHS = {
  manifest: 'manifest.json',
  checksums: 'checksums.sha256',
  databaseDump: 'database/database.dump',
  settings: 'settings/settings.json',
  licence: 'licence/licence-state.json',
  instructions: 'RESTORE-INSTRUCTIONS.txt',
  filesRoot: 'files/uploads',
} as const;

export interface FileEntry {
  /// Path inside the archive, forward slashes.
  path: string;
  bytes: number;
  sha256: string;
}

export interface DatabasePart {
  engine: 'postgresql';
  serverVersion: string | null;
  databaseName: string;
  dumpPath: string;
  dumpBytes: number;
  dumpSha256: string;
  /// Objects `pg_restore --list` found in the dump at the moment it was
  /// written. Zero would mean the dump is empty.
  archiveEntries: number;
  prisma: { appliedMigrations: number; lastMigration: string | null };
}

export interface LicencePart {
  /// The machine's own licence state, recorded but never restored: a licence
  /// belongs to a machine, and copying one is not a restore.
  statePath: string;
  /// Where the redacted state sits inside the archive, and its hash.
  archivePath: string;
  archiveSha256: string;
  /// The hash of the live licence file, so the restore can prove it was not
  /// touched.
  sha256: string | null;
  /// Whether a licence file was found at all on this machine.
  present: boolean;
  /// The status read out of it, e.g. `active`, `expired`, `unknown`.
  status: string | null;
  expiresAt: string | null;
  /// A short, non-reversible fingerprint of this machine. Never a key.
  machineFingerprint: string;
  /// Keys that were deliberately not written into the archive.
  withheld: string[];
}

export interface SystemBackupManifest {
  format: typeof SYSTEM_BACKUP_FORMAT;
  version: number;
  createdAt: string;
  /// The version of the program that wrote the backup.
  appVersion: string;
  nodeVersion: string;
  platform: string;
  kind: 'full' | 'safety';
  database: DatabasePart;
  files: {
    root: string;
    count: number;
    totalBytes: number;
    entries: FileEntry[];
  };
  settings: FileEntry;
  licence: LicencePart;
  /// Small files that also carry their own checksum line: the redacted
  /// licence state and the restore instructions.
  extras?: FileEntry[];
  checksums: {
    algorithm: 'sha256';
    file: string;
    entries: number;
  };
  /// A short, human-readable count of what is inside, proved by the restore's
  /// post-checks.
  counts: {
    companies: number;
    users: number;
    accounts: number;
    journalEntries: number;
    items: number;
    customers: number;
    suppliers: number;
    stockBalances: number;
  };
}

/// Reads the version of the program that is running, from its own package
/// file, without trusting an environment variable to describe it.
export function appVersion(): string {
  const candidates = [
    join(process.cwd(), 'package.json'),
    join(__dirname, '..', '..', '..', '..', 'package.json'),
    join(__dirname, '..', '..', '..', '..', '..', 'package.json'),
  ];
  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) continue;
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as {
        name?: string;
        version?: string;
      };
      if (parsed.version && /backend|kayan|erp/i.test(parsed.name ?? '')) {
        return parsed.version;
      }
    } catch {
      /* unreadable package file: try the next */
    }
  }
  return '0.0.0-unknown';
}

/// The exact text of the checksum file: `sha256  path`, one per line, sorted
/// by path so the same archive always produces the same list. This is the
/// format `sha256sum -c` reads, which is the point.
export function serialiseChecksums(entries: FileEntry[]): string {
  return (
    [...entries]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((entry) => `${entry.sha256}  ${entry.path}`)
      .join('\n') + '\n'
  );
}

export function parseChecksums(text: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^([0-9a-f]{64})\s{1,2}(.+)$/.exec(trimmed);
    if (!match) {
      throw new Error(`the checksum list holds a line this program cannot read: "${trimmed.slice(0, 80)}"`);
    }
    const path = match[2].trim();
    if (result.has(path)) {
      throw new Error(`the checksum list names "${path}" twice`);
    }
    result.set(path, match[1]);
  }
  if (result.size === 0) throw new Error('the checksum list is empty');
  return result;
}

/// The entries a complete backup promises: every file it carries except the
/// manifest and the checksum list itself (which cannot contain its own hash).
export function manifestFileEntries(manifest: SystemBackupManifest): FileEntry[] {
  return [
    { path: manifest.database.dumpPath, bytes: manifest.database.dumpBytes, sha256: manifest.database.dumpSha256 },
    manifest.settings,
    ...(manifest.extras ?? []),
    ...manifest.files.entries,
  ];
}

export function checksumTextFor(manifest: SystemBackupManifest): string {
  return serialiseChecksums(manifestFileEntries(manifest));
}

/// Everything a restore must refuse before it starts.
export function validateManifestShape(value: unknown): SystemBackupManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('the archive has no readable manifest');
  }
  const manifest = value as Partial<SystemBackupManifest>;
  if (manifest.format !== SYSTEM_BACKUP_FORMAT) {
    throw new Error(
      'this file is not a KAYAN system backup (its manifest does not say "kayan-system-backup")',
    );
  }
  if (!Number.isInteger(manifest.version) || (manifest.version as number) < 1) {
    throw new Error('the manifest has no format version');
  }
  if ((manifest.version as number) > SYSTEM_BACKUP_VERSION) {
    throw new Error(
      `this backup was written by a newer version of the program (format ${manifest.version}); update the program first`,
    );
  }
  const database = manifest.database;
  if (
    !database ||
    database.engine !== 'postgresql' ||
    typeof database.dumpPath !== 'string' ||
    typeof database.dumpSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(database.dumpSha256)
  ) {
    throw new Error('the manifest does not describe a PostgreSQL dump properly');
  }
  if (!Array.isArray(manifest.files?.entries)) {
    throw new Error('the manifest does not list the files in the archive');
  }
  if (!manifest.settings || typeof manifest.settings.sha256 !== 'string') {
    throw new Error('the manifest does not describe the settings it carries');
  }
  return manifest as SystemBackupManifest;
}

/// A stable, non-reversible name for this machine, used only to say "this
/// licence file was read here". It cannot be turned back into a hostname.
export function machineFingerprint(): string {
  const material = [
    hostname(),
    process.platform,
    process.arch,
    process.env.ProgramData ?? '',
    process.env.COMPUTERNAME ?? '',
  ].join('|');
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

/// The keys of a licence file that must never be written into a backup: any
/// private key, signature, token or password. Matching by name is the only
/// safe test, because the shape of a licence file is not this program's to
/// assume.
const WITHHELD_KEY_PATTERN = /key|secret|token|signature|private|password|passphrase|credential/i;

export interface SanitisedLicence {
  status: string | null;
  expiresAt: string | null;
  fields: Record<string, string | number | boolean | null>;
  withheld: string[];
}

/**
 * Turns a licence file into a few facts safe to put in a backup: whether it
 * is active, when it expires, and the non-secret values around them. Anything
 * that could sign, mint or forge a licence is dropped, and its name is
 * recorded so a reader knows something was withheld rather than absent.
 */
export function sanitiseLicence(raw: unknown): SanitisedLicence {
  const withheld: string[] = [];
  const fields: Record<string, string | number | boolean | null> = {};

  const walk = (value: unknown, prefix: string, depth: number): void => {
    if (depth > 3 || value === null || value === undefined) return;
    if (Array.isArray(value)) return; // lists are not facts a restore reads
    if (typeof value !== 'object') {
      if (prefix && !WITHHELD_KEY_PATTERN.test(prefix)) {
        if (['string', 'number', 'boolean'].includes(typeof value)) {
          const text = String(value);
          if (text.length <= 200) fields[prefix] = value as string | number | boolean;
        }
      }
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (WITHHELD_KEY_PATTERN.test(key)) {
        withheld.push(path);
        continue;
      }
      walk(child, path, depth + 1);
    }
  };
  walk(raw, '', 0);

  const pick = (...names: string[]): string | null => {
    for (const name of names) {
      const value = fields[name] ?? fields[`licence.${name}`] ?? fields[`license.${name}`];
      if (value !== undefined && value !== null && `${value}`.trim() !== '') return `${value}`;
    }
    return null;
  };

  let status = pick('status', 'state', 'licenseStatus', 'licenceStatus');
  const valid = fields['valid'] ?? fields['isValid'];
  if (status === null && typeof valid === 'boolean') status = valid ? 'active' : 'invalid';
  const expiresAt = pick('expiresAt', 'expiry', 'expiresOn', 'validUntil', 'expiryDate');
  return { status, expiresAt, fields, withheld };
}

export function sha256(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}
