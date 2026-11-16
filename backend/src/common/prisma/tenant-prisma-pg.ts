import { PrismaPg } from '@prisma/adapter-pg';
import type pg from 'pg';
import type {
  ConnectionInfo,
  IsolationLevel,
  SqlDriverAdapter,
  SqlQuery,
  SqlResultSet,
  SqlMigrationAwareDriverAdapterFactory,
  Transaction,
  TransactionOptions,
} from '@prisma/driver-adapter-utils';
import {
  currentTenantCompanyId,
  currentTenantMode,
} from '../tenant/tenant-context';

/**
 * Driver adapter that binds the verified tenant context into every database
 * transaction.
 *
 * The application role is NOSUPERUSER NOBYPASSRLS and every table carries a
 * RLS policy keyed on `current_setting('app.company_id', true)`. This adapter
 * runs `set_config('app.company_id', ..., true)` - transaction-local - as the
 * first statement of every transaction, so:
 *
 *  - the value cannot leak to the next query that borrows the pooled
 *    connection (transaction-local GUCs reset at COMMIT/ROLLBACK);
 *  - a request's company comes from AsyncLocalStorage (the verified JWT),
 *    never from user input;
 *  - outside any tenant context the GUC is set empty, which makes every
 *    tenant policy deny by default.
 *
 * Local Windows installs run as a database superuser where RLS does not apply;
 * they are unaffected by this adapter.
 */
export class TenantPrismaPg
  implements SqlMigrationAwareDriverAdapterFactory
{
  readonly provider = 'postgres';
  readonly adapterName = 'tenant-prisma-pg';

  private readonly inner: PrismaPg;

  constructor(
    poolOrConfig: pg.Pool | pg.PoolConfig,
    options?: ConstructorParameters<typeof PrismaPg>[1],
  ) {
    this.inner = new PrismaPg(poolOrConfig, options);
  }

  async connect(): Promise<SqlDriverAdapter> {
    return new TenantPrismaPgAdapter(await this.inner.connect());
  }

  async connectToShadowDb(): Promise<SqlDriverAdapter> {
    return new TenantPrismaPgAdapter(await this.inner.connectToShadowDb());
  }
}

/** The statement that binds tenant identity into a transaction. */
function tenantContextQuery(): SqlQuery {
  const companyId = currentTenantCompanyId() ?? '';
  const mode = currentTenantMode() ?? '';
  return {
    sql: "SELECT set_config('app.company_id', $1, true), set_config('app.login_mode', $2, true), set_config('app.setup_mode', $3, true), set_config('app.jobs_mode', $4, true)",
    args: [
      companyId,
      mode === 'login' ? '1' : '',
      mode === 'setup' ? '1' : '',
      mode === 'jobs' ? '1' : '',
    ],
    argTypes: [
      { scalarType: 'string', arity: 'scalar' },
      { scalarType: 'string', arity: 'scalar' },
      { scalarType: 'string', arity: 'scalar' },
      { scalarType: 'string', arity: 'scalar' },
    ],
  };
}

class TenantTransaction implements Transaction {
  constructor(private readonly inner: Transaction) {}

  private async bindTenant(): Promise<void> {
    await this.inner.executeRaw(tenantContextQuery());
  }

  async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    return this.inner.queryRaw(query);
  }

  async executeRaw(query: SqlQuery): Promise<number> {
    return this.inner.executeRaw(query);
  }

  /** Exposed for the adapter: bind context right after BEGIN. */
  initialize(): Promise<void> {
    return this.bindTenant();
  }

  commit(): Promise<void> {
    return this.inner.commit();
  }

  rollback(): Promise<void> {
    return this.inner.rollback();
  }

  get options(): TransactionOptions {
    return this.inner.options;
  }

  get adapterName(): string {
    return this.inner.adapterName;
  }

  get provider(): Transaction['provider'] {
    return this.inner.provider;
  }
}

class TenantPrismaPgAdapter implements SqlDriverAdapter {
  readonly provider = 'postgres';
  readonly adapterName = 'tenant-prisma-pg';

  constructor(private readonly inner: SqlDriverAdapter) {}

  async startTransaction(isolationLevel?: IsolationLevel): Promise<Transaction> {
    const tx = new TenantTransaction(
      await this.inner.startTransaction(isolationLevel),
    );
    await tx.initialize();
    return tx;
  }

  /**
   * Statements that arrive outside an explicit transaction (single-query
   * operations) are routed through a transaction as well, so they always run
   * behind the tenant context binding. A query that somehow bypasses the
   * binding would see zero rows - the safe direction.
   */
  async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    const tx = await this.startTransaction();
    try {
      const result = await tx.queryRaw(query);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      throw error;
    }
  }

  async executeRaw(query: SqlQuery): Promise<number> {
    const tx = await this.startTransaction();
    try {
      const result = await tx.executeRaw(query);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      throw error;
    }
  }

  /** Migration DDL runs without tenant context; RLS does not gate DDL. */
  executeScript(script: string): Promise<void> {
    return this.inner.executeScript(script);
  }

  getConnectionInfo(): ConnectionInfo {
    const info = this.inner.getConnectionInfo;
    if (!info) {
      throw new Error('getConnectionInfo is not available on this adapter');
    }
    return info.call(this.inner);
  }

  dispose(): Promise<void> {
    return this.inner.dispose();
  }

  underlyingDriver(): pg.Pool {
    const withDriver = this.inner as SqlDriverAdapter & {
      underlyingDriver?: () => pg.Pool;
    };
    if (!withDriver.underlyingDriver) {
      throw new Error('underlyingDriver is not available on this adapter');
    }
    return withDriver.underlyingDriver();
  }
}
