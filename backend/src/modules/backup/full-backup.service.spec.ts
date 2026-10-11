import { BadRequestException } from '@nestjs/common';
import { chmodSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { FullBackupService } from './full-backup.service';

/// What protects the backup folder from a crafted file name, and what
/// protects the database from a file that is not a backup at all.
describe('FullBackupService guards', () => {
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
      const service = serviceWithEnv('/tmp/backups');
      const path = (service as any).safePath('kayan-full-2026-01-01.dump');
      expect(path).toBe('/tmp/backups/kayan-full-2026-01-01.dump');
    });

    it('refuses path traversal and separators', () => {
      const service = serviceWithEnv('/tmp/backups');
      for (const name of [
        '../secrets.dump',
        'a/b.dump',
        '..\\x.dump',
        '/etc/passwd.dump',
        'kayan-full.dump/../../x',
      ]) {
        expect(() => (service as any).safePath(name)).toThrow(
          BadRequestException,
        );
      }
    });

    it('refuses names that are not .dump files', () => {
      const service = serviceWithEnv('/tmp/backups');
      expect(() => (service as any).safePath('notes.txt')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('assertCustomDump', () => {
    it('refuses a file without the PGDMP magic', () => {
      const service = serviceWithEnv('/tmp/backups');
      expect(() =>
        (service as any).assertCustomDump(
          Buffer.from('this is not a dump'),
          'x.dump',
        ),
      ).toThrow(BadRequestException);
    });

    it('refuses an empty file', () => {
      const service = serviceWithEnv('/tmp/backups');
      expect(() =>
        (service as any).assertCustomDump(Buffer.alloc(0), 'x.dump'),
      ).toThrow(BadRequestException);
    });

    it('accepts the Custom-format magic', () => {
      const service = serviceWithEnv('/tmp/backups');
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
      // A stand-in pg_dump that reports version 12, against a server on 16.
      const dir = mkdtempSync(join(tmpdir(), 'kayan-pg-'));
      const fakeDump = join(dir, 'pg_dump');
      writeFileSync(fakeDump, '#!/bin/sh\necho "pg_dump (PostgreSQL) 12.4"\n');
      chmodSync(fakeDump, 0o755);
      process.env.KAYAN_PG_DUMP = fakeDump;
      process.env.KAYAN_PG_RESTORE = fakeDump;

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

      delete process.env.KAYAN_PG_DUMP;
      delete process.env.KAYAN_PG_RESTORE;
    });

    it('stays quiet when the tools match the server', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'kayan-pg-'));
      const fakeDump = join(dir, 'pg_dump');
      writeFileSync(fakeDump, '#!/bin/sh\necho "pg_dump (PostgreSQL) 16.2"\n');
      chmodSync(fakeDump, 0o755);
      process.env.KAYAN_PG_DUMP = fakeDump;
      process.env.KAYAN_PG_RESTORE = fakeDump;

      const service = new FullBackupService(
        { $queryRaw: async () => [{ v: '16.2' }] } as any,
        { record: async () => {} } as any,
        { begin() {}, end() {}, isActive: false, status: {} } as any,
      );
      const caps = await service.capabilities();
      expect(caps.warning).toBeNull();

      delete process.env.KAYAN_PG_DUMP;
      delete process.env.KAYAN_PG_RESTORE;
    });
  });

  describe('restore', () => {
    it('refuses to run without an explicit confirmation', async () => {
      const service = serviceWithEnv('/tmp/backups');
      await expect(
        service.restore({ confirm: false }, 'u1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to run with no file at all', async () => {
      const service = serviceWithEnv('/tmp/backups');
      await expect(service.restore({ confirm: true }, 'u1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
