import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
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

  describe('recovery safety', () => {
    it('keeps maintenance active when restoring the safety backup also fails', async () => {
      const state: { active: boolean; detail: string | null } = {
        active: false,
        detail: null,
      };
      const maintenance = {
        get isActive() {
          return state.active;
        },
        get status() {
          return { maintenance: state.active, detail: state.detail, since: null };
        },
        begin(detail: string) {
          state.active = true;
          state.detail = detail;
        },
        end() {
          state.active = false;
          state.detail = null;
        },
      };
      const service = new FullBackupService(
        {} as any,
        { record: async () => {} } as any,
        maintenance as any,
      );
      jest.spyOn(service as any, 'safePath').mockReturnValue('/tmp/kayan-safety.dump');
      jest.spyOn(service as any, 'connectionArgs').mockReturnValue([]);
      jest.mocked(childProcess.execFile).mockImplementation(
        ((_, __, ___, callback) => {
          const complete = callback as (
            error: Error | null,
            stdout: string,
            stderr: string,
          ) => void;
          complete(new Error('restore failed'), '', 'restore failed');
          return {} as childProcess.ChildProcess;
        }) as typeof childProcess.execFile,
      );

      await expect(
        (service as any).recoverFrom('kayan-safety-2026-01-01.dump', 'pg_restore'),
      ).resolves.toBe(false);
      expect(maintenance.isActive).toBe(true);
      expect(maintenance.status.detail).toContain('ATTENTION');
    });
  });

  describe('restore', () => {
    it('rejects concurrent full restores before starting a second restore', async () => {
      const service = serviceWithEnv(temporaryDir('kayan-backups-'));
      let finish!: (value: { restored: boolean }) => void;
      jest.spyOn(service as any, 'restoreOnce').mockImplementation(
        () => new Promise((resolvePromise) => { finish = resolvePromise; }),
      );

      const first = service.restore({ confirm: true }, 'u1');
      await Promise.resolve();

      await expect(
        service.restore({ confirm: true }, 'u2'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      finish({ restored: true });
      await expect(first).resolves.toEqual({ restored: true });
    });

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
});
