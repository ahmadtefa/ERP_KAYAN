import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AUDIT_PURGE_SETTING, AuditPurgeService } from '../../common/audit/audit-purge.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ResetService } from './reset.service';

jest.mock('argon2', () => ({
  verify: jest.fn(),
  hash: jest.fn(async () => 'hashed'),
}));

/// The reset is the one button that can erase a company's books, so the tests
/// are mostly about the ways it must refuse: the wrong person, the wrong
/// password, an unconfirmed request, a backup that did not work, and a second
/// press while the first is still running.
describe('ResetService', () => {
  const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
  const USER_ID = '22222222-2222-4222-8222-222222222222';

  let deletions: string[];
  let companyUpdates: unknown[];
  let userUpdates: unknown[];
  let auditRecords: Array<Record<string, unknown>>;
  let purgeSessions: string[];
  let purgeRecords: Array<Record<string, unknown>>;
  let linkStatements: string[];
  let failOn: string | null;

  /// The models the reset clears, and the order it clears them in.
  const MODELS = [
    'cashVoucherAllocation',
    'cashVoucher',
    'cashTransfer',
    'bankReconciliation',
    'cashAccount',
    'stockDocumentLine',
    'stockDocument',
    'openingBalanceLine',
    'openingBalance',
    'salesInvoiceLine',
    'purchaseInvoiceLine',
    'salesInvoice',
    'purchaseInvoice',
    'salesOrderLine',
    'purchaseOrderLine',
    'salesOrder',
    'purchaseOrder',
    'stockMovement',
    'stockBalance',
    'journalLine',
    'journalEntry',
    'itemUnit',
    'priceListItem',
    'customer',
    'supplier',
    'item',
    'priceList',
    'itemCategory',
    'assetDepreciation',
    'depreciationRun',
    'fixedAsset',
    'costCenter',
    'account',
    'companySetting',
    'fiscalPeriod',
    'documentSequence',
    'warehouse',
    'userPermission',
    'userRole',
    'userBranch',
    'rolePermission',
    'auditLog',
    'role',
    'user',
    'branch',
  ] as const;

  function transaction() {
    const tx: Record<string, unknown> = {
      $queryRaw: async () => [{ id: 'x' }],
      $executeRaw: async () => 1,
      // What the purge helper uses to announce the purge to this transaction
      // and to put the guard back on straight afterwards.
      $queryRawUnsafe: async (sql: string) => {
        const match = /set_config\('([^']+)', '(on|off)'/.exec(sql);
        if (match) purgeSessions.push(`${match[2]}`);
        return [{ set_config: 'ok' }];
      },
      // Clearing the trail's links to the people who are about to be deleted:
      // the rows are copied aside, deleted and written back without the link,
      // because the database refuses every UPDATE on that table.
      $executeRawUnsafe: async (sql: string) => {
        linkStatements.push(sql.replace(/\s+/g, ' ').trim());
        return sql.trimStart().startsWith('DELETE FROM audit_logs') ? 2 : 0;
      },
      company: {
        update: async (args: unknown) => {
          companyUpdates.push(args);
          return { id: COMPANY_ID };
        },
      },
    };
    for (const model of MODELS) {
      tx[model] = {
        deleteMany: async () => {
          if (failOn === model) throw new Error(`${model} failed`);
          deletions.push(model);
          return { count: 1 };
        },
        updateMany: async () => ({ count: 0 }),
        update: async (args: unknown) => {
          if (model === 'user') userUpdates.push(args);
          return {};
        },
        create: async (args: { data: Record<string, unknown> }) => {
          purgeRecords.push(args.data);
          return args.data;
        },
      };
    }
    return tx;
  }

  function prisma(user: {
    isSuperAdmin?: boolean;
    isActive?: boolean;
    companyDeletedAt?: Date | null;
    companyLogoPath?: string | null;
  }) {
    const tx = transaction();
    return {
      user: {
        findFirst: async () =>
          user === null
            ? null
            : {
                id: USER_ID,
                username: 'admin',
                passwordHash: 'stored-hash',
                isActive: user.isActive ?? true,
                isSuperAdmin: user.isSuperAdmin ?? true,
                companyId: COMPANY_ID,
                company: {
                  id: COMPANY_ID,
                  code: 'KAYAN',
                  deletedAt: user.companyDeletedAt ?? null,
                  logoPath: user.companyLogoPath ?? null,
                },
              },
        count: async () => 1,
      },
      company: {
        count: async () => 1,
        findUnique: async () => ({ code: 'KAYAN', nameEn: 'Kayan', nameAr: 'كيان' }),
      },
      journalEntry: { count: async () => 3 },
      account: { count: async () => 30 },
      customer: { count: async () => 4 },
      supplier: { count: async () => 2 },
      item: { count: async () => 5 },
      salesInvoice: { count: async () => 6 },
      purchaseInvoice: { count: async () => 2 },
      stockMovement: { count: async () => 7 },
      fiscalPeriod: { count: async () => 1 },
      branch: { count: async () => 1 },
      $transaction: async (work: (t: unknown) => Promise<unknown>) =>
        work(tx),
    };
  }

  const audit = { record: async (input: never) => void auditRecords.push({ ...(input as unknown as Record<string, unknown>) }) };

  function maintenance() {
    const state = { active: false, detail: null as string | null };
    return {
      get isActive() {
        return state.active;
      },
      begin(detail: string) {
        state.active = true;
        state.detail = detail;
      },
      end() {
        state.active = false;
        state.detail = null;
      },
      get status() {
        return { maintenance: state.active, detail: state.detail, since: null };
      },
    };
  }

  /// A backup service that succeeds, unless told otherwise.
  function backups(
    mode: 'ok' | 'dump-fails' | 'verify-fails' = 'ok',
  ) {
    return {
      createFull: async () => {
        if (mode === 'dump-fails') {
          throw new ServiceUnavailableException('pg_dump is missing');
        }
        return {
          file: { name: 'kayan-full-1.dump', sizeBytes: 1024, kind: 'full' },
          durationMs: 1,
        };
      },
      verify: async () => {
        if (mode === 'verify-fails') {
          throw new ServiceUnavailableException('the archive is damaged');
        }
        return {
          name: 'kayan-full-1.dump',
          sizeBytes: 1024,
          entries: 42,
          verifiedAt: new Date().toISOString(),
          tool: '/usr/bin/pg_restore',
        };
      },
    };
  }

  function service(
    options: {
      backups?: ReturnType<typeof backups>;
      user?: Parameters<typeof prisma>[0];
      companyBackups?: ReturnType<typeof mockCompanyBackups>;
    } = {},
  ) {
    return new ResetService(
      prisma(options.user ?? {}) as never,
      audit as never,
      new AuditPurgeService(),
      maintenance() as never,
      (options.backups ?? backups()) as never,
      (options.companyBackups ?? mockCompanyBackups()) as never,
    );
  }

  function mockCompanyBackups(fail = false) {
    return {
      create: async (companyId: string) => {
        if (fail) throw new Error('database read failure');
        return {
          format: 'kayan-backup',
          version: 1,
          createdAt: new Date().toISOString(),
          companyId,
          companyCode: 'KAYAN',
          companyName: 'Kayan',
          counts: { accounts: 30, journalEntries: 3 },
          tables: { accounts: [], journalEntries: [] },
        };
      },
      inspect: async (file: { companyId: string }, companyId: string) => {
        if (file.companyId !== companyId) throw new Error('wrong company backup');
        return { belongsToThisCompany: true };
      },
    };
  }

  const admin = (overrides: Partial<AuthUser> = {}): AuthUser => ({
    userId: USER_ID,
    username: 'admin',
    companyId: COMPANY_ID,
    branchId: null,
    isSuperAdmin: true,
    permissions: ['admin.company.manage'],
    ...overrides,
  });

  beforeEach(() => {
    deletions = [];
    companyUpdates = [];
    userUpdates = [];
    auditRecords = [];
    purgeSessions = [];
    purgeRecords = [];
    linkStatements = [];
    failOn = null;
    jest.mocked(argon2.verify).mockReset();
    jest.mocked(argon2.verify).mockResolvedValue(true);
  });

  it('verifies the administrator password against the stored hash', async () => {
    await service().reset(admin(), 'correct horse', 'RESET');
    expect(argon2.verify).toHaveBeenCalledWith('stored-hash', 'correct horse');
  });

  it('refuses the wrong password and deletes nothing', async () => {
    jest.mocked(argon2.verify).mockResolvedValue(false);
    await expect(
      service().reset(admin(), 'wrong', 'RESET'),
    ).rejects.toThrow(UnauthorizedException);
    expect(deletions).toEqual([]);
    expect(companyUpdates).toEqual([]);
  });

  it('refuses a principal who is not an administrator', async () => {
    await expect(
      service().reset(admin({ isSuperAdmin: false }), 'pw', 'RESET'),
    ).rejects.toThrow(ForbiddenException);
    expect(deletions).toEqual([]);
  });

  it('refuses when the account behind the token is no longer a super administrator', async () => {
    await expect(
      service({ user: { isSuperAdmin: false } }).reset(
        admin(),
        'pw',
        'RESET',
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(deletions).toEqual([]);
  });

  it('refuses when the account is deactivated', async () => {
    await expect(
      service({ user: { isActive: false } }).reset(admin(), 'pw', 'RESET'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('refuses without the typed confirmation', async () => {
    await expect(service().reset(admin(), 'pw', 'reset')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service().reset(admin(), 'pw', '')).rejects.toThrow(
      BadRequestException,
    );
    expect(deletions).toEqual([]);
  });

  it('clears the company and puts it back into the first-run state', async () => {
    const result = await service().reset(admin(), 'pw', 'RESET');
    expect(result.reset).toBe(true);
    expect(result.needsSetup).toBe(true);
    expect(result.backupFile).toBe('kayan-full-1.dump');
    // Every model above is cleared, in that order.
    expect(deletions).toEqual([...MODELS]);
    // The company is marked as not set up rather than destroyed.
    expect(companyUpdates).toHaveLength(1);
    const update = companyUpdates[0] as { data: { deletedAt: Date | null; logoData: null; logoMime: null; logoPath: null } };
    expect(update.data.deletedAt).toBeInstanceOf(Date);
    expect(update.data.logoData).toBeNull();
    expect(update.data.logoMime).toBeNull();
    expect(update.data.logoPath).toBeNull();
    expect(userUpdates).toContainEqual({
      where: { id: USER_ID },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        tokenVersion: { increment: 1 },
      },
    });
  });

  it('removes the reset company’s legacy logo file without following its stored path', async () => {
    const previousUploadDir = process.env.KAYAN_UPLOAD_DIR;
    const uploadDir = await mkdtemp(join(tmpdir(), 'kayan-reset-logo-'));
    const logoName = 'legacy-logo.png';
    const logoPath = join(uploadDir, logoName);
    await writeFile(logoPath, 'test logo');
    process.env.KAYAN_UPLOAD_DIR = uploadDir;

    try {
      await service({ user: { companyLogoPath: `../outside/${logoName}` } }).reset(
        admin(),
        'pw',
        'RESET',
      );

      await expect(stat(logoPath)).rejects.toMatchObject({ code: 'ENOENT' });
      const update = companyUpdates[0] as { data: { logoPath: null } };
      expect(update.data.logoPath).toBeNull();
    } finally {
      if (previousUploadDir === undefined) delete process.env.KAYAN_UPLOAD_DIR;
      else process.env.KAYAN_UPLOAD_DIR = previousUploadDir;
      await rm(uploadDir, { recursive: true, force: true });
    }
  });

  it('records the reset in the audit trail without the password', async () => {
    await service().reset(admin(), 'super secret', 'RESET');
    expect(auditRecords).toHaveLength(1);
    const entry = auditRecords[0]!;
    expect(entry.action).toBe('RESET');
    expect(entry.entity).toBe('company_data');
    expect(JSON.stringify(entry)).not.toContain('super secret');
    expect(JSON.stringify(entry)).toContain('kayan-full-1.dump');
  });

  it('purges the trail through the guard, and puts the guard back on', async () => {
    await service().reset(admin(), 'pw', 'RESET');
    // The database refuses to delete audit rows unless the transaction has
    // announced itself as a purge: on first, off immediately after.
    expect(purgeSessions).toEqual(['on', 'off']);
    expect(purgeSessions.filter((value) => value === 'off')).toHaveLength(1);
  });

  it('clears the trail’s links to the people it is about to delete, before they go', async () => {
    await service().reset(admin(), 'pw', 'RESET');

    // Three statements, in this order: copy the affected rows aside, delete
    // them under the guard, write them back with the same id and timestamp and
    // without the link. An UPDATE is impossible: the database refuses every
    // one of them, guard or no guard.
    expect(linkStatements).toHaveLength(3);
    expect(linkStatements[0]).toMatch(/^CREATE TEMP TABLE .* AS SELECT .* FROM audit_logs/);
    expect(linkStatements[1]).toMatch(/^DELETE FROM audit_logs WHERE "userId" IN/);
    expect(linkStatements[2]).toMatch(/^INSERT INTO audit_logs .*SELECT id, "companyId", NULL/);

    // Rows of the company being wiped are left to the purge itself, which
    // deletes them a moment later.
    expect(linkStatements[0]).toContain(`"companyId" IS DISTINCT FROM $2::uuid`);
    expect(linkStatements[0]).toContain(`"companyId" = $1::uuid`);

    // The people are deleted after the links are cleared, not before: that
    // order is the whole point.
    expect(deletions.indexOf('user')).toBeGreaterThan(deletions.indexOf('auditLog'));
    expect(purgeSessions).toEqual(['on', 'off']);

    // And the purge says how many rows had their link cleared.
    expect((purgeRecords[0]!.afterJson as Record<string, unknown>).detachedLinksToUsers).toBe(2);
  });

  it('leaves a record of the purge, naming the operation and the administrator', async () => {
    await service().reset(admin(), 'pw', 'RESET');
    expect(purgeRecords).toHaveLength(1);
    const record = purgeRecords[0]!;
    expect(record.action).toBe('AUDIT_PURGED');
    expect(record.entity).toBe('audit_logs');
    expect(record.companyId).toBe(COMPANY_ID);
    expect(record.userId).toBe(USER_ID);
    expect((record.afterJson as Record<string, unknown>).reason).toBe(
      'company-data-reset',
    );
    // The guard's own name never appears in the record; what appears is the
    // operation a person can read.
    expect(JSON.stringify(record)).not.toContain(AUDIT_PURGE_SETTING);
  });

  it('does not reset when the backup cannot be taken', async () => {
    await expect(
      service({
        backups: backups('dump-fails'),
        companyBackups: mockCompanyBackups(true),
      }).reset(admin(), 'pw', 'RESET'),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(deletions).toEqual([]);
    expect(companyUpdates).toEqual([]);
  });

  it('does not reset when the backup cannot be verified', async () => {
    await expect(
      service({
        backups: backups('verify-fails'),
        companyBackups: mockCompanyBackups(true),
      }).reset(
        admin(),
        'pw',
        'RESET',
      ),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(deletions).toEqual([]);
    expect(companyUpdates).toEqual([]);
  });

  it('rolls the clearing back when one step fails', async () => {
    failOn = 'customer';
    await expect(service().reset(admin(), 'pw', 'RESET')).rejects.toThrow(
      'customer failed',
    );
    // Nothing after the failing step ran, and the company was never marked.
    expect(deletions).not.toContain('branch');
    expect(companyUpdates).toEqual([]);
    expect(auditRecords).toEqual([]);
  });

  it('refuses a second reset while one is still running', async () => {
    const slow = {
      createFull: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return {
          file: { name: 'kayan-full-1.dump', sizeBytes: 10, kind: 'full' },
          durationMs: 1,
        };
      },
      verify: async () => ({
        name: 'kayan-full-1.dump',
        sizeBytes: 10,
        entries: 1,
        verifiedAt: new Date().toISOString(),
        tool: '/usr/bin/pg_restore',
      }),
    };
    const shared = service({ backups: slow as never });
    const first = shared.reset(admin(), 'pw', 'RESET');
    await expect(shared.reset(admin(), 'pw', 'RESET')).rejects.toThrow(
      ServiceUnavailableException,
    );
    await first;
    // And it lets go afterwards, so the next one can run.
    await expect(shared.reset(admin(), 'pw', 'RESET')).resolves.toMatchObject({
      reset: true,
    });
  });

  it('counts what a reset would remove, so the warning can name it', async () => {
    const preview = await service().preview(COMPANY_ID);
    expect(preview.companyCode).toBe('KAYAN');
    expect(preview.counts).toMatchObject({
      journalEntries: 3,
      accounts: 30,
      customers: 4,
    });
    expect(preview.confirmationWord).toBe('RESET');
    // The administrator keeping their account is not counted as a deletion.
    expect(preview.counts.users).toBe(0);
  });

  it('creates a private, verified company JSON safety backup when full backup tools are unavailable', async () => {
    const backupDir = await mkdtemp(join(tmpdir(), 'kayan-reset-backup-'));
    try {
      const noToolsBackups = {
        capabilities: async () => ({ available: false }),
        createFull: async () => {
          throw new Error('pg_dump unavailable');
        },
        verify: async () => {
          throw new Error('pg_restore unavailable');
        },
        ensureBackupDir: async () => backupDir,
      };
      const result = await service({ backups: noToolsBackups as never }).reset(
        admin(),
        'pw',
        'RESET',
      );
      expect(result.reset).toBe(true);
      expect(result.backupFile).toMatch(/\.json$/);
      expect(result.backupBytes).toBeGreaterThan(0);
      expect(result.backupEntries).toBeGreaterThan(0);
      expect(deletions).toEqual([...MODELS]);

      const file = await stat(join(backupDir, result.backupFile));
      if (process.platform !== 'win32') expect(file.mode & 0o777).toBe(0o600);
    } finally {
      await rm(backupDir, { recursive: true, force: true });
    }
  });

  it('aborts and deletes nothing when both full backup and company backup fail', async () => {
    const failingBackups = {
      capabilities: async () => ({ available: false }),
      createFull: async () => {
        throw new Error('pg_dump unavailable');
      },
      verify: async () => {
        throw new Error('pg_restore unavailable');
      },
      ensureBackupDir: async () => '/tmp/kayan-spec-backups',
    };
    await expect(
      service({
        backups: failingBackups as never,
        companyBackups: mockCompanyBackups(true),
      }).reset(admin(), 'pw', 'RESET'),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(deletions).toEqual([]);
    expect(companyUpdates).toEqual([]);
  });
});
