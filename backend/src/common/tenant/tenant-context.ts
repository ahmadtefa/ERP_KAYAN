import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The trusted, verified company context of the current unit of work.
 *
 * Row-level security in PostgreSQL reads this context through
 * `set_config('app.company_id', ..., true)` (transaction-local) executed at the
 * start of every database transaction - see tenant-prisma-pg.ts. Nothing that
 * arrives in a request body, query string, or header can set it: the value is
 * taken from the verified access token (JwtAuthGuard) and carried in
 * AsyncLocalStorage, which is invisible outside the request's async chain and
 * therefore cannot leak between concurrent requests on a pooled connection.
 */
export interface TenantContext {
  /** The verified principal's company. `null` means "no tenant" (deny). */
  readonly companyId: string | null;
  /**
   * Narrow, reviewed exceptions used only by flows that legitimately run
   * before a company context exists:
   *  - 'login':  username lookup / token refresh (reads access-control rows
   *              across companies, never tenant business data).
   *  - 'setup':  first-run bootstrap that creates the first company + admin.
   *  - 'jobs':   system jobs reading the company roster (companies SELECT
   *              only; every other table stays deny-by-default). The job then
   *              runs its real work inside a strict per-company context.
   */
  readonly mode?: 'login' | 'setup' | 'jobs';
}

const storage = new AsyncLocalStorage<TenantContext>();

/** Runs `fn` with `context` bound to its async chain. */
export function runWithTenantContext<T>(
  context: TenantContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(context, fn);
}

/** The context of the current async chain, if any. */
export function currentTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * The company id to bind into the next database transaction. Returns `null`
 * outside a tenant context, which makes every tenant policy deny.
 */
export function currentTenantCompanyId(): string | null {
  return storage.getStore()?.companyId ?? null;
}

/** 'login' | 'setup' | 'jobs' when the current chain runs a reviewed mode. */
export function currentTenantMode(): 'login' | 'setup' | 'jobs' | null {
  return storage.getStore()?.mode ?? null;
}
