import type { SqlDriverAdapter, Transaction, SqlQuery } from '@prisma/driver-adapter-utils';

export class ClosedDatabaseTransactionError extends Error {
  constructor() { super('Database transaction is closed'); this.name = 'ClosedDatabaseTransactionError'; }
}

/**
 * The engine-less interpreter can retain a transaction for all the statements
 * of a nested write. Its timeout manager queues ROLLBACK between those
 * statements. Refuse any later statement before it reaches the pg client,
 * which may already have been released to the pool and be in autocommit.
 *
 * Mark closed when the close is QUEUED, not when it completes. A statement
 * already in flight remains ahead of ROLLBACK in pg's queue and is rolled back.
 */
export function guardTransactionLifetime(transaction: Transaction): Transaction {
  let closing = false;
  return new Proxy(transaction, {
    get(target, key) {
      if (key === 'queryRaw' || key === 'executeRaw') {
        return async (query: SqlQuery) => {
          if (closing) throw new ClosedDatabaseTransactionError();
          if (/^\s*(?:COMMIT|ROLLBACK)\s*;?\s*$/i.test(query.sql)) closing = true;
          return target[key](query);
        };
      }
      if (key === 'commit' || key === 'rollback') {
        return async () => {
          closing = true;
          return target[key]();
        };
      }
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function guardAdapterTransactions<T extends SqlDriverAdapter>(adapter: T): T {
  return new Proxy(adapter, {
    get(target, key) {
      if (key === 'startTransaction') {
        return async (...args: Parameters<SqlDriverAdapter['startTransaction']>) =>
          guardTransactionLifetime(await target.startTransaction(...args));
      }
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
