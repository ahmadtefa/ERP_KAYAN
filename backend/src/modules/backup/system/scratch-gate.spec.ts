import { mayCreateDatabase, scratchToolEnv } from './pg-support';
import { restoreAdminStatus } from './restore-admin';

jest.mock('./restore-admin', () => ({
  ...jest.requireActual('./restore-admin'),
  restoreAdminStatus: jest.fn(),
}));
const status = restoreAdminStatus as jest.MockedFunction<typeof restoreAdminStatus>;

describe('scratch rehearsal gate uses the actual configured account', () => {
  afterEach(() => jest.resetAllMocks());

  it('refuses a broken configured administrator even if runtime might have CREATEDB', async () => {
    status.mockResolvedValue({configured: true, sameServer: false, mayCreate: false, usable: false, path: null, reason: 'different PostgreSQL server'});
    const result = await mayCreateDatabase();
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/different PostgreSQL server/);
    expect(result.reason).toMatch(/KAYAN_RESTORE_ADMIN/);
  });

  it('reports the dedicated administrator path when ready', async () => {
    status.mockResolvedValue({configured: true, sameServer: true, mayCreate: true, usable: true, path: 'restore-admin', reason: null});
    await expect(mayCreateDatabase()).resolves.toEqual({allowed: true, reason: null, path: 'restore-admin'});
  });

  it('does not silently fall back to runtime for a broken configured credential file', async () => {
    const oldUrl = process.env.KAYAN_RESTORE_ADMIN_DATABASE_URL;
    const oldFile = process.env.KAYAN_RESTORE_ADMIN_FILE;
    delete process.env.KAYAN_RESTORE_ADMIN_DATABASE_URL;
    process.env.KAYAN_RESTORE_ADMIN_FILE = 'relative-invalid';
    status.mockResolvedValue({configured: true, sameServer: false, mayCreate: false, usable: false, path: null, reason: 'credential file invalid'});
    try {
      await expect(scratchToolEnv()).rejects.toThrow(/configured but unusable/);
    } finally {
      if (oldUrl === undefined) delete process.env.KAYAN_RESTORE_ADMIN_DATABASE_URL;
      else process.env.KAYAN_RESTORE_ADMIN_DATABASE_URL = oldUrl;
      if (oldFile === undefined) delete process.env.KAYAN_RESTORE_ADMIN_FILE;
      else process.env.KAYAN_RESTORE_ADMIN_FILE = oldFile;
    }
  });
});
