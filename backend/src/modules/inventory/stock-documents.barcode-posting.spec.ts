import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma, StockDocumentKind } from '@prisma/client';
import { PGlite } from '@electric-sql/pglite';
import { BadRequestException } from '@nestjs/common';

import { StockDocumentsService } from './stock-documents.service';
import { pglitePrisma } from '../../testing/pglite-adapter';

/// What a scanned carton actually leaves in the database.
///
/// `stock-documents.units.spec.ts` already proves the conversion with a mocked
/// transaction: it checks the object the service hands to Prisma, which is one
/// step short of the row a report reads. This file takes the last step. It
/// builds the project's own schema from the migration files inside PGlite - real
/// DDL, real DECIMAL columns - and then reads the stored row back.
///
/// The fixture is the one the operator described: a carton holds 24 pieces.
///
/// The point being pinned is arithmetic that is easy to get wrong twice:
///
///   screen sends quantity 1 with unitName "carton"
///   service multiplies by the carton factor (24)
///   database stores 24.0000
///
/// A screen that decided to send 24 instead - reading the same number the server
/// calls `quantityPerScan` - would make the service store 576.0000. That is the
/// defect this file exists to catch, and it catches it where it matters: in the
/// row, not in a mock.

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const WAREHOUSE = '44444444-4444-4444-8444-444444444444';
const ITEM = '55555555-5555-4555-8555-555555555555';
/// A transfer needs somewhere to go, so the fixture carries two warehouses of
/// the same branch rather than inventing a second branch.
const WAREHOUSE_2 = '88888888-8888-4888-8888-888888888888';

const D = (v: string | number) => new Prisma.Decimal(v);
const migrationsDir = join(process.cwd(), 'prisma', 'migrations');

/// A carton of 24 pieces, which is the operator's case.
const itemWithCarton = {
  id: ITEM,
  code: 'IT-24',
  unit: 'piece',
  isStockTracked: true,
  units: [
    {
      id: '66666666-6666-4666-8666-666666666666',
      unit: 'piece',
      factor: D(1),
      isActive: true,
    },
    {
      id: '77777777-7777-4777-8777-777777777777',
      unit: 'carton',
      factor: D(24),
      isActive: true,
    },
  ],
};

async function freshDatabase() {
  const db = new PGlite();
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const dir of dirs) {
    let sql: string;
    try {
      sql = readFileSync(join(migrationsDir, dir, 'migration.sql'), 'utf8');
    } catch {
      continue;
    }
    await db.exec(sql);
  }

  await db.exec(`
    INSERT INTO companies (id, code, "nameEn", "nameAr", "updatedAt")
    VALUES ('${COMPANY}', 'CO', 'Co', 'شركة', now());

    INSERT INTO branches (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
    VALUES ('${BRANCH}', '${COMPANY}', 'BR', 'Branch', 'فرع', now());

    INSERT INTO warehouses (id, "companyId", "branchId", code, "nameEn", "nameAr", "isDefault", "isActive", "updatedAt")
    VALUES ('${WAREHOUSE}', '${COMPANY}', '${BRANCH}', 'W1', 'Main', 'رئيسي', true, true, now()),
           ('${WAREHOUSE_2}', '${COMPANY}', '${BRANCH}', 'W2', 'Second', 'ثاني', false, true, now());

    INSERT INTO items (id, "companyId", code, "nameEn", "nameAr", unit, "isStockTracked",
                       "requiresBatch", "useFefo", "allowExpiredIssue",
                       "salePrice", "updatedAt")
    VALUES ('${ITEM}', '${COMPANY}', 'IT-24', 'Widget', 'قطعة', 'piece', true,
            false, true, false, 10, now());

    INSERT INTO item_units (id, "itemId", unit, factor, "isActive", "createdAt", "updatedAt")
    VALUES ('66666666-6666-4666-8666-666666666666', '${ITEM}', 'piece', 1, true, now(), now()),
           ('77777777-7777-4777-8777-777777777777', '${ITEM}', 'carton', 24, true, now(), now());
  `);

  return db;
}

/// The production service, wired to PGlite, with the collaborators a
/// document-creation path never reaches replaced by inert stubs.
function serviceFor(db: PGlite, item: typeof itemWithCarton) {
  const prisma = pglitePrisma(db as never);
  const captured: any[] = [];
  const tx = {
    branch: { findFirst: async () => ({ id: BRANCH }) },
    item: { findFirst: async () => item },
    stockDocument: {
      create: async ({ data }: { data: any }) => {
        captured.push(data);
        return { id: 'doc-1', documentNumber: data.documentNumber };
      },
    },
  };
  const wrapper = {
    ...(prisma as any),
    item: { findFirst: async () => item },
    stockDocument: { findFirst: async () => null },
    $transaction: async (work: (client: unknown) => unknown) => work(tx),
  };
  const service = new StockDocumentsService(
    wrapper as never,
    { next: async () => 'ST-0001' } as never,
    {} as never,
    {} as never,
    { recordRequired: async () => undefined } as never,
    { get: async () => null } as never,
    {} as never,
    { assertPostable: async () => undefined } as never,
    {} as never,
  );
  jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'doc-1' } as never);
  return { service, captured };
}

/// Reads back the line a real insert would have written, by inserting it.
async function persistLine(db: PGlite, line: any) {
  await db.query(
    `INSERT INTO stock_documents
       (id,"companyId","branchId",kind,status,"documentNumber","documentDate",
        "createdBy","createdAt","updatedAt")
     VALUES ($1,$2,$3,'TRANSFER','DRAFT',$4,now(),$5,now(),now())`,
    [crypto.randomUUID(), COMPANY, BRANCH, `ST-${Math.random().toString(36).slice(2, 8)}`, USER],
  );
  const docId = (
    await db.query<{ id: string }>(
      `SELECT id FROM stock_documents WHERE "companyId"=$1 ORDER BY "createdAt" DESC LIMIT 1`,
      [COMPANY],
    )
  ).rows[0].id;

  await db.query(
    `INSERT INTO stock_document_lines
       (id,"documentId","itemId",quantity,"unitName","unitFactor","unitQuantity","lineNumber")
     VALUES ($1,$2,$3,$4,$5,$6,$7,1)`,
    [
      crypto.randomUUID(),
      docId,
      ITEM,
      line.quantity,
      line.unitName ?? null,
      line.unitFactor ?? null,
      line.unitQuantity ?? null,
    ],
  );

  const stored = await db.query<{
    quantity: string;
    unitQuantity: string | null;
    unitFactor: string | null;
    unitName: string | null;
  }>(
    `SELECT quantity::text, "unitQuantity"::text, "unitFactor"::text, "unitName"
       FROM stock_document_lines WHERE "documentId"=$1`,
    [docId],
  );
  return stored.rows[0];
}

jest.setTimeout(120_000);

const vmLacksDynamicImport = !(
  process.execArgv.includes('--experimental-vm-modules') ||
  (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules')
);

(vmLacksDynamicImport ? describe.skip : describe)(
  'a scanned carton of 24, stored',
  () => {
    let db: PGlite;

    beforeEach(async () => {
      db = await freshDatabase();
    });

    afterEach(async () => {
      await db.close();
    });

    it('one scan of the carton unit stores 24 base pieces, not 1 and not 576',
      async () => {
        const { service, captured } = serviceFor(db, itemWithCarton);
        await service.create(COMPANY, BRANCH, USER, {
          kind: StockDocumentKind.TRANSFER,
          fromBranchId: BRANCH,
          branchId: BRANCH,
          fromWarehouseId: WAREHOUSE,
          toWarehouseId: WAREHOUSE_2,
          documentDate: '2026-11-06',
          lines: [{ itemId: ITEM, quantity: '1', unitName: 'carton' }],
        } as never);

        const line = captured[0].lines.create[0];

        // What the service decided.
        expect(line.quantity.toFixed(4)).toBe('24.0000');
        expect(line.unitQuantity.toFixed(4)).toBe('1.0000');
        expect(line.unitFactor.toFixed(6)).toBe('24.000000');
        expect(line.unitName).toBe('carton');

        // What the database holds once the row exists.
        const stored = await persistLine(db, line);
        expect(Number(stored.quantity)).toBe(24);
        expect(Number(stored.unitQuantity)).toBe(1);
        expect(Number(stored.unitFactor)).toBe(24);
        expect(stored.unitName).toBe('carton');
      },
    );

    it('two scans store 48 base pieces', async () => {
      const { service, captured } = serviceFor(db, itemWithCarton);
      await service.create(COMPANY, BRANCH, USER, {
        kind: StockDocumentKind.TRANSFER,
        fromBranchId: BRANCH,
        branchId: BRANCH,
        fromWarehouseId: WAREHOUSE,
        toWarehouseId: WAREHOUSE_2,
        documentDate: '2026-11-06',
        lines: [{ itemId: ITEM, quantity: '2', unitName: 'carton' }],
      } as never);

      const line = captured[0].lines.create[0];
      expect(line.quantity.toFixed(4)).toBe('48.0000');

      const stored = await persistLine(db, line);
      expect(Number(stored.quantity)).toBe(48);
    });

    it('three cartons typed by hand store 72 base pieces', async () => {
      const { service, captured } = serviceFor(db, itemWithCarton);
      await service.create(COMPANY, BRANCH, USER, {
        kind: StockDocumentKind.TRANSFER,
        fromBranchId: BRANCH,
        branchId: BRANCH,
        fromWarehouseId: WAREHOUSE,
        toWarehouseId: WAREHOUSE_2,
        documentDate: '2026-11-06',
        lines: [{ itemId: ITEM, quantity: '3', unitName: 'carton' }],
      } as never);

      const line = captured[0].lines.create[0];
      expect(line.quantity.toFixed(4)).toBe('72.0000');

      const stored = await persistLine(db, line);
      expect(Number(stored.quantity)).toBe(72);
    });

    it('the base unit itself stores the quantity unchanged', async () => {
      const { service, captured } = serviceFor(db, itemWithCarton);
      await service.create(COMPANY, BRANCH, USER, {
        kind: StockDocumentKind.TRANSFER,
        fromBranchId: BRANCH,
        branchId: BRANCH,
        fromWarehouseId: WAREHOUSE,
        toWarehouseId: WAREHOUSE_2,
        documentDate: '2026-11-06',
        lines: [{ itemId: ITEM, quantity: '5', unitName: 'piece' }],
      } as never);

      const line = captured[0].lines.create[0];
      expect(line.quantity.toFixed(4)).toBe('5.0000');

      const stored = await persistLine(db, line);
      expect(Number(stored.quantity)).toBe(5);
    });

    /// The defect this whole stage is about, written as an executable
    /// statement: a client that puts the factor into the quantity box gets 576
    /// pieces. The service is behaving correctly here - it multiplies by the
    /// carton factor because the line says carton. The test exists so that the
    /// wrong client behaviour is visible as a number rather than an argument.
    it('a client that sends the factor as the quantity posts 576 pieces',
      async () => {
        const { service, captured } = serviceFor(db, itemWithCarton);
        await service.create(COMPANY, BRANCH, USER, {
          kind: StockDocumentKind.TRANSFER,
          fromBranchId: BRANCH,
          branchId: BRANCH,
          fromWarehouseId: WAREHOUSE,
          toWarehouseId: WAREHOUSE_2,
          documentDate: '2026-11-06',
          lines: [{ itemId: ITEM, quantity: '24', unitName: 'carton' }],
        } as never);

        const line = captured[0].lines.create[0];
        expect(line.quantity.toFixed(4)).toBe('576.0000');
        expect(captured[0].lines.create[0].unitQuantity.toFixed(4)).toBe(
          '24.0000',
        );
      },
    );

    it('an unknown unit on the line is refused before anything is stored',
      async () => {
        const { service, captured } = serviceFor(db, itemWithCarton);
        await expect(
          service.create(COMPANY, BRANCH, USER, {
            kind: StockDocumentKind.TRANSFER,
            fromBranchId: BRANCH,
            branchId: BRANCH,
            fromWarehouseId: WAREHOUSE,
            toWarehouseId: WAREHOUSE_2,
            documentDate: '2026-11-06',
            lines: [{ itemId: ITEM, quantity: '1', unitName: 'pallet' }],
          } as never),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(captured).toHaveLength(0);
      },
    );
  },
);
