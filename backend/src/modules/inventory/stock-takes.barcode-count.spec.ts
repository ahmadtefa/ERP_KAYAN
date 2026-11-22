import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PGlite } from '@electric-sql/pglite';

import { StockTakesService } from './stock-takes.service';
import { pglitePrisma } from '../../testing/pglite-adapter';

/// What a scanned carton leaves in a stock-take line.
///
/// The count has no unit column of its own: `stock_take_lines` stores the
/// frozen system quantity and the counted figure, both in base units, and the
/// difference between them is what the adjustment will book. So the conversion
/// a scan triggers has to happen before the row is written, exactly once:
///
///   screen sends countedQuantity 1 with unitName "carton"
///   service multiplies by the carton factor (24)
///   row stores countedQuantity 24.0000 and variance -24.0000 against 48 frozen
///
/// A screen that sent 24 instead - reading the same number the barcode endpoint
/// calls `quantityPerScan` - would store 576 and book a loss of 528 that nobody
/// counted. This file pins the row, not a mock, because that is where the
/// difference is reported from.

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const WAREHOUSE = '44444444-4444-4444-8444-444444444444';
const ITEM = '55555555-5555-4555-8555-555555555555';
const SESSION = '99999999-9999-4999-8999-999999999999';
const LINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const D = (v: string | number) => new Prisma.Decimal(v);
const migrationsDir = join(process.cwd(), 'prisma', 'migrations');

async function freshDatabase(frozenBaseQuantity = '48') {
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
    VALUES ('${WAREHOUSE}', '${COMPANY}', '${BRANCH}', 'W1', 'Main', 'رئيسي', true, true, now());

    INSERT INTO items (id, "companyId", code, "nameEn", "nameAr", unit, "isStockTracked",
                       "requiresBatch", "useFefo", "allowExpiredIssue",
                       "salePrice", "updatedAt")
    VALUES ('${ITEM}', '${COMPANY}', 'IT-24', 'Widget', 'قطعة', 'piece', true,
            false, true, false, 10, now());

    INSERT INTO item_units (id, "itemId", unit, factor, "isActive", "createdAt", "updatedAt")
    VALUES ('66666666-6666-4666-8666-666666666666', '${ITEM}', 'piece', 1, true, now(), now()),
           ('77777777-7777-4777-8777-777777777777', '${ITEM}', 'carton', 24, true, now(), now());

    INSERT INTO stock_take_sessions
      (id, "companyId", "branchId", "warehouseId", code, scope, status, "frozenAt",
       "createdAt", "createdBy", "updatedAt")
    VALUES ('${SESSION}', '${COMPANY}', '${BRANCH}', '${WAREHOUSE}', 'STK-1', 'FULL',
            'COUNTING', now(), now(), '${USER}', now());

    INSERT INTO stock_take_lines
      (id, "sessionId", "itemId", "systemQuantity", "unitCost",
       "varianceQuantity", "varianceValue")
    VALUES ('${LINE}', '${SESSION}', '${ITEM}', ${frozenBaseQuantity}, 10, 0, 0);
  `);

  return db;
}

/// The production service over PGlite.
///
/// `pglitePrisma` implements the models the ledger engine calls. The two the
/// count needs are added here, on top of it, so every read and write below is
/// real SQL against the project's own schema - the conversion is proven in the
/// row, not in a mock that could agree with a wrong service.
function serviceFor(db: PGlite) {
  const base = pglitePrisma(db as never) as unknown as Record<string, any>;

  const stockTakeSession = {
    findFirst: async ({ where }: any) => {
      const rows = await db.query<Record<string, unknown>>(
        `SELECT * FROM stock_take_sessions WHERE id = $1 AND "companyId" = $2`,
        [where.id, where.companyId],
      );
      if (rows.rows.length === 0) return null;
      return rows.rows[0];
    },
  };

  const stockTakeLine = {
    /// Answers the shape `record` asks for: the frozen figures, plus the item
    /// and its unit table when `select.item` is present.
    findFirst: async ({ where, select }: any) => {
      const rows = await db.query<Record<string, any>>(
        `SELECT id, "systemQuantity"::text, "unitCost"::text
           FROM stock_take_lines WHERE id = $1 AND "sessionId" = $2`,
        [where.id, where.sessionId],
      );
      if (rows.rows.length === 0) return null;
      const line = rows.rows[0];
      line.systemQuantity = new Prisma.Decimal(line.systemQuantity);
      line.unitCost = new Prisma.Decimal(line.unitCost);
      if (!select?.item) return line;
      const itemRows = await db.query<Record<string, any>>(
        `SELECT l."itemId", i.unit
           FROM stock_take_lines l JOIN items i ON i.id = l."itemId"
          WHERE l.id = $1`,
        [where.id],
      );
      const units = await db.query<Record<string, any>>(
        `SELECT id, unit, factor::text, "isActive"
           FROM item_units WHERE "itemId" = $1 ORDER BY factor`,
        [itemRows.rows[0].itemId],
      );
      return {
        ...line,
        item: {
          unit: itemRows.rows[0].unit,
          units: units.rows.map((unit) => ({
            id: unit.id,
            unit: unit.unit,
            factor: new Prisma.Decimal(unit.factor),
            isActive: unit.isActive,
          })),
        },
      };
    },
    update: async ({ where, data }: any) => {
      await db.query(
        `UPDATE stock_take_lines
            SET "countedQuantity" = $2, "varianceQuantity" = $3,
                "varianceValue" = $4
          WHERE id = $1`,
        [
          where.id,
          data.countedQuantity?.toString() ?? null,
          data.varianceQuantity?.toString() ?? null,
          data.varianceValue?.toString() ?? null,
        ],
      );
      return {};
    },
    count: async ({ where }: any) => {
      const rows = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM stock_take_lines
          WHERE "sessionId" = $1 AND "countedQuantity" IS NULL`,
        [where.sessionId],
      );
      return Number(rows.rows[0].n);
    },
  };

  const prisma = {
    ...base,
    stockTakeSession,
    stockTakeLine,
    $transaction: async (work: (client: unknown) => unknown) => work(prisma),
  };
  const service = new StockTakesService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { record: async () => undefined } as never,
  );
  // `record` answers with the session it just wrote; reading it back needs the
  // whole projection, which this file does not exercise.
  jest.spyOn(service, 'findOne').mockResolvedValue({ id: SESSION } as never);
  return service;
}

async function readLine(db: PGlite) {
  const result = await db.query<{
    countedQuantity: string | null;
    varianceQuantity: string;
    varianceValue: string;
    systemQuantity: string;
  }>(
    `SELECT "countedQuantity"::text, "varianceQuantity"::text,
            "varianceValue"::text, "systemQuantity"::text
       FROM stock_take_lines WHERE id = $1`,
    [LINE],
  );
  return result.rows[0];
}

jest.setTimeout(180_000);

/// Whether this Node process can import the ESM-only PGlite engine.
///
/// PGlite is published as an ES module, so it can only be loaded when Jest runs
/// on a VM that supports dynamic `import()`. That is what the
/// `--experimental-vm-modules` flag unlocks.
const vmLacksDynamicImport = !(
  process.execArgv.includes('--experimental-vm-modules') ||
  (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules')
);

/// A skipped real-database test is worse than no test at all: the suite reports
/// green while proving nothing about the SQL it exists to check. So the missing
/// flag is reported as a FAILURE that says how to supply it, never as a quiet
/// skip. CI sets NODE_OPTIONS for the unit-test step, so a green CI run here
/// means the conversion was actually executed against PostgreSQL.
if (vmLacksDynamicImport) {
  describe('a scanned carton in a stock take, stored', () => {
    it('REFUSES TO PASS WITHOUT A REAL DATABASE: this suite needs --experimental-vm-modules', () => {
      throw new Error(
        [
          'The stock-take conversion tests did not run: PGlite is an ES module and',
          'this Jest VM cannot import it without --experimental-vm-modules.',
          '',
          'Running them as "skipped" would report a green build while proving',
          'nothing about what a scanned carton stores, so this is a failure.',
          '',
          'Fix by running:',
          '  NODE_OPTIONS="--experimental-vm-modules" npx jest \\',
          '    src/modules/inventory/stock-takes.barcode-count.spec.ts',
          '',
          'or by using `npm run test:pglite`, which sets the flag for you.',
        ].join('\n'),
      );
    });
  });
} else {
  describe('a scanned carton in a stock take, stored', () => {
    let db: PGlite;

    afterEach(async () => {
      await db.close();
    });

    it('one carton counted by scan stores 24 base units, never 1 and never 576',
      async () => {
        db = await freshDatabase('48');
        const service = serviceFor(db);

        await service.record(COMPANY, USER, SESSION, {
          lines: [{ lineId: LINE, countedQuantity: 1, unitName: 'carton' }],
        });

        const line = await readLine(db);
        expect(Number(line.countedQuantity)).toBe(24);
        // The difference is booked from the frozen figure, in base units.
        expect(Number(line.varianceQuantity)).toBe(-24);
        expect(Number(line.varianceValue)).toBe(-240);
      });

    it('two cartons counted by scan match a shelf of 48 exactly', async () => {
      db = await freshDatabase('48');
      const service = serviceFor(db);

      await service.record(COMPANY, USER, SESSION, {
        lines: [{ lineId: LINE, countedQuantity: 2, unitName: 'carton' }],
      });

      const line = await readLine(db);
      expect(Number(line.countedQuantity)).toBe(48);
      expect(Number(line.varianceQuantity)).toBe(0);
      expect(Number(line.varianceValue)).toBe(0);
    });

    it('a bare figure stays in base units, as every older client sends it',
      async () => {
        db = await freshDatabase('48');
        const service = serviceFor(db);

        await service.record(COMPANY, USER, SESSION, {
          lines: [{ lineId: LINE, countedQuantity: 30 }],
        });

        const line = await readLine(db);
        expect(Number(line.countedQuantity)).toBe(30);
        expect(Number(line.varianceQuantity)).toBe(-18);
      });

    it('an empty shelf counted in cartons stores zero and the whole loss',
      async () => {
        db = await freshDatabase('48');
        const service = serviceFor(db);

        await service.record(COMPANY, USER, SESSION, {
          lines: [{ lineId: LINE, countedQuantity: 0, unitName: 'carton' }],
        });

        const line = await readLine(db);
        // Zero cartons is zero pieces: "none left" must be recordable.
        expect(Number(line.countedQuantity)).toBe(0);
        expect(Number(line.varianceQuantity)).toBe(-48);
        expect(Number(line.varianceValue)).toBe(-480);
      });

    it('a unit the item does not have records nothing at all', async () => {
      db = await freshDatabase('48');
      const service = serviceFor(db);

      await expect(
        service.record(COMPANY, USER, SESSION, {
          lines: [{ lineId: LINE, countedQuantity: 1, unitName: 'sack' }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      const line = await readLine(db);
      expect(line.countedQuantity).toBeNull();
      expect(Number(line.varianceQuantity)).toBe(0);
    });

    /// The zero-count bug, proven against real PostgreSQL rather than a mock:
    /// a count of zero used to skip the unit check entirely, so an unknown unit
    /// was accepted the moment the figure was zero.
    it('a zero count on an unknown unit is still refused, and writes nothing',
      async () => {
        db = await freshDatabase('48');
        const service = serviceFor(db);

        await expect(
          service.record(COMPANY, USER, SESSION, {
            lines: [{ lineId: LINE, countedQuantity: 0, unitName: 'sack' }],
          }),
        ).rejects.toBeInstanceOf(BadRequestException);

        const line = await readLine(db);
        expect(line.countedQuantity).toBeNull();
        expect(Number(line.varianceQuantity)).toBe(0);
      });

    /// The counterpart: a valid unit with a zero figure must still be stored,
    /// or the fix would have broken "the shelf is empty".
    it('a zero count on a known unit is stored as zero against the real row',
      async () => {
        db = await freshDatabase('48');
        const service = serviceFor(db);

        await service.record(COMPANY, USER, SESSION, {
          lines: [{ lineId: LINE, countedQuantity: 0, unitName: 'carton' }],
        });

        const line = await readLine(db);
        expect(Number(line.countedQuantity)).toBe(0);
        expect(Number(line.varianceQuantity)).toBe(-48);
      });

    it('a fractional factor keeps its fraction instead of rounding to zero',
      async () => {
        db = await freshDatabase('10');
        await db.exec(`
          INSERT INTO item_units (id, "itemId", unit, factor, "isActive", "createdAt", "updatedAt")
          VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${ITEM}', 'half', 0.5, true, now(), now());
        `);
        const service = serviceFor(db);

        await service.record(COMPANY, USER, SESSION, {
          lines: [{ lineId: LINE, countedQuantity: 3, unitName: 'half' }],
        });

        const line = await readLine(db);
        expect(Number(line.countedQuantity)).toBe(1.5);
        expect(Number(line.varianceQuantity)).toBe(-8.5);
      });
  });
}
