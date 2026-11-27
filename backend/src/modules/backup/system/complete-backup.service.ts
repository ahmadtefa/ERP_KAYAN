import { Injectable, Logger, BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  ARCHIVE_PATHS,
  SYSTEM_BACKUP_FORMAT,
  SYSTEM_BACKUP_VERSION,
  appVersion,
  checksumTextFor,
  machineFingerprint,
  parseChecksums,
  validateManifestShape,
  type FileEntry,
  type SystemBackupManifest,
} from './manifest';
import {
  MAX_UPLOAD_BYTES,
  backupDirectory,
  databaseNameFrom,
  dumpEntries,
  ensureDirectory,
  findLicenceSnapshot,
  findPgTools,
  hasCustomMagic,
  listUserFiles,
  pgDumpToFile,
  removeIfExists,
  safeBackupPath,
  serverVersion,
  uploadsDirectory,
  withPgClient,
} from './pg-support';
import {
  TarWriter,
  extractTar,
  fileDigest,
  listTar,
  readTarTextEntries,
  verifyTarArchive,
} from './tar';

/**
 * Complete system backups.
 *
 * A "database archive" (the legacy .dump) is half a backup: it brings the
 * books back but not the pictures, the settings or the record of which version
 * wrote it, and a person holding it has no way to tell whether the file is
 * intact. A complete backup is one file that carries all of it plus the
 * evidence needed to prove it before it is used:
 *
 *   manifest.json          what this is, which version wrote it, what is inside
 *   checksums.sha256       the SHA-256 of every file, in `sha256sum -c` format
 *   database/database.dump the whole PostgreSQL database (custom format)
 *   files/uploads/…        the uploaded files the database refers to
 *   settings/settings.json the settings a restore needs, with no secrets
 *   licence/licence-state.json  the licence's state, redacted — never a key
 *   RESTORE-INSTRUCTIONS.txt    how to recover by hand, in Arabic and English
 *
 * The archive is therefore both a restore source and a report. Every file in
 * it is read back and hashed before anyone is told the backup worked.
 */

const ARCHIVE_EXTENSION = '.kayanbackup';
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.kayanbackup$/;

export interface SystemBackupFile {
  name: string;
  sizeBytes: number;
  createdAt: string;
  kind: 'full' | 'safety';
  /// The archive holds the database only (a legacy .dump), rather than the
  /// complete system. Always false for files this service writes.
  databaseOnly: boolean;
}

export interface ArchiveCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SystemBackupReport {
  name: string;
  sizeBytes: number;
  verifiedAt: string;
  ok: boolean;
  checks: ArchiveCheck[];
  warnings: string[];
  manifest: {
    format: string;
    version: number;
    kind: 'full' | 'safety' | 'unknown';
    createdAt: string;
    appVersion: string;
    platform: string;
    database: SystemBackupManifest['database'];
    files: { count: number; totalBytes: number };
    licence: { present: boolean; status: string | null; expiresAt: string | null };
    counts: SystemBackupManifest['counts'];
  } | null;
  /// For a foreign or damaged file: why it cannot be used, in words a person
  /// can act on. Null when every check passed.
  failure: string | null;
  compatible: boolean;
}

const INSTRUCTIONS = `KAYAN ERP — نسخة احتياطية كاملة / Complete system backup
================================================================

هذا الملف أرشيف واحد يحتوي:
  database/database.dump        قاعدة بيانات PostgreSQL كاملة (pg_dump custom)
  files/uploads/…               الملفات المرفوعة (شعارات الشركات وغيرها)
  settings/settings.json        إعدادات الاستعادة (بدون أي كلمات مرور)
  licence/licence-state.json    حالة الترخيص فقط — لا يُستعاد ولا يحتوي مفاتيح
  manifest.json                 محتويات النسخة وإصدار البرنامج
  checksums.sha256              بصمة SHA-256 لكل ملف

الاستعادة من داخل البرنامج:
  الإعدادات ← النسخ الاحتياطي ← القسم الثاني (نسخ واستعادة النظام)
  اختر الملف، افحصه، ثم استعد بعد كتابة كلمة التأكيد.
  يأخذ البرنامج نسخة أمان قبل أي تغيير، ويجرّب الاستعادة على قاعدة منفصلة أولاً.

الاستعادة يدويًا (عند تعذّر تشغيل البرنامج):
  1) تحقق من سلامة الملف:
       sha256sum -c checksums.sha256
  2) أنشئ قاعدة البيانات إن لم تكن موجودة.
  3) استعد:
       pg_restore --clean --if-exists --no-owner --no-privileges \\
         -d <database> database/database.dump
  4) انسخ محتويات files/uploads إلى مجلد الرفع KAYAN_UPLOAD_DIR.
  5) لا تنسخ licence-state.json إلى جهاز: الترخيص يخص هذا الجهاز.

English
-------
Restore from inside the program (Settings → Backup → System backup/restore):
choose the file, verify it, then type the confirmation. The program takes a
safety backup first and rehearses the restore on a scratch database before it
replaces anything.

Manual recovery: verify with "sha256sum -c checksums.sha256", restore with
"pg_restore --clean --if-exists --no-owner --no-privileges -d <database>
database/database.dump", then copy files/uploads to KAYAN_UPLOAD_DIR. Never
copy licence-state.json onto another machine: a licence belongs to a machine.
`;

@Injectable()
export class CompleteBackupService {
  private readonly logger = new Logger(CompleteBackupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /// ─────────────────────────────────────────────────────────── what is here

  async capabilities() {
    const tools = await findPgTools();
    const [version, server, dir] = await Promise.all([
      this.databaseNameOrNull(),
      serverVersion(),
      Promise.resolve(backupDirectory()),
    ]);
    const backups = await this.list().catch(() => []);
    return {
      available: Boolean(tools.pgDump && tools.pgRestore),
      pgDump: tools.pgDump,
      pgRestore: tools.pgRestore,
      version: tools.version,
      serverVersion: server,
      database: version,
      backupDirectory: dir,
      uploadsDirectory: uploadsDirectory(),
      format: SYSTEM_BACKUP_FORMAT,
      formatVersion: SYSTEM_BACKUP_VERSION,
      appVersion: appVersion(),
      backups: backups.length,
      reason:
        tools.pgDump && tools.pgRestore
          ? null
          : 'PostgreSQL command-line tools (pg_dump / pg_restore) were not found ' +
            'on this machine, so a complete backup cannot be written here.',
    };
  }

  private async databaseNameOrNull(): Promise<string | null> {
    try {
      return databaseNameFrom();
    } catch {
      return null;
    }
  }

  /// ────────────────────────────────────────────────────────────── writing

  async create(
    kind: 'full' | 'safety',
    userId: string | null,
  ): Promise<{ file: SystemBackupFile; manifest: SystemBackupManifest; durationMs: number; warnings: string[] }> {
    const started = Date.now();
    const tools = await findPgTools();
    if (!tools.pgDump || !tools.pgRestore) {
      throw new ServiceUnavailableException({ code: 'COMPLETE_BACKUP_CREATE_E085', message: 'This machine has no PostgreSQL backup tools (pg_dump / pg_restore), so a ' +
          'complete backup cannot be written here. Nothing was changed.' });
    }
    const database = databaseNameFrom();
    const dir = await ensureDirectory(backupDirectory());
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const name = `kayan-${kind}-${stamp}${ARCHIVE_EXTENSION}`;
    const target = join(dir, name);
    const partial = `${target}.partial`;
    const buildDir = join(dir, '.build', stamp);
    const warnings: string[] = [];

    try {
      await mkdir(join(buildDir, 'database'), { recursive: true });
      await mkdir(join(buildDir, 'settings'), { recursive: true });
      await mkdir(join(buildDir, 'licence'), { recursive: true });

      // 1. The database. Written to disk first so a 500 MB dump never sits in
      //    memory, and checked immediately: a dump that cannot be listed is
      //    not a backup.
      const dumpPath = join(buildDir, 'database.dump');
      this.logger.log(`Dumping database "${database}" to ${dumpPath}`);
      await pgDumpToFile(dumpPath);
      if (!(await stat(dumpPath).catch(() => null))) {
        throw new Error('pg_dump produced no file');
      }
      if (!(await hasCustomMagic(dumpPath))) {
        throw new Error('pg_dump produced a file that is not a PostgreSQL custom archive');
      }
      const entries = await dumpEntries(dumpPath);
      if (entries === 0) throw new Error('pg_dump produced an empty archive');
      const dumpDigest = await fileDigest(dumpPath);

      // 2. The uploads folder. Only regular files, never links, never
      //    temporary files: a backup must not carry something the program
      //    would refuse to put back.
      const files = await listUserFiles(uploadsDirectory());

      // 3. Settings: what a restore needs to know about this installation,
      //    with anything secret left out by construction.
      const counts = await this.counts();
      const settings = {
        application: {
          name: 'KAYAN ERP',
          backendVersion: appVersion(),
          backupFormat: SYSTEM_BACKUP_FORMAT,
          backupFormatVersion: SYSTEM_BACKUP_VERSION,
        },
        database: {
          engine: 'postgresql',
          name: database,
          serverVersion: await serverVersion(),
          prisma: await this.prismaState(),
        },
        environment: {
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
          port: process.env.PORT ?? null,
          nodeEnv: process.env.NODE_ENV ?? null,
          uploadsDirectory: uploadsDirectory(),
          backupDirectory: dir,
        },
        counts,
        note:
          'This file deliberately contains no passwords, tokens or private keys. ' +
          'The database password and the JWT secrets live in the environment of the ' +
          'server and are never written into a backup.',
      };
      const settingsPath = join(buildDir, 'settings.json');
      await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
      const settingsDigest = await fileDigest(settingsPath);

      // 4. The licence, redacted. A licence belongs to a machine; what is
      //    written here is a record of its state, never the key material.
      const licenceSnapshot = await findLicenceSnapshot();
      const licenceState = {
        recordedAt: new Date().toISOString(),
        machineFingerprint: machineFingerprint(),
        present: licenceSnapshot.present,
        status: licenceSnapshot.sanitised.status,
        expiresAt: licenceSnapshot.sanitised.expiresAt,
        fields: licenceSnapshot.sanitised.fields,
        withheld: licenceSnapshot.sanitised.withheld,
        noteAr:
          'هذا سجل لحالة الترخيص على الجهاز الذي أُخذت منه النسخة. لا يحتوي أي مفاتيح خاصة، ولا يُستعاد على جهاز آخر.',
        noteEn:
          'This records the licence state of the machine the backup was taken on. It ' +
          'holds no key material and is never restored onto this or any machine.',
      };
      const licencePath = join(buildDir, 'licence-state.json');
      await writeFile(licencePath, `${JSON.stringify(licenceState, null, 2)}\n`, 'utf8');
      const licenceDigest = await fileDigest(licencePath);

      const instructionsPath = join(buildDir, 'instructions.txt');
      await writeFile(instructionsPath, INSTRUCTIONS, 'utf8');
      const instructionsDigest = await fileDigest(instructionsPath);

      // 5. The files the archive carries, hashed before the manifest is
      //    written so the manifest can promise them.
      const fileEntries: FileEntry[] = [];
      for (const file of files) {
        const digest = await fileDigest(file.absolute);
        fileEntries.push({
          path: `${ARCHIVE_PATHS.filesRoot}/${file.relative}`,
          bytes: digest.bytes,
          sha256: digest.sha256,
        });
      }

      const extras: FileEntry[] = [
        { path: ARCHIVE_PATHS.licence, bytes: licenceDigest.bytes, sha256: licenceDigest.sha256 },
        {
          path: ARCHIVE_PATHS.instructions,
          bytes: instructionsDigest.bytes,
          sha256: instructionsDigest.sha256,
        },
      ];

      const manifest: SystemBackupManifest = {
        format: SYSTEM_BACKUP_FORMAT,
        version: SYSTEM_BACKUP_VERSION,
        createdAt: new Date().toISOString(),
        appVersion: appVersion(),
        nodeVersion: process.version,
        platform: `${process.platform}-${process.arch}`,
        kind,
        database: {
          engine: 'postgresql',
          serverVersion: await serverVersion(),
          databaseName: database,
          dumpPath: ARCHIVE_PATHS.databaseDump,
          dumpBytes: dumpDigest.bytes,
          dumpSha256: dumpDigest.sha256,
          archiveEntries: entries,
          prisma: await this.prismaState(),
        },
        files: {
          root: ARCHIVE_PATHS.filesRoot,
          count: fileEntries.length,
          totalBytes: fileEntries.reduce((sum, entry) => sum + entry.bytes, 0),
          entries: fileEntries,
        },
        settings: {
          path: ARCHIVE_PATHS.settings,
          bytes: settingsDigest.bytes,
          sha256: settingsDigest.sha256,
        },
        licence: {
          statePath: licenceSnapshot.path,
          archivePath: ARCHIVE_PATHS.licence,
          archiveSha256: licenceDigest.sha256,
          sha256: licenceSnapshot.sha256,
          present: licenceSnapshot.present,
          status: licenceSnapshot.sanitised.status,
          expiresAt: licenceSnapshot.sanitised.expiresAt,
          machineFingerprint: machineFingerprint(),
          withheld: licenceSnapshot.sanitised.withheld,
        },
        extras,
        checksums: {
          algorithm: 'sha256',
          file: ARCHIVE_PATHS.checksums,
          entries: 0,
        },
        counts,
      };
      const checksumText = checksumTextFor(manifest);
      manifest.checksums.entries = parseChecksums(checksumText).size;
      const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;

      if (manifest.files.count === 0) {
        warnings.push(
          'لا توجد ملفات مرفوعة على هذا الجهاز، لذلك لا يحمل الأرشيف أي ملفات. / ' +
            'The uploads folder is empty, so the archive carries no uploaded files.',
        );
      }
      if (!licenceSnapshot.present) {
        warnings.push(
          'لم يُعثر على ملف ترخيص على هذا الجهاز. / No licence file was found on this machine.',
        );
      }

      // 6. One archive, written to a `.partial` name and renamed only when it
      //    is complete. A power cut mid-write leaves a file a restore will
      //    refuse, never a half-archive with the right name.
      const writer = await TarWriter.create(partial);
      try {
        await writer.add({ name: ARCHIVE_PATHS.manifest, data: Buffer.from(manifestText, 'utf8') });
        await writer.add({
          name: ARCHIVE_PATHS.checksums,
          data: Buffer.from(checksumText, 'utf8'),
        });
        await writer.add({ name: ARCHIVE_PATHS.databaseDump, path: dumpPath });
        await writer.add({ name: ARCHIVE_PATHS.settings, path: settingsPath });
        await writer.add({ name: ARCHIVE_PATHS.licence, path: licencePath });
        await writer.add({ name: ARCHIVE_PATHS.instructions, path: instructionsPath });
        for (const file of files) {
          await writer.add({
            name: `${ARCHIVE_PATHS.filesRoot}/${file.relative}`,
            path: file.absolute,
          });
        }
      } finally {
        await writer.close();
      }

      await rename(partial, target);

      // 7. Read it back. The one step that turns "a file exists" into "a
      //    backup exists": every entry is hashed against the manifest.
      const report = await this.verifyPath(target);
      if (!report.ok) {
        await removeIfExists(target);
        throw new ServiceUnavailableException({
          code: 'COMPLETE_BACKUP_VERIFY_FAILED',
          message:
            `The backup was written but did not pass its own verification ` +
            `(${report.failure ?? 'unknown reason'}). The file was removed so it cannot ` +
            'be mistaken for a usable backup. Nothing else was changed.',
        });
      }

      const info = await stat(target);
      const file: SystemBackupFile = {
        name,
        sizeBytes: info.size,
        createdAt: info.mtime.toISOString(),
        kind,
        databaseOnly: false,
      };

      if (userId) {
        await this.audit.record({
          action: 'BACKUP',
          entity: 'backup_system',
          entityId: name,
          after: {
            name,
            kind,
            sizeBytes: info.size,
            databaseEntries: entries,
            files: fileEntries.length,
            companies: counts.companies,
            users: counts.users,
            licencePresent: licenceSnapshot.present,
            verified: true,
          },
          userId,
        });
      }

      return { file, manifest, durationMs: Date.now() - started, warnings };
    } catch (error) {
      await removeIfExists(partial);
      throw error;
    } finally {
      await rm(buildDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async createFull(userId: string | null) {
    return this.create('full', userId);
  }

  async createSafety(userId: string | null): Promise<SystemBackupFile> {
    const result = await this.create('safety', userId);
    return result.file;
  }

  /// ─────────────────────────────────────────────────────────────── reading

  private roots(): string[] {
    const dir = backupDirectory();
    const legacy = join(process.cwd(), 'backups');
    return resolve(legacy) === resolve(dir) ? [dir] : [dir, legacy];
  }

  async list(): Promise<SystemBackupFile[]> {
    const found: SystemBackupFile[] = [];
    const seen = new Set<string>();
    for (const dir of this.roots()) {
      if (!existsSync(dir)) continue;
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (error) {
        throw new ServiceUnavailableException({
          code: 'COMPLETE_BACKUP_FOLDER_UNREADABLE',
          message: `The backup folder "${dir}" could not be read (${(error as Error).message}).`,
        });
      }
      for (const name of names) {
        if (!name.endsWith(ARCHIVE_EXTENSION) || seen.has(name)) continue;
        if (!NAME_PATTERN.test(name)) continue;
        seen.add(name);
        try {
          const info = await stat(join(dir, name));
          if (!info.isFile()) continue;
          found.push({
            name,
            sizeBytes: info.size,
            createdAt: info.mtime.toISOString(),
            kind: name.includes('-safety-') ? 'safety' : 'full',
            databaseOnly: false,
          });
        } catch {
          /* vanished between listing and stat */
        }
      }
    }
    return found.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  pathOf(name: string): string {
    if (!NAME_PATTERN.test(name)) {
      throw new BadRequestException({ code: 'FULL_BACKUP_NAME_INVALID', message: 'That is not a complete-backup file name. Choose one from the list.' });
    }
    return safeBackupPath(name, this.roots());
  }

  async read(name: string): Promise<{ data: Buffer; name: string }> {
    const path = this.pathOf(name);
    if (!existsSync(path)) {
      throw new NotFoundException({ code: 'FULL_BACKUP_FILE_MISSING', message: `No backup file named "${name}" on this server` });
    }
    try {
      return { data: await readFile(path), name };
    } catch (error) {
      throw new ServiceUnavailableException({
        code: 'COMPLETE_BACKUP_FILE_UNREADABLE',
        message:
          `The backup file "${name}" could not be read (${(error as Error).message}). ` +
          'The database was not changed.',
        params: { name },
      });
    }
  }

  async remove(name: string, userId: string | null): Promise<void> {
    const path = this.pathOf(name);
    if (!existsSync(path)) {
      throw new NotFoundException({ code: 'FULL_BACKUP_FILE_MISSING', message: `No backup file named "${name}" on this server` });
    }
    try {
      await unlink(path);
    } catch (error) {
      throw new ServiceUnavailableException({
        code: 'COMPLETE_BACKUP_FILE_NOT_DELETED',
        message: `The backup file "${name}" could not be deleted (${(error as Error).message}).`,
        params: { name },
      });
    }
    await this.audit.record({
      action: 'DELETE',
      entity: 'backup_system',
      entityId: name,
      before: { name },
      userId,
    });
  }

  /// Verifies a file already in the backup folder.
  async verify(name: string): Promise<SystemBackupReport> {
    const path = this.pathOf(name);
    if (!existsSync(path)) {
      throw new NotFoundException({ code: 'FULL_BACKUP_FILE_MISSING', message: `No backup file named "${name}" on this server` });
    }
    return this.verifyPath(path, name);
  }

  /// Verifies bytes the user uploaded, without leaving anything behind.
  async inspectUpload(
    buffer: Buffer,
    label: string,
  ): Promise<SystemBackupReport> {
    if (!buffer?.length) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'No file was uploaded.' });
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException({ code: 'BACKUP_TOO_LARGE', message: 'The backup file is larger than 2 GB.' });
    }
    const dir = await ensureDirectory(backupDirectory());
    const temporary = join(dir, `.inspect-${Date.now()}-${process.pid}${ARCHIVE_EXTENSION}`);
    await writeFile(temporary, buffer);
    try {
      return await this.verifyPath(temporary, label, true);
    } finally {
      await removeIfExists(temporary);
    }
  }

  /**
   * The whole verification, in the order that fails fastest and least
   * destructively: is it a TAR, does it hold a manifest this program can read,
   * do the bytes match the checksums, and can pg_restore read the dump inside?
   */
  async verifyPath(
    path: string,
    displayName = path,
    temporary = false,
  ): Promise<SystemBackupReport> {
    const checks: ArchiveCheck[] = [];
    const warnings: string[] = [];
    let sizeOnDisk = 0;
    let manifestSummary: SystemBackupReport['manifest'] = null;
    const finish = (failure: string | null): SystemBackupReport => ({
      name: displayName,
      sizeBytes: sizeOnDisk,
      verifiedAt: new Date().toISOString(),
      ok: failure === null,
      checks,
      warnings,
      manifest: manifestSummary ?? null,
      failure,
      compatible: failure === null && (manifestSummary?.version ?? 0) <= SYSTEM_BACKUP_VERSION,
    });

    const info = await stat(path).catch(() => null);
    if (!info || !info.isFile() || info.size === 0) {
      checks.push({ name: 'file', ok: false, detail: 'the file is missing or empty' });
      return finish('the file is missing or empty');
    }
    sizeOnDisk = info.size;
    checks.push({ name: 'file', ok: true, detail: `${info.size} bytes` });

    // 1. TAR structure, names and truncation.
    let listing;
    try {
      listing = await listTar(path);
      checks.push({
        name: 'archive-structure',
        ok: true,
        detail: `${listing.entries.length} entries, ${listing.totalBytes} bytes of content`,
      });
    } catch (error) {
      checks.push({ name: 'archive-structure', ok: false, detail: (error as Error).message });
      return finish(
        `this is not a complete KAYAN backup archive (${(error as Error).message}). ` +
          'A database-only .dump file must be restored from the database-archive section.',
      );
    }

    // 2. The manifest, before any belief is placed in the file's contents.
    let manifest: SystemBackupManifest;
    let checksumText: string;
    try {
      const texts = await readTarTextEntries(path, [
        ARCHIVE_PATHS.manifest,
        ARCHIVE_PATHS.checksums,
      ]);
      const manifestText = texts.get(ARCHIVE_PATHS.manifest);
      checksumText = texts.get(ARCHIVE_PATHS.checksums) ?? '';
      if (!manifestText) throw new Error('the archive has no manifest.json');
      if (!checksumText) throw new Error('the archive has no checksums.sha256');
      manifest = validateManifestShape(JSON.parse(manifestText));
      checks.push({
        name: 'manifest',
        ok: true,
        detail: `format ${manifest.format} v${manifest.version}, written ${manifest.createdAt}`,
      });
    } catch (error) {
      checks.push({ name: 'manifest', ok: false, detail: (error as Error).message });
      return finish((error as Error).message);
    }

    // 3. The checksums already recorded in the archive may not have been
    //    edited to match a tampered file: they must agree with the manifest.
    const expected = new Map<string, { sha256: string; bytes?: number }>();
    try {
      const listed = parseChecksums(checksumText);
      for (const entry of [
        {
          path: manifest.database.dumpPath,
          bytes: manifest.database.dumpBytes,
          sha256: manifest.database.dumpSha256,
        },
        manifest.settings,
        ...(manifest.extras ?? []),
        ...manifest.files.entries,
      ]) {
        const claimed = listed.get(entry.path);
        if (!claimed) throw new Error(`the checksum list does not cover "${entry.path}"`);
        if (claimed !== entry.sha256) {
          throw new Error(`the checksum list disagrees with the manifest about "${entry.path}"`);
        }
        expected.set(entry.path, { sha256: entry.sha256, bytes: entry.bytes });
      }
      if (listed.size !== expected.size) {
        throw new Error('the checksum list covers files the manifest does not describe');
      }
      checks.push({
        name: 'checksum-list',
        ok: true,
        detail: `${expected.size} files promised by the manifest`,
      });
    } catch (error) {
      checks.push({ name: 'checksum-list', ok: false, detail: (error as Error).message });
      return finish((error as Error).message);
    }

    manifestSummary = {
      format: manifest.format,
      version: manifest.version,
      kind: manifest.kind ?? 'unknown',
      createdAt: manifest.createdAt,
      appVersion: manifest.appVersion,
      platform: manifest.platform,
      database: manifest.database,
      files: { count: manifest.files.count, totalBytes: manifest.files.totalBytes },
      licence: {
        present: manifest.licence?.present ?? false,
        status: manifest.licence?.status ?? null,
        expiresAt: manifest.licence?.expiresAt ?? null,
      },
      counts: manifest.counts,
    };

    // 4. Every byte, against its promised hash.
    try {
      await verifyTarArchive(path, expected);
      checks.push({ name: 'sha256', ok: true, detail: 'every file matches its SHA-256' });
    } catch (error) {
      checks.push({ name: 'sha256', ok: false, detail: (error as Error).message });
      return finish((error as Error).message);
    }

    // 5. The dump itself: real PostgreSQL custom format, and readable by the
    //    pg_restore that will have to use it.
    const workDir = join(
      backupDirectory(),
      '.verify',
      `${Date.now()}-${process.pid}`,
    );
    try {
      await mkdir(workDir, { recursive: true });
      const dumpPath = join(workDir, ARCHIVE_PATHS.databaseDump);
      await extractTar(path, workDir, { only: (name) => name === ARCHIVE_PATHS.databaseDump });
      if (!(await hasCustomMagic(dumpPath))) {
        checks.push({
          name: 'database-dump',
          ok: false,
          detail: 'the dump is not a PostgreSQL custom archive',
        });
        return finish('the database dump inside this archive is not a PostgreSQL custom archive');
      }
      const entries = await dumpEntries(dumpPath);
      if (entries === 0) {
        checks.push({ name: 'database-dump', ok: false, detail: 'the dump holds no objects' });
        return finish('the database dump inside this archive holds no objects');
      }
      checks.push({
        name: 'database-dump',
        ok: true,
        detail: `pg_restore reads ${entries} objects`,
      });
    } catch (error) {
      checks.push({ name: 'database-dump', ok: false, detail: (error as Error).message });
      return finish(
        `the database dump could not be read (${(error as Error).message}). ` +
          'It may be damaged, or written by a newer PostgreSQL than this machine has.',
      );
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }

    // 6. Compatibility: an archive from a newer program may hold tables this
    //    version does not know, which is exactly the case where restoring
    //    would lose data.
    const local = await this.prismaState();
    const archived = manifest.database?.prisma ?? null;
    if (archived && local.appliedMigrations > 0 && archived.appliedMigrations > local.appliedMigrations) {
      checks.push({
        name: 'compatibility',
        ok: false,
        detail:
          `the archive holds ${archived.appliedMigrations} migrations and this installation has ` +
          `${local.appliedMigrations}; it was written by a newer version of the program`,
      });
      return finish(
        'this backup was written by a newer version of the program than the one installed here. ' +
          'Update the program before restoring it; nothing was changed.',
      );
    }
    if (manifest.appVersion !== appVersion()) {
      warnings.push(
        `The archive was written by version ${manifest.appVersion} and this installation is ` +
          `${appVersion()}. The restore will run this version's access repair afterwards.`,
      );
    }
    if ((manifest.licence?.present ?? false) === false) {
      warnings.push('No licence state was recorded in this archive.');
    }
    checks.push({ name: 'compatibility', ok: true, detail: 'the archive fits this installation' });

    if (temporary) checks.push({ name: 'temporary', ok: true, detail: 'checked before upload' });
    return finish(null);
  }

  /// The manifest of an archive, read without trusting anything else in it.
  async readManifest(path: string): Promise<SystemBackupManifest> {
    const texts = await readTarTextEntries(path, [ARCHIVE_PATHS.manifest]);
    const text = texts.get(ARCHIVE_PATHS.manifest);
    if (!text) throw new Error('the archive has no manifest.json');
    return validateManifestShape(JSON.parse(text));
  }

  /// The hashes a restore checks while it unpacks: everything the manifest
  /// promises, keyed by the path inside the archive.
  expectedFrom(manifest: SystemBackupManifest): Map<string, { sha256: string; bytes?: number }> {
    const expected = new Map<string, { sha256: string; bytes?: number }>();
    expected.set(manifest.database.dumpPath, {
      sha256: manifest.database.dumpSha256,
      bytes: manifest.database.dumpBytes,
    });
    expected.set(manifest.settings.path, {
      sha256: manifest.settings.sha256,
      bytes: manifest.settings.bytes,
    });
    for (const extra of manifest.extras ?? []) {
      expected.set(extra.path, { sha256: extra.sha256, bytes: extra.bytes });
    }
    for (const file of manifest.files.entries) {
      expected.set(file.path, { sha256: file.sha256, bytes: file.bytes });
    }
    return expected;
  }

  /// ───────────────────────────────────────────────────────────── help

  private async counts(): Promise<SystemBackupManifest['counts']> {
    try {
      return await withPgClient({}, async (client) => {
        const result = await client.query<Record<string, string>>(`
          SELECT
            (SELECT count(*) FROM companies) AS companies,
            (SELECT count(*) FROM users) AS users,
            (SELECT count(*) FROM accounts) AS accounts,
            (SELECT count(*) FROM journal_entries) AS journal_entries,
            (SELECT count(*) FROM items) AS items,
            (SELECT count(*) FROM customers) AS customers,
            (SELECT count(*) FROM suppliers) AS suppliers,
            (SELECT count(*) FROM stock_balances) AS stock_balances
        `);
        const row = result.rows[0] ?? {};
        return {
          companies: Number(row.companies ?? 0),
          users: Number(row.users ?? 0),
          accounts: Number(row.accounts ?? 0),
          journalEntries: Number(row.journal_entries ?? 0),
          items: Number(row.items ?? 0),
          customers: Number(row.customers ?? 0),
          suppliers: Number(row.suppliers ?? 0),
          stockBalances: Number(row.stock_balances ?? 0),
        };
      });
    } catch {
      return {
        companies: 0,
        users: 0,
        accounts: 0,
        journalEntries: 0,
        items: 0,
        customers: 0,
        suppliers: 0,
        stockBalances: 0,
      };
    }
  }

  /// How far the Prisma migrations have got. Recorded so a restore can refuse
  /// an archive written by a newer program instead of silently losing the
  /// tables that program added.
  async prismaState(): Promise<{ appliedMigrations: number; lastMigration: string | null }> {
    try {
      return await withPgClient({}, async (client) => {
        const exists = await client.query<{ present: boolean }>(
          `SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`,
        );
        if (!exists.rows[0]?.present) return { appliedMigrations: 0, lastMigration: null };
        const result = await client.query<{ count: string; last: string | null }>(
          `SELECT count(*)::text AS count, max(migration_name) AS last
             FROM _prisma_migrations WHERE finished_at IS NOT NULL`,
        );
        return {
          appliedMigrations: Number(result.rows[0]?.count ?? 0),
          lastMigration: result.rows[0]?.last ?? null,
        };
      });
    } catch {
      return { appliedMigrations: 0, lastMigration: null };
    }
  }
}

/// Small helper used by other services and the tests: the top-level kind of an
/// archive by its name.
export function archiveKind(name: string): 'full' | 'safety' {
  return name.includes('-safety-') ? 'safety' : 'full';
}
