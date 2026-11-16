# Supabase database CA certificate (public)

`supabase-prod-ca-2021.crt` is the **public** root certificate that signs the
TLS certificates presented by the Supabase database endpoints and the shared
Supavisor session pooler. It is the same file the dashboard serves under
**Database Settings → SSL Configuration → Download certificate** (also
published at `https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`).

It is a certificate, not a secret: committing it only pins the trust root so
`verify-full` TLS can succeed. Nothing here grants access to any database.

## Pinned identity (`scripts/supabase-db-ca.test.mjs` enforces these)

| Field | Value |
| --- | --- |
| Subject / Issuer | `CN=Supabase Root 2021 CA, O=Supabase Inc` (self-signed root) |
| Validity | 2021-04-28 → 2031-04-26 (UTC) |
| SHA-256 fingerprint | `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA` |

## Usage

- GitHub Actions: `read-only-supabase-role-check` uses the repository secret
  `SUPABASE_DB_CA_CERT` when present and falls back to this pinned file.
- Local/CI scripts: `SUPABASE_DB_CA_CERT_FILE=certs/supabase-prod-ca-2021.crt`
  (or set `SUPABASE_DB_CA_CERT` to the PEM text).
- Deployment: `deployment/cloud/supabase-ca.crt` is the runtime copy
  (gitignored); copy this file there after verifying the fingerprint.

## Rotation

If Supabase ever rotates the root (currently valid to 2031-04-26), download
the new certificate from Database Settings, verify its fingerprint over a
trusted channel, replace this file, and update the pinned fingerprint in
`scripts/supabase-db-ca.test.mjs` in the same commit.
