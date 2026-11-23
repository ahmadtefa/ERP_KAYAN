import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  restoreAdminStatus,
  scratchDatabaseActor,
  selfCreatedScratchName,
} from './restore-admin';

describe('restore-admin: the limited-privilege restore account', () => {
  const originalUrl = process.env.KAYAN_RESTORE_ADMIN_DATABASE_URL;
  const originalFile = process.env.KAYAN_RESTORE_ADMIN_FILE;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.KAYAN_RESTORE_ADMIN_DATABASE_URL;
    else process.env.KAYAN_RESTORE_ADMIN_DATABASE_URL = originalUrl;
    if (originalFile === undefined) delete process.env.KAYAN_RESTORE_ADMIN_FILE;
    else process.env.KAYAN_RESTORE_ADMIN_FILE = originalFile;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('only names that look like this program\'s scratch databases may be created or dropped', () => {
    expect(selfCreatedScratchName('kayan_restore_check_abc123')).toBe(true);
    expect(selfCreatedScratchName('kayan_rehearsal_x')).toBe(true);
    expect(selfCreatedScratchName('postgres')).toBe(false);
    expect(selfCreatedScratchName('kayan_inv')).toBe(false);
    expect(selfCreatedScratchName('kayan_restore_check_; DROP DATABASE x')).toBe(false);
    expect(selfCreatedScratchName('../escape')).toBe(false);
  });

  it('takes the credential from the environment without ever returning it', async () => {
    process.env.DATABASE_URL = 'postgresql://runtime:secret-runtime@db-host:5432/kayan_inv';
    process.env.KAYAN_RESTORE_ADMIN_DATABASE_URL =
      'postgresql://restore_admin:secret-admin@db-host:5432/postgres';
    const status = await restoreAdminStatus();
    const actor = scratchDatabaseActor();
    expect(status.configured).toBe(true);
    expect(actor?.path).toBe('restore-admin');
    // The actor holds the credential on purpose — it feeds the tools. What
    // leaves the process is `status`, and it must carry nothing secret.
    const disclosed = JSON.stringify({ status }) + String(status.reason);
    expect(disclosed).not.toContain('secret-admin');
    expect(disclosed).not.toContain('secret-runtime');
    expect(disclosed).not.toContain('restore_admin');
    expect(disclosed).not.toContain('pw@');
  });

  it('refuses a restore-admin on a different server than the program', async () => {
    process.env.DATABASE_URL = 'postgresql://runtime:pw@db-host:5432/kayan_inv';
    process.env.KAYAN_RESTORE_ADMIN_DATABASE_URL =
      'postgresql://restore_admin:pw@other-host:5432/postgres';
    const status = await restoreAdminStatus();
    expect(status.sameServer).toBe(false);
    expect(status.usable).toBe(false);
    expect(status.reason).toMatch(/different PostgreSQL server/);
    expect(scratchDatabaseActor()).toBeNull();
  });

  it('refuses an admin when the runtime server cannot be verified', async () => {
    delete process.env.DATABASE_URL;
    process.env.KAYAN_RESTORE_ADMIN_DATABASE_URL = 'postgresql://restore_admin:pw@localhost:5432/postgres';
    const status = await restoreAdminStatus();
    expect(status).toMatchObject({ configured: true, usable: false, sameServer: false });
    expect(status.reason).toMatch(/DATABASE_URL/);
    expect(scratchDatabaseActor()).toBeNull();
  });

  it('refuses a credential file other users can read', async () => {
    // The permission bits this test sets mean nothing on Windows: there is no
    // POSIX mode, `chmodSync(0o644)` is a no-op, and `restore-admin.ts`
    // deliberately skips the check there rather than pretend. Asserting the
    // POSIX outcome on a Windows runner made the whole backend suite - and so
    // the Windows build - fail on a rule that was never in force, which is the
    // one thing this job must not do: a real failure and a platform
    // difference have to look different.
    const posix = process.platform !== 'win32';
    const dir = mkdtempSync(join(tmpdir(), 'kayan-restore-admin-'));
    try {
      const file = join(dir, 'admin-url');
      writeFileSync(file, 'postgresql://restore_admin:pw@localhost:5432/postgres');
      if (posix) chmodSync(file, 0o644);
      process.env.KAYAN_RESTORE_ADMIN_FILE = file;
      const status = await restoreAdminStatus();
      expect(status.configured).toBe(true);
      if (posix) {
        expect(status.usable).toBe(false);
        expect(status.reason).toMatch(/readable by other users/);
      } else {
        // On Windows the credential is read rather than refused for its mode
        // bits. Whether it is *usable* still depends on the runtime server
        // check that follows, so the honest assertion is that the refusal is
        // no longer the permission one - and that nothing secret is returned.
        expect(status.reason ?? '').not.toMatch(/readable by other users/);
        expect(JSON.stringify(status)).not.toContain('pw@');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports "not configured" quietly when nothing is set', async () => {
    delete process.env.KAYAN_RESTORE_ADMIN_DATABASE_URL;
    delete process.env.KAYAN_RESTORE_ADMIN_FILE;
    process.env.DATABASE_URL = 'postgresql://runtime:pw@localhost:5432/kayan_inv';
    const status = await restoreAdminStatus();
    expect(status).toMatchObject({ configured: false, usable: false, path: null });
  });
});
