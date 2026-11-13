import { Prisma } from '@prisma/client';

/// The slice of Prisma's client API that the lot engine actually calls, backed
/// by a real PostgreSQL engine (PGlite, compiled to wasm).
///
/// A mock returns whatever the spec told it to; this does not. Every query here
/// is real SQL against a real schema built from the project's own migration
/// files, so a spec that drives `issueTx` through it is exercising the same
/// statements production runs: the conditional `UPDATE ... WHERE remainingQuantity
/// >= n`, the `SELECT ... FOR UPDATE` on the shelf, the decrements, the
/// movements. What it cannot reproduce is genuine cross-connection contention -
/// PGlite is one process - so a concurrency claim still needs a server.
///
/// Only the methods the lot engine and the sales posting touch are implemented.
/// Anything else throws, loudly, rather than pretending to work.

type Row = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/// Renders a `Prisma.sql` value into PGlite's (text, params) form.
export function renderSql(sql: { strings: readonly string[]; values: unknown[] }): {
  text: string;
  params: unknown[];
} {
  let text = '';
  const params: unknown[] = [];
  sql.strings.forEach((part, index) => {
    text += part;
    if (index < sql.values.length) {
      params.push(sql.values[index]);
      text += `$${params.length}`;
    }
  });
  return { text, params };
}

/// `$queryRaw` and `$executeRaw` reach Prisma in two shapes: as a call with a
/// `Prisma.sql` value, and as a tagged template, where the strings arrive as
/// the first argument and the interpolations as the rest. Both mean the same
/// SQL, so both are folded into the same (text, params) pair here.
function normaliseRaw(
  first: { strings?: readonly string[]; values?: unknown[] } | readonly string[],
  rest: unknown[],
): { strings: readonly string[]; values: unknown[] } {
  if (Array.isArray(first)) {
    // A tagged template: Node hands over a frozen array of the literal parts,
    // and the interpolated values come through as the remaining arguments.
    return { strings: first as readonly string[], values: rest };
  }
  const value = first as { strings?: readonly string[]; values?: unknown[] };
  return { strings: value.strings ?? [], values: value.values ?? [] };
}

/// Prisma returns `Decimal`; PGlite returns strings for numeric columns.
/// Rebuild the Decimals so callers keep calling `.toFixed`, `.lessThan` and so
/// on exactly as they do in production.
function revive(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (
      typeof value === 'string' &&
      /^-?\d+(\.\d+)?$/.test(value) &&
      /quantity|value|cost|price|amount|factor|tax|discount|total/i.test(key)
    ) {
      out[key] = new Prisma.Decimal(value);
    } else if (value instanceof Date) {
      out[key] = value;
    } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      out[key] = new Date(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function camelToSnake(value: string): string {
  return value.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/// The physical column name for a Prisma field on a given table.
function columnFor(table: string, field: string): string {
  const explicit: Record<string, Record<string, string>> = {
    item_batches: {
      companyId: 'companyId',
      branchId: 'branchId',
      warehouseId: 'warehouseId',
      itemId: 'itemId',
      batchNumber: 'batchNumber',
      productionDate: 'productionDate',
      expiryDate: 'expiryDate',
      receivedQuantity: 'receivedQuantity',
      remainingQuantity: 'remainingQuantity',
      reservedQuantity: 'reservedQuantity',
      unitCost: 'unitCost',
      status: 'status',
      storageLocationId: 'storageLocationId',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
    item_cost_history: {
      companyId: 'companyId',
      branchId: 'branchId',
      warehouseId: 'warehouseId',
      itemId: 'itemId',
      occurredAt: 'occurredAt',
      quantityIn: 'quantityIn',
      valueIn: 'valueIn',
      quantityAfter: 'quantityAfter',
      valueAfter: 'valueAfter',
      unitCostAfter: 'unitCostAfter',
      sourceType: 'sourceType',
      sourceId: 'sourceId',
      createdBy: 'createdBy',
    },
    stock_movements: {
      companyId: 'companyId',
      branchId: 'branchId',
      warehouseId: 'warehouseId',
      itemId: 'itemId',
      batchId: 'batchId',
      storageLocationId: 'storageLocationId',
      movementDate: 'movementDate',
      direction: 'direction',
      quantity: 'quantity',
      unitCost: 'unitCost',
      totalCost: 'totalCost',
      costCenterId: 'costCenterId',
      referenceType: 'referenceType',
      referenceId: 'referenceId',
      referenceNumber: 'referenceNumber',
      notes: 'notes',
      createdBy: 'createdBy',
      createdAt: 'createdAt',
    },
  };
  return explicit[table]?.[field] ?? field;
}

export interface PgliteLike {
  query(text: string, params?: unknown[]): Promise<{ rows: Row[] }>;
  exec(sql: string): Promise<unknown>;
}

export function pglitePrisma(db: PgliteLike) {
  const q = async (text: string, params: unknown[] = []): Promise<Row[]> => {
    const result = await db.query(text, params);
    return result.rows.map(revive);
  };

  const whereToSql = (
    table: string,
    where: Row | undefined,
    params: unknown[],
    start = 1,
  ): string => {
    if (!where || Object.keys(where).length === 0) return '';
    const parts: string[] = [];
    for (const [field, value] of Object.entries(where)) {
      // Prisma reads an explicit null as IS NULL; undefined means "no filter".
      // Skipping nulls would silently widen `deletedAt: null` to include every
      // soft-deleted row, which is the opposite of what the caller asked for.
      if (value === undefined) continue;
      const col = columnFor(table, field);
      if (value === null) {
        parts.push(`"${col}" IS NULL`);
        continue;
      }
      if (typeof value === 'object' && value !== null && !(value instanceof Date) && !Prisma.Decimal.isDecimal(value)) {
        const ops = value as Record<string, unknown>;
        if ('gt' in ops) {
          params.push(ops.gt);
          parts.push(`"${col}" > $${params.length}`);
          continue;
        }
        if ('gte' in ops) {
          params.push(ops.gte);
          parts.push(`"${col}" >= $${params.length}`);
          continue;
        }
        if ('lte' in ops) {
          params.push(ops.lte);
          parts.push(`"${col}" <= $${params.length}`);
          continue;
        }
        if ('in' in ops) {
          const list = ops.in as unknown[];
          if (list.length === 0) {
            parts.push('FALSE');
          } else {
            const placeholders = list.map((v) => {
              params.push(v);
              return `$${params.length}`;
            });
            parts.push(`"${col}" IN (${placeholders.join(',')})`);
          }
          continue;
        }
        continue;
      }
      params.push(value);
      parts.push(`"${col}" = $${params.length}`);
    }
    return parts.length ? ` WHERE ${parts.join(' AND ')}` : '';
  };

  const orderToSql = (table: string, orderBy: unknown): string => {
    if (!orderBy) return '';
    const list = Array.isArray(orderBy) ? orderBy : [orderBy];
    const parts: string[] = [];
    for (const entry of list) {
      for (const [field, dir] of Object.entries(entry as Record<string, unknown>)) {
        parts.push(`"${columnFor(table, field)}" ${String(dir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`);
      }
    }
    return parts.length ? ` ORDER BY ${parts.join(', ')}` : '';
  };

  /// The columns a table really has, read from the catalogue once per table.
  ///
  /// The schema is not uniform: `journal_line_allocations` is keyed by the
  /// database, `stock_balances` has no `id` at all, and not every table carries
  /// `updatedAt`. Guessing would write a column that does not exist; reading
  /// the catalogue once makes every insert match the table it targets.
  const columnCache = new Map<string, Set<string>>();
  const columnsOf = async (table: string): Promise<Set<string>> => {
    const cached = columnCache.get(table);
    if (cached) return cached;
    const rows = await q(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [table],
    );
    const columns = new Set(rows.map((row) => String(row.column_name)));
    columnCache.set(table, columns);
    return columns;
  };

  /// Inserts one row and returns it.
  ///
  /// Two columns are filled here that production never sends: `id`, because
  /// `@default(uuid())` and `@default(cuid())` are computed by the Prisma
  /// client rather than by the database, and `updatedAt`, because `@updatedAt`
  /// is stamped by the client on every write. Both are only added when the
  /// table actually has the column.
  const insertRow = async (
    table: string,
    data: Row,
    returning = 'id',
  ): Promise<Row> => {
    const columns = await columnsOf(table);
    const cols: string[] = [];
    const params: unknown[] = [];
    if (columns.has('id') && data.id === undefined) {
      cols.push('"id"');
      params.push(crypto.randomUUID());
    }
    if (columns.has('updatedAt') && data.updatedAt === undefined) {
      cols.push('"updatedAt"');
      params.push(new Date());
    }
    for (const [field, value] of Object.entries(data)) {
      if (value === undefined) continue;
      cols.push(`"${columnFor(table, field)}"`);
      params.push(
        Prisma.Decimal.isDecimal(value) ? (value as Prisma.Decimal).toString() : value,
      );
    }
    const placeholders = params.map((_, i) => `$${i + 1}`);
    const rows = await q(
      `INSERT INTO "${table}" (${cols.join(',')}) VALUES (${placeholders.join(',')}) RETURNING ${returning}`,
      params,
    );
    return rows[0] ?? {};
  };

  /// Where a nested `create` payload lands: which model the child is, which
  /// table stores it, and which column points back at its parent.
  ///
  /// Prisma performs a nested write as a single statement; the adapter performs
  /// the same steps inside the caller's transaction, which is the transaction
  /// that decides whether the invoice posts at all.
  const CHILDREN: Record<
    string,
    Record<string, { model: string; table: string; foreignKey: string }>
  > = {
    journalEntry: {
      lines: { model: 'journalLine', table: 'journal_lines', foreignKey: 'journalEntryId' },
    },
    journalLine: {
      allocations: {
        model: 'journalLineAllocation',
        table: 'journal_line_allocations',
        foreignKey: 'journalLineId',
      },
    },
    salesInvoice: {
      lines: { model: 'salesInvoiceLine', table: 'sales_invoice_lines', foreignKey: 'invoiceId' },
    },
  };

  /// The relations the posting walks. Prisma loads them with a second query;
  /// the adapter runs the same second query, so `include` means the same thing
  /// here as it does in production.
  ///
  /// `foreignKey` is the column on the *other* table that points back at this
  /// row - `invoiceId` for a line. `parentField` names the column on *this*
  /// row that holds the key when the relation is to-one, where the child is
  /// looked up by its own primary key.
  const RELATIONS: Record<
    string,
    Record<string, { model: string; table: string; foreignKey: string; parentField?: string }>
  > = {
    salesInvoice: {
      lines: { model: 'salesInvoiceLine', table: 'sales_invoice_lines', foreignKey: 'invoiceId' },
      customer: {
        model: 'customer',
        table: 'customers',
        foreignKey: 'id',
        parentField: 'customerId',
      },
    },
    journalEntry: {
      lines: { model: 'journalLine', table: 'journal_lines', foreignKey: 'journalEntryId' },
    },
    journalLine: {
      allocations: {
        model: 'journalLineAllocation',
        table: 'journal_line_allocations',
        foreignKey: 'journalLineId',
      },
    },
  };

  /// Writes one row and then whatever nested `create` payloads it carries.
  const createWithChildren = async (model: string, table: string, data: Row): Promise<Row> => {
    const parent = { ...data };
    const nested: Array<{
      child: { model: string; table: string; foreignKey: string };
      rows: Row[];
    }> = [];
    for (const [key, mapping] of Object.entries(CHILDREN[model] ?? {})) {
      const value = parent[key] as Row | undefined;
      if (value && Array.isArray(value.create)) {
        nested.push({ child: mapping, rows: value.create as Row[] });
        delete parent[key];
      }
    }
    const row = await insertRow(table, parent, '*');
    for (const { child, rows } of nested) {
      for (const childData of rows) {
        await createWithChildren(child.model, child.table, {
          ...childData,
          [child.foreignKey]: row.id,
        });
      }
    }
    return row;
  };

  /// A plain model: the operations the sales posting and its reversal call on
  /// a table that has no special arithmetic of its own.
  const plainModel = (model: string, table: string) => {
    type FindMany = (args?: Row) => Promise<Row[]>;
    const self = {
      findFirst: async (args: Row = {}) => {
        const rows = await self.findMany({ ...args, take: 1 });
        return rows[0] ?? null;
      },
      findMany: async (args: Row = {}) => {
        const params: unknown[] = [];
        const where = whereToSql(table, args.where as Row, params);
        const order = orderToSql(table, args.orderBy);
        const rows = await q(`SELECT * FROM "${table}"${where}${order}`, params);

        // `select` is honoured the way Prisma honours it: only the named
        // columns come back, so a caller cannot lean on a field it did not ask
        // for.
        const select = args.select as Record<string, unknown> | undefined;
        const shaped = select
          ? rows.map((row) => {
              const keep = Object.keys(select).filter((key) => Boolean(select[key]));
              const out: Row = {};
              for (const key of keep) out[key] = row[columnFor(table, key)];
              return out;
            })
          : rows;

        // `include` is a second query per relation in Prisma, and it is a
        // second query here too - not a join - so the shape the caller sees and
        // the shape the database holds stay the same thing.
        const include = args.include as Record<string, Row | boolean> | undefined;
        if (!include) return shaped;
        for (const [field, spec] of Object.entries(RELATIONS[model] ?? {})) {
          if (!include[field]) continue;
          const options = include[field] === true ? {} : (include[field] as Row);
          const toOne = Boolean(spec.parentField);
          for (const row of shaped) {
            // A to-many relation filters the child table by the key stored on
            // the child; a to-one relation looks the child up by its own id,
            // which this row carries as a column.
            const source = toOne
              ? ({ [spec.foreignKey]: row[columnFor(table, spec.parentField as string)] } as Row)
              : ({ [spec.foreignKey]: row.id } as Row);
            // The child lives in another table, so its own model answers -
            // running this against the parent's table would filter the wrong
            // relation and read the wrong rows.
            const children = (await plainModel(spec.model, spec.table).findMany({
              ...options,
              where: { ...((options.where as Row) ?? {}), ...source },
            })) as Row[];
            (row as Row)[field] = toOne ? (children[0] ?? null) : children;
          }
        }
        return shaped;
      },
      findUnique: async (args: Row = {}) => {
        const rows = await self.findMany({ ...args, take: 1 });
        return rows[0] ?? null;
      },
      count: async (args: Row = {}) => {
        const params: unknown[] = [];
        const where = whereToSql(table, args.where as Row, params);
        const rows = await q(`SELECT count(*)::int AS n FROM "${table}"${where}`, params);
        return Number(rows[0]?.n ?? 0);
      },
      create: async (args: Row) => createWithChildren(model, table, { ...(args.data as Row) }),
      update: async (args: Row) => {
        const params: unknown[] = [];
        const sets: string[] = [];
        for (const [field, value] of Object.entries(args.data as Row)) {
          params.push(
            Prisma.Decimal.isDecimal(value) ? (value as Prisma.Decimal).toString() : value,
          );
          sets.push(`"${columnFor(table, field)}" = $${params.length}`);
        }
        const where = whereToSql(table, args.where as Row, params);
        const rows = await q(
          `UPDATE "${table}" SET ${sets.join(',')}${where} RETURNING *`,
          params,
        );
        return rows[0] ?? {};
      },
      updateMany: async (args: Row) => {
        const params: unknown[] = [];
        const sets: string[] = [];
        for (const [field, value] of Object.entries(args.data as Row)) {
          params.push(
            Prisma.Decimal.isDecimal(value) ? (value as Prisma.Decimal).toString() : value,
          );
          sets.push(`"${columnFor(table, field)}" = $${params.length}`);
        }
        const where = whereToSql(table, args.where as Row, params);
        // RETURNING reports the rows the UPDATE really matched, so a guarded
        // claim that finds nothing returns 0 instead of lying.
        const result = await db.query(
          `UPDATE "${table}" SET ${sets.join(',')}${where} RETURNING id`,
          params,
        );
        return { count: result.rows.length };
      },
    } as Record<string, unknown> & { findMany: FindMany };
    return self;
  };

  const client: Record<string, unknown> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $queryRaw: async (first: any, ...rest: unknown[]) => {
      const { text, params } = renderSql(normaliseRaw(first, rest));
      return q(text, params);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $executeRaw: async (first: any, ...rest: unknown[]) => {
      const { text, params } = renderSql(normaliseRaw(first, rest));
      await db.query(text, params);
      return 1;
    },

    itemBatch: {
      findMany: async (args: Row = {}) => {
        const params: unknown[] = [];
        const where = whereToSql('item_batches', args.where as Row, params);
        const order = orderToSql('item_batches', args.orderBy);
        return q(`SELECT * FROM "item_batches"${where}${order}`, params);
      },
      findFirst: async (args: Row = {}) => {
        const rows = await (client.itemBatch as any).findMany({ ...args, take: 1 });
        return rows[0] ?? null;
      },
      // `list()` pages with a count over the same filter. Without it the page
      // total is unknown to the caller, not zero, so it must be answered
      // rather than left to fail as a missing method.
      count: async (args: Row = {}) => {
        const params: unknown[] = [];
        const where = whereToSql('item_batches', args.where as Row, params);
        const rows = await q(`SELECT count(*)::int AS n FROM "item_batches"${where}`, params);
        return Number(rows[0]?.n ?? 0);
      },
      updateMany: async (args: Row) => {
        const params: unknown[] = [];
        const where = whereToSql('item_batches', args.where as Row, params);
        const data = args.data as Row;
        const sets: string[] = [];
        for (const [field, value] of Object.entries(data)) {
          const col = `"${columnFor('item_batches', field)}"`;
          if (typeof value === 'object' && value !== null && !Prisma.Decimal.isDecimal(value)) {
            const op = value as Record<string, number | string>;
            if ('increment' in op) {
              params.push(op.increment);
              sets.push(`${col} = ${col} + $${params.length}`);
              continue;
            }
            if ('decrement' in op) {
              params.push(op.decrement);
              sets.push(`${col} = ${col} - $${params.length}`);
              continue;
            }
          }
          params.push(Prisma.Decimal.isDecimal(value) ? (value as Prisma.Decimal).toString() : value);
          sets.push(`${col} = $${params.length}`);
        }
        if (sets.length === 0) return { count: 0 };
        // RETURNING is what makes the count truthful: it reports the rows the
        // UPDATE actually matched, so a conditional `remainingQuantity >= n`
        // that finds nothing returns 0 and the engine can raise its conflict.
        const result = await db.query(
          `UPDATE "item_batches" SET ${sets.join(',')}${where} RETURNING id`,
          params,
        );
        return { count: result.rows.length };
      },
      create: async (args: Row) => {
        const data = args.data as Row;
        // Prisma fills @updatedAt itself; the adapter has to do the same or the
        // NOT NULL column rejects every insert.
        if (data.updatedAt === undefined) data.updatedAt = new Date();
        const fields = Object.keys(data);
        const rows = await q(
          `INSERT INTO "item_batches" ("id"${fields
            .map((f) => `,"${columnFor('item_batches', f)}"`)
            .join('')}) VALUES (gen_random_uuid()${fields.map((_, i) => `,$${i + 1}`).join('')})
           RETURNING *`,
          fields.map((f) => {
            const value = data[f];
            return Prisma.Decimal.isDecimal(value)
              ? (value as Prisma.Decimal).toString()
              : value;
          }),
        );
        return rows[0] ?? {};
      },
      update: async (args: Row) => {
        const params: unknown[] = [];
        const where = whereToSql('item_batches', args.where as Row, params);
        const data = args.data as Row;
        const sets: string[] = [];
        for (const [field, value] of Object.entries(data)) {
          const col = `"${columnFor('item_batches', field)}"`;
          if (typeof value === 'object' && value !== null && !Prisma.Decimal.isDecimal(value)) {
            const op = value as Record<string, number | string>;
            if ('increment' in op) {
              params.push(op.increment);
              sets.push(`${col} = ${col} + $${params.length}`);
              continue;
            }
            if ('decrement' in op) {
              params.push(op.decrement);
              sets.push(`${col} = ${col} - $${params.length}`);
              continue;
            }
          }
          params.push(Prisma.Decimal.isDecimal(value) ? (value as Prisma.Decimal).toString() : value);
          sets.push(`${col} = $${params.length}`);
        }
        if (sets.length === 0) return {};
        const rows = await q(
          `UPDATE "item_batches" SET ${sets.join(',')}${where} RETURNING *`,
          params,
        );
        return rows[0] ?? {};
      },
    },

    // A lot points at its shelf by id alone - the schema has no relation - so
    // `list()` resolves the ids in one query. That query needs this model.
    storageLocation: {
      findMany: async (args: Row = {}) => {
        const params: unknown[] = [];
        const where = whereToSql('storage_locations', args.where as Row, params);
        return q(`SELECT * FROM "storage_locations"${where}`, params);
      },
      findFirst: async (args: Row = {}) => {
        const rows = await (client.storageLocation as any).findMany({ ...args, take: 1 });
        return rows[0] ?? null;
      },
    },

    stockMovement: {
      create: async (args: Row) => {
        const data = args.data as Row;
        const rows = await q(
          `INSERT INTO "stock_movements" ("id"${Object.keys(data)
            .map((f) => `,"${columnFor('stock_movements', f)}"`)
            .join('')}) VALUES (gen_random_uuid()${Object.keys(data)
            .map((_, i) => `,$${i + 1}`)
            .join('')}) RETURNING *`,
          Object.values(data).map((v) =>
            Prisma.Decimal.isDecimal(v) ? (v as Prisma.Decimal).toString() : v,
          ),
        );
        return rows[0] ?? {};
      },
      findMany: async (args: Row = {}) => {
        const params: unknown[] = [];
        const where = whereToSql('stock_movements', args.where as Row, params);
        return q(`SELECT * FROM "stock_movements"${where}`, params);
      },
      count: async (args: Row = {}) => {
        const params: unknown[] = [];
        const where = whereToSql('stock_movements', args.where as Row, params);
        const rows = await q(`SELECT count(*)::int AS n FROM "stock_movements"${where}`, params);
        return Number(rows[0]?.n ?? 0);
      },
    },

    stockBalance: {
      createMany: async (args: Row) => {
        const rows = (args.data as Row[]) ?? [];
        for (const row of rows) {
          await db.query(
            `INSERT INTO "stock_balances" ("companyId","branchId","itemId","quantity","value","updatedAt")
             VALUES ($1,$2,$3,$4,$5,now()) ON CONFLICT DO NOTHING`,
            [
              row.companyId,
              row.branchId,
              row.itemId,
              String(row.quantity ?? 0),
              String(row.value ?? 0),
            ],
          );
        }
        return { count: rows.length };
      },
      update: async (args: Row) => {
        const where = args.where as Record<string, Record<string, unknown>>;
        const key = where.companyId_branchId_itemId;
        const data = args.data as Row;
        const sets: string[] = [];
        const params: unknown[] = [];
        for (const [field, value] of Object.entries(data)) {
          const op = value as Record<string, unknown>;
          if (op && typeof op === 'object' && 'decrement' in op) {
            params.push(String(op.decrement));
            sets.push(`"${field}" = "${field}" - $${params.length}`);
          } else {
            params.push(Prisma.Decimal.isDecimal(value) ? (value as Prisma.Decimal).toString() : value);
            sets.push(`"${field}" = $${params.length}`);
          }
        }
        params.push(key.companyId, key.branchId, key.itemId);
        await db.query(
          `UPDATE "stock_balances" SET ${sets.join(',')}
            WHERE "companyId" = $${params.length - 2} AND "branchId" = $${params.length - 1} AND "itemId" = $${params.length}`,
          params,
        );
        return {};
      },
    },

    // ---- the tables the sales document itself lives in -----------------
    //
    // The lot suite above only needs the stock tables. These are here so the
    // posting and its reversal can be driven as the real service, against the
    // real schema, rather than as a mock of themselves.
    salesInvoice: plainModel('salesInvoice', 'sales_invoices'),
    salesInvoiceLine: plainModel('salesInvoiceLine', 'sales_invoice_lines'),
    journalEntry: plainModel('journalEntry', 'journal_entries'),
    journalLine: plainModel('journalLine', 'journal_lines'),
    account: plainModel('account', 'accounts'),
    customer: plainModel('customer', 'customers'),
    warehouse: plainModel('warehouse', 'warehouses'),
    branch: plainModel('branch', 'branches'),
    item: plainModel('item', 'items'),
    fiscalPeriod: plainModel('fiscalPeriod', 'fiscal_periods'),
    costCenter: plainModel('costCenter', 'cost_centers'),

    // The per-shelf cost trail the engine writes after every issue. Not asserted
    // here, but it must accept the row or the issue cannot complete.
    itemCostHistory: {
      create: async (args: Row) => insertRow('item_cost_history', args.data as Row),
    },

    warehouseStockBalance: {
      createMany: async (args: Row) => {
        const rows = (args.data as Row[]) ?? [];
        for (const row of rows) {
          await db.query(
            `INSERT INTO "warehouse_stock_balances" ("companyId","branchId","warehouseId","itemId","quantity","value","updatedAt")
             VALUES ($1,$2,$3,$4,$5,$6,now()) ON CONFLICT DO NOTHING`,
            [
              row.companyId,
              row.branchId,
              row.warehouseId,
              row.itemId,
              String(row.quantity ?? 0),
              String(row.value ?? 0),
            ],
          );
        }
        return { count: rows.length };
      },
      update: async (args: Row) => {
        const where = args.where as Record<string, Record<string, unknown>>;
        const key =
          where.companyId_branchId_warehouseId_itemId ??
          where.companyId_warehouseId_itemId ??
          (Object.values(where)[0] as Record<string, unknown>);
        const data = args.data as Row;
        const sets: string[] = [];
        const params: unknown[] = [];
        for (const [field, value] of Object.entries(data)) {
          params.push(Prisma.Decimal.isDecimal(value) ? (value as Prisma.Decimal).toString() : value);
          sets.push(`"${field}" = $${params.length}`);
        }
        params.push(key.companyId, key.branchId, key.warehouseId, key.itemId);
        const n = params.length;
        await db.query(
          `UPDATE "warehouse_stock_balances" SET ${sets.join(',')}
            WHERE "companyId" = $${n - 3} AND "branchId" = $${n - 2}
              AND "warehouseId" = $${n - 1} AND "itemId" = $${n}`,
          params,
        );
        return {};
      },
    },

    // The audit log is where an expired-issue approval has to land, so the
    // spec can read it back and prove who signed, when and why.
    auditLog: {
      create: async (args: Row) => {
        const data = { ...(args.data as Row) };
        // Prisma maps Json columns from objects; PGlite needs the text form.
        if (data.beforeJson && typeof data.beforeJson === 'object') {
          data.beforeJson = JSON.stringify(data.beforeJson);
        }
        if (data.afterJson && typeof data.afterJson === 'object') {
          data.afterJson = JSON.stringify(data.afterJson);
        }
        return insertRow('audit_logs', data);
      },
    },

    $transaction: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
      await db.exec('BEGIN');
      try {
        const result = await work(client);
        await db.exec('COMMIT');
        return result;
      } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
      }
    },
  };

  return client;
}

export { UUID_RE };
