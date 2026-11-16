# KAYAN ERP browser pilot (deployment template only)

This is a self-hosted HTTPS template. It does not deploy, publish an image, or apply database migrations. GitHub Actions builds and validates the frontend and image only.

## Before starting

- A Linux VM with Docker Engine and Docker Compose v2.
- A domain whose A/AAAA records point to that VM; allow inbound TCP 80 and 443 (and UDP 443 for HTTP/3).
- The current Supabase database CA certificate from Database Settings.
- The dedicated runtime role and a passing read-only Supabase role/RLS preflight.

## Prepare the host

1. Copy .env.cloud.example to .env.cloud. Set ERP_DOMAIN, SUPABASE_DATABASE_URL, and two unique random JWT secrets. Use the runtime role's session-pooler URL on port 5432 and URL-encode reserved credential characters.
2. Save the Supabase CA certificate as supabase-ca.crt in this directory. Both files are ignored by Git.
3. From the repository root, build Flutter Web and stage it for the API container:

   flutter pub get
   flutter build web --release --dart-define=APP_ENV=production --dart-define=API_BASE_URL=/api/v1
   mkdir -p backend/build
   cp -a build/web backend/build/web

4. Start the pilot from this directory:

   docker compose --env-file .env.cloud build
   docker compose --env-file .env.cloud up -d
   docker compose ps

Caddy obtains and renews HTTPS certificates when DNS and ports 80/443 are reachable. It forwards requests to NestJS, which serves Flutter and /api/v1 on one HTTPS origin. The API port is private to the Compose network.

## Database and recovery gate

The app container uses only SUPABASE_DATABASE_URL; it has no startup migration or database-creation command. Do not set ADMIN_DATABASE_URL, SUPABASE_MIGRATION_DATABASE_URL, or run prepare-database.mjs in the app service.

Before the first Prisma migration, create an encrypted custom-format pg_dump of the current database and verify restore into a separate disposable PostgreSQL 17 database (or isolated Supabase branch). Record the current Supabase migration ledger and confirm backup/PITR retention and restore permissions in the Supabase dashboard. Treat the backup as unverified until restoration succeeds. Keep migrations separate, use only the migration credential, and apply them only after the role/RLS review, confirmed restore path, and explicit approval. This Compose template contains no migration command.

## GitHub Actions TLS setup

The Cloud web package preflight builds but never deploys. The Supabase role workflow additionally needs the GitHub Actions secret SUPABASE_DB_CA_CERT containing the PEM CA certificate downloaded from Supabase Database Settings. The checker uses this CA with certificate and hostname verification and does not disable TLS checks. No Supabase URL, password, or key is embedded in Flutter assets.
