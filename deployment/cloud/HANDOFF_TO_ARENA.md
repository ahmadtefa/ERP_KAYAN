# KAYAN ERP Cloud — Arena Handoff

Updated: 2026-11-17  
Repository: [ahmadtefa/ERP_KAYAN](https://github.com/ahmadtefa/ERP_KAYAN)  
Work branch: `feature/supabase-pilot`  
Comparison branch: `codex/kayan-final-review` (read-only)  
Verified implementation HEAD before this handoff file: `29ba7570ff8ac35fcc9c4349636374b78e8f877b`

The workspace used for this handoff has no local Git checkout. GitHub is the source of truth; there are no local repository changes to import. Do not recreate already-pushed changes or repeat successful checks below unless a later change requires them.

## Completed and verified

- Supabase project `kayan-erp-dev` (`yyaodengmthijrqxyczf`) is active on PostgreSQL 17.
- All 72 checked-in Prisma migrations are applied through the official Prisma Migrate CLI. The current database reports 72 complete rows in `public._prisma_migrations`.
- The Prisma CLI uses its classic engine for migrations and verifies TLS with the pinned Supabase CA using strict certificate validation. Runtime uses the dedicated `kayan_runtime` credential; schema changes and backups use `kayan_migrator`.
- Runtime and migrator were checked as separate least-privilege roles. Neither is superuser or has `BYPASSRLS`; runtime has no `CREATE` on `public`.
- `public` contains 80 application tables. All 80 have forced RLS and at least one tenant policy. No application table grants SELECT to `anon` or `authenticated`.
- A migration removed the single-active-company unique index that prevented a second company. A real Supabase runtime smoke test inserted two temporary active companies and branches inside a transaction, verified cross-company reads/writes were denied and transaction context cleared, then rolled back all test rows.
- The database currently has zero companies and zero users. The 81 permission catalog rows are application seed data.
- The migration principal has an explicit SELECT-only `backup_select_migrator` policy on all 81 public tables (including migration history) so a full backup can include every tenant while RLS remains enabled. This credential can read all tenant data and must remain restricted to CI backup/migration tasks; never configure it as the application runtime.
- The exact supplied logo is tracked as root `1.png`; its Git blob SHA matches the attached file. `pubspec.yaml` references `1.png`, and `Dockerfile.render` copies it into the Flutter build context with `COPY 1.png ./1.png`.

## Successful GitHub Actions

- [Supabase compatibility preflight — latest](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/44034598397) — success, including live TLS/role checks, static migration audit, and PostgreSQL 17 tenant isolation.
- [Encrypted backup and PostgreSQL 17 restore drill — latest](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/44034598339) — success. Restored snapshot verified 81 public tables, 81 RLS-enabled tables, 173 policies, and 72 Prisma migrations; scratch database was dropped.
- [Prisma migration deployment](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/44033777270) — success; 72/72 migrations and post-deployment security checks passed.
- [Live Supabase two-company RLS smoke](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/44034117486) — success; test data was rolled back.
- [Flutter Web and integrated Docker package](https://github.com/ahmadtefa/ERP_KAYAN/actions/runs/44030952527) — success, including the Docker image build with the root logo asset.

Several earlier attempts failed while fixing TLS configuration, the company index, and the backup restore drill. They are superseded by the successful runs linked above.

## Current Supabase state

- Prisma schema/migration history: 72 migrations complete.
- Public application tables: 80; forced RLS: 80/80; tables without policy: 0; REST SELECT grants to `anon`/`authenticated`: 0.
- Companies: 0; users: 0; permission catalog rows: 81.
- Supabase's separate migration-list endpoint shows its existing platform migration record; use `public._prisma_migrations` as the Prisma deployment history.

## Backup and recovery

The latest encrypted backup and restore drill succeeded on the post-migration schema using PostgreSQL 17. Backups use the dedicated migration credential, verified Supabase TLS, and the GitHub Secret `KAYAN_BACKUP_PASSPHRASE`. The workflow retains the encrypted artifact for 30 days. Never print or copy secret values into this file, Flutter, logs, or the repository.

For any future schema migration: review SQL, run the local PostgreSQL 17 preflight, obtain a fresh encrypted backup and successful restore drill of the current schema, verify the target and roles, then use `prisma migrate deploy --config prisma.migrate.config.ts`. Do not apply SQL through Supabase's migration ledger and do not rerun the 72 migrations manually.

## Deployment settings (no secret values)

The existing Render configuration is `render.yaml` and builds the integrated image with `Dockerfile.render`:

- Service type: free Docker web service, branch `feature/supabase-pilot`, health check `/api/v1/health`.
- Set Render `DATABASE_URL` to the session-mode pooler URL for `kayan_runtime` on port 5432 with TLS verification. URL-encode reserved password characters.
- Set distinct random `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` values (32+ characters). The Render manifest generates these values.
- The image includes `backend/certs/supabase-prod-ca-2021.crt` and sets `SUPABASE_DB_CA_CERT_FILE`; keep TLS verification enabled.
- Do not set the migrator URL or backup passphrase on the running web service.
- CI secrets already used by the workflows are `SUPABASE_RUNTIME_DATABASE_URL`, `SUPABASE_MIGRATION_DATABASE_URL`, and `KAYAN_BACKUP_PASSPHRASE`. Their values are not recorded here.

## Render and HTTPS blocker

The Render workspace is `Ahmed’s workspace`. The Render connector returned `need_payment_info` when planning the free blueprint, and the workspace currently has no service. No payment information was entered, no paid resource was created, and no deployment or HTTPS URL exists. Do not bypass this account gate or subscribe to a paid plan.

## Remaining steps to browser delivery

1. Resolve hosting without a paid subscription: use Render only if the workspace permits the free service without requiring paid billing setup; otherwise select a genuinely available free Docker host. No host was deployed in this handoff.
2. Connect only `feature/supabase-pilot`, load the runtime database URL and JWT secrets into the host's secret store, and deploy the existing Render/Docker configuration. Keep the migrator and backup credentials in CI only.
3. Verify the HTTPS certificate, `/api/v1/health`, same-origin Flutter-to-NestJS requests, CORS/session behavior, and Arabic RTL rendering.
4. Run the browser acceptance flow for login/logout, company setup, core accounts/items/invoices/inventory/reports, and invalid/expired sessions.
5. Repeat the two-company isolation test against the deployed backend and verify no test data remains. The existing live database RLS smoke already passed at the database layer; it is not a substitute for browser acceptance.
6. Do not repeat successful backup, migration, logo/Docker build, or RLS runs unless code or environment changes invalidate them.
7. Preserve Windows Offline, `main`, license behavior, and the comparison branch.

## Known limits

- No backend or Flutter Web service is deployed, so browser login and ERP workflow acceptance have not yet been run.
- The successful live tenant drill is a database-level test, not a full NestJS/browser test.
- This handoff does not authorize a merge, release, paid hosting, or another production database migration.
