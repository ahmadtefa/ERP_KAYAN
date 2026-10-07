# ERP_KAYAN

Cross-platform enterprise resource planning client (Flutter), targeting **Android,
iOS, Windows, macOS, Linux and Web** from a single codebase.

## Repository layout

| Path | Contents |
| --- | --- |
| `lib/` | Flutter client (Android, iOS, Windows, macOS, Linux, Web) |
| `backend/` | NestJS API server — the only component that talks to the database |
| `docker-compose.yml` | Local / on-premise deployment of PostgreSQL + API |

## Status

**Backend:** working. Authentication (Argon2id + JWT access/refresh), company
and branch scoping, chart of accounts, and journal entries with server-side
double-entry validation, server-generated document numbers, posting, reversal
and an append-only audit trail. PostgreSQL schema with 14 tables and versioned
migrations.

**Client:** authentication, dashboard, chart of accounts (now reading from the
real API) and settings are wired. All other ERP modules are deliberately not
implemented — see "Pending business decisions".

## Architecture

Feature-first layout with an inner clean-architecture split per feature:

```
backend/                       # NestJS API server
├── prisma/schema.prisma       # 14 tables; money is numeric(19,4)
├── prisma/seed.ts             # development seed (company, admin, chart)
└── src/
    ├── common/                # guards, filters, decorators, audit, prisma
    └── modules/               # auth, accounting, health

lib/
├── main.dart                  # bootstrap: logging, ProviderScope
├── app/                       # application shell
│   ├── app.dart               # MaterialApp.router, locale + theme wiring
│   ├── router/                # go_router config and auth redirect
│   ├── shell/                 # responsive navigation (rail / bottom bar)
│   └── theme/                 # Material 3 theme
├── core/                      # cross-cutting, no feature dependencies
│   ├── config/                # AppConfig from --dart-define
│   ├── error/                 # sealed Failure hierarchy
│   ├── result/                # sealed Result<T>
│   ├── money/                 # decimal-safe Money value object
│   ├── network/               # Dio client, bearer token, failure mapping
│   ├── storage/               # keystore tokens + locale preference
│   ├── logging/               # logging facade
│   └── utils/                 # pure validators
├── features/
│   ├── accounting/            # domain / data / presentation
│   ├── auth/                  # domain / data / presentation
│   ├── dashboard/
│   └── settings/
├── shared/                    # widgets, extensions, error localization
└── l10n/                      # en + ar ARB sources and generated code
```

Rules the codebase follows:

- `domain` never imports `data` or `presentation`.
- Only `app/` composes features; features do not import each other's internals.
- The client never talks to a database. All data goes through the HTTP API.
- Money is never a `double` — client uses `Decimal`, server uses `numeric(19,4)`.
- The server enforces accounting rules; the client may hide UI but is never
  the control.

## Accounting core

`JournalEntry` enforces the double-entry invariant at construction time:

- at least two lines, all in the entry's single currency;
- a line is either a debit or a credit, never both, and never negative;
- `isBalanced` compares rounded totals, so sub-cent representation noise
  cannot mask — or fake — an imbalance;
- `post()` refuses an unbalanced entry; posted entries are corrected by
  generating a `reversal()`, never by editing.

These invariants are covered by unit tests.

## Localization

English and Arabic are first-class. Text direction follows the locale, so
switching to Arabic renders the entire application right-to-left. The choice
is persisted and can be reset to the system locale.

## Configuration

Nothing environment-specific is hardcoded. Configuration is injected at build
time:

```bash
flutter run \
  --dart-define=APP_ENV=development \
  --dart-define=API_BASE_URL=http://localhost:8080/api/v1
```

`APP_ENV` accepts `development`, `staging`, `production` or `onPremise`.
Seed (sample) data is enabled **only** in `development`; any other environment
always talks to the real API, and the interface displays a banner whenever
sample data is in use.

## Getting started

> **على ويندوز؟** فيه دليل عربي كامل خطوة بخطوة في
> [`RUN_LOCALLY.md`](RUN_LOCALLY.md) — بشرح تنصيب البرامج وتشغيل كل حاجة.
> وفيه سكربتات جاهزة في مجلد `scripts/` بتعمل الإعداد لوحدها.
>
> **On Windows?** A full step-by-step guide is in
> [`RUN_LOCALLY.md`](RUN_LOCALLY.md) (Arabic), with helper scripts in
> `scripts/`.

The client needs the API running. Full Windows instructions are in
[`backend/README.md`](backend/README.md); in short:

```bash
# terminal 1 — database and API
cd backend
npm install
npx prisma generate
npx prisma migrate deploy
npx ts-node prisma/seed.ts
npm run start:dev            # http://localhost:3000/api/v1

# terminal 2 — client
cd ..
flutter pub get
flutter gen-l10n             # regenerate translations after editing .arb files
flutter run -d chrome        # or: -d windows | -d macos | -d linux
```

Development sign-in: `admin` / `Admin@12345` — **change it before real use**.

The client never connects to PostgreSQL. Every read and write goes through the
API, which is the single source of truth.

## Quality gates

```bash
dart format --output=none --set-exit-if-changed .
flutter analyze
flutter test
flutter build web --release
```

All four currently pass: `flutter analyze` reports no issues and 60 tests pass.

## Pending business decisions

The following are intentionally not decided in code:

| Area | Question |
| --- | --- |
| Backend technology | **Decided:** NestJS + Prisma + PostgreSQL |
| Tax / VAT rules | Rate source, rounding and the treatment of returns. |
| Inventory costing | FIFO vs weighted average, and when COGS is recognised. |
| Fiscal calendar | Fiscal-year start and period-locking policy. |
| Document numbering | Scope (company/branch/year), gapless vs sequential-with-gaps. |
| Permissions model | Role catalogue and whether approval workflows are required. |
| Reporting | Required statutory reports and their layouts. |

The API is now the source of data. A local sample source still exists for
working on the interface without a server, but it is **opt-in and disabled by
default**; enable it only for development:

```bash
flutter run -d chrome --dart-define=USE_SEED_DATA=true
```

It is refused outside development builds, and the UI shows a banner whenever
it is active. It is never a system of record.
