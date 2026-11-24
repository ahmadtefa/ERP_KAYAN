import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A column name in a migration is a promise about how Prisma will address it.
 *
 * Prisma does not read the SQL: it takes the field name from the model in
 * `schema.prisma` and uses it verbatim unless the field carries `@map`, and
 * this schema's convention is to name columns in the model's own spelling
 * (`notificationId`, not `notification_id`). So a migration that creates
 * `notification_id` while the model says `notificationId` produces a table
 * Prisma cannot query at all — P2022, "column does not exist", for every read.
 *
 * That is what happened: `notification_user_states` was created with snake_case
 * columns, and on real PostgreSQL the whole alert centre answered 500. The unit
 * suites missed it because the PGlite adapter resolves field names itself and
 * never notices what the SQL named them. The lesson is that this class of bug
 * is invisible to every test that does not read the two files together, so this
 * spec does exactly that.
 *
 * It is deliberately a file-level check rather than a database one: it runs in
 * the ordinary unit suite, needs no server, and fails at the moment somebody
 * writes the mismatched migration rather than months later in production.
 */
const MIGRATIONS = join(process.cwd(), 'prisma', 'migrations');
const SCHEMA = join(process.cwd(), 'prisma', 'schema.prisma');

interface ModelColumn {
  model: string;
  table: string;
  /// Prisma field name, which is also the column name when no `@map` is set.
  field: string;
  column: string;
}

/// Read every model in the schema and the column each field is stored in.
function modelColumns(): ModelColumn[] {
  const schema = readFileSync(SCHEMA, 'utf8');
  const lines = schema.split('\n');
  const out: ModelColumn[] = [];
  let current: { name: string; table: string } | null = null;
  for (const line of lines) {
    const modelStart = /^model\s+(\w+)\s*\{/.exec(line);
    if (modelStart) {
      current = { name: modelStart[1], table: modelStart[1] };
      continue;
    }
    if (current === null) continue;
    if (line.trim() === '}') {
      current = null;
      continue;
    }
    const mapped = /^@@map\("([^"]+)"\)/.exec(line.trim());
    if (mapped) {
      current.table = mapped[1];
      continue;
    }
    if (line.trim().startsWith('@@') || line.trim().startsWith('//')) continue;
    const field = /^\s+(\w+)\s+\w/.exec(line);
    if (!field) continue;
    // Relation fields are not columns; they carry a type that is another model
    // and no `@db.` attribute.
    const columnMap = /@map\("([^"]+)"\)/.exec(line);
    const isRelation = /^\s+\w+\s+(\w+)(\[\])?(\?)?\s+@relation/.test(line);
    const isScalarType = /^\s+\w+\s+(String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes)\b/.test(line);
    if (isRelation || !isScalarType) continue;
    out.push({
      model: current.name,
      table: current.table,
      field: field[1],
      column: columnMap ? columnMap[1] : field[1],
    });
  }
  return out;
}

/// Every `CREATE TABLE` in every migration, as table -> columns in the order
/// they were written, plus any `RENAME COLUMN` that later moved a name.
function sqlTables(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const add = (table: string, column: string) => {
    if (!tables.has(table)) tables.set(table, new Set());
    tables.get(table)!.add(column);
  };
  const rename = (table: string, from: string, to: string) => {
    const set = tables.get(table);
    if (!set || !set.has(from)) return;
    set.delete(from);
    set.add(to);
  };

  for (const entry of readdirSync(MIGRATIONS).sort()) {
    const path = join(MIGRATIONS, entry, 'migration.sql');
    let sql: string;
    try {
      if (!statSync(path).isFile()) continue;
      sql = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    // CREATE TABLE "name" ( "col" TYPE ..., "col2" TYPE ... );
    const createPattern = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"([^"]+)"\s*\(([\s\S]*?)\n\);/g;
    for (const match of sql.matchAll(createPattern)) {
      const [, table, body] = match;
      for (const line of body.split('\n')) {
        const column = /^\s*"([^"]+)"\s+[A-Z]/.exec(line);
        if (column) add(table, column[1]);
      }
    }
    // ALTER TABLE "name" RENAME COLUMN "a" TO "b";
    const renamePattern =
      /ALTER TABLE\s+"([^"]+)"\s+RENAME COLUMN\s+"([^"]+)"\s+TO\s+"([^"]+)"/g;
    for (const match of sql.matchAll(renamePattern)) {
      rename(match[1], match[2], match[3]);
    }
    // A guarded block runs the same statement behind an IF; the regex above
    // still sees it, which is what we want.
  }
  return tables;
}

describe('migrations and the Prisma model agree on column names', () => {
  const columns = modelColumns();
  const tables = sqlTables();

  it('parses the schema and the migrations rather than silently passing', () => {
    // A regex that quietly matches nothing would make every assertion below
    // vacuous. These floors are low enough not to be brittle and high enough
    // to prove the parser is reading real content.
    expect(columns.length).toBeGreaterThan(500);
    expect(tables.size).toBeGreaterThan(40);
  });

  it('creates every mapped table with the column names the model expects', () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const column of columns) {
      seen.add(column.table);
      const created = tables.get(column.table);
      if (!created) continue; // table may predate the migrations that name it
      if (!created.has(column.column)) {
        const snake = column.column.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
        problems.push(
          `${column.model}.${column.field} expects "${column.table}"."${column.column}"` +
            (created.has(snake)
              ? ` but the migration created "${snake}" - Prisma will answer P2022`
              : `, which no migration creates`),
        );
      }
    }
    expect(problems).toEqual([]);
    expect(seen.size).toBeGreaterThan(40);
  });

  it('names the per-person read state the way the model does', () => {
    // The specific regression this file was written for, kept because a general
    // assertion that passes is easier to weaken than one that names the bug.
    const created = tables.get('notification_user_states');
    expect(created).toBeDefined();
    for (const column of ['notificationId', 'userId', 'readAt', 'dismissedAt', 'createdAt']) {
      expect(created!.has(column)).toBe(true);
    }
    for (const wrong of ['notification_id', 'user_id', 'read_at', 'dismissed_at', 'created_at']) {
      expect(created!.has(wrong)).toBe(false);
    }
  });
});
