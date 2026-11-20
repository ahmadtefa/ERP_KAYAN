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
    const dir = mkdtempSync(join(tmpdir(), 'kayan-restore-admin-'));
    try {
      const file = join(dir, 'admin-url');
      writeFileSync(file, 'postgresql://restore_admin:pw@localhost:5432/postgres');
      chmodSync(file, 0o644);
      process.env.KAYAN_RESTORE_ADMIN_FILE = file;
      const status = await restoreAdminStatus();
      expect(status.configured).toBe(true);
      expect(status.usable).toBe(false);
      expect(status.reason).toMatch(/readable by other users/);
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
