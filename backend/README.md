# KAYAN ERP — API Server

NestJS + Prisma + PostgreSQL. This is the **only** component that talks to the
database; the Flutter client never connects to PostgreSQL directly.

## Why this stack

| Choice | Reason |
| --- | --- |
| NestJS (TypeScript) | Fast to build, large ecosystem, straightforward Docker deployment |
| PostgreSQL | Required for accounting: exact `numeric(19,4)` arithmetic, real transactions, referential integrity |
| Prisma | Typed schema, versioned migrations, safe parameterised queries |

## Current API surface

All routes are prefixed with `/api/v1`.

| Method | Path | Permission required |
| --- | --- | --- |
| GET | `/health` | public |
| POST | `/auth/login` | public |
| POST | `/auth/refresh` | public |
| POST | `/auth/logout` | authenticated |
| GET | `/auth/me` | authenticated |
| GET | `/accounting/chart-of-accounts` | `accounting.accounts.read` |
| GET | `/accounting/journal-entries` | `accounting.journal.read` |
| GET | `/accounting/journal-entries/:id` | `accounting.journal.read` |
| POST | `/accounting/journal-entries` | `accounting.journal.create` |
| POST | `/accounting/journal-entries/:id/post` | `accounting.journal.post` |
| POST | `/accounting/journal-entries/:id/reverse` | `accounting.journal.post` |

## Accounting rules enforced by the server

These are **not** UI conveniences — the API rejects violations:

1. **Debits must equal credits.** Compared with exact decimal arithmetic; the
   error response reports the exact difference.
2. **A line is a debit or a credit, never both, never negative.**
3. **Only postable, active accounts accept postings.** Grouping accounts are
   rejected by code (e.g. `Accounts cannot receive postings: 11`).
4. **Document numbers are server-generated** (`JV-000001`). Allocation takes a
   row lock inside the same transaction that creates the document, so two
   concurrent requests cannot receive the same number.
5. **Posted entries are immutable.** Corrections are made by reversal, which
   creates a mirror entry and marks the original `REVERSED`.
6. **Company scoping comes from the verified token**, never from a request
   parameter, so one company cannot read another's data.

## Running locally (Windows)

### 1. Install prerequisites

- **Node.js 20 LTS** — https://nodejs.org (LTS installer, accept defaults)
- **PostgreSQL 17** — https://www.postgresql.org/download/windows/
  Remember the password you set for the `postgres` superuser.

### 2. Create the database

Open **SQL Shell (psql)** from the Start menu and run:

```sql
CREATE ROLE erp_app WITH LOGIN PASSWORD 'choose-a-strong-password';
CREATE DATABASE erp_kayan OWNER erp_app;
ALTER ROLE erp_app CREATEDB;   -- needed for Prisma migrations
\q
```

### 3. Configure the API

```cmd
cd backend
copy .env.example .env
```

Edit `.env` and set `DATABASE_URL` with the password you chose:

```
DATABASE_URL="postgresql://erp_app:choose-a-strong-password@127.0.0.1:5432/erp_kayan?schema=public"
```

Generate the JWT secrets — run this **twice** and paste a different value into
each variable:

```cmd
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

### 4. Install, migrate, seed, run

```cmd
npm install
npx prisma generate
npx prisma migrate deploy
npx ts-node prisma/seed.ts
npm run start:dev
```

The API is then at `http://localhost:3000/api/v1`.

### 5. Verify

```cmd
curl http://localhost:3000/api/v1/health
```

Expected:

```json
{"status":"ok","database":"up","timestamp":"..."}
```

### Default development login

| Field | Value |
| --- | --- |
| Username | `admin` |
| Password | `Admin@12345` |

**Change this password before any real use.** Override it during seeding with
the `SEED_ADMIN_PASSWORD` environment variable.

## Connecting the Flutter client

```cmd
cd ..
flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:3000/api/v1
```

The default already points at port 3000 for development.

## Security notes

- Passwords are hashed with **Argon2id**; the plaintext is never stored.
- Five failed sign-ins lock the account for 15 minutes.
- Sign-in failures return one generic message, so usernames cannot be
  enumerated.
- Refresh tokens are stored **hashed** and rotated on every use.
- Every request is authenticated by default; routes opt out explicitly with
  `@Public()`.
- Permissions are deny-by-default and enforced server-side.
- No secret is ever committed — `.env` is git-ignored, `.env.example` is a
  template only.
- Login, failed login, create, post and reverse operations are written to the
  append-only `audit_logs` table.

## Not yet implemented

Honest list — these are deliberately absent, not forgotten:

- Companies/branches/users/roles CRUD endpoints (data exists; no API yet)
- Customers, suppliers, items, warehouses, sales, purchases, treasury
- Financial reports (trial balance, P&L, balance sheet)
- Fiscal periods and period locking
- Rate limiting, 2FA, password reset
- Automated tests for the backend
- HTTP-only refresh-cookie flow for the web build

## Pending business decisions

| Topic | Question |
| --- | --- |
| Document numbering | Must numbers be gapless? Do they restart each fiscal year? |
| Fiscal calendar | Fiscal-year start date |
| Chart of accounts | Is the seeded chart the approved statutory chart? |
| Cost centres | Required on every line, or optional? |
| Period locking | Who may reopen a closed period? |
