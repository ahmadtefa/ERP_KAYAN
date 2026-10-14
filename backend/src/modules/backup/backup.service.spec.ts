import { BadRequestException } from '@nestjs/common';

import { AUDIT_PURGE_SETTING, AuditPurgeService } from '../../common/audit/audit-purge.service';
import { BackupController } from './backup.controller';
import { BackupFile, BackupService } from './backup.service';

describe('BackupService & BackupController (Company JSON Backup)', () => {
  const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
  let service: BackupService;
  let controller: BackupController;
  let prismaMock: any;
  let txMock: any;
  let auditMock: any;
  let purge: AuditPurgeService;
  /// Rows whose link to a deleted user is cleared; set per test.
  let detachCount = 0;
  /// Whether the administrator who asked for the restore still has an account
  /// once the file's rows are in; a replace-restore may have replaced it.
  let actorAccountExists = true;
  const ACTOR_ID = '99999999-9999-4999-8999-999999999999';

  /// The tables the restore touches. Every one of them exists on both clients
  /// so a write that lands on the wrong one is visible instead of silent.
  const models = [
    'role',
    'rolePermission',
    'user',
    'userPermission',
    'userRole',
    'userBranch',
    'fiscalPeriod',
    'customer',
    'supplier',
    'item',
    'itemUnit',
    'itemCategory',
    'priceList',
    'priceListItem',
    'warehouse',
    'stockBalance',
    'stockMovement',
    'journalEntry',
    'journalLine',
    'salesOrder',
    'salesOrderLine',
    'purchaseOrder',
    'purchaseOrderLine',
    'salesInvoice',
    'salesInvoiceLine',
    'purchaseInvoice',
    'purchaseInvoiceLine',
    'stockDocument',
    'stockDocumentLine',
    'openingBalance',
    'openingBalanceLine',
    'cashAccount',
    'bankReconciliation',
    'cashVoucher',
    'cashTransfer',
    'cashVoucherAllocation',
    'companySetting',
    'costCenter',
    'documentSequence',
    'auditLog',
  ];

  const modelMocks = () => {
    const shape: Record<string, any> = {};
    for (const model of [...models, 'branch', 'account']) {
      shape[model] = {
        findMany: jest.fn(async () => []),
        deleteMany: jest.fn(async () => ({ count: 0 })),
        createMany: jest.fn(async () => ({ count: 0 })),
        updateMany: jest.fn(async () => ({ count: 0 })),
        create: jest.fn(async () => ({})),
      };
    }
    return shape;
  };

  beforeEach(() => {
    prismaMock = {
      company: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.id === COMPANY_ID || where.code === 'KAYAN') {
            return {
              id: COMPANY_ID,
              code: 'KAYAN',
              nameAr: 'شركة كيان',
              nameEn: 'Kayan Company',
            };
          }
          return null;
        }),
      },
      ...modelMocks(),
    };

    // The transaction client. `$queryRawUnsafe` is what the purge helper uses
    // to switch the database trigger's guard on and off; `$executeRawUnsafe` is
    // where clearing the trail's user links lands (copy aside, delete, write
    // back), and its DELETE reports the rows that were affected.
    detachCount = 0;
    actorAccountExists = true;
    txMock = {
      ...modelMocks(),
      // The purge helper asks one question with `$queryRawUnsafe` besides
      // switching the guard: whether the account that asked still exists.
      $queryRawUnsafe: jest.fn(async (sql: unknown) =>
        String(sql).includes('FROM users WHERE id')
          ? actorAccountExists
            ? [{ id: ACTOR_ID }]
            : []
          : [{ set_config: 'ok' }],
      ),
      $executeRawUnsafe: jest.fn(async (sql: unknown) =>
        String(sql).trimStart().startsWith('DELETE FROM audit_logs') ? detachCount : 0,
      ),
    };

    prismaMock.$executeRawUnsafe = jest.fn(async () => 0);
    prismaMock.$transaction = jest.fn(async (callback: any) => callback(txMock));

    // A read of the permission catalogue happens on whichever client the
    // restore writes through.
    prismaMock.permission = { findMany: jest.fn(async () => []) };
    txMock.permission = { findMany: jest.fn(async () => []) };

    auditMock = {
      record: jest.fn(async () => {}),
    };

    purge = new AuditPurgeService();
    service = new BackupService(prismaMock, auditMock, purge);
    controller = new BackupController(service, auditMock);
  });

  describe('Validation & Format checks', () => {
    test('rejects file that is not a kayan-backup format', async () => {
      const invalid = { format: 'other-format', version: 1 } as any;
      await expect(service.inspect(invalid, COMPANY_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    test('rejects file with future version', async () => {
      const invalid: BackupFile = {
        format: 'kayan-backup',
        version: 99,
        createdAt: new Date().toISOString(),
        companyId: COMPANY_ID,
        companyCode: 'KAYAN',
        companyName: 'Test',
        counts: {},
        tables: {},
      };
      await expect(service.inspect(invalid, COMPANY_ID)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('Mutual rejection in BackupController', () => {
    test('explicitly rejects PostgreSQL DUMP (.dump / PGDMP) on JSON company restore route', () => {
      const dumpBuffer = Buffer.concat([
        Buffer.from('PGDMP'),
        Buffer.alloc(100),
      ]);
      const file = {
        originalname: 'backup.dump',
        mimetype: 'application/octet-stream',
        size: dumpBuffer.length,
        buffer: dumpBuffer,
      };

      expect(() => {
        (controller as any).parse(file);
      }).toThrow(
        /هذا الملف هو أرشيف قاعدة بيانات PostgreSQL \(\.dump\) وليس ملف نسخة احتياطية لبيانات الشركة بصيغة JSON/,
      );
    });

    test('accepts valid JSON file on company restore route', () => {
      const validJson = JSON.stringify({
        format: 'kayan-backup',
        version: 1,
        createdAt: new Date().toISOString(),
        companyId: COMPANY_ID,
        companyCode: 'KAYAN',
        companyName: 'Test',
        counts: {},
        tables: {},
      });
      const file = {
        originalname: 'company-backup.json',
        mimetype: 'application/json',
        size: validJson.length,
        buffer: Buffer.from(validJson, 'utf8'),
      };

      const parsed = (controller as any).parse(file);
      expect(parsed.format).toBe('kayan-backup');
      expect(parsed.version).toBe(1);
    });
  });

  describe('Restoring verified demo JSON backup', () => {
    test('inspects and restores demo company backup JSON cleanly', async () => {
      const backupData: BackupFile = {
        format: 'kayan-backup',
        version: 1,
        createdAt: new Date().toISOString(),
        companyId: COMPANY_ID,
        companyCode: 'KAYAN',
        companyName: 'شركة كيان للحلول والتجارة',
        counts: {
          branch: 1,
          account: 1,
          journalEntry: 1,
        },
        tables: {
          branch: [
            {
              id: '22222222-2222-4222-8222-222222222201',
              companyId: COMPANY_ID,
              code: 'MAIN',
              nameAr: 'الفرع الرئيسي',
              nameEn: 'Main Branch',
            },
          ],
          account: [
            {
              id: '66666666-6666-4666-8666-666666666601',
              companyId: COMPANY_ID,
              code: '1101',
              nameAr: 'الصندوق',
              nameEn: 'Cash',
              parentId: null,
            },
          ],
          journalEntry: [
            {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
              companyId: COMPANY_ID,
              entryNumber: 'JE-001',
              totalDebit: '100.0000',
              totalCredit: '100.0000',
            },
          ],
        },
      };

      expect(backupData.format).toBe('kayan-backup');
      expect(backupData.version).toBe(1);
      expect(backupData.companyCode).toBe('KAYAN');
      expect(Object.keys(backupData.tables).length).toBeGreaterThan(0);

      const inspection = await service.inspect(backupData, COMPANY_ID);
      expect(inspection.format).toBe('kayan-backup');
      expect(inspection.belongsToThisCompany).toBe(true);

      const restoreResult = await service.restore(backupData, COMPANY_ID, {
        replace: true,
      });
      expect(restoreResult.companyId).toBe(COMPANY_ID);
      expect(restoreResult.total).toBeGreaterThan(0);
      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(txMock.account.createMany).toHaveBeenCalled();
      expect(txMock.branch.createMany).toHaveBeenCalled();
      expect(txMock.journalEntry.createMany).toHaveBeenCalled();
    });

    test('refuses an older backup that omits a table containing live company data', async () => {
      prismaMock.cashAccount.findMany.mockResolvedValueOnce([
        { id: 'cash-account-live', companyId: COMPANY_ID, accountId: 'account-live' },
      ]);

      await expect(service.restore({
        format: 'kayan-backup',
        version: 1,
        createdAt: new Date().toISOString(),
        companyId: COMPANY_ID,
        companyCode: 'KAYAN',
        companyName: 'شركة كيان',
        counts: {},
        // Simulate a backup from before cash accounts were part of the format.
        tables: { account: [] },
      }, COMPANY_ID, { replace: true })).rejects.toThrow(/missing tables.*cashAccount/i);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    test('deletes cash and banking dependants before deleting their ledger accounts', async () => {
      // A child-table delete is scoped through the parent rows. Give the mock
      // one voucher so the allocation delete is exercised rather than skipped.
      txMock.cashVoucher.findMany.mockResolvedValueOnce([{ id: 'voucher-demo' }]);
      await service.restore({
        format: 'kayan-backup',
        version: 1,
        createdAt: new Date().toISOString(),
        companyId: COMPANY_ID,
        companyCode: 'KAYAN',
        companyName: 'شركة كيان',
        counts: {},
        tables: {},
      }, COMPANY_ID, { replace: true });

      expect(txMock.cashAccount.deleteMany).toHaveBeenCalled();
      expect(txMock.cashVoucher.deleteMany).toHaveBeenCalled();
      expect(txMock.cashTransfer.deleteMany).toHaveBeenCalled();
      expect(txMock.bankReconciliation.deleteMany).toHaveBeenCalled();
      expect(txMock.cashVoucherAllocation.deleteMany).toHaveBeenCalled();

      const deleteOrder = (model: string) =>
        txMock[model].deleteMany.mock.invocationCallOrder[0];
      expect(deleteOrder('cashVoucherAllocation')).toBeLessThan(deleteOrder('cashVoucher'));
      expect(deleteOrder('cashTransfer')).toBeLessThan(deleteOrder('cashAccount'));
      expect(deleteOrder('cashVoucher')).toBeLessThan(deleteOrder('bankReconciliation'));
      expect(deleteOrder('bankReconciliation')).toBeLessThan(deleteOrder('cashAccount'));
      expect(deleteOrder('cashAccount')).toBeLessThan(deleteOrder('account'));
    });

    test('restores committed demo-data/kayan-company-backup-full.json with remapped permission IDs and parent-first branches', async () => {
      const fs = require('node:fs');
      const path = require('node:path');
      const demoPath = path.resolve(
        __dirname,
        '../../../../demo-data/kayan-company-backup-full.json',
      );
      const demoBackup: BackupFile = JSON.parse(
        fs.readFileSync(demoPath, 'utf8'),
      );

      expect(demoBackup.format).toBe('kayan-backup');
      expect(demoBackup.companyCode).toBe('DEMO');
      expect(Object.keys(demoBackup.tables)).toHaveLength(42);
      expect(Object.values(demoBackup.tables).every((rows) => rows.length > 0)).toBe(true);

      // Verify every journal entry in the demo backup is balanced.
      const entries = demoBackup.tables.journalEntry ?? [];
      expect(entries.length).toBeGreaterThan(100);
      for (const je of entries) {
        expect(Number(je.totalDebit)).toBeCloseTo(Number(je.totalCredit), 4);
      }

      txMock.permission = {
        findMany: jest.fn(async () =>
          Array.from({ length: 31 }, (_, idx) => ({
            id: `target-perm-${idx + 1}`,
            code: `perm.${idx + 1}`,
          })),
        ),
      };

      const result = await service.restore(demoBackup, COMPANY_ID, {
        replace: true,
      });
      expect(result.companyId).toBe(COMPANY_ID);
      expect(result.total).toBeGreaterThan(1000);

      // MAIN branch (parentBranchId === null) must be inserted before child branches.
      expect(txMock.branch.createMany).toHaveBeenCalled();
      const branchCreates = txMock.branch.createMany.mock.calls[0][0].data;
      expect(branchCreates.length).toBe(3);
      expect(branchCreates[0].code).toBe('MAIN');
      expect(branchCreates[0].parentBranchId).toBeNull();

      // Role permissions must be remapped to target-perm-* IDs.
      expect(txMock.rolePermission.createMany).toHaveBeenCalled();
      const rpCall = txMock.rolePermission.createMany.mock.calls[0][0];
      expect(
        rpCall.data.every((row: any) =>
          String(row.permissionId).startsWith('target-perm-'),
        ),
      ).toBe(true);
    });
  });

  describe('The audit purge a restore is allowed to perform', () => {
    const minimalBackup = (): BackupFile => ({
      format: 'kayan-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      companyId: COMPANY_ID,
      companyCode: 'KAYAN',
      companyName: 'شركة كيان',
      counts: { account: 1, user: 1 },
      tables: {
        // The administrator who is signed in: the restore deletes this account
        // and puts it back, which is the whole reason the purge record has to
        // wait for the accounts.
        user: [
          {
            id: '99999999-9999-4999-8999-999999999999',
            companyId: COMPANY_ID,
            username: 'admin',
          },
        ],
        account: [
          {
            id: '66666666-6666-4666-8666-666666666601',
            companyId: COMPANY_ID,
            code: '1101',
            nameAr: 'الصندوق',
            nameEn: 'Cash',
            parentId: null,
          },
        ],
      },
    });

    test('switches the guard on, deletes, and switches it straight back off', async () => {
      await service.restore(minimalBackup(), COMPANY_ID, { replace: true });

      const calls = txMock.$queryRawUnsafe.mock.calls.map((call: any[]) =>
        String(call[0]),
      );
      const onIndex = calls.findIndex((sql: string) =>
        sql.includes(`set_config('${AUDIT_PURGE_SETTING}', 'on'`),
      );
      const offIndex = calls.findIndex((sql: string) =>
        sql.includes(`set_config('${AUDIT_PURGE_SETTING}', 'off'`),
      );

      expect(onIndex).toBeGreaterThanOrEqual(0);
      expect(offIndex).toBeGreaterThan(onIndex);

      // `is_local = true` is what keeps the guard from leaking to another
      // connection, another request or the process itself.
      expect(calls[onIndex]).toContain('true)');
      expect(calls[offIndex]).toContain('true)');

      // The delete happened between the two, and the guard was back on before
      // the file's rows were written.
      const deleteOrder = txMock.auditLog.deleteMany.mock.invocationCallOrder[0];
      const firstInsert = txMock.account.createMany.mock.invocationCallOrder[0];
      const offOrder = txMock.$queryRawUnsafe.mock.invocationCallOrder[offIndex];
      expect(deleteOrder).toBeLessThan(offOrder);
      expect(offOrder).toBeLessThan(firstInsert);
    });

    test('records the purge itself, with the operation, the caller and the row count', async () => {
      txMock.auditLog.deleteMany.mockResolvedValueOnce({ count: 41 });

      await service.restore(minimalBackup(), COMPANY_ID, {
        replace: true,
        actorUserId: '99999999-9999-4999-8999-999999999999',
        ipAddress: '10.0.0.7',
        userAgent: 'jest',
      });

      const purgeRecord = txMock.auditLog.create.mock.calls
        .map((call: any[]) => call[0].data)
        .find((row: any) => row.action === 'AUDIT_PURGED');

      expect(purgeRecord).toBeDefined();
      expect(purgeRecord.entity).toBe('audit_logs');
      expect(purgeRecord.companyId).toBe(COMPANY_ID);
      expect(purgeRecord.userId).toBe('99999999-9999-4999-8999-999999999999');
      expect(purgeRecord.ipAddress).toBe('10.0.0.7');
      expect(purgeRecord.afterJson).toMatchObject({
        reason: 'company-json-restore',
        removedRows: 41,
      });
    });

    test('clears the trail’s links to the company’s users before deleting them', async () => {
      detachCount = 3;

      await service.restore(minimalBackup(), COMPANY_ID, { replace: true });

      const linkSql = txMock.$executeRawUnsafe.mock.calls.map((call: any[]) =>
        String(call[0]).replace(/\s+/g, ' ').trim(),
      );
      expect(linkSql).toHaveLength(3);
      // Copy the affected rows aside, take them out under the guard, put them
      // back with the same id and createdAt and without the link. History is
      // never edited — the database refuses every UPDATE on this table.
      expect(linkSql[0]).toMatch(/^CREATE TEMP TABLE .* AS SELECT .* FROM audit_logs/);
      expect(linkSql[1]).toMatch(/^DELETE FROM audit_logs WHERE "userId" IN/);
      expect(linkSql[2]).toMatch(/^INSERT INTO audit_logs .*SELECT id, "companyId", NULL/);

      // This company's own rows are deleted by the purge a moment later, so the
      // link clearing leaves them alone.
      expect(linkSql[0]).toContain(`"companyId" IS DISTINCT FROM $2::uuid`);

      // It all happens inside the guard, and before the users are deleted.
      const rawCalls = txMock.$queryRawUnsafe.mock.calls.map((call: any[]) => String(call[0]));
      const onIndex = rawCalls.findIndex((sql: string) =>
        sql.includes(`set_config('${AUDIT_PURGE_SETTING}', 'on'`),
      );
      const offIndex = rawCalls.findIndex((sql: string) =>
        sql.includes(`set_config('${AUDIT_PURGE_SETTING}', 'off'`),
      );
      const firstLink = txMock.$executeRawUnsafe.mock.invocationCallOrder[0];
      const deleteUsers = txMock.user.deleteMany.mock.invocationCallOrder[0];
      expect(txMock.$queryRawUnsafe.mock.invocationCallOrder[onIndex]).toBeLessThan(firstLink);
      expect(firstLink).toBeLessThan(deleteUsers);
      expect(deleteUsers).toBeLessThan(txMock.$queryRawUnsafe.mock.invocationCallOrder[offIndex]);

      // And the purge record says how many rows lost their link.
      const purgeRecord = txMock.auditLog.create.mock.calls
        .map((call: any[]) => call[0].data)
        .find((row: any) => row.action === 'AUDIT_PURGED');
      expect(purgeRecord.afterJson).toMatchObject({
        reason: 'company-json-restore',
        detachedLinksToUsers: 3,
      });
    });

    test('writes the purge record only after the accounts are back', async () => {
      detachCount = 1;

      await service.restore(minimalBackup(), COMPANY_ID, { replace: true });

      // The record names the administrator, and the administrator is one of the
      // accounts this restore deletes and re-creates: writing it during the
      // clearing phase would leave a trail row pointing at a person who does
      // not exist while the foreign key is checked.
      const recordOrder = txMock.auditLog.create.mock.calls.findIndex(
        (call: any[]) => call[0].data.action === 'AUDIT_PURGED',
      );
      expect(recordOrder).toBeGreaterThanOrEqual(0);
      const recordCall = txMock.auditLog.create.mock.invocationCallOrder[recordOrder];

      const putAccountsBack = txMock.user.createMany.mock.invocationCallOrder[0];
      expect(putAccountsBack).toBeDefined();
      expect(putAccountsBack).toBeLessThan(recordCall);

      // And it is still inside the transaction, before the restore's own row.
      const restoreCall = txMock.auditLog.create.mock.invocationCallOrder[
        txMock.auditLog.create.mock.calls.findIndex(
          (call: any[]) => String(call[0].data.action).startsWith('RESTORE'),
        )
      ];
      expect(recordCall).toBeLessThan(restoreCall);
    });

    test('names a replaced administrator without pointing the foreign key at nobody', async () => {
      // A replace-restore puts the file's accounts where the installation's
      // were: the person who asked for it can be gone by the time the record is
      // written.
      actorAccountExists = false;

      await service.restore(minimalBackup(), COMPANY_ID, {
        replace: true,
        actorUserId: ACTOR_ID,
      });

      const records = txMock.auditLog.create.mock.calls.map((call: any[]) => call[0].data);
      const purgeRecord = records.find((row: any) => row.action === 'AUDIT_PURGED');
      const restoreRecord = records.find((row: any) => String(row.action).startsWith('RESTORE'));

      for (const row of [purgeRecord, restoreRecord]) {
        expect(row).toBeDefined();
        // No foreign key to a person who is not there...
        expect(row.userId).toBeNull();
        expect(row.ipAddress ?? null).toBeNull();
      }
      // ...but the trail still says which account asked for it.
      expect(purgeRecord.afterJson).toMatchObject({ actorAccountId: ACTOR_ID });
      expect(restoreRecord.entity).toBe('company_json_backup');
    });

    test('points the record at the administrator when the account is still there', async () => {
      await service.restore(minimalBackup(), COMPANY_ID, {
        replace: true,
        actorUserId: ACTOR_ID,
      });

      const purgeRecord = txMock.auditLog.create.mock.calls
        .map((call: any[]) => call[0].data)
        .find((row: any) => row.action === 'AUDIT_PURGED');

      expect(purgeRecord.userId).toBe(ACTOR_ID);
      expect(purgeRecord.afterJson).not.toHaveProperty('actorAccountId');
    });

    test('writes nothing back when no trail row points at a deleted user', async () => {
      detachCount = 0;

      await service.restore(minimalBackup(), COMPANY_ID, { replace: true });

      const linkSql = txMock.$executeRawUnsafe.mock.calls.map((call: any[]) =>
        String(call[0]).trimStart(),
      );
      // The copy and the delete still run (they have to: nothing tells us the
      // count beforehand), but there is no write-back to make.
      expect(linkSql.some((sql: string) => sql.startsWith('INSERT INTO audit_logs'))).toBe(false);

      // The purge still says how many links it cleared: a zero is a fact, not
      // an omission.
      const purgeRecord = txMock.auditLog.create.mock.calls
        .map((call: any[]) => call[0].data)
        .find((row: any) => row.action === 'AUDIT_PURGED');
      expect(purgeRecord.afterJson).toMatchObject({ detachedLinksToUsers: 0 });
    });

    test('records what the restore put back, in the same transaction', async () => {
      await service.restore(minimalBackup(), COMPANY_ID, { replace: true });

      const restoreRecord = txMock.auditLog.create.mock.calls
        .map((call: any[]) => call[0].data)
        .find((row: any) => String(row.action).startsWith('RESTORE'));

      expect(restoreRecord).toBeDefined();
      expect(restoreRecord.entity).toBe('company_json_backup');
      expect(restoreRecord.afterJson).toMatchObject({ companyCode: 'KAYAN' });
    });

    test('writes through the transaction client, never the root one', async () => {
      await service.restore(minimalBackup(), COMPANY_ID, { replace: true });

      // Every delete and every insert went through `tx`. A write on the root
      // client would be its own transaction, which is exactly the bug that
      // left half-restored companies behind.
      expect(txMock.auditLog.deleteMany).toHaveBeenCalled();
      expect(txMock.account.deleteMany).toHaveBeenCalled();
      expect(txMock.account.createMany).toHaveBeenCalled();

      expect(prismaMock.auditLog.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.account.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.account.createMany).not.toHaveBeenCalled();
      expect(prismaMock.journalEntry.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    });

    test('does not claim a purge when the delete failed', async () => {
      txMock.auditLog.deleteMany.mockRejectedValueOnce(
        new Error('audit_logs is append-only: deleting requires an audited purge session'),
      );

      await expect(
        service.restore(minimalBackup(), COMPANY_ID, { replace: true }),
      ).rejects.toThrow(/append-only/);

      // The guard still goes back on, and no purge row is written: a purge
      // that did not happen is never recorded as having happened.
      const calls = txMock.$queryRawUnsafe.mock.calls.map((call: any[]) =>
        String(call[0]),
      );
      expect(
        calls.some((sql: string) => sql.includes(`set_config('${AUDIT_PURGE_SETTING}', 'off'`)),
      ).toBe(true);
      expect(
        txMock.auditLog.create.mock.calls.some(
          (call: any[]) => call[0].data.action === 'AUDIT_PURGED',
        ),
      ).toBe(false);
    });

    test('refuses a purge that does not name an operation allowed to purge', async () => {
      await expect(
        purge.purge(txMock, { companyId: COMPANY_ID, reason: 'just-because' as any }),
      ).rejects.toThrow(BadRequestException);
      expect(txMock.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    test('scopes the delete to the company it was asked about', async () => {
      await purge.purge(txMock, {
        companyId: COMPANY_ID,
        reason: 'company-data-reset',
      });
      expect(txMock.auditLog.deleteMany).toHaveBeenCalledWith({
        where: { companyId: COMPANY_ID },
      });
    });
  });
});
