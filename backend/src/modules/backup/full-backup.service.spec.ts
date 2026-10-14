import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as childProcess from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { FullBackupService } from './full-backup.service';

jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execFile: jest.fn(),
}));

/// What protects the backup folder from a crafted file name, and what
/// protects the database from a file that is not a backup at all.
describe('FullBackupService guards', () => {
  const originalBackupDir = process.env.KAYAN_BACKUP_DIR;
  const originalPgDump = process.env.KAYAN_PG_DUMP;
  const originalPgRestore = process.env.KAYAN_PG_RESTORE;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const temporaryDirs: string[] = [];

  function mockPgDumpVersion(version: string): void {
    jest.mocked(childProcess.execFile).mockImplementation(
      ((_, __, ___, callback) => {
        const complete = callback as (
          error: Error | null,
          stdout: string,
          stderr: string,
        ) => void;
        complete(null, version, '');
        return {} as childProcess.ChildProcess;
      }) as typeof childProcess.execFile,
    );
  }

  afterEach(() => {
    if (originalBackupDir === undefined) {
      delete process.env.KAYAN_BACKUP_DIR;
    } else {
      process.env.KAYAN_BACKUP_DIR = originalBackupDir;
    }
    if (originalPgDump === undefined) {
      delete process.env.KAYAN_PG_DUMP;
    } else {
      process.env.KAYAN_PG_DUMP = originalPgDump;
    }
    if (originalPgRestore === undefined) {
      delete process.env.KAYAN_PG_RESTORE;
    } else {
      process.env.KAYAN_PG_RESTORE = originalPgRestore;
    }
    jest.mocked(childProcess.execFile).mockReset();
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    for (const dir of temporaryDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function temporaryDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    temporaryDirs.push(dir);
    return dir;
  }

  function serviceWithEnv(dir: string) {
    process.env.KAYAN_BACKUP_DIR = dir;
    const service = new FullBackupService(
      {} as any,
      { record: async () => {} } as any,
      { begin() {}, end() {}, isActive: false, status: {} } as any,
    );
    return service;
  }

  describe('safePath', () => {
    it('accepts a plain backup file name', () => {
      const dir = temporaryDir('kayan-backups-');
      const service = serviceWithEnv(dir);
      const path = (service as any).safePath('kayan-full-2026-01-01.dump');
      expect(path).toBe(resolve(dir, 'kayan-full-2026-01-01.dump'));
    });

    it('refuses path traversal and separators', () => {
      const dir = temporaryDir('kayan-backups-');
      const service = serviceWithEnv(dir);
      for (const name of [
        '../secrets.dump',
        'a/b.dump',
        '..\\x.dump',
        resolve(dir, 'passwd.dump'),
        'kayan-full.dump/../../x',
      ]) {
        expect(() => (service as any).safePath(name)).toThrow(
          BadRequestException,
        );
      }
    });

    it('refuses names that are not .dump files', () => {
      const service = serviceWithEnv(temporaryDir('kayan-backups-'));
      expect(() => (service as any).safePath('notes.txt')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('assertCustomDump', () => {
    it('refuses a file without the PGDMP magic', () => {
      const service = serviceWithEnv(temporaryDir('kayan-backups-'));
      expect(() =>
        (service as any).assertCustomDump(
          Buffer.from('this is not a dump'),
          'x.dump',
        ),
      ).toThrow(BadRequestException);
    });

    it('refuses an empty file', () => {
      const service = serviceWithEnv(temporaryDir('kayan-backups-'));
      expect(() =>
        (service as any).assertCustomDump(Buffer.alloc(0), 'x.dump'),
      ).toThrow(BadRequestException);
    });

    it('accepts the Custom-format magic', () => {
      const service = serviceWithEnv(temporaryDir('kayan-backups-'));
      const dump = Buffer.concat([
        Buffer.from('PGDMP', 'latin1'),
        Buffer.alloc(64),
      ]);
      expect(() =>
        (service as any).assertCustomDump(dump, 'x.dump'),
      ).not.toThrow();
    });
  });

  describe('capabilities', () => {
    it('warns when pg_dump is older than the database server', async () => {
      const dir = temporaryDir('kayan-pg-');
      const fakeDump = join(dir, 'pg_dump');
      writeFileSync(fakeDump, '');
      process.env.KAYAN_PG_DUMP = fakeDump;
      process.env.KAYAN_PG_RESTORE = fakeDump;
      mockPgDumpVersion('pg_dump (PostgreSQL) 12.4');

      const prisma = {
        $queryRaw: async () => [{ v: '16.2' }],
      } as any;
      const service = new FullBackupService(
        prisma,
        { record: async () => {} } as any,
        { begin() {}, end() {}, isActive: false, status: {} } as any,
      );

      const caps = await service.capabilities();
      expect(caps.available).toBe(true);
      expect(caps.serverVersion).toBe('16.2');
      expect(caps.warning).toContain('version 12');
      expect(caps.warning).toContain('16');
    });

    it('stays quiet when the tools match the server', async () => {
      const dir = temporaryDir('kayan-pg-');
      const fakeDump = join(dir, 'pg_dump');
      writeFileSync(fakeDump, '');
      process.env.KAYAN_PG_DUMP = fakeDump;
      process.env.KAYAN_PG_RESTORE = fakeDump;
      mockPgDumpVersion('pg_dump (PostgreSQL) 16.2');

      const service = new FullBackupService(
        { $queryRaw: async () => [{ v: '16.2' }] } as any,
        { record: async () => {} } as any,
        { begin() {}, end() {}, isActive: false, status: {} } as any,
      );
      const caps = await service.capabilities();
      expect(caps.warning).toBeNull();
    });
  });

  describe('restore', () => {
    it('refuses to run without an explicit confirmation', async () => {
      const service = serviceWithEnv(temporaryDir('kayan-backups-'));
      await expect(
        service.restore({ confirm: false }, 'u1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to run with no file at all', async () => {
      const service = serviceWithEnv(temporaryDir('kayan-backups-'));
      await expect(service.restore({ confirm: true }, 'u1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('machine problems are explained, never "unexpected server error"', () => {
    function fakeTools(dir: string): void {
      const tool = join(dir, 'pg_dump');
      writeFileSync(tool, '');
      process.env.KAYAN_PG_DUMP = tool;
      process.env.KAYAN_PG_RESTORE = tool;
      // The command line is built from the connection string; it never
      // leaves the process environment, but it has to exist.
      process.env.DATABASE_URL =
        'postgresql://test:test@127.0.0.1:5432/kayan_test';
      mockPgDumpVersion('pg_dump (PostgreSQL) 16.2');
    }

    it('a backup folder that cannot be created says so and names KAYAN_BACKUP_DIR', async () => {
      // A folder path under a plain file cannot be created on any system -
      // the same failure as a read-only Program Files install on Windows.
      const dir = temporaryDir('kayan-backups-');
      const blocker = join(dir, 'blocker');
      writeFileSync(blocker, 'not a folder');
      process.env.KAYAN_BACKUP_DIR = join(blocker, 'backups');
      fakeTools(dir);

      const service = new FullBackupService(
        {} as any,
        { record: async () => {} } as any,
        { begin() {}, end() {}, isActive: false, status: {} } as any,
      );
      await expect(service.createFull('u1')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      await expect(service.createFull('u1')).rejects.toThrow(/KAYAN_BACKUP_DIR/);
    });

    it('a missing backup file is a 404, not a crash', async () => {
      const service = serviceWithEnv(temporaryDir('kayan-backups-'));
      await expect(service.read('kayan-full-2026-01-01-00-00-00.dump')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.remove('kayan-full-2026-01-01-00-00-00.dump', 'u1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a full backup is reported only after the file exists and is a real archive', async () => {
      const dir = temporaryDir('kayan-backups-');
      fakeTools(dir);
      // The "pg_dump" writes a Custom-format file where it was told to.
      jest.mocked(childProcess.execFile).mockImplementation(
        ((_, args, ___, callback) => {
          const fileArg = (args as string[]).find((a) => a.startsWith('--file='));
          writeFileSync(
            String(fileArg).slice('--file='.length),
            Buffer.concat([Buffer.from('PGDMP', 'latin1'), Buffer.alloc(32)]),
          );
          const complete = callback as (
            error: Error | null,
            stdout: string,
            stderr: string,
          ) => void;
          complete(null, '', '');
          return {} as childProcess.ChildProcess;
        }) as typeof childProcess.execFile,
      );

      const audits: unknown[] = [];
      const service = new FullBackupService(
        {} as any,
        { record: async (input: unknown) => audits.push(input) } as any,
        { begin() {}, end() {}, isActive: false, status: {} } as any,
      );
      const result = await service.createFull('u1');
      expect(result.file.name).toMatch(/^kayan-full-.*\.dump$/);
      expect(result.file.sizeBytes).toBeGreaterThan(0);
      expect(audits).toHaveLength(1);
    });

    it('a backup that is not a PGDMP archive is discarded and refused', async () => {
      const dir = temporaryDir('kayan-backups-');
      fakeTools(dir);
      jest.mocked(childProcess.execFile).mockImplementation(
        ((_, args, ___, callback) => {
          const fileArg = (args as string[]).find((a) => a.startsWith('--file='));
          writeFileSync(String(fileArg).slice('--file='.length), 'not a dump');
          const complete = callback as (
            error: Error | null,
            stdout: string,
            stderr: string,
          ) => void;
          complete(null, '', '');
          return {} as childProcess.ChildProcess;
        }) as typeof childProcess.execFile,
      );

      const service = new FullBackupService(
        {} as any,
        { record: async () => {} } as any,
        { begin() {}, end() {}, isActive: false, status: {} } as any,
      );
      await expect(service.createFull('u1')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('an unreadable DATABASE_URL is a machine problem, not a crashed URL parser', async () => {
      const dir = temporaryDir('kayan-backups-');
      fakeTools(dir);
      // What a shell that lost its quoting, or a half-written .env, hands
      // over: `new URL` used to throw a TypeError here, and the screen got
      // the least helpful message the program can produce.
      process.env.DATABASE_URL = 'not a database url';
      const service = new FullBackupService(
        {} as any,
        { record: async () => {} } as any,
        { begin() {}, end() {}, isActive: false, status: {} } as any,
      );
      await expect(service.createFull('u1')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      await expect(service.createFull('u1')).rejects.toThrow(/DATABASE_URL/);
    });

    it('a missing DATABASE_URL says which setting is missing', async () => {
      const dir = temporaryDir('kayan-backups-');
      fakeTools(dir);
      delete process.env.DATABASE_URL;
      const service = new FullBackupService(
        {} as any,
        { record: async () => {} } as any,
        { begin() {}, end() {}, isActive: false, status: {} } as any,
      );
      await expect(service.createFull('u1')).rejects.toThrow(/DATABASE_URL/);
    });
  });

  describe('verify', () => {
    function fakeTools(dir: string): void {
      const tool = join(dir, 'pg_dump');
      writeFileSync(tool, '');
      process.env.KAYAN_PG_DUMP = tool;
      process.env.KAYAN_PG_RESTORE = tool;
      process.env.DATABASE_URL =
        'postgresql://test:test@127.0.0.1:5432/kayan_test';
      mockPgDumpVersion('pg_dump (PostgreSQL) 16.2');
    }

    it('proves an archive can be read back, not merely that it exists', async () => {
      const dir = temporaryDir('kayan-backups-');
      fakeTools(dir);
      process.env.KAYAN_BACKUP_DIR = dir;
      writeFileSync(
        join(dir, 'kayan-full-2026-01-01-00-00-00.dump'),
        Buffer.concat([Buffer.from('PGDMP', 'latin1'), Buffer.alloc(64)]),
      );
      // `pg_restore --list` prints one line per object; the leading ";"
      // lines are comments and must not be counted as objects.
      jest.mocked(childProcess.execFile).mockImplementation(
        ((_, args, ___, callback) => {
          const complete = callback as (
            error: Error | null,
            stdout: string,
            stderr: string,
          ) => void;
          const isList = (args as string[]).includes('--list');
          complete(
            null,
            isList
              ? ';\n; Archive created at 2026-01-01\n; dbname: kayan\n216; 1259 TABLE public companies\n217; 0 TABLE DATA public companies\n'
              : '',
            '',
          );
          return {} as childProcess.ChildProcess;
        }) as typeof childProcess.execFile,
      );

      const service = new FullBackupService(
        {} as any,
        { record: async () => {} } as any,
        { begin() {}, end() {}, isActive: false, status: {} } as any,
      );
      const verified = await service.verify(
        'kayan-full-2026-01-01-00-00-00.dump',
      );
      expect(verified.entries).toBe(2);
      expect(verified.sizeBytes).toBe(69);
    });

    it('refuses an archive that holds no objects', async () => {
      const dir = temporaryDir('kayan-backups-');
      fakeTools(dir);
      process.env.KAYAN_BACKUP_DIR = dir;
      writeFileSync(
        join(dir, 'kayan-full-empty.dump'),
        Buffer.concat([Buffer.from('PGDMP', 'latin1'), Buffer.alloc(8)]),
      );
      jest.mocked(childProcess.execFile).mockImplementation(
        ((_, __, ___, callback) => {
          const complete = callback as (
            error: Error | null,
            stdout: string,
            stderr: string,
          ) => void;
          complete(null, ';\n; nothing here\n', '');
          return {} as childProcess.ChildProcess;
        }) as typeof childProcess.execFile,
      );

      const service = new FullBackupService(
        {} as any,
        { record: async () => {} } as any,
        { begin() {}, end() {}, isActive: false, status: {} } as any,
      );
      await expect(service.verify('kayan-full-empty.dump')).rejects.toThrow(
        /no database objects/,
      );
    });

    it('refuses a file that is not an archive at all', async () => {
      const dir = temporaryDir('kayan-backups-');
      fakeTools(dir);
      process.env.KAYAN_BACKUP_DIR = dir;
      writeFileSync(join(dir, 'kayan-full-text.dump'), 'hello');
      const service = new FullBackupService(
        {} as any,
        { record: async () => {} } as any,
        { begin() {}, end() {}, isActive: false, status: {} } as any,
      );
      await expect(service.verify('kayan-full-text.dump')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe('restore guards', () => {
    function fakeTools(dir: string): void {
      const tool = join(dir, 'pg_dump');
      writeFileSync(tool, '');
      process.env.KAYAN_PG_DUMP = tool;
      process.env.KAYAN_PG_RESTORE = tool;
      process.env.DATABASE_URL =
        'postgresql://test:test@127.0.0.1:5432/kayan_test';
      mockPgDumpVersion('pg_dump (PostgreSQL) 16.2');
    }

    it('refuses a second restore while one is already running', async () => {
      const dir = temporaryDir('kayan-backups-');
      fakeTools(dir);
      const service = new FullBackupService(
        {} as any,
        { record: async () => {} } as any,
        { begin() {}, end() {}, isActive: true, status: {} } as any,
      );
      await expect(
        service.restore({ confirm: true, fileName: 'x.dump' }, 'u1'),
      ).rejects.toThrow(/already running/);
    });
  });
});
