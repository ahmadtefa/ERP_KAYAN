import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';

/// The migrations must build the schema Prisma describes.
///
/// A database is only ever created from `prisma/migrations/*.sql`, so any
/// column present in `schema.prisma` but missing from those files does not
/// exist in a real installation - even though the TypeScript compiles and the
/// Prisma client happily generates a query for it. The failure surfaces at
/// runtime, in production, on the one code path that touches the column.
///
/// That is exactly what happened to `stock_movements`: three columns
/// (`enteredUnit`, `enteredQuantity`, `unitFactor`) were added to the model and
/// to every *line* table, but never to the movement table itself. Selling an
/// item in a non-base unit - "1 carton of 500" - died at posting with P2022
/// "column enteredUnit does not exist", which no unit test caught because the
/// existing specs never create a movement with a unit snapshot. Migration
/// 20261107140000_stock_movement_unit_snapshot closes it; this test is the
/// tripwire that stops the next such omission.
///
/// It reads every migration in filename order into a real PostgreSQL engine
/// (PGlite) and compares the result to schema.prisma by parsing both. No
/// database connection is needed, so it runs anywhere the suite runs.

const migrationsDir = join(process.cwd(), 'prisma', 'migrations');
const schemaPath = join(process.cwd(), 'prisma', 'schema.prisma');

/// Prisma scalars that become a column. Everything else in a model body is
/// either a relation (a model name, capitalised, no database column of its
/// own) or an enum, which must be counted too - an enum field *is* a column.
const SCALAR_TYPES = new Set([
  'String',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'Boolean',
  'DateTime',
  'Json',
  'Bytes',
  'Unsupported',
]);

interface Model {
  table: string;
  columns: string[];
}

function parseSchema(source: string): Model[] {
  const enums = new Set(
    [...source.matchAll(/^enum\s+(\w+)\s*\{/gm)].map((match) => match[1]),
  );
  const models: Model[] = [];
  for (const match of source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const body = match[2];
    const mapped = /@@map\("([^"]+)"\)/.exec(body);
    const columns: string[] = [];
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;
      const field = parts[0];
      const type = (parts[1] ?? '').replace(/[?[\]]/g, '');
      if (!SCALAR_TYPES.has(type) && !enums.has(type)) continue;
      columns.push(field);
    }
    models.push({ table: mapped ? mapped[1] : match[1], columns });
  }
  return models;
}

async function migratedDatabase(): Promise<PGlite> {
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
  return db;
}

jest.setTimeout(180_000);

const vmReady =
  process.execArgv.includes('--experimental-vm-modules') ||
  (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules');

(vmReady ? describe : describe.skip)(
  'the migrations alone build the schema Prisma describes',
  () => {
    let db: PGlite;
    let models: Model[];

    beforeAll(async () => {
      models = parseSchema(readFileSync(schemaPath, 'utf8'));
      db = await migratedDatabase();
    });

    afterAll(async () => {
      await db?.close();
    });

    it('parses a plausible number of models', () => {
      // Guard against the parser silently matching nothing and the whole suite
      // passing because it compared zero models to zero tables.
      expect(models.length).toBeGreaterThan(50);
    });

    it('creates every mapped table', async () => {
      const { rows } = await db.query<{ table_name: string }>(
        `select table_name from information_schema.tables where table_schema='public'`,
      );
      const present = new Set(rows.map((row) => row.table_name));
      const missing = models.map((model) => model.table).filter((table) => !present.has(table));
      expect(missing).toEqual([]);
    });

    it('creates every scalar column each model declares', async () => {
      const { rows } = await db.query<{ table_name: string; column_name: string }>(
        `select table_name, column_name from information_schema.columns where table_schema='public'`,
      );
      const present = new Map<string, Set<string>>();
      for (const row of rows) {
        if (!present.has(row.table_name)) present.set(row.table_name, new Set());
        present.get(row.table_name)!.add(row.column_name);
      }

      const missing: string[] = [];
      for (const model of models) {
        const have = present.get(model.table);
        if (!have) continue; // reported by the table test above
        for (const column of model.columns) {
          if (!have.has(column)) missing.push(`${model.table}.${column}`);
        }
      }
      // One readable list rather than one assertion per column, so a future
      // omission reports every missing column in a single run.
      expect(missing).toEqual([]);
    });

    // Named individually so that if the migration is ever dropped, the failure
    // says what breaks rather than just "a column is missing".
    it('keeps the stock-movement unit snapshot columns', async () => {
      const { rows } = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_name='stock_movements'
            and column_name in ('enteredUnit','enteredQuantity','unitFactor')`,
      );
      expect(rows.map((row) => row.column_name).sort()).toEqual([
        'enteredQuantity',
        'enteredUnit',
        'unitFactor',
      ]);
    });
  },
);

if (!vmReady) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n  SKIPPED: the migration/schema parity suite needs\n' +
      '    npm run test:lots\n' +
      '  (NODE_OPTIONS=--experimental-vm-modules, for PGlite\'s wasm engine).\n',
  );
}
