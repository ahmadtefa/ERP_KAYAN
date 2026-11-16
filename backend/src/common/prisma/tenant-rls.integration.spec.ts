/**
 * REAL integration tests for tenant row-level security.
 *
 * These tests run against a real PostgreSQL database (not a mock): they apply
 * the Prisma migrations, create the least-privilege runtime role the cloud
 * deployment uses, seed two companies, and then - as that non-superuser
 * NOBYPASSRLS role - exercise cross-company SELECT/INSERT/UPDATE/DELETE on
 * direct tables, parent-inherited child tables, and the reviewed login path.
 * They also prove the application role cannot exceed or disable RLS.
 *
 * Requirements to run (otherwise the suite skips with a loud warning):
 *   TENANT_RLS_TEST_DATABASE_URL or DATABASE_URL pointing at a LOCAL test
 *   database (host 127.0.0.1/localhost). The suite refuses non-local hosts so
 *   it can never apply migrations to a cloud database by accident - applying
 *   the tenant policies to Supabase stays blocked until these tests pass.
 */
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';

interface ResolvedTarget {
  url: string;
  localOnly: boolean;
}

function resolveTestTarget(): ResolvedTarget | null {
  const url = (
    process.env.TENANT_RLS_TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    ''
  ).trim();
  if (!url) return null;
  let host: string | null = null;
  try {
    host = new URL(url.replace(/^postgres(ql)?:\/\//, 'http://')).hostname;
  } catch {
    return null;
  }
  const isLocal = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  return isLocal ? { url, localOnly: true } : null;
}

const target = resolveTestTarget();
const describeDb = target ? describe : describe.skip;

if (!target) {
  // eslint-disable-next-line no-console
  console.warn(
    '[tenant-rls.integration] SKIPPED: set TENANT_RLS_TEST_DATABASE_URL (or ' +
      'DATABASE_URL) to a LOCAL PostgreSQL database to run the real ' +
      'cross-company isolation suite. These tests are required evidence for ' +
      'the Supabase pilot and must run in CI.',
  );
}

const RUNTIME_ROLE = 'kayan_app_rls_test';

// Deterministic fixtures (ids are plain TEXT in this schema).
const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const USER_A = '11111111-1111-4111-8111-111111111101';
const USER_B = '22222222-2222-4222-8222-222222222201';
const BRANCH_A = '11111111-1111-4111-8111-111111111102';
const BRANCH_B = '22222222-2222-4222-8222-222222222202';
const ACCOUNT_A = '11111111-1111-4111-8111-111111111103';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222203';
const COST_A = '11111111-1111-4111-8111-111111111104';
const COST_B = '22222222-2222-4222-8222-222222222204';
const ITEM_A = '11111111-1111-4111-8111-111111111105';
const ITEM_B = '22222222-2222-4222-8222-222222222205';
const UNIT_A = '11111111-1111-4111-8111-111111111106';
const UNIT_B = '22222222-2222-4222-8222-222222222206';
const CUST_A = '11111111-1111-4111-8111-111111111107';
const CUST_B = '22222222-2222-4222-8222-222222222207';
const JE_A = '11111111-1111-4111-8111-111111111108';
const JE_B = '22222222-2222-4222-8222-222222222208';
const JL_A = '11111111-1111-4111-8111-111111111109';
const JL_B = '22222222-2222-4222-8222-222222222209';
const JLA_A = '11111111-1111-4111-8111-111111111110';
const JLA_B = '22222222-2222-4222-8222-222222222210';
const QUO_A = '11111111-1111-4111-8111-111111111111';
const QUO_B = '22222222-2222-4222-8222-222222222211';
const QTB_A = '11111111-1111-4111-8111-111111111112';
const QTB_B = '22222222-2222-4222-8222-222222222212';
const QLN_A = '11111111-1111-4111-8111-111111111113';
const QLN_B = '22222222-2222-4222-8222-222222222213';
const OB_A = '11111111-1111-4111-8111-111111111114';
const OB_B = '22222222-2222-4222-8222-222222222214';
const OBL_A = '11111111-1111-4111-8111-111111111115';
const OBL_B = '22222222-2222-4222-8222-222222222215';
const ROLE_A = '11111111-1111-4111-8111-111111111116';
const ROLE_SYS = '00000000-0000-4000-8000-000000000001';
const PERM_1 = '00000000-0000-4000-8000-000000000002';
const RPERM_A = '11111111-1111-4111-8111-111111111117';
const RPERM_SYS = '00000000-0000-4000-8000-000000000003';
const RTOKEN_A = '11111111-1111-4111-8111-111111111118';
const RTOKEN_B = '22222222-2222-4222-8222-222222222218';

const NOW = '2026-11-15T12:00:00.000Z';

describeDb('tenant row-level security (real database)', () => {
  jest.setTimeout(180_000);

  let owner: Client;
  let app: Client;

  const q = async (client: Client, sql: string, params: unknown[] = []) =>
    (await client.query(sql, params)).rows;

  const exec = async (client: Client, sql: string, params: unknown[] = []) =>
    client.query(sql, params);

  /** Runs `fn` inside a transaction with the given company bound (LOCAL). */
  async function withCompany<T>(
    client: Client,
    companyId: string | null,
    fn: () => Promise<T>,
  ): Promise<T> {
    await exec(client, 'BEGIN');
    await exec(client, `SELECT set_config('app.company_id', $1, true)`, [
      companyId ?? '',
    ]);
    try {
      const result = await fn();
      await exec(client, 'COMMIT');
      return result;
    } catch (error) {
      await exec(client, 'ROLLBACK');
      throw error;
    }
  }

  /** Runs `fn` inside a transaction in the reviewed login mode. */
  async function withLoginMode<T>(client: Client, fn: () => Promise<T>) {
    await exec(client, 'BEGIN');
    await exec(client, `SELECT set_config('app.login_mode', '1', true)`);
    try {
      const result = await fn();
      await exec(client, 'COMMIT');
      return result;
    } catch (error) {
      await exec(client, 'ROLLBACK');
      throw error;
    }
  }

  /** Runs `fn` inside a transaction in the reviewed system-jobs mode. */
  async function withJobsMode<T>(client: Client, fn: () => Promise<T>) {
    await exec(client, 'BEGIN');
    await exec(client, `SELECT set_config('app.jobs_mode', '1', true)`);
    try {
      const result = await fn();
      await exec(client, 'COMMIT');
      return result;
    } catch (error) {
      await exec(client, 'ROLLBACK');
      throw error;
    }
  }

  beforeAll(async () => {
    // Apply every checked-in migration (idempotent), including the tenant RLS
    // policies. `prisma migrate deploy` cannot run this project's migrations
    // (WASM schema engine dollar-quote bug - see ci.yml), so the suite uses the
    // repository's sanctioned apply-migrations.mjs, which records the same
    // _prisma_migrations rows and checksums. Refuses non-local hosts above, so
    // this can never reach Supabase by accident.
    execFileSync('node', ['scripts/apply-migrations.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: target!.url },
      stdio: 'pipe',
    });

    owner = new Client({ connectionString: target!.url });
    await owner.connect();

    // The role the cloud runtime uses: no superuser, no BYPASSRLS, no
    // ownership. Created here with a login password so the tests CONNECT AS
    // that role and exercise the exact privilege posture of the Supabase
    // runtime role (a SET ROLE from a superuser session would not be faithful:
    // it could still switch to privileged roles).
    await exec(
      owner,
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RUNTIME_ROLE}') THEN
           CREATE ROLE ${RUNTIME_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
         END IF;
       END $$;`,
    );
    await exec(owner, `ALTER ROLE ${RUNTIME_ROLE} PASSWORD 'kayan_rls_test_pw'`);
    await exec(owner, `GRANT USAGE ON SCHEMA public TO ${RUNTIME_ROLE}`);
    await exec(
      owner,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${RUNTIME_ROLE}`,
    );
    await exec(
      owner,
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${RUNTIME_ROLE}`,
    );

    // --- seed two companies with parallel data (as owner: RLS bypassed) ---
    for (const [companyId, user, branch, account, cost, item, unit, cust, je, jl, jla, quo, qtb, qln, ob, obl, role, rperm, rtoken, code] of [
      [COMPANY_A, USER_A, BRANCH_A, ACCOUNT_A, COST_A, ITEM_A, UNIT_A, CUST_A, JE_A, JL_A, JLA_A, QUO_A, QTB_A, QLN_A, OB_A, OBL_A, ROLE_A, RPERM_A, RTOKEN_A, 'A'],
      [COMPANY_B, USER_B, BRANCH_B, ACCOUNT_B, COST_B, ITEM_B, UNIT_B, CUST_B, JE_B, JL_B, JLA_B, QUO_B, QTB_B, QLN_B, OB_B, OBL_B, ROLE_SYS, RPERM_SYS, RTOKEN_B, 'B'],
    ] as const) {
      await exec(
        owner,
        `INSERT INTO companies (id, code, "nameEn", "nameAr", "updatedAt", "deletedAt") VALUES ($1, $2, $3, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [companyId, `C${code}`, `Company ${code}`, NOW, code === 'B' ? NOW : null],
      );
      // NOTE: the schema enforces a single ACTIVE company per installation
      // (partial unique index on companies). Company B is seeded as retired so
      // both tenants exist; row-level security keys on companyId and must hold
      // for every company row regardless of its lifecycle state.
      await exec(
        owner,
        `INSERT INTO users (id, "companyId", username, "fullNameEn", "fullNameAr", "passwordHash", "updatedAt")
         VALUES ($1, $2, $3, $4, $4, 'x', $5) ON CONFLICT (id) DO NOTHING`,
        [user, companyId, `user${code.toLowerCase()}`, `User ${code}`, NOW],
      );
      await exec(
        owner,
        `INSERT INTO branches (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
         VALUES ($1, $2, $3, $4, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [branch, companyId, `B${code}`, `Branch ${code}`, NOW],
      );
      await exec(
        owner,
        `INSERT INTO accounts (id, "companyId", code, "nameEn", "nameAr", type, "updatedAt")
         VALUES ($1, $2, $3, $4, $4, 'ASSET', $5) ON CONFLICT (id) DO NOTHING`,
        [account, companyId, `1${code}00`, `Account ${code}`, NOW],
      );
      await exec(
        owner,
        `INSERT INTO cost_centers (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
         VALUES ($1, $2, $3, $4, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [cost, companyId, `CC${code}`, `Cost ${code}`, NOW],
      );
      await exec(
        owner,
        `INSERT INTO items (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
         VALUES ($1, $2, $3, $4, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [item, companyId, `IT${code}`, `Item ${code}`, NOW],
      );
      await exec(
        owner,
        `INSERT INTO item_units (id, "itemId", unit, factor, "updatedAt")
         VALUES ($1, $2, 'pcs', 1, $3) ON CONFLICT (id) DO NOTHING`,
        [unit, item, NOW],
      );
      await exec(
        owner,
        `INSERT INTO customers (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
         VALUES ($1, $2, $3, $4, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [cust, companyId, `CU${code}`, `Customer ${code}`, NOW],
      );
      await exec(
        owner,
        `INSERT INTO journal_entries (id, "companyId", "branchId", "entryNumber", "entryDate", "totalDebit", "totalCredit", "updatedAt")
         VALUES ($1, $2, $3, $4, $5::date, 10, 10, $6) ON CONFLICT (id) DO NOTHING`,
        [je, companyId, branch, `JE-${code}`, NOW, NOW],
      );
      await exec(
        owner,
        `INSERT INTO journal_lines (id, "journalEntryId", "lineNumber", "accountId", debit, credit)
         VALUES ($1, $2, 1, $3, 10, 0) ON CONFLICT (id) DO NOTHING`,
        [jl, je, account],
      );
      await exec(
        owner,
        `INSERT INTO journal_line_allocations (id, "journalLineId", "costCenterId", amount)
         VALUES ($1, $2, $3, 10) ON CONFLICT (id) DO NOTHING`,
        [jla, jl, cost],
      );
      await exec(
        owner,
        `INSERT INTO quotations (id, "companyId", "branchId", "quotationNumber", "quotationDate", "customerId", "updatedAt")
         VALUES ($1, $2, $3, $4, $5::date, $6, $7) ON CONFLICT (id) DO NOTHING`,
        [quo, companyId, branch, `Q-${code}`, NOW, cust, NOW],
      );
      await exec(
        owner,
        `INSERT INTO quotation_tables (id, "quotationId", title, "sortOrder")
         VALUES ($1, $2, 'main', 0) ON CONFLICT (id) DO NOTHING`,
        [qtb, quo],
      );
      await exec(
        owner,
        `INSERT INTO quotation_lines (id, "tableId", "lineNumber", description, quantity, "unitPrice", "lineTotal")
         VALUES ($1, $2, 1, 'line', 1, 5, 5) ON CONFLICT (id) DO NOTHING`,
        [qln, qtb],
      );
      await exec(
        owner,
        `INSERT INTO opening_balances (id, "companyId", "branchId", "documentNumber", "asOfDate", "updatedAt")
         VALUES ($1, $2, $3, $4, $5::date, $6) ON CONFLICT (id) DO NOTHING`,
        [ob, companyId, branch, `OB-${code}`, NOW, NOW],
      );
      await exec(
        owner,
        `INSERT INTO opening_balance_lines (id, "openingBalanceId", "accountId", "lineNumber")
         VALUES ($1, $2, $3, 1) ON CONFLICT (id) DO NOTHING`,
        [obl, ob, account],
      );
    }

    // Role A is tenant-owned; ROLE_SYS is a shared system role (NULL company).
    await exec(
      owner,
      `INSERT INTO roles (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
       VALUES ($1, $2, 'acc-a', 'Accountant A', 'A', $3) ON CONFLICT (id) DO NOTHING`,
      [ROLE_A, COMPANY_A, NOW],
    );
    await exec(
      owner,
      `INSERT INTO roles (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
       VALUES ($1, NULL, 'admin', 'Admin', 'A', $2) ON CONFLICT (id) DO NOTHING`,
      [ROLE_SYS, NOW],
    );
    await exec(
      owner,
      `INSERT INTO permissions (id, code, "nameEn", "nameAr", module)
       VALUES ($1, 'test.perm', 'Test', 'T', 'test') ON CONFLICT (id) DO NOTHING`,
      [PERM_1],
    );
    await exec(
      owner,
      `INSERT INTO role_permissions ("roleId", "permissionId")
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [ROLE_A, PERM_1],
    );
    await exec(
      owner,
      `INSERT INTO role_permissions ("roleId", "permissionId")
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [ROLE_SYS, PERM_1],
    );
    await exec(
      owner,
      `INSERT INTO refresh_tokens (id, "userId", "tokenHash", "expiresAt")
       VALUES ($1, $2, 'h-a', $3) ON CONFLICT (id) DO NOTHING`,
      [RTOKEN_A, USER_A, NOW],
    );
    await exec(
      owner,
      `INSERT INTO refresh_tokens (id, "userId", "tokenHash", "expiresAt")
       VALUES ($1, $2, 'h-b', $3) ON CONFLICT (id) DO NOTHING`,
      [RTOKEN_B, USER_B, NOW],
    );

    // Connect AS the runtime role (not via SET ROLE from a superuser session):
    // this is exactly what the cloud application does.
    const appUrl = new URL(target!.url.replace(/^postgres(ql)?:\/\//, 'http://'));
    app = new Client({
      host: appUrl.hostname,
      port: Number(appUrl.port || 5432),
      database: decodeURIComponent(appUrl.pathname.replace(/^\//, '')),
      user: RUNTIME_ROLE,
      password: 'kayan_rls_test_pw',
    });
    await app.connect();
  });

  afterAll(async () => {
    await app?.end().catch(() => undefined);
    await owner?.end().catch(() => undefined);
  });

  it('the runtime role is not superuser and cannot bypass RLS', async () => {
    const rows = await q(
      owner,
      `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication
       FROM pg_roles WHERE rolname = $1`,
      [RUNTIME_ROLE],
    );
    expect(rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
    });
  });

  it('every public table is FORCE RLS-protected with at least one policy', async () => {
    const rows = await q(
      owner,
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE NOT c.relforcerowsecurity)::int AS no_force,
              count(*) FILTER (WHERE NOT EXISTS (
                SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname))::int AS no_policy
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relname <> '_prisma_migrations'`,
    );
    expect(Number(rows[0].total)).toBeGreaterThan(70);
    expect(rows[0].no_force).toBe(0);
    expect(rows[0].no_policy).toBe(0);
  });

  it('reads only the session company on direct and child tables', async () => {
    await withCompany(app, COMPANY_A, async () => {
      const items = await q(app, `SELECT id FROM items`);
      expect(items.map((r) => r.id)).toEqual([ITEM_A]);
      const units = await q(app, `SELECT id FROM item_units`);
      expect(units.map((r) => r.id)).toEqual([UNIT_A]);
      // Deep child: allocation -> line -> entry -> company.
      const allocs = await q(app, `SELECT id FROM journal_line_allocations`);
      expect(allocs.map((r) => r.id)).toEqual([JLA_A]);
      // Deep child: quotation line -> table -> quotation -> company.
      const qlines = await q(app, `SELECT id FROM quotation_lines`);
      expect(qlines.map((r) => r.id)).toEqual([QLN_A]);
      const olines = await q(app, `SELECT id FROM opening_balance_lines`);
      expect(olines.map((r) => r.id)).toEqual([OBL_A]);
    });
    await withCompany(app, COMPANY_B, async () => {
      const items = await q(app, `SELECT id FROM items`);
      expect(items.map((r) => r.id)).toEqual([ITEM_B]);
      const allocs = await q(app, `SELECT id FROM journal_line_allocations`);
      expect(allocs.map((r) => r.id)).toEqual([JLA_B]);
    });
  });

  it('without a company context every tenant table reads zero rows', async () => {
    await withCompany(app, null, async () => {
      for (const table of ['users', 'items', 'journal_entries', 'quotations', 'branches']) {
        const rows = await q(app, `SELECT id FROM ${table}`);
        expect(rows).toHaveLength(0);
      }
    });
  });

  it('rejects inserting a row into another company (WITH CHECK)', async () => {
    await withCompany(app, COMPANY_A, async () => {
      await expect(
        exec(
          app,
          `INSERT INTO items (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
           VALUES ('99999999-9999-4999-8999-999999999901', $1, 'X1', 'x', 'x', $2)`,
          [COMPANY_B, NOW],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
    await withCompany(app, null, async () => {
      await expect(
        exec(
          app,
          `INSERT INTO items (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
           VALUES ('99999999-9999-4999-8999-999999999902', $1, 'X2', 'x', 'x', $2)`,
          [COMPANY_A, NOW],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it('rejects moving a child row under another company parent (WITH CHECK)', async () => {
    // Each assertion gets its own transaction: a rejected statement aborts
    // the surrounding transaction, so one failure would poison the next.
    await withCompany(app, COMPANY_A, async () => {
      await expect(
        exec(
          app,
          `UPDATE journal_lines SET "journalEntryId" = $1 WHERE id = $2`,
          [JE_B, JL_A],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
    await withCompany(app, COMPANY_A, async () => {
      await expect(
        exec(app, `UPDATE quotation_lines SET "tableId" = $1 WHERE id = $2`, [
          QTB_B,
          QLN_A,
        ]),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it('cross-company UPDATE and DELETE affect zero rows and leave data intact', async () => {
    await withCompany(app, COMPANY_A, async () => {
      const upd = await exec(
        app,
        `UPDATE items SET "nameEn" = 'hacked' WHERE id = $1`,
        [ITEM_B],
      );
      expect(upd.rowCount).toBe(0);
      const del = await exec(app, `DELETE FROM items WHERE id = $1`, [ITEM_B]);
      expect(del.rowCount).toBe(0);
      const delChild = await exec(
        app,
        `DELETE FROM journal_line_allocations WHERE id = $1`,
        [JLA_B],
      );
      expect(delChild.rowCount).toBe(0);
    });
    // The B data is still there (verified as owner).
    const rows = await q(owner, `SELECT "nameEn" FROM items WHERE id = $1`, [
      ITEM_B,
    ]);
    expect(rows[0].nameEn).toBe('Item B');
    const alloc = await q(
      owner,
      `SELECT id FROM journal_line_allocations WHERE id = $1`,
      [JLA_B],
    );
    expect(alloc).toHaveLength(1);
  });

  it('a company context may manage its own rows', async () => {
    await withCompany(app, COMPANY_A, async () => {
      const upd = await exec(
        app,
        `UPDATE items SET "nameEn" = 'Item A v2' WHERE id = $1`,
        [ITEM_A],
      );
      expect(upd.rowCount).toBe(1);
      const del = await exec(
        app,
        `DELETE FROM refresh_tokens WHERE id = $1`,
        [RTOKEN_A],
      );
      expect(del.rowCount).toBe(1);
    });
  });

  it('reviewed login mode reads access-control rows but not tenant data', async () => {
    await withLoginMode(app, async () => {
      const users = await q(app, `SELECT id FROM users ORDER BY id`);
      expect(users.map((r) => r.id)).toEqual([USER_A, USER_B]);
      const tokens = await q(app, `SELECT id FROM refresh_tokens`);
      expect(tokens.map((r) => r.id)).toEqual([RTOKEN_B]); // A's was deleted above
      // Tenant business data stays invisible even in login mode.
      const items = await q(app, `SELECT id FROM items`);
      expect(items).toHaveLength(0);
      // And login mode cannot write tenant rows.
      await expect(
        exec(
          app,
          `INSERT INTO users (id, "companyId", username, "fullNameEn", "fullNameAr", "passwordHash", "updatedAt")
           VALUES ('99999999-9999-4999-8999-999999999903', $1, 'evil', 'e', 'e', 'x', $2)`,
          [COMPANY_A, NOW],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it('system roles and shared catalogs behave as documented', async () => {
    await withCompany(app, COMPANY_A, async () => {
      // System role (NULL company) is readable; tenant A role is readable.
      const roles = await q(app, `SELECT id FROM roles ORDER BY id`);
      // Sorted by id: the system role id sorts first.
      expect(roles.map((r) => r.id)).toEqual([ROLE_SYS, ROLE_A]);
      // Both role_permission rows are visible (one via tenant role, one via system role).
      const rperms = await q(app, `SELECT "roleId" FROM role_permissions ORDER BY "roleId"`);
      expect(rperms.map((r) => r.roleId)).toEqual([ROLE_SYS, ROLE_A]);
      // The permission catalog is readable (it may hold rows seeded earlier
      // on this database; our fixture row must be among them).
      const perms = await q(app, `SELECT id FROM permissions`);
      expect(perms.some((r) => r.id === PERM_1)).toBe(true);
      // But the system role is NOT writable from a tenant context.
      const upd = await exec(app, `UPDATE roles SET "nameEn" = 'no' WHERE id = $1`, [
        ROLE_SYS,
      ]);
      expect(upd.rowCount).toBe(0);
    });
  });

  it('the application role cannot exceed or disable RLS', async () => {
    // Cannot disable RLS on a table it does not own.
    await expect(
      exec(app, `ALTER TABLE public.users DISABLE ROW LEVEL SECURITY`),
    ).rejects.toThrow();
    // Cannot create or drop policies.
    await expect(
      exec(app, `CREATE POLICY evil ON public.users FOR ALL USING (true)`),
    ).rejects.toThrow();
    // Cannot switch to a privileged role.
    await expect(exec(app, `SET ROLE postgres`)).rejects.toThrow();
    // Cannot alter the context readers.
    await expect(
      exec(app, `DROP FUNCTION public.app_company_id()`),
    ).rejects.toThrow();
    // Privilege posture: DML only, no CREATE on the schema, no table ownership.
    const privs = await q(
      owner,
      `SELECT
         has_schema_privilege($1, 'public', 'CREATE') AS schema_create,
         (SELECT count(*) FROM pg_tables t WHERE t.schemaname = 'public'
            AND pg_get_userbyid((SELECT relowner FROM pg_class c WHERE c.relname = t.tablename AND c.relnamespace = 'public'::regnamespace)) = $1) AS owned_tables`,
      [RUNTIME_ROLE],
    );
    expect(privs[0].schema_create).toBe(false);
    expect(Number(privs[0].owned_tables)).toBe(0);
    const dml = await q(
      owner,
      `SELECT has_table_privilege($1, 'public.users', 'SELECT,INSERT,UPDATE,DELETE') AS ok`,
      [RUNTIME_ROLE],
    );
    expect(dml[0].ok).toBe(true);
  });

  it('transaction-local context cannot leak across transactions (pooler safety)', async () => {
    await withCompany(app, COMPANY_A, async () => {
      const rows = await q(app, `SELECT current_setting('app.company_id', true) AS v`);
      expect(rows[0].v).toBe(COMPANY_A);
    });
    // After COMMIT the LOCAL setting is gone: a pooled connection reused by
    // another request starts with no tenant and is denied by default.
    const rows = await q(
      app,
      `SELECT coalesce(current_setting('app.company_id', true), '') AS v`,
    );
    expect(rows[0].v).toBe('');
  });

  // ── background jobs (schedulers) ─────────────────────────────────────────

  it('the reviewed jobs mode reads the company roster and nothing else', async () => {
    await withJobsMode(app, async () => {
      const companies = await q(app, `SELECT id FROM companies ORDER BY id`);
      expect(companies.map((r) => r.id)).toEqual([COMPANY_A, COMPANY_B]);
      // The roster mode must not open ANY tenant or system business table.
      for (const table of [
        'users',
        'items',
        'company_settings',
        'notifications',
        'notification_settings',
        'journal_entries',
        'backup_runs',
      ]) {
        const rows = await q(app, `SELECT count(*)::int AS n FROM ${table}`);
        expect(Number(rows[0].n)).toBe(0);
      }
    });
    // Without the mode (or any context) the roster itself is closed.
    await withCompany(app, null, async () => {
      const companies = await q(app, `SELECT id FROM companies`);
      expect(companies).toHaveLength(0);
    });
  });

  it('the jobs mode cannot write companies or tenant rows', async () => {
    await withJobsMode(app, async () => {
      // Writes to rows the policy hides affect zero rows - and the row is
      // provably unchanged (RLS is not an UPDATE oracle).
      const updated = await exec(
        app,
        `UPDATE companies SET "nameEn" = 'hijacked' WHERE id = $1`,
        [COMPANY_A],
      );
      expect(updated.rowCount).toBe(0);
      const still = await q(app, `SELECT "nameEn" FROM companies WHERE id = $1`, [
        COMPANY_A,
      ]);
      expect(still[0].nameEn).not.toBe('hijacked');
      const deleted = await exec(app, `DELETE FROM users WHERE id = $1`, [
        USER_A,
      ]);
      expect(deleted.rowCount).toBe(0);
      // A company-attributed row is refused outright (WITH CHECK): the jobs
      // mode carries no company, so it can never speak for one. (NULL-company
      // system events are the documented shared channel - audit/backup rows.)
      await expect(
        exec(
          app,
          `INSERT INTO backup_runs (id, "companyId", kind, "fileName", status) VALUES ('99999999-9999-4999-8999-999999999901', $1, 'SCHEDULED', '-', 'FAILED')`,
          [COMPANY_A],
        ),
      ).rejects.toThrow();
    });
  });

  it('background per-company writes cannot cross companies (WITH CHECK + read scope)', async () => {
    const RUN_A = '99999999-9999-4999-8999-999999999902';
    const NOTIF_A = '99999999-9999-4999-8999-999999999903';
    // A background record that names ANOTHER company is refused outright.
    // Each refusal gets its own transaction: the failed statement aborts it,
    // exactly as it would in production.
    await withCompany(app, COMPANY_A, async () => {
      await expect(
        exec(
          app,
          `INSERT INTO backup_runs (id, "companyId", kind, "fileName", status) VALUES ($1, $2, 'SCHEDULED', '-', 'FAILED')`,
          [RUN_A, COMPANY_B],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
    await withCompany(app, COMPANY_A, async () => {
      await expect(
        exec(
          app,
          `INSERT INTO notifications (id, "companyId", type, "titleEn", "titleAr", "dedupeKey") VALUES ($1, $2, 'TEST_KIND', 'x', 'y', 'k1')`,
          [NOTIF_A, COMPANY_B],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
    await withCompany(app, COMPANY_A, async () => {
      await expect(
        exec(
          app,
          `INSERT INTO notification_settings (id, "companyId", type, "updatedAt") VALUES ($1, $2, 'TEST_KIND', NOW())`,
          ['99999999-9999-4999-8999-999999999904', COMPANY_B],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
    // The same writes for the session company are accepted...
    await withCompany(app, COMPANY_A, async () => {
      await exec(
        app,
        `INSERT INTO backup_runs (id, "companyId", kind, "fileName", status) VALUES ($1, $2, 'SCHEDULED', '-', 'FAILED')`,
        [RUN_A, COMPANY_A],
      );
      await exec(
        app,
        `INSERT INTO notifications (id, "companyId", type, "titleEn", "titleAr", "dedupeKey") VALUES ($1, $2, 'TEST_KIND', 'x', 'y', 'k1')`,
        [NOTIF_A, COMPANY_A],
      );
      const runs = await q(app, `SELECT id FROM backup_runs WHERE id = $1`, [RUN_A]);
      expect(runs).toHaveLength(1);
    });
    // ...and the other company cannot see them (background read isolation).
    await withCompany(app, COMPANY_B, async () => {
      const runs = await q(app, `SELECT id FROM backup_runs WHERE id = $1`, [RUN_A]);
      expect(runs).toHaveLength(0);
      const notifs = await q(app, `SELECT id FROM notifications WHERE id = $1`, [NOTIF_A]);
      expect(notifs).toHaveLength(0);
    });
    // Cleanup so a re-run of the suite sees the same fixtures.
    await withCompany(app, COMPANY_A, async () => {
      await exec(app, `DELETE FROM backup_runs WHERE id = $1`, [RUN_A]);
      await exec(app, `DELETE FROM notifications WHERE id = $1`, [NOTIF_A]);
    });
  });
});
