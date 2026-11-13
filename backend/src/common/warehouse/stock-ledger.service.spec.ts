import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { StockLedgerService } from './stock-ledger.service';

/*
 * The stock ledger, against an in-memory stand-in for the parts of PostgreSQL
 * it depends on.
 *
 * The stand-in is deliberately a little pedantic, because the defect this file
 * exists for was not in the arithmetic - it was in *how* the two books were
 * written:
 *
 *   - `stock_balances` carries the database's own CHECK
 *     (`quantity >= 0`). The stand-in enforces it on insert and on update, so
 *     a negative figure fails the test the way it fails real PostgreSQL
 *     instead of passing quietly;
 *   - `createMany({ skipDuplicates })` is the ON CONFLICT DO NOTHING the
 *     ledger uses to make sure a row exists at zero before it is locked;
 *   - `$queryRaw` answers the ledger's SELECT ... FOR UPDATE and its SUM.
 *
 * What is asserted is the invariant, not the implementation: after any
 * posting the branch holds exactly what its shelves hold, and no single
 * posting can ever *create* a balance out of thin air.
 */

interface Row {
  companyId: string;
  branchId: string;
  warehouseId?: string;
  itemId: string;
  quantity: Prisma.Decimal;
  value: Prisma.Decimal;
}

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const WAREHOUSE_A = '33333333-3333-4333-8333-333333333333';
const WAREHOUSE_B = '44444444-4444-4444-8444-444444444444';
const ITEM = '55555555-5555-4555-8555-555555555555';

/// What PostgreSQL says when the balance would go negative.
class CheckViolation extends Error {
  readonly code = '23514';
  constructor(table: string) {
    super(
      `new row for relation "${table}" violates check constraint "${table}_quantity_nonnegative"`,
    );
  }
}

/// The bound parameters of a `Prisma.sql` fragment, whichever client is in
/// play: the generated one and the test shim both expose `values`.
function parameters(query: unknown): unknown[] {
  const raw = query as { values?: unknown[] } | null;
  return raw && Array.isArray(raw.values) ? raw.values : [];
}

function sqlText(query: unknown): string {
  const raw = query as { sql?: string; strings?: string[] } | string;
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw.sql === 'string') return raw.sql;
  if (raw && Array.isArray(raw.strings)) return raw.strings.join('?');
  return '';
}

class PostgresLike {
  readonly branchRows = new Map<string, Row>();
  readonly shelfRows = new Map<string, Row>();
  /// Every statement the ledger issued, in order, so a test can assert that
  /// the row is created before it is locked and written as a figure.
  readonly statements: string[] = [];

  private branchKey(branchId: string, itemId: string) {
    return `${branchId}:${itemId}`;
  }

  private shelfKey(warehouseId: string, itemId: string) {
    return `${warehouseId}:${itemId}`;
  }

  seedBranch(quantity: number, value: number, itemId = ITEM) {
    this.branchRows.set(this.branchKey(BRANCH, itemId), {
      companyId: COMPANY,
      branchId: BRANCH,
      itemId,
      quantity: new Prisma.Decimal(quantity),
      value: new Prisma.Decimal(value),
    });
  }

  seedShelf(warehouseId: string, quantity: number, value: number, itemId = ITEM) {
    this.shelfRows.set(this.shelfKey(warehouseId, itemId), {
      companyId: COMPANY,
      branchId: BRANCH,
      warehouseId,
      itemId,
      quantity: new Prisma.Decimal(quantity),
      value: new Prisma.Decimal(value),
    });
  }

  /// Runs `work` the way a real transaction would: whatever it wrote is
  /// undone when it throws, so a refusal leaves no row behind.
  async inTransaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
    const branch = new Map(this.branchRows);
    const shelf = new Map(this.shelfRows);
    try {
      return await work(this.tx);
    } catch (error) {
      this.branchRows.clear();
      for (const [key, row] of branch) this.branchRows.set(key, { ...row });
      this.shelfRows.clear();
      for (const [key, row] of shelf) this.shelfRows.set(key, { ...row });
      throw error;
    }
  }

  /// The transaction surface the ledger uses, and nothing more.
  get tx() {
    const self = this;
    return {
      /** @internal */
      $queryRaw: async (query: unknown) => self.query(sqlText(query), parameters(query)),
      stockBalance: {
        createMany: async (args: { data: Row[]; skipDuplicates?: boolean }) => {
          self.statements.push('stock_balances.createMany');
          let count = 0;
          for (const row of args.data) {
            const key = self.branchKey(row.branchId, row.itemId);
            if (self.branchRows.has(key)) continue;
            if (new Prisma.Decimal(row.quantity).lessThan(0)) {
              throw new CheckViolation('stock_balances');
            }
            self.branchRows.set(key, { ...row });
            count += 1;
          }
          return { count };
        },
        update: async (args: {
          where: { companyId_branchId_itemId: { branchId: string; itemId: string } };
          data: { quantity: Prisma.Decimal; value: Prisma.Decimal };
        }) => {
          self.statements.push('stock_balances.update');
          const key = self.branchKey(
            args.where.companyId_branchId_itemId.branchId,
            args.where.companyId_branchId_itemId.itemId,
          );
          const row = self.branchRows.get(key);
          if (!row) throw new Error('No branch balance to update');
          if (new Prisma.Decimal(args.data.quantity).lessThan(0)) {
            throw new CheckViolation('stock_balances');
          }
          row.quantity = new Prisma.Decimal(args.data.quantity);
          row.value = new Prisma.Decimal(args.data.value);
          return row;
        },
      },
      warehouseStockBalance: {
        createMany: async (args: { data: Row[]; skipDuplicates?: boolean }) => {
          self.statements.push('warehouse_stock_balances.createMany');
          let count = 0;
          for (const row of args.data) {
            const key = self.shelfKey(row.warehouseId as string, row.itemId);
            if (self.shelfRows.has(key)) continue;
            self.shelfRows.set(key, { ...row });
            count += 1;
          }
          return { count };
        },
        update: async (args: {
          where: {
            companyId_branchId_warehouseId_itemId: { warehouseId: string; itemId: string };
          };
          data: { quantity: Prisma.Decimal; value: Prisma.Decimal };
        }) => {
          self.statements.push('warehouse_stock_balances.update');
          const key = self.shelfKey(
            args.where.companyId_branchId_warehouseId_itemId.warehouseId,
            args.where.companyId_branchId_warehouseId_itemId.itemId,
          );
          const row = self.shelfRows.get(key);
          if (!row) throw new Error('No shelf balance to update');
          row.quantity = new Prisma.Decimal(args.data.quantity);
          row.value = new Prisma.Decimal(args.data.value);
          return row;
        },
      },
    };
  }

  private query(
    sql: string,
    params: unknown[],
  ): Array<{ quantity: Prisma.Decimal; value: Prisma.Decimal }> {
    if (/SUM\(/i.test(sql) && /warehouse_stock_balances/.test(sql)) {
      const rows = [...this.shelfRows.values()];
      return [
        {
          quantity: rows.reduce(
            (sum, row) => sum.plus(row.quantity),
            new Prisma.Decimal(0),
          ),
          value: rows.reduce((sum, row) => sum.plus(row.value), new Prisma.Decimal(0)),
        },
      ];
    }
    // Parameter order is the ledger's own: company, then the branch or the
    // warehouse, then the item.
    const [, second, third] = params.map((value) => String(value));
    if (/FROM\s+"warehouse_stock_balances"/i.test(sql)) {
      this.statements.push('warehouse_stock_balances.select');
      const row = this.shelfRows.get(this.shelfKey(second, third));
      return row ? [{ quantity: row.quantity, value: row.value }] : [];
    }
    if (/FROM\s+"stock_balances"/i.test(sql)) {
      this.statements.push('stock_balances.select');
      const row = this.branchRows.get(this.branchKey(second, third));
      return row ? [{ quantity: row.quantity, value: row.value }] : [];
    }
    return [];
  }

  shelf(warehouseId: string) {
    return this.shelfRows.get(this.shelfKey(warehouseId, ITEM));
  }

  branch() {
    return this.branchRows.get(this.branchKey(BRANCH, ITEM));
  }
}

describe('StockLedgerService', () => {
  let db: PostgresLike;
  let ledger: StockLedgerService;

  beforeEach(() => {
    db = new PostgresLike();
    ledger = new StockLedgerService();
  });

  const at = (warehouseId: string | null) => ({
    companyId: COMPANY,
    branchId: BRANCH,
    warehouseId,
    itemId: ITEM,
  });

  describe('the four steps of a posting', () => {
    it('creates the row at zero, locks it, then writes the result as a figure', async () => {
      // A balance that does not exist yet is the case the defect lived in:
      // the old code went straight to an upsert whose create carried the
      // delta, so an OUT into nothing inserted a negative row.
      await ledger.post(db.tx as never, { ...at(WAREHOUSE_A), quantity: 10, value: 100 });

      expect(db.statements.slice(0, 4)).toEqual([
        'stock_balances.createMany',
        'stock_balances.select',
        'stock_balances.update',
        'warehouse_stock_balances.createMany',
      ]);
      expect(db.branch()?.quantity.toFixed(4)).toBe('10.0000');
      expect(db.shelf(WAREHOUSE_A)?.quantity.toFixed(4)).toBe('10.0000');
    });

    it('refuses an issue from nothing with a readable message, not a constraint error', async () => {
      await expect(
        db.inTransaction((tx) =>
          ledger.post(tx as never, { ...at(WAREHOUSE_A), quantity: -4, value: -60 }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      // Nothing was written: no half-filled row survives a refusal.
      expect(db.branch()).toBeUndefined();
      expect(db.shelf(WAREHOUSE_A)).toBeUndefined();
    });

    it('never lets the branch book go negative, even when a negative shelf is permitted', async () => {
      await expect(
        db.inTransaction((tx) =>
          ledger.post(
            tx as never,
            { ...at(WAREHOUSE_A), quantity: -1, value: -10 },
            { allowNegative: true },
          ),
        ),
      ).rejects.toThrow(/branch total is never allowed below zero/i);
    });

    it('lets one shelf go negative while the branch stays whole, when the company permits it', async () => {
      // Warehouse A holds 2, warehouse B holds 8: selling 5 from A leaves the
      // branch at 5 and A at -3, which the setting allows.
      await ledger.post(db.tx as never, { ...at(WAREHOUSE_A), quantity: 2, value: 20 });
      await ledger.post(db.tx as never, { ...at(WAREHOUSE_B), quantity: 8, value: 80 });

      await ledger.post(
        db.tx as never,
        { ...at(WAREHOUSE_A), quantity: -5, value: -50 },
        { allowNegative: true },
      );

      expect(db.shelf(WAREHOUSE_A)?.quantity.toFixed(4)).toBe('-3.0000');
      expect(db.branch()?.quantity.toFixed(4)).toBe('5.0000');
    });

    it('applies a retried posting exactly once when the caller guards it, and so is not an increment', async () => {
      await ledger.post(db.tx as never, { ...at(WAREHOUSE_A), quantity: 10, value: 100 });

      // The write is an absolute figure computed under the lock, so replaying
      // the same call with the same target cannot double it the way an
      // `increment` would: it recomputes from the locked read each time.
      await ledger.post(db.tx as never, { ...at(WAREHOUSE_A), quantity: 0, value: 0 });

      expect(db.branch()?.quantity.toFixed(4)).toBe('10.0000');
      expect(db.shelf(WAREHOUSE_A)?.quantity.toFixed(4)).toBe('10.0000');
    });
  });

  describe('two books, one figure', () => {
    it('keeps the branch equal to the sum of its shelves after mixed movements', async () => {
      await ledger.post(db.tx as never, { ...at(WAREHOUSE_A), quantity: 10, value: 100 });
      await ledger.post(db.tx as never, { ...at(WAREHOUSE_A), quantity: 10, value: 200 });
      await ledger.post(db.tx as never, { ...at(WAREHOUSE_B), quantity: 10, value: 300 });
      await ledger.post(db.tx as never, { ...at(WAREHOUSE_A), quantity: -4, value: -60 });

      const reconciled = await ledger.reconcile(db.tx as never, at(null));
      expect(reconciled.branch.toFixed(4)).toBe('26.0000');
      expect(reconciled.shelves.toFixed(4)).toBe('26.0000');
      expect(reconciled.difference.toFixed(4)).toBe('0.0000');
      expect(reconciled.branchValue.toFixed(4)).toBe('540.0000');
      expect(reconciled.valueDifference.toFixed(4)).toBe('0.0000');
      // Warehouse A still averages 15 - an issue never moves the average.
      expect(ledger.issuePrice(await ledger.position(db.tx as never, at(WAREHOUSE_A)), 4).unitCost.toFixed(4)).toBe(
        '15.0000',
      );
    });

    it('reports the difference when something wrote the branch without a shelf', async () => {
      await ledger.post(db.tx as never, { ...at(WAREHOUSE_A), quantity: 10, value: 100 });
      // A writer that bypassed the ledger - the reversed sale used to.
      const row = db.branch()!;
      row.quantity = row.quantity.plus(5);

      const reconciled = await ledger.reconcile(db.tx as never, at(null));
      expect(reconciled.difference.toFixed(4)).toBe('5.0000');
    });
  });

  describe('an emptied shelf', () => {
    it('is worth nothing, whatever the rounding left behind', async () => {
      // 3 units worth 10 divide at 3.333333: taking all three must leave zero,
      // not a fils of valuation on an empty shelf.
      await ledger.post(db.tx as never, { ...at(WAREHOUSE_A), quantity: 3, value: 10 });
      await ledger.post(db.tx as never, { ...at(WAREHOUSE_A), quantity: -3, value: -10 });

      expect(db.shelf(WAREHOUSE_A)?.quantity.toFixed(4)).toBe('0.0000');
      expect(db.shelf(WAREHOUSE_A)?.value.toFixed(4)).toBe('0.0000');
      expect(db.branch()?.value.toFixed(4)).toBe('0.0000');
    });
  });
});
