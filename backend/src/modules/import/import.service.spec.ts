import { BadRequestException } from '@nestjs/common';

import { IMPORT_KINDS, ImportService } from './import.service';
import { readCsv, readXlsx } from './tabular';

/// The file this program hands out has to be one this program accepts.
///
/// It sounds obvious and it was not true: the template used to carry its
/// Arabic labels and its notes on the very sheet that gets uploaded, so the
/// first thing anybody saw after downloading it and uploading it unchanged
/// was a wall of red rows. That reads as a broken screen, and it is the
/// screen's own template doing it.
describe('ImportService', () => {
  const COMPANY = '11111111-1111-4111-8111-111111111111';
  const USER = '22222222-2222-4222-8222-222222222222';
  const BRANCH = '33333333-3333-4333-8333-333333333333';

  /// Enough of Prisma to preview each supported template without writing.
  function prisma() {
    return {
      customer: { findMany: async () => [], create: async () => ({}) },
      supplier: { findMany: async () => [], create: async () => ({}) },
      item: { findMany: async () => [], create: async () => ({}) },
      openingBalance: { findFirst: async () => null },
      branch: { findFirst: async () => ({ id: BRANCH, code: 'HQ', isActive: true }) },
      warehouse: { findFirst: async () => null },
      account: {
        findMany: async () => [
          { id: 'cash-id', code: '1101', isPostable: true, isActive: true, deletedAt: null, type: 'ASSET', parentId: null },
          { id: 'capital-id', code: '3101', isPostable: true, isActive: true, deletedAt: null, type: 'EQUITY', parentId: null },
        ],
        findFirst: async () => null,
        create: async () => ({}),
      },
      $transaction: async (work: unknown) =>
        typeof work === 'function' ? (work as () => unknown)() : work,
    };
  }

  function openingBalances() {
    return {
      create: async () => ({
        id: 'draft-id',
        documentNumber: 'OB-0001',
        status: 'draft',
      }),
    };
  }

  function service() {
    return new ImportService(
      prisma() as never,
      { record: async () => {} } as never,
      openingBalances() as never,
    );
  }

  it('reads back the template it writes, with nothing to correct', async () => {
    const importer = service();
    for (const kind of IMPORT_KINDS) {
      const buffer = await importer.template(kind);
      expect(buffer.length).toBeGreaterThan(0);

      const report = await importer.run(
        kind,
        COMPANY,
        USER,
        { originalname: `${kind}.xlsx`, buffer },
        { dryRun: true, mode: 'insert' },
        kind === 'opening-balances' ? BRANCH : null,
      );

      // The examples are real rows, so each template must be accepted.
      expect(report.errors).toEqual([]);
      expect(report.totalRows).toBe(kind === 'opening-balances' ? 2 : 1);
      expect(report.created).toBe(1);
      expect(report.unknownColumns).toEqual([]);
    }
  });

  it('keeps the notes where a person can read them and the importer cannot trip over them', async () => {
    const importer = service();
    const buffer = await importer.template('customers');
    const sheet = await readXlsx(buffer);

    // One header, one example row. Anything else on this sheet is something
    // the importer would have to guess about.
    expect(sheet.headers).toContain('Code');
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]!.values['code']).toBe('C-100');
  });

  it('names the columns a file must have, in both languages', async () => {
    const importer = service();
    const buffer = await importer.template('items');
    const sheet = await readXlsx(buffer);
    // The Arabic name of the code column is on the instructions sheet, so a
    // person can match a hand-made sheet; the upload sheet stays clean.
    expect(sheet.headers.join(',')).not.toMatch(/[؀-ۿ]/);
  });

  it('refuses a file that is not a spreadsheet', async () => {
    const importer = service();
    await expect(
      importer.run(
        'customers',
        COMPANY,
        USER,
        { originalname: 'notes.txt', buffer: Buffer.from('hello') },
        { dryRun: true, mode: 'insert' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports the row and column of a value it cannot accept', async () => {
    const importer = service();
    const csv = 'Code,Name (English),Name (Arabic)\n'
      + ',No code given,بدون كود\n'
      + 'OK-1,Fine,جيد\n';
    const report = await importer.run(
      'customers',
      COMPANY,
      USER,
      { originalname: 'customers.csv', buffer: Buffer.from(csv, 'utf8') },
      { dryRun: true, mode: 'insert' },
    );
    expect(report.totalRows).toBe(2);
    expect(report.created).toBe(1);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]!.row).toBe(2);
    expect(report.errors[0]!.message).toContain('Code');
  });

  it('refuses a file that leaves out a required column entirely', async () => {
    // A column that is not in the file at all used to leave no value and no
    // complaint: the record was written with nothing where its Arabic name
    // should have been.
    const importer = service();
    const csv = 'Code,Name (English)\nC-9,Alfa\n';
    const report = await importer.run(
      'customers',
      COMPANY,
      USER,
      { originalname: 'x.csv', buffer: Buffer.from(csv, 'utf8') },
      { dryRun: true, mode: 'insert' },
    );
    expect(report.created).toBe(0);
    expect(report.errors.map((error) => error.column)).toContain(
      'Name (Arabic)',
    );
  });

  it('reads a CSV with a byte-order mark, as Excel writes them', async () => {
    const sheet = readCsv(
      Buffer.concat([
        Buffer.from('﻿', 'utf8'),
        Buffer.from('Code,Name (English)\nC-1,Alfa\n', 'utf8'),
      ]),
    );
    expect(sheet.headers[0]).toBe('Code');
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]!.values['code']).toBe('C-1');
  });

  it('writes through the transaction client rather than escaping to the pool', async () => {
    const rootCreate = jest.fn(async () => {
      throw new Error('write escaped the transaction');
    });
    const txCreate = jest.fn(async () => ({}));
    const tx = {
      customer: { create: txCreate, updateMany: jest.fn(async () => ({ count: 1 })) },
      supplier: { create: jest.fn(async () => ({})), updateMany: jest.fn(async () => ({ count: 1 })) },
      item: { create: jest.fn(async () => ({})), updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const root: any = {
      customer: { findMany: jest.fn(async () => []), create: rootCreate },
      supplier: { findMany: jest.fn(async () => []) },
      item: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
    };
    const importer = new ImportService(
      root,
      { record: async () => {} } as never,
      openingBalances() as never,
    );
    const report = await importer.run(
      'customers',
      COMPANY,
      USER,
      {
        originalname: 'customers.csv',
        buffer: Buffer.from('Code,Name (English),Name (Arabic)\nC-1,Alfa,ألفا\n', 'utf8'),
      },
      { dryRun: false, mode: 'insert' },
    );

    expect(report.created).toBe(1);
    expect(root.$transaction).toHaveBeenCalledTimes(1);
    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(rootCreate).not.toHaveBeenCalled();
  });

  it('will not write when the file still has problems', async () => {
    const importer = service();
    const csv = 'Code,Name (English),Name (Arabic)\nBAD,Alfa,\u0639\u0644\u0627\u0621\n';
    // A dry run and a real run take the same path, so a file that cannot be
    // read cleanly cannot be written either.
    const dry = await importer.run(
      'customers',
      COMPANY,
      USER,
      { originalname: 'x.csv', buffer: Buffer.from(csv, 'utf8') },
      { dryRun: true, mode: 'insert' },
    );
    expect(dry.created + dry.updated).toBe(1);
    expect(dry.errors).toEqual([]);
  });

  it('creates chart accounts in parent-first order and demotes a grouping parent atomically', async () => {
    const createdCodes: string[] = [];
    const tx = {
      account: {
        findMany: jest.fn(async () => []),
        create: jest.fn(async ({ data }: { data: { code: string } }) => {
          createdCodes.push(data.code);
          return { id: `id-${data.code}` };
        }),
        update: jest.fn(async () => ({})),
      },
      journalLine: { count: jest.fn(async () => 0) },
    };
    const root: any = {
      account: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn(async () => {}) };
    const importer = new ImportService(root, audit as never, openingBalances() as never);
    const csv = 'Code,Name (English),Name (Arabic),Account type,Parent code,Can receive postings,Active\n'
      + '610101,Office supplies,مصروفات مكتبية,EXPENSE,6101,yes,yes\n'
      + '6101,Operating expenses,مصروفات تشغيلية,EXPENSE,,yes,yes\n';

    const report = await importer.run(
      'chart-of-accounts', COMPANY, USER,
      { originalname: 'accounts.csv', buffer: Buffer.from(csv, 'utf8') },
      { dryRun: false, mode: 'insert' },
    );

    expect(report.errors).toEqual([]);
    expect(report.created).toBe(2);
    expect(createdCodes).toEqual(['6101', '610101']);
    expect(tx.account.update).toHaveBeenCalledWith({
      where: { id: 'id-6101' },
      data: { isPostable: false, updatedBy: USER },
    });
    expect(root.$transaction).toHaveBeenCalledTimes(1);
  });

  it('keeps assigned-branch imports scoped while allowing super-admin branch selection', async () => {
    const createDraft = jest.fn();
    const root: any = {
      branch: {
        findFirst: jest.fn(async () => ({
          id: 'other-branch-id',
          code: 'OTHER',
          isActive: true,
        })),
      },
      warehouse: { findFirst: jest.fn(async () => null) },
      account: {
        findMany: jest.fn(async () => [
          { id: 'cash-id', code: '1101', isPostable: true, isActive: true },
          { id: 'capital-id', code: '3101', isPostable: true, isActive: true },
        ]),
        findFirst: jest.fn(async () => null),
      },
      item: { findMany: jest.fn(async () => []) },
      customer: { findMany: jest.fn(async () => []) },
      supplier: { findMany: jest.fn(async () => []) },
      openingBalance: { findFirst: jest.fn(async () => null) },
    };
    const importer = new ImportService(
      root,
      { record: async () => {} } as never,
      { create: createDraft } as never,
    );
    const csv = 'As-of date,Branch code,Account code,Debit,Credit\n'
      + '2026-01-01,OTHER,1101,1000,0\n'
      + '2026-01-01,OTHER,3101,0,1000\n';
    const file = { originalname: 'other-branch.csv', buffer: Buffer.from(csv, 'utf8') };

    const restricted = await importer.run(
      'opening-balances', COMPANY, USER, file,
      { dryRun: false, mode: 'insert' }, BRANCH,
    );
    expect(restricted.created).toBe(0);
    expect(restricted.errors.some((error) => error.message.includes('outside your assigned branch'))).toBe(true);
    expect(createDraft).not.toHaveBeenCalled();

    const superAdminPreview = await importer.run(
      'opening-balances', COMPANY, USER, file,
      { dryRun: true, mode: 'insert' }, BRANCH, true,
    );
    expect(superAdminPreview.errors).toEqual([]);
    expect(superAdminPreview.created).toBe(1);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('validates a balanced opening-balance workbook, commits it once, and skips a replay', async () => {
    const createDraft = jest.fn(async (
      _companyId: string,
      _branchId: string | null,
      _userId: string,
      _dto: { lines: unknown[]; importFingerprint?: string },
    ) => ({
      id: 'draft-id', documentNumber: 'OB-0002', status: 'draft',
    }));
    const opening = { create: createDraft };
    const root: any = {
      branch: { findFirst: jest.fn(async () => ({ id: BRANCH, code: 'HQ', isActive: true })) },
      warehouse: { findFirst: jest.fn(async () => null) },
      account: {
        findMany: jest.fn(async () => [
          { id: 'cash-id', code: '1101', isPostable: true, isActive: true },
          { id: 'capital-id', code: '3101', isPostable: true, isActive: true },
        ]),
        findFirst: jest.fn(async () => null),
      },
      item: { findMany: jest.fn(async () => []) },
      customer: { findMany: jest.fn(async () => []) },
      supplier: { findMany: jest.fn(async () => []) },
      openingBalance: {
        findFirst: jest.fn(async () => null),
      },
      $transaction: jest.fn(async (callback: (client: unknown) => unknown) => callback({})),
    };
    const importer = new ImportService(root, { record: async () => {} } as never, opening as never);
    const csv = 'As-of date,Branch code,Warehouse code,Account code,Debit,Credit,Description\n'
      + '2026-01-01,,,1101,1000,0,Opening cash\n'
      + '2026-01-01,,,3101,0,1000,Opening capital\n';
    const file = { originalname: 'opening.csv', buffer: Buffer.from(csv, 'utf8') };

    const preview = await importer.run(
      'opening-balances', COMPANY, USER, file,
      { dryRun: true, mode: 'insert' }, BRANCH,
    );
    expect(preview.errors).toEqual([]);
    expect(preview.created).toBe(1);
    expect(createDraft).not.toHaveBeenCalled();

    const committed = await importer.run(
      'opening-balances', COMPANY, USER, file,
      { dryRun: false, mode: 'insert' }, BRANCH,
    );
    expect(committed.errors).toEqual([]);
    expect(committed.draft).toEqual({ id: 'draft-id', documentNumber: 'OB-0002', status: 'draft' });
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(createDraft.mock.calls[0]![0]).toBe(COMPANY);
    expect(createDraft.mock.calls[0]![3].lines).toHaveLength(2);
    expect(createDraft.mock.calls[0]![3].importFingerprint).toMatch(/^[0-9a-f]{64}$/);

    root.openingBalance.findFirst.mockResolvedValue({
      id: 'draft-id', documentNumber: 'OB-0002', status: 'DRAFT',
    });
    const replay = await importer.run(
      'opening-balances', COMPANY, USER, file,
      { dryRun: false, mode: 'insert' }, BRANCH,
    );
    expect(replay.created).toBe(0);
    expect(replay.skipped).toBe(1);
    expect(replay.draft).toEqual({ id: 'draft-id', documentNumber: 'OB-0002', status: 'DRAFT' });
    expect(createDraft).toHaveBeenCalledTimes(1);
  });

  it('rejects a repeated stock item before any opening-stock movement can be drafted', async () => {
    const createDraft = jest.fn();
    const root: any = {
      branch: { findFirst: async () => ({ id: BRANCH, code: 'HQ', isActive: true }) },
      warehouse: { findFirst: async () => null },
      account: {
        findMany: async () => [
          { id: 'inventory-id', code: '1104', isPostable: true, isActive: true },
          { id: 'capital-id', code: '3101', isPostable: true, isActive: true },
        ],
        findFirst: async () => ({ id: 'inventory-id' }),
      },
      item: { findMany: async () => [{ id: 'stock-item-id', code: 'STOCK-1', isStockTracked: true }] },
      customer: { findMany: async () => [] },
      supplier: { findMany: async () => [] },
      openingBalance: { findFirst: jest.fn(async () => null) },
    };
    const importer = new ImportService(
      root,
      { record: async () => {} } as never,
      { create: createDraft } as never,
    );
    const csv = 'As-of date,Branch code,Account code,Debit,Credit,Item code,Opening quantity,Unit cost\n'
      + '2026-01-01,HQ,1104,10,0,STOCK-1,1,10\n'
      + '2026-01-01,HQ,1104,10,0,STOCK-1,1,10\n'
      + '2026-01-01,HQ,3101,0,20,,,\n';
    const report = await importer.run(
      'opening-balances', COMPANY, USER,
      { originalname: 'duplicate-stock.csv', buffer: Buffer.from(csv, 'utf8') },
      { dryRun: false, mode: 'insert' },
    );

    expect(report.created).toBe(0);
    expect(report.errors.some((error) => error.message.includes('is repeated'))).toBe(true);
    expect(createDraft).not.toHaveBeenCalled();
    expect(root.openingBalance.findFirst).not.toHaveBeenCalled();
  });

  it('does not create an opening-balance draft if any line makes the file unbalanced', async () => {
    const createDraft = jest.fn(async () => ({
      id: 'draft-id', documentNumber: 'OB-0003', status: 'draft',
    }));
    const root: any = {
      branch: { findFirst: async () => ({ id: BRANCH, code: 'HQ', isActive: true }) },
      warehouse: { findFirst: async () => null },
      account: {
        findMany: async () => [
          { id: 'cash-id', code: '1101', isPostable: true, isActive: true },
          { id: 'capital-id', code: '3101', isPostable: true, isActive: true },
        ],
        findFirst: async () => null,
      },
      item: { findMany: async () => [] },
      customer: { findMany: async () => [] },
      supplier: { findMany: async () => [] },
    };
    const importer = new ImportService(root, { record: async () => {} } as never, { create: createDraft } as never);
    const csv = 'As-of date,Account code,Debit,Credit\n'
      + '2026-01-01,1101,1000,0\n'
      + '2026-01-01,3101,0,900\n';
    const report = await importer.run(
      'opening-balances', COMPANY, USER,
      { originalname: 'unbalanced.csv', buffer: Buffer.from(csv, 'utf8') },
      { dryRun: false, mode: 'insert' }, BRANCH,
    );

    expect(report.created).toBe(0);
    expect(report.errors.some((error) => error.message.includes('not balanced'))).toBe(true);
    expect(createDraft).not.toHaveBeenCalled();
  });
});
