# ERP_KAYAN

Cross-platform enterprise resource planning client (Flutter), targeting **Android,
iOS, Windows, macOS, Linux and Web** from a single codebase.

## Status

Early foundation. The architecture, core services, localization and the
accounting domain are in place; the interface currently covers authentication,
the dashboard, the chart of accounts and settings. All other ERP modules are
deliberately not implemented yet — see "Pending business decisions".

## Architecture

Feature-first layout with an inner clean-architecture split per feature:

```
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
- Money is never a `double`.

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

```bash
flutter pub get
flutter gen-l10n          # regenerate translations after editing .arb files
flutter run -d chrome     # or: -d windows | -d macos | -d linux
```

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
| Backend technology | The API server has not been selected. The client is written against a REST contract; no server is assumed. |
| Tax / VAT rules | Rate source, rounding and the treatment of returns. |
| Inventory costing | FIFO vs weighted average, and when COGS is recognised. |
| Fiscal calendar | Fiscal-year start and period-locking policy. |
| Document numbering | Scope (company/branch/year), gapless vs sequential-with-gaps. |
| Permissions model | Role catalogue and whether approval workflows are required. |
| Reporting | Required statutory reports and their layouts. |

Sample data exists solely so the interface can be exercised before a backend
is chosen. It is not persisted and is never a system of record.
