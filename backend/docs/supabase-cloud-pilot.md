# Supabase cloud pilot

> **Implementation status (branch `feature/supabase-pilot`)**
>
> - Tenant row-level security is **designed and implemented**: migration
>   `20261115120000_tenant_rls_policies` (79 tables, FORCE RLS, deny-by-default,
>   reviewed login/setup paths) - see `supabase-tenant-rls.md` for the design.
> - Trusted company context: `TenantContextInterceptor` + AsyncLocalStorage +
>   `TenantPrismaPg` transaction-local `set_config` binding (pooler-safe).
> - Proof: `tenant-rls.integration.spec.ts` (12 tests) runs REAL cross-company
>   CRUD against a real PostgreSQL as the least-privilege runtime role; wired
>   into `.github/workflows/supabase-compatibility.yml` (`tenant-rls` job).
> - **Migrations are still NOT applied to the Supabase project** - the
>   deployment gate in `supabase-tenant-rls.md` §7 must be completed first.
>
> What remains for the cloud pilot after the gate: provision the two roles,
> run `check-supabase-roles.mjs` read-only, apply migrations with the migration
> URL, grant runtime DML, and wire background jobs to the tenant context.

## Connection profiles

Local remains the default: `DATABASE_PROFILE=local` (or unset) uses the existing `DATABASE_URL`, so Windows can continue to run against its bundled/local PostgreSQL without internet.

The NestJS runtime cloud profile is explicit: `DATABASE_PROFILE=supabase` reads `SUPABASE_DATABASE_URL`. It accepts TLS only and the shared Supavisor session pooler on port 5432. Transaction pooling is intentionally rejected because the persistent PrismaPg client uses session semantics and prepared statements.

Prisma CLI database commands in cloud mode use `SUPABASE_MIGRATION_DATABASE_URL`, separate from the runtime secret. Migration URLs may use the direct endpoint or session pooler, both on port 5432 and TLS. Schema-only commands such as `prisma validate` and `prisma generate` do not need database credentials. Never run `scripts/prepare-database.mjs` against Supabase: it creates roles/databases for desktop installs.

## Required database roles

Provision two different custom roles through a secure Supabase administration channel:

- Runtime role: LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS. It must not own tables and must not have CREATE on `public`; grant only the table/sequence DML needed by the API after policies are reviewed.
- Migration role: separate LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, with CREATE on `public` and ownership of objects it creates. Object ownership can bypass ordinary RLS unless FORCE ROW LEVEL SECURITY is used, so keep this secret only in the trusted migration workflow. It is never the application credential.
- Do not grant `anon` or `authenticated` privileges on ERP tables. Do not use `postgres` or `service_role` for NestJS.

The manual Actions role preflight is read-only. It checks TLS, role separation and attributes, runtime schema privileges, RLS/policy presence on existing public tables, and table grants to Data API roles. It does not apply migrations.

## Tenant RLS is a separate deployment gate

The checked-in Prisma migrations create no RLS policies. Supabase's `ensure_rls` event trigger enables RLS on newly created public tables, but it does not create tenant policies. The runtime role must therefore remain unable to read the migrated tables until policy work is complete.

The schema's tenant root is `companies.id`; tables carrying `companyId` must scope it to the authenticated company. Child rows without `companyId` must inherit the same scope through their parent relation, including journal lines/allocations, voucher allocations, opening-balance lines, stock-document lines, invoice lines, quotation tables/lines/events, item units, order lines, price-list items, user permissions, role permissions/branches, refresh tokens, and stock-take lines. System permission catalog rows, system roles, audit rows with null company IDs, and device-level licence records need explicit, separate access rules rather than a blanket tenant policy.

Current NestJS services use a process-wide Prisma client and the public login looks up a globally unique username before a company is known. There is no transaction-local authenticated company context yet. A secure implementation must establish that context from the verified principal for each request and apply it with transaction-local state; login and background/license operations need separate reviewed paths. Until that work and cross-company denial tests exist, do not apply the Prisma migrations or grant runtime DML.
