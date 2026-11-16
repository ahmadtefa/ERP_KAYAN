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

The NestJS runtime cloud profile is explicit: `DATABASE_PROFILE=supabase` reads `SUPABASE_DATABASE_URL`. It requires verified TLS with the Supabase CA certificate from `SUPABASE_DB_CA_CERT` or `SUPABASE_DB_CA_CERT_FILE`, and the shared Supavisor session pooler on port 5432. Transaction pooling is intentionally rejected because the persistent PrismaPg client uses session semantics and prepared statements.

Prisma CLI database commands in cloud mode use `SUPABASE_MIGRATION_DATABASE_URL`, separate from the runtime secret, and use the same verified CA configuration. Migration URLs may use the direct endpoint or session pooler, both on port 5432 and TLS. Schema-only commands such as `prisma validate` and `prisma generate` do not need database credentials. Never run `scripts/prepare-database.mjs` against Supabase: it creates roles/databases for desktop installs.

## Supabase database CA (`SUPABASE_DB_CA_CERT`)

Supabase's database/pooler certificates chain to the private **Supabase Root 2021 CA**, which is not in Node's or libpq's public trust store. Without it every verified connection fails with `self-signed certificate in certificate chain`. The CA is public (not a secret): it is pinned in `backend/certs/supabase-prod-ca-2021.crt` (`certs/README.md` documents its fingerprint and rotation; `scripts/supabase-db-ca.test.mjs` enforces the pin) and is the same file the dashboard serves under **Database Settings → SSL Configuration → Download certificate**.

- GitHub secret `SUPABASE_DB_CA_CERT` = the full PEM text of that certificate (optional; the workflow falls back to the pinned file). The connection secrets stay in `SUPABASE_RUNTIME_DATABASE_URL` / `SUPABASE_MIGRATION_DATABASE_URL`.
- Local runs: `SUPABASE_DB_CA_CERT_FILE=certs/supabase-prod-ca-2021.crt`.
- `check-supabase-roles.mjs` and the runtime pool refuse to connect without it (fail closed, `rejectUnauthorized: true`, ssl-mode URL parameters are stripped so they cannot downgrade verification).

## External backup and restore drill

`scripts/cloud-backup-drill.mjs` (`npm run cloud:backup-drill`) provides the pre-migration backup gate from `supabase-tenant-rls.md` §7:

- `backup --url <source> --out <dir>`: `pg_dump -Fc --schema=public` (all program objects; Supabase-managed schemas such as `auth`/`storage` are excluded - the app keeps its own users in `public.users`) with verified TLS (`verify-full` + the pinned CA) for Supabase hosts; set `KAYAN_BACKUP_PASSPHRASE` to store the artifact AES-256 encrypted, otherwise it is written with mode 0600. The dump is an external copy - keep it outside the repository and outside the database host.
- `drill --dump <file> --admin-url <local-url>`: restores into a scratch database on an isolated local PostgreSQL 17 (loopback admin URL only - a drill can never touch Supabase), verifies tables/RLS/policies/`_prisma_migrations`, and drops the scratch database. `scripts/cloud-backup-drill.test.mjs` proves the guards (no ssl downgrade, CA required, loopback-only).
- Take the backup with `SUPABASE_MIGRATION_DATABASE_URL` (read access to all schemas) before any migration run, and run the drill after it. Both are read-only with respect to Supabase.

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


## HTTPS browser pilot packaging

The deployment/cloud files and backend/Dockerfile.cloud provide a cloud-only container with Caddy in front of NestJS. Flutter Web is built with API_BASE_URL=/api/v1, so requests stay same-origin; no Supabase URL, password, or key is compiled into Flutter. The existing Windows/offline profile remains DATABASE_PROFILE=local.

The Cloud web package preflight builds Flutter Web and the Docker image on feature/supabase-pilot. It does not publish or deploy either artifact. The Compose template does not run migrations or prepare-database.mjs.

Before running the browser container, set a DNS name and copy deployment/cloud/.env.cloud.example to the ignored .env.cloud; provide the runtime URL and JWT secrets there, and place the downloaded Supabase database CA at the ignored deployment/cloud/supabase-ca.crt. The migration URL stays out of the app container. Caddy obtains the HTTPS certificate after DNS points to the host and inbound ports 80/443 are available.
