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
    'journalLineAllocation',
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
        findFirst: jest.fn(async () => null),
        // One existing super administrator by default, so the restore's
        // access reconciliation leaves accounts alone unless a test says
        // the restored file left the company with none.
        count: jest.fn(async () => 1),
        deleteMany: jest.fn(async () => ({ count: 0 })),
        createMany: jest.fn(async () => ({ count: 0 })),
        updateMany: jest.fn(async () => ({ count: 0 })),
        create: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
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
      company: { update: jest.fn(async () => ({})) },
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

    test('rejects a malformed company logo before starting a restore transaction', async () => {
      const invalid: BackupFile = {
        format: 'kayan-backup',
        version: 1,
        createdAt: new Date().toISOString(),
        companyId: COMPANY_ID,
        companyCode: 'KAYAN',
        companyName: 'Test',
        companyProfile: {
          nameEn: 'Test Company',
          nameAr: 'شركة تجريبية',
          taxId: null,
          commercialRegistration: null,
          addressEn: null,
          addressAr: null,
          phone: null,
          email: null,
          address: null,
          currency: 'EGP',
          timezone: 'Africa/Cairo',
          logoBase64: Buffer.from('<script>').toString('base64'),
          logoMime: 'image/png',
        },
        counts: {},
        tables: {},
      };

      await expect(service.restore(invalid, COMPANY_ID, { replace: true })).rejects.toThrow(
        BadRequestException,
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    test('rejects malformed rows and unsupported populated tables before any transaction', async () => {
      const malformed: BackupFile = {
        format: 'kayan-backup',
        version: 1,
        createdAt: new Date().toISOString(),
        companyId: COMPANY_ID,
        companyCode: 'KAYAN',
        companyName: 'Test',
        counts: {},
        tables: { account: [null as never] },
      };
      await expect(service.restore(malformed, COMPANY_ID, { replace: true })).rejects.toThrow(
        /row 1 in table "account" must be a JSON object/i,
      );

      const unsupported: BackupFile = {
        ...malformed,
        tables: { paymentEvent: [{ id: 'unmapped-row' }] },
      };
      await expect(service.inspect(unsupported, COMPANY_ID)).rejects.toThrow(
        /unsupported table "paymentEvent"/i,
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
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

  test('serves the complete downloadable demo JSON, including cash accounts and vouchers', async () => {
    const bytes = await service.demoBackup();
    const demo: BackupFile = JSON.parse(bytes.toString('utf8'));

    expect(demo.companyCode).toBe('DEMO');
    expect(Object.keys(demo.tables)).toHaveLength(42);
    expect(demo.tables.cashAccount).toHaveLength(2);
    expect(demo.tables.cashVoucher.length).toBeGreaterThan(0);
    expect(demo.tables.cashTransfer.length).toBeGreaterThan(0);
    expect(demo.tables.cashVoucherAllocation.length).toBeGreaterThan(0);
    expect(Object.values(demo.tables).every((rows) => rows.length > 0)).toBe(true);
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
    test('restores the company profile and validated logo without changing target identity', async () => {
      const png = Buffer.alloc(24);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
      png.writeUInt32BE(64, 16);
      png.writeUInt32BE(48, 20);
      const backup: BackupFile = {
        format: 'kayan-backup',
        version: 1,
        createdAt: new Date().toISOString(),
        companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        companyCode: 'DEMO',
        companyName: 'Demo Company',
        companyProfile: {
          nameEn: 'Demo Company',
          nameAr: 'شركة تجريبية',
          taxId: '12345',
          commercialRegistration: null,
          addressEn: 'Minya',
          addressAr: 'المنيا',
          phone: '+20 100 000 0000',
          email: 'demo@example.test',
          address: 'Minya',
          currency: 'EGP',
          timezone: 'Africa/Cairo',
          logoBase64: png.toString('base64'),
          logoMime: 'image/png',
        },
        counts: {},
        tables: {},
      };

      await service.restore(backup, COMPANY_ID, { replace: true });

      expect(txMock.company.update).toHaveBeenCalledWith({
        where: { id: COMPANY_ID },
        data: expect.objectContaining({
          nameEn: 'Demo Company',
          nameAr: 'شركة تجريبية',
          taxId: '12345',
          logoMime: 'image/png',
          logoPath: null,
        }),
      });
      const updateData = txMock.company.update.mock.calls[0][0].data;
      expect(Buffer.from(updateData.logoData)).toEqual(png);
      expect(updateData).not.toHaveProperty('code');
      expect(updateData).not.toHaveProperty('id');
    });

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

    test('carries cost-centre splits in a company backup and writes them back', async () => {
      // A split is not a column on the journal line: without this table the
      // file would look complete and restore every split amount as
      // unallocated. The read must find the rows through line -> entry ->
      // company, because a journal line has no companyId of its own.
      const allocation = {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01',
        journalLineId: 'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
        costCenterId: '00000000-0000-4000-8000-000000009001',
        amount: '150.0000',
      };
      prismaMock.journalLineAllocation.findMany.mockResolvedValueOnce([allocation]);

      const file = await service.create(COMPANY_ID);
      expect(file.tables.journalLineAllocation).toEqual([allocation]);
      expect(prismaMock.journalLineAllocation.findMany).toHaveBeenCalledWith({
        where: { line: { entry: { companyId: COMPANY_ID } } },
      });

      const restoreFile: BackupFile = {
        format: 'kayan-backup',
        version: 1,
        createdAt: new Date().toISOString(),
        companyId: COMPANY_ID,
        companyCode: 'KAYAN',
        companyName: 'شركة كيان',
        counts: {},
        tables: {
          journalEntry: [{ id: 'entry-1', companyId: COMPANY_ID }],
          journalLine: [{ id: allocation.journalLineId, journalEntryId: 'entry-1' }],
          journalLineAllocation: [allocation],
        },
      };
      await service.restore(restoreFile, COMPANY_ID, { replace: true });

      expect(txMock.journalLineAllocation.createMany).toHaveBeenCalledWith({
        data: [allocation],
        skipDuplicates: false,
      });
      const order = (model: string) =>
        txMock[model].createMany.mock.invocationCallOrder[0];
      expect(order('journalLine')).toBeLessThan(order('journalLineAllocation'));
      expect(txMock.journalLineAllocation.deleteMany).toHaveBeenCalledWith({
        where: { line: { entry: { companyId: COMPANY_ID } } },
      });
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

      // JSON restore deliberately strips imported super-admin status. The
      // demo administrator must still have a tenant role to read its books.
      const demoAdmin = demoBackup.tables.user.find((row) => row.username === 'admin')!;
      const adminRole = demoBackup.tables.role.find((row) => row.code === 'ADMIN')!;
      expect(demoBackup.tables.userRole).toContainEqual(expect.objectContaining({ userId: demoAdmin.id, roleId: adminRole.id }));
      expect(demoBackup.tables.rolePermission).toContainEqual(expect.objectContaining({ roleId: adminRole.id, permissionCode: 'reports.read' }));

      // Verify every journal entry in the demo backup is balanced.
      const entries = demoBackup.tables.journalEntry ?? [];
      expect(entries.length).toBeGreaterThan(100);
      for (const je of entries) {
        expect(Number(je.totalDebit)).toBeCloseTo(Number(je.totalCredit), 4);
      }

      const demoPermissionCodes = [...new Set([
        ...(demoBackup.tables.rolePermission ?? []),
        ...(demoBackup.tables.userPermission ?? []),
      ].map((row) => String(row.permissionCode)))];
      txMock.permission = {
        findMany: jest.fn(async () =>
          demoPermissionCodes.map((code, idx) => ({
            id: `target-perm-${idx + 1}`,
            code,
          })),
        ),
      };

      const result = await service.restore(demoBackup, COMPANY_ID, {
        replace: true,
      });
      expect(result.companyId).toBe(COMPANY_ID);
      expect(result.total).toBeGreaterThan(1000);

      // Reversal journals are parent-first so a row never points at a journal
      // entry that has not been inserted yet, including across chunked writes.
      const journalCreates = txMock.journalEntry.createMany.mock.calls[0][0].data;
      const journalPosition = new Map<string, number>(
        journalCreates.map((row: any, index: number) => [String(row.id), index] as [string, number]),
      );
      for (const reversal of journalCreates.filter((row: any) => row.reversalOfId)) {
        expect(journalPosition.get(String(reversal.reversalOfId))!).toBeLessThan(
          journalPosition.get(String(reversal.id))!,
        );
      }

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
      for (const row of demoBackup.tables.rolePermission) {
        const restored = rpCall.data.find((candidate: any) =>
          candidate.roleId === row.roleId &&
          candidate.permissionId === `target-perm-${demoPermissionCodes.indexOf(String(row.permissionCode)) + 1}`,
        );
        expect(restored).toBeDefined();
      }

      // User-level permission overrides use the same target catalogue remapping.
      expect(txMock.userPermission.createMany).toHaveBeenCalled();
      const userPermissionCall = txMock.userPermission.createMany.mock.calls[0][0];
      expect(
        userPermissionCall.data.every((row: any) =>
          String(row.permissionId).startsWith('target-perm-'),
        ),
      ).toBe(true);
      const periodRows = txMock.fiscalPeriod.createMany.mock.calls.flatMap(([args]: any[]) => args.data);
      expect(periodRows.every((row: any) => row.status === 'OPEN')).toBe(true);
      const closed = demoBackup.tables.fiscalPeriod.filter((row) => row.status === 'CLOSED');
      expect(closed.length).toBeGreaterThan(0);
      for (const period of closed) {
        expect(txMock.fiscalPeriod.updateMany).toHaveBeenCalledWith({
          where: { id: period.id, companyId: COMPANY_ID }, data: { status: 'CLOSED' },
        });
      }
      expect(txMock.fiscalPeriod.updateMany.mock.invocationCallOrder[0])
        .toBeGreaterThan(txMock.journalLine.createMany.mock.invocationCallOrder[0]);

    });

    test('restores linked sales and purchase returns only after their original documents and lines', async () => {
      const originalSales = 'sales-original';
      const returnSales = 'sales-return';
      const originalSalesLine = 'sales-line-original';
      const returnSalesLine = 'sales-line-return';
      const originalPurchase = 'purchase-original';
      const returnPurchase = 'purchase-return';
      const originalPurchaseLine = 'purchase-line-original';
      const returnPurchaseLine = 'purchase-line-return';
      const date = '2026-01-01';
      const invoice = (id: string, originalInvoiceId: string | null) => ({
        id,
        companyId: COMPANY_ID,
        branchId: 'branch-id',
        invoiceNumber: id,
        invoiceDate: date,
        customerId: 'customer-id',
        supplierId: 'supplier-id',
        originalInvoiceId,
      });
      const line = (id: string, invoiceId: string, originalLineId: string | null) => ({
        id,
        invoiceId,
        lineNumber: 1,
        description: id,
        quantity: '1',
        unitPrice: '10',
        taxAmount: '0',
        lineTotal: '10',
        originalLineId,
      });
      const backup: BackupFile = {
        format: 'kayan-backup',
        version: 1,
        createdAt: new Date().toISOString(),
        companyId: COMPANY_ID,
        companyCode: 'KAYAN',
        companyName: 'Kayan',
        counts: {},
        tables: {
          salesInvoice: [invoice(returnSales, originalSalesLine), invoice(originalSales, null)],
          salesInvoiceLine: [
            line(returnSalesLine, returnSales, originalSalesLine),
            line(originalSalesLine, originalSales, null),
          ],
          purchaseInvoice: [invoice(returnPurchase, originalPurchase), invoice(originalPurchase, null)],
          purchaseInvoiceLine: [
            line(returnPurchaseLine, returnPurchase, originalPurchaseLine),
            line(originalPurchaseLine, originalPurchase, null),
          ],
        },
      };

      await service.restore(backup, COMPANY_ID, { replace: true });

      const assertParentFirst = (rows: Array<Record<string, unknown>>, parentId: string, childId: string) => {
        const ids = rows.map((row) => String(row.id));
        expect(ids.indexOf(parentId)).toBeGreaterThanOrEqual(0);
        expect(ids.indexOf(childId)).toBeGreaterThan(ids.indexOf(parentId));
      };
      assertParentFirst(txMock.salesInvoice.createMany.mock.calls[0][0].data, originalSales, returnSales);
      assertParentFirst(txMock.salesInvoiceLine.createMany.mock.calls[0][0].data, originalSalesLine, returnSalesLine);
      assertParentFirst(txMock.purchaseInvoice.createMany.mock.calls[0][0].data, originalPurchase, returnPurchase);
      assertParentFirst(txMock.purchaseInvoiceLine.createMany.mock.calls[0][0].data, originalPurchaseLine, returnPurchaseLine);
    });
  });

  describe('Access reconciliation after a restore', () => {
    const emptyBackup = (): BackupFile => ({
      format: 'kayan-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      companyId: COMPANY_ID,
      companyCode: 'KAYAN',
      companyName: 'شركة كيان',
      counts: {},
      tables: {},
    });

    test('tops up system roles with permissions an older backup cannot contain', async () => {
      // The catalogue the *current* program ships, including a permission
      // introduced after the backup was written (opening balances).
      txMock.permission.findMany.mockResolvedValue([
        { id: 'p-open', code: 'accounting.openingbalances.manage', module: 'accounting' },
        { id: 'p-journal', code: 'accounting.journal.read', module: 'accounting' },
        { id: 'p-sales-create', code: 'sales.invoices.create', module: 'sales' },
        { id: 'p-sales-read', code: 'sales.invoices.read', module: 'sales' },
        { id: 'p-cash', code: 'cash.vouchers.read', module: 'cash' },
      ]);
      txMock.role.findMany.mockResolvedValue([
        { id: 'role-admin', code: 'ADMIN' },
        { id: 'role-accountant', code: 'ACCOUNTANT' },
        { id: 'role-custom', code: 'SALES' },
      ]);
      txMock.rolePermission.createMany.mockResolvedValue({ count: 3 });

      await service.restore(emptyBackup(), COMPANY_ID, { replace: true });

      const calls = txMock.rolePermission.createMany.mock.calls.map((c: any[]) => c[0]);
      const byRole = new Map<string, string[]>();
      for (const call of calls) {
        for (const row of call.data) {
          byRole.set(row.roleId, [...(byRole.get(row.roleId) ?? []), row.permissionId]);
        }
        expect(call.skipDuplicates).toBe(true);
      }
      // ADMIN holds the whole catalogue; ACCOUNTANT holds the books modules
      // plus read-only invoices — crucially including opening balances, the
      // permission the restored demo snapshot was missing.
      expect(byRole.get('role-admin')).toEqual(
        expect.arrayContaining(['p-open', 'p-journal', 'p-sales-create', 'p-sales-read', 'p-cash']),
      );
      expect(byRole.get('role-accountant')).toEqual(
        expect.arrayContaining(['p-open', 'p-journal', 'p-sales-read', 'p-cash']),
      );
      expect(byRole.get('role-accountant')).not.toContain('p-sales-create');
      // A custom role keeps exactly what the file gave it: no top-up.
      expect(byRole.has('role-custom')).toBe(false);
      // The audit record says what was repaired.
      const auditData = txMock.auditLog.create.mock.calls.at(-1)[0].data;
      expect(auditData.afterJson.accessReconciled.grantsAdded).toBeGreaterThan(0);
      expect(auditData.afterJson.accessReconciled.superAdminPromoted).toBeNull();
    });

    test('promotes the restored ADMIN account only when no super administrator remains', async () => {
      txMock.permission.findMany.mockResolvedValue([]);
      txMock.role.findMany.mockResolvedValue([{ id: 'role-admin', code: 'ADMIN' }]);
      txMock.user.count.mockResolvedValue(0);
      txMock.userRole.findFirst.mockResolvedValue({
        user: { id: 'user-admin', username: 'admin' },
      });

      await service.restore(emptyBackup(), COMPANY_ID, { replace: true });

      expect(txMock.user.update).toHaveBeenCalledWith({
        where: { id: 'user-admin' },
        data: { isSuperAdmin: true },
      });
      const auditData = txMock.auditLog.create.mock.calls.at(-1)[0].data;
      expect(auditData.afterJson.accessReconciled.superAdminPromoted).toBe('admin');
    });

    test('never promotes anyone while a super administrator still exists', async () => {
      txMock.permission.findMany.mockResolvedValue([]);
      txMock.role.findMany.mockResolvedValue([{ id: 'role-admin', code: 'ADMIN' }]);
      txMock.user.count.mockResolvedValue(2);

      await service.restore(emptyBackup(), COMPANY_ID, { replace: true });

      expect(txMock.userRole.findFirst).not.toHaveBeenCalled();
      expect(txMock.user.update).not.toHaveBeenCalled();
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
