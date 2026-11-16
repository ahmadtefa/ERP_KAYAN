# Tenant Row-Level Security design - Supabase cloud pilot

Status: **implemented** (migration `20261115120000_tenant_rls_policies`, tenant
context runtime, real cross-company integration tests). This document is the
reviewed design those artifacts implement. Companion: `supabase-cloud-pilot.md`
(connection/roles plan).

## 1. Threat model

The cloud pilot runs the NestJS API against Supabase Postgres. Every table
belongs to one company (tenant). The database must enforce that boundary even
if application code has a bug (forgotten `where companyId`), a leaked query, or
a compromised query path. The enforcement point is PostgreSQL row-level
security (RLS), keyed on a **transaction-local** tenant context that only the
trusted application can set.

Out of scope (unchanged by this design): the Windows/desktop install (runs as a
superuser against its bundled PostgreSQL where RLS does not apply), licensing,
quotations, and the migration to Supabase itself (still blocked until the
deployment checklist below is completed).

## 2. Table classification (79 public tables)

| Class | Tables | Policy |
|---|---|---|
| Tenant root | `companies` | `id = app_company_id()`, plus reviewed login/setup read paths |
| Direct (`companyId`) | 48 tables (branches, users, items, journal_entries, sales_invoices, quotations, ...) | `companyId = app_company_id()` for SELECT/INSERT/UPDATE/DELETE; deny when the GUC is unset |
| Child (no `companyId`) | 16 tables (journal_lines, journal_line_allocations, cash_voucher_allocations, opening_balance_lines, stock_document_lines, sales/purchase_invoice_lines, quotation_tables/lines/events, quotation_lines_legacy, item_units, purchase/sales_order_lines, price_list_items, stock_take_lines) | `EXISTS` on the owning parent's company, two hops where the chain is deeper (allocation -> line -> entry; line -> table -> quotation) |
| Access-control children | user_roles (own `companyId`), user_permissions, user_branches, refresh_tokens | strict write scope; SELECT also allowed in reviewed login/setup mode so sign-in can assemble the permission snapshot |
| System roles | `roles`, `role_permissions` with `companyId NULL` | readable from any context (shared catalog), writable only through a tenant-owned row |
| System events | `audit_logs`, `backup_runs` (nullable `companyId`) | NULL rows visible to every context; a context manages its own rows |
| Shared catalog | `permissions` | full access (no tenant data); protected by role grants |
| Device-level licence | license_installations, license_keys, license_seat_usage, license_events | full access (not tenant rows); protected by role grants and never exposed to the Data API |

Regenerate the SQL with `scripts/generate-tenant-rls-migration.py` if the
classification changes; the migration file is the applied source of truth.

## 3. Context protocol

The only sanctioned way to carry tenant identity into a database session:

```sql
SELECT set_config('app.company_id', '<uuid>', true);  -- transaction-local
SELECT set_config('app.login_mode',  '1',     true);  -- reviewed login path
SELECT set_config('app.setup_mode',  '1',     true);  -- reviewed bootstrap path
```

Readers (STABLE sql functions created by the migration):
`app_company_id()`, `app_login_mode()`, `app_setup_mode()`.

Rules:

1. The third argument is always `true` (transaction-local). A session-level
   GUC would survive on a pooled connection and leak into the next request.
2. Unset/empty context means **deny**: every tenant policy compares against
   `app_company_id()` which is then NULL.
3. The value comes from the **verified** JWT principal (reloaded from the
   database per request by `JwtAuthGuard`), carried in `AsyncLocalStorage`
   (`src/common/tenant/tenant-context.ts`). No header, query parameter, or
   request body can set it.

## 4. Runtime plumbing (NestJS)

```
JwtAuthGuard (verifies token, reloads principal)
  -> TenantContextInterceptor (binds AsyncLocalStorage for the request)
    -> controllers/services (unchanged call sites)
      -> PrismaService = PrismaClient + TenantPrismaPg adapter
        -> every transaction begins with set_config(..., true)
```

`TenantPrismaPg` (`src/common/prisma/tenant-prisma-pg.ts`) wraps the pg driver
adapter: `startTransaction()` binds the context as the first statement of the
transaction, and single queries outside an explicit transaction are routed
through a transaction too, so no statement can run without the binding. The
binding dies at COMMIT/ROLLBACK - this is what makes Supabase's pooled
connections (pgbouncer session mode) safe.

Reviewed pre-context paths (explicit, narrow, transaction-local):

- **login** (`auth.service.login`, `auth.service.refresh`): `mode: 'login'` -
  read access to users/roles/permissions/refresh_tokens/company rows across
  companies (username and token are unique lookups), never tenant business
  data; writes of refresh tokens allowed for the resolved user only.
- **setup** (`company.setup.service.status/initialSetup`): `mode: 'setup'` -
  may create the first company/users and read the emptiness check. The route
  closes itself as soon as any account exists.

Everything else runs with no mode: strict `app_company_id()`.

Background jobs must wrap their bodies in `runWithTenantContext({ companyId })`
per tenant (helper exported); until wrapped they see zero rows on a RLS
database - the safe direction.

## 5. Role posture

- Runtime role: `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  NOBYPASSRLS`, no table ownership, no `CREATE` on schema `public`, DML grants
  only (provisioned by the migration role; verified by
  `scripts/check-supabase-roles.mjs`).
- `FORCE ROW LEVEL SECURITY` on every table: the owner is subject to the
  policies too, so migration data fixes must set `app.company_id` explicitly
  (rule for future migrations; the checked-in data fixes predate RLS).
- `anon`/`authenticated` (Supabase Data API roles) keep **no** table
  privileges - the migration revokes them where they exist.
- The migration itself contains no role/extension DDL, no destructive
  statements, and no SECURITY DEFINER functions - it passes
  `scripts/supabase-migration-audit.mjs`.

## 6. Proof (tests)

`src/common/prisma/tenant-rls.integration.spec.ts` runs against a real
PostgreSQL (never a mock): applies the migrations via
`scripts/apply-migrations.mjs`, creates the runtime role, seeds two companies,
and connects **as** that role (not via SET ROLE from a superuser session) to
prove:

1. reads return only the session company on direct and deep child tables;
2. no context => zero rows everywhere (deny by default);
3. INSERT with another company (or under another company's parent) is rejected
   by `WITH CHECK`;
4. cross-company UPDATE/DELETE affect zero rows and leave data intact;
5. a company manages its own rows;
6. login mode reads access-control rows (users/tokens/roles) but zero tenant
   business rows, and cannot write tenant rows;
7. system roles and shared catalogs behave as documented (system role readable,
   not writable from a tenant context);
8. the role cannot disable RLS, create policies, drop the context functions,
   switch to `postgres`, own tables, or create schema objects;
9. the transaction-local GUC is gone after COMMIT (pooler safety).

The suite refuses non-local database hosts, so it can never apply migrations to
Supabase by accident. CI runs it in the `tenant-rls` job of
`.github/workflows/supabase-compatibility.yml` against a real PostgreSQL
service.

## 7. Deployment gate (order matters)

Do **not** apply Prisma migrations to the Supabase project until all of the
following are true (user constraint; also `supabase-cloud-pilot.md`):

1. this design and the migration are reviewed;
2. `tenant-rls.integration.spec.ts` is green in CI on a real database;
3. `check-supabase-roles.mjs` passes against the project (read-only) with the
   runtime and migration roles provisioned as specified;
4. only then run `apply-migrations.mjs` with `SUPABASE_MIGRATION_DATABASE_URL`
   (never the runtime URL), and grant the runtime role DML.

## 8. Known limitations / follow-ups

- The schema enforces a single ACTIVE company per installation (partial unique
  index on `companies`). The RLS policies are written multi-company from day
  one; relaxing that business rule is a product decision out of this task's
  scope.
- Background/queue jobs need explicit `runWithTenantContext` wrapping per
  tenant before they do useful work on the cloud database.
- Supabase `service_role` (BYPASSRLS) must never be used by the API; the
  connection profile validator already rejects it for the runtime URL.
