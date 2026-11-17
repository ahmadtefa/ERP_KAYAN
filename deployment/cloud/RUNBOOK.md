# KAYAN ERP Cloud — operations runbook

This runbook runs, updates, backs up, and restores the browser edition of
KAYAN ERP (Flutter Web + NestJS on one HTTPS origin, Supabase PostgreSQL 17
as the database). Supabase hosts the DATABASE ONLY: the web client and the
API are self-hosted on your own VM with Docker Compose (`compose.yaml` +
Caddy for automatic HTTPS). Nothing here touches the Windows Offline
edition, its installer, its data, or its licences.

## 1. First deployment

Prerequisites: a Linux VM (2 GB RAM is enough), Docker Engine + Compose v2,
a domain whose A/AAAA records point at the VM, inbound TCP 80/443 (and UDP
443 for HTTP/3), a Supabase project, and the two least-privilege database
roles (`kayan_runtime`, `kayan_migrator`) provisioned per
`backend/docs/supabase-cloud-pilot.md`.

```bash
# 1) Build the browser client and stage it for the API image
flutter pub get
flutter build web --release --dart-define=APP_ENV=production --dart-define=API_BASE_URL=/api/v1
mkdir -p backend/build && cp -a build/web backend/build/web

# 2) Configure secrets (gitignored)
cd deployment/cloud
cp .env.cloud.example .env.cloud        # set ERP_DOMAIN, SUPABASE_DATABASE_URL, JWT secrets
cp /path/to/prod-ca-2021.crt supabase-ca.crt   # Supabase CA (backend/certs/supabase-prod-ca-2021.crt)

# 3) Apply database migrations ONCE, with the MIGRATION credential only
cd ../../backend
SUPABASE_DB_CA_CERT_FILE=certs/supabase-prod-ca-2021.crt \
SUPABASE_MIGRATION_DATABASE_URL='postgresql://kayan_migrator.PROJECT_REF:PASSWORD@HOST:5432/postgres?sslmode=verify-full' \
  node scripts/apply-migrations.mjs

# 4) Start the stack
cd ../deployment/cloud
docker compose --env-file .env.cloud build
docker compose --env-file .env.cloud up -d
```

Caddy obtains the HTTPS certificate automatically once DNS resolves. Open
`https://YOUR_DOMAIN` — the first-run screen creates the company and the
administrator account. Run the acceptance suite against the live URL:

```bash
cd backend
ACCEPTANCE_USERNAME='operator' ACCEPTANCE_PASSWORD='...' \
  npm run cloud:acceptance -- --base https://YOUR_DOMAIN
```

## 2. Update procedure

```bash
git fetch && git checkout <new-sha>            # or unpack the delivery bundle
flutter build web --release --dart-define=APP_ENV=production --dart-define=API_BASE_URL=/api/v1
rm -rf backend/build/web && cp -a build/web backend/build/web
cd deployment/cloud && docker compose --env-file .env.cloud up -d --build
```

Database migrations for a release (only with the migration credential, only
after the backup drill of §3, only with explicit approval):

```bash
cd backend && SUPABASE_MIGRATION_DATABASE_URL='...' node scripts/apply-migrations.mjs
```

Rollback: redeploy the previous image/commit; migrations are
forward-applied — restore the database from the backup drill if a migration
must be undone (see §3).

## 3. Backup and restore (cloud)

Full-database archives are intentionally NOT available to company users in
the cloud profile (they would contain every tenant). The cloud backup path
is the external, encrypted drill:

```bash
cd backend
export SUPABASE_DB_CA_CERT_FILE=certs/supabase-prod-ca-2021.crt
export KAYAN_BACKUP_PASSPHRASE='<strong passphrase kept OUTSIDE the repo>'

# nightly, from cron on the VM (read-only against Supabase):
node scripts/cloud-backup-drill.mjs backup \
  --url "$SUPABASE_MIGRATION_DATABASE_URL" --out /var/backups/kayan-erp

# weekly restore rehearsal on an isolated PostgreSQL 17 (loopback only):
node scripts/cloud-backup-drill.mjs drill \
  --dump /var/backups/kayan-erp/kayan-backup-....dump.enc \
  --admin-url 'postgresql://kayan:PASSWORD@127.0.0.1:5432/postgres'
```

The drill refuses non-loopback admin URLs and verifies tables/RLS
policies/`_prisma_migrations` before dropping the scratch database. Keep at
least one copy of the backup OFF the server. A backup that has never been
restored in a drill is not a backup.

## 4. Secrets and certificates

- `.env.cloud` and `supabase-ca.crt` are gitignored; never commit them.
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`: 32+ random chars each, rotated
  by editing `.env.cloud` and `docker compose up -d` (sessions reset).
- The database password lives only in `SUPABASE_DATABASE_URL` inside
  `.env.cloud`; rotate it with `ALTER ROLE ... PASSWORD` on Supabase and by
  editing the URL. The app runtime role is never `postgres`/`service_role`.
- TLS to the database is `verify-full` with the pinned Supabase Root 2021 CA
  (`backend/certs/README.md` documents the fingerprint and rotation).

## 5. Health checks and monitoring

- `GET /api/v1/health` — liveness (also the Compose healthcheck).
- `GET /api/v1/health/details` — database reachability.
- Compose keeps the API private; only Caddy publishes 80/443.

## 6. Supabase Free-tier limits

- 500 MB database + 5 GB egress/month + 2 projects; the project **pauses
  after ~7 days of inactivity** — a scheduled nightly backup/health request
  also serves as activity.
- No PITR on the free tier: point-in-time recovery is unavailable, so the
  external backup drill of §3 is the ONLY restore path — run it weekly.
- The shared pooler caps concurrent connections (~60 on free): the API pool
  is small and session-mode; do not raise `connection_limit` beyond 5–10.
- Monitor the Supabase dashboard for egress/DB size before adding heavy
  import/export workloads.

## 7. Acceptance checklist (per release)

1. `npm run cloud:acceptance -- --base https://YOUR_DOMAIN` passes
   (health → first-run/company → sign-in → items → customers → quotation →
   reports → token rotation → security negatives → tenant scoping).
2. `node --test scripts/supabase-migration-audit.test.mjs scripts/supabase-db-ca.test.mjs`
3. The tenant isolation suite (CI `tenant-rls` job) is green.
4. One backup + one restore drill succeeded after the release.
